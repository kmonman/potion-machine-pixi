// The gameplay screen, rebuilt on PixiJS. Phase 1 built this around one global
// `Platform`; Phase 2 (the pinball-tower expansion) turned `Platform` into a
// factory (see platform.js) so multiple independent platforms can exist at once,
// stacked in a `PlayScreen.platforms` array — this file's job is now to build a
// Pixi visual "bundle" per platform instead of one fixed set of sprites, plus a
// world/camera split: platforms + the ball live inside `worldContainer`, which
// pans vertically to follow the ball as it climbs/falls (Rob: camera follows the
// ball, doesn't show the whole tower fixed); the background/fog/vignette and the
// HUD stay screen-fixed, outside the panning container.

// Pixi sprite tints take a single packed 0xRRGGBB number, not separate
// channels — the old ctx-based particle code kept r/g/b as separate lerped
// floats the whole way through, so this just packs them at the point of use.
function rgbToHex(r, g, b) {
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
}
function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

const PlayScreenPixi = {
  container: null,
  worldContainer: null,
  _fogSprites: [],
  _ballSprite: null,
  _camY: 0,
  _dt: 1 / 60,

  build(textures) {
    const c = new PIXI.Container();
    this.container = c;

    // Built once and reused by every jet on every platform, every frame (see
    // _refreshJets) — a FillGradient bakes its own small GPU texture, so
    // constructing a fresh one per jet per frame (as an earlier version did)
    // leaked GPU memory continuously until it crashed a phone. Center is (0,0)
    // since each jet's nozzle Graphics gets positioned at the jet's world
    // location instead (nozzle.position.set), so the gradient itself never
    // needs to know where any particular jet actually is.
    this._jetAuraGradient = new PIXI.FillGradient({
      type: 'radial', center: { x: 0, y: 0 }, innerRadius: 0, outerCenter: { x: 0, y: 0 }, outerRadius: 24,
      colorStops: [
        { offset: 0, color: 'rgba(120,170,255,0.35)' },
        { offset: 1, color: 'rgba(90,140,255,0)' },
      ],
      textureSpace: 'local',
    });
    this._jetCoreGradient = new PIXI.FillGradient({
      type: 'radial', center: { x: 0, y: 0 }, innerRadius: 0, outerCenter: { x: 0, y: 0 }, outerRadius: 6,
      colorStops: [
        { offset: 0, color: 'rgba(255,255,255,0.95)' },
        { offset: 0.5, color: 'rgba(180,210,255,0.6)' },
        { offset: 1, color: 'rgba(180,210,255,0)' },
      ],
      textureSpace: 'local',
    });

    const bg = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x0a0410);
    c.addChild(bg);

    // Fog — 3 layers, each 2 stacked sprites (see Fog.layers in fog.js for the
    // actual scroll/wrap math, unchanged). Screen-fixed background atmosphere,
    // not part of the panning world — it doesn't need to scroll with the camera.
    for (const l of Fog.layers) {
      const img = new PIXI.Sprite(textures[l.key]);
      img.width = 720; img.height = 1280;
      const imgFlip = new PIXI.Sprite(textures[l.key + 'Flip']);
      imgFlip.width = 720; imgFlip.height = 1280;
      c.addChild(img, imgFlip);
      this._fogSprites.push({ key: l.key, sprite: img, spriteFlip: imgFlip });
    }

    // Vignette — same gradient shape as Fog._drawVignette, built once as a
    // Graphics fill using Pixi's gradient fill support.
    const vignette = new PIXI.Graphics();
    const grad = new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: 0, x1: 0, y1: 1280,
      colorStops: [
        { offset: 0, color: 'rgba(10,4,16,1)' },
        { offset: 0.55, color: 'rgba(10,4,16,1)' },
        { offset: 0.68, color: 'rgba(10,4,16,0.78)' },
        { offset: 0.82, color: 'rgba(10,4,16,0.6)' },
        { offset: 1, color: 'rgba(10,4,16,0.45)' },
      ],
      textureSpace: 'local',
    });
    vignette.rect(0, 0, 720, 1280).fill(grad);
    c.addChild(vignette);

    // The panning world — every platform and the ball live in here. Built once
    // PlayScreen.platforms exists (PlayScreen.enter() runs before the first
    // build() call from game.js's main(), same ordering Phase 1 relied on for
    // JET_DEFS).
    this.worldContainer = new PIXI.Container();
    c.addChild(this.worldContainer);

    for (const p of PlayScreen.platforms) {
      this._buildPlatformVisual(p, textures);
    }

    // Ball — a sprite rotating around its own center, position/rotation copied
    // from Physics.x/y/rotation every frame. Z-order relative to each
    // platform's hinge/bubbles is re-applied every frame in refresh() (see
    // _restackBall) since which platform it's "behind" changes as it climbs.
    this._ballSprite = new PIXI.Sprite(textures.ball);
    this._ballSprite.anchor.set(0.5);
    const ballSize = Physics.displayRadius * 2;
    this._ballSprite.width = ballSize; this._ballSprite.height = ballSize;
    this.worldContainer.addChild(this._ballSprite);
  },

  // Builds one platform's full visual bundle (pole if it has one, bar+liquid+
  // glass, hinge glow/particles, jets) and adds it all to worldContainer,
  // storing the pieces refresh() needs on `p._visual`. Mirrors the Phase 1
  // single-platform build() step for step, just parameterized per platform
  // instead of reading the old global `Platform`/`textures` directly.
  _buildPlatformVisual(p, textures) {
    const wc = this.worldContainer;
    const v = {};
    p._visual = v;

    // Pole — only the base platform has one (Rob: the platforms stacked above
    // it are just floating bars, not each mounted on their own post).
    if (p.hasPole) {
      const poleX = p.pivot.x - 25;
      v.poleSprite = new PIXI.Sprite(textures.pole);
      v.poleSprite.position.set(poleX, p.pivot.y);
      v.poleSprite.width = 50; v.poleSprite.height = p.poleHeight;
      wc.addChild(v.poleSprite);

      const poleGrad = new PIXI.FillGradient({
        type: 'linear', x0: 0, y0: p.pivot.y, x1: 0, y1: p.pivot.y + p.poleHeight,
        colorStops: [
          { offset: 0, color: 'rgba(170,100,255,0.9)' },
          { offset: 0.6, color: 'rgba(170,100,255,0.55)' },
          { offset: 1, color: 'rgba(170,100,255,0)' },
        ],
        textureSpace: 'local',
      });
      v.poleGlowBlurred = new PIXI.Graphics()
        .roundRect(poleX, p.pivot.y, 50, p.poleHeight, 10).stroke({ width: 6, fill: poleGrad });
      v.poleGlowBlurred.filters = [new PIXI.BlurFilter({ strength: 8 })];
      v.poleGlowSolid = new PIXI.Graphics()
        .roundRect(poleX, p.pivot.y, 50, p.poleHeight, 10).stroke({ width: 3, fill: poleGrad });
      wc.addChild(v.poleGlowBlurred, v.poleGlowSolid);
    }

    // Platform bar — a Container so the whole assembly (bar sprite, liquid,
    // glass) rotates together around the pivot.
    v.platformContainer = new PIXI.Container();
    v.platformContainer.position.set(p.pivot.x, p.pivot.y);
    v.platformSprite = new PIXI.Sprite(textures.platform);
    v.platformSprite.anchor.set(0.5);
    v.platformSprite.width = p.length; v.platformSprite.height = p.thickness;
    v.platformContainer.addChild(v.platformSprite);

    // Liquid — rebuilt from scratch every frame in refresh() (column levels
    // genuinely change every frame), clipped to the tube's own rounded-rect
    // via a Pixi mask.
    const halfL = p._liquidHalfLength(), halfT = p._liquidHalfThickness();
    v.liquidMask = new PIXI.Graphics().roundRect(-halfL, -halfT, halfL * 2, halfT * 2, halfT).fill(0xffffff);
    v.liquidBody = new PIXI.Graphics();
    v.liquidShine = new PIXI.Graphics();
    v.liquidShine.blendMode = 'screen';
    const liquidContainer = new PIXI.Container();
    liquidContainer.addChild(v.liquidBody, v.liquidShine, v.liquidMask);
    liquidContainer.mask = v.liquidMask;
    v.platformContainer.addChild(liquidContainer);

    // Glass — shadow + highlight sprites drawn in front of the liquid.
    v.tubeShadow = new PIXI.Sprite(textures.tubeShadow);
    v.tubeShadow.anchor.set(0.5);
    v.tubeShadow.width = p.length; v.tubeShadow.height = p.thickness;
    v.tubeShadow.alpha = 0.8;
    v.tubeHighlight = new PIXI.Sprite(textures.tubeHighlight);
    v.tubeHighlight.anchor.set(0.5);
    v.tubeHighlight.width = p.length; v.tubeHighlight.height = p.thickness;
    v.tubeHighlight.alpha = 0.9;
    v.platformContainer.addChild(v.tubeShadow, v.tubeHighlight);

    wc.addChild(v.platformContainer);

    // Hinge — z-order matters a lot here: bubbles behind everything (the
    // sprite's own opaque pixels are what hides them at the dot), then the
    // sprite, then the dot glow, then HingeMagic smoke, then the ring glow,
    // then HingeSparks on top. The ball gets re-inserted right after
    // hingeBubbleContainer each frame (see _restackBall) so it renders behind
    // whichever platform's hinge it's currently nearest.
    v.hingeBubbleContainer = new PIXI.Container();
    wc.addChild(v.hingeBubbleContainer);

    v.hingeSprite = new PIXI.Sprite(textures.hinge);
    v.hingeSprite.anchor.set(0.5);
    v.hingeSprite.width = 112; v.hingeSprite.height = 112;
    v.hingeSprite.position.set(p.pivot.x, p.pivot.y);
    wc.addChild(v.hingeSprite);

    v.hingeGlowBlurred = new PIXI.Graphics();
    v.hingeGlowBlurred.filters = [new PIXI.BlurFilter({ strength: 4 })];
    v.hingeGlowSolid = new PIXI.Graphics();
    wc.addChild(v.hingeGlowBlurred, v.hingeGlowSolid);

    v.hingeMagicContainer = new PIXI.Container();
    v.hingeMagicContainer.blendMode = 'add';
    wc.addChild(v.hingeMagicContainer);

    v.hingeSparkContainer = new PIXI.Container();
    wc.addChild(v.hingeSparkContainer);

    v.hingeMagicPool = [];
    v.hingeSparkPool = [];
    v.hingeBubblePool = [];

    // Jets — one particle container per jet, each with its own small
    // rebuilt-every-frame nozzle Graphics (aura + pulsing ring + spark rays +
    // core), additive-blended. No BlurFilter here (see note below) — the aura/
    // core already use soft radial gradients, which reads as glowy without a
    // real GPU blur pass.
    //
    // A real-time BlurFilter renders its content to an offscreen texture and
    // blurs it — genuinely expensive per instance, not free just because
    // there's "only" one of them. With up to 4 jets active per platform and 3
    // platforms, giving each its own blur filter meant up to 12 separate blur
    // passes every frame (plus 3 more on the hinges), which crashed a phone's
    // GPU ("Aw, Snap!" — Rob's test) even with particle *counts* well within
    // what plenty of games run fine. That's the actual lesson here: the
    // problem was never how many particles were on screen, it was stacking
    // real-time blur filters per emitter instead of baking the glow into the
    // art/gradients the way most games do.
    v.jetContainers = JET_DEFS.map(() => {
      const jc = new PIXI.Container();
      jc.blendMode = 'add';
      const nozzle = new PIXI.Graphics();
      const nozzleWrap = new PIXI.Container();
      nozzleWrap.blendMode = 'add';
      nozzleWrap.addChild(nozzle);
      wc.addChild(jc, nozzleWrap);
      return { particleContainer: jc, pool: [], nozzle };
    });
  },

  // Delegates to the OLD ui.js's PlayScreen.update() — the real single entry
  // point; it calls every platform's/Physics's/Fog's/Difficulty's updates
  // internally, this just delegates to it whole (see the Phase 1 bug this
  // fixed: calling the sub-updates directly here skipped PlayScreen's own
  // score/blast-charge/game-over logic entirely).
  update(dt, tiltX) {
    PlayScreen.update(dt, tiltX);
    this._dt = dt;
  },

  refresh() {
    for (const f of this._fogSprites) {
      const l = Fog.layers.find((x) => x.key === f.key);
      f.sprite.y = l.y1;
      f.spriteFlip.y = l.y2;
    }

    for (const p of PlayScreen.platforms) {
      this._refreshPlatform(p);
    }

    this._ballSprite.position.set(Physics.x, Physics.y);
    this._ballSprite.rotation = Physics.rotation;
    this._restackBall();
    this._updateCamera();
  },

  // Re-inserts the ball sprite right after whichever platform's hinge-bubble
  // container it currently belongs to (Physics.currentPlatform — the platform
  // it's resting on, or last rested on while mid-flight), so it renders behind
  // that platform's hinge/bubbles the same way the Phase 1 single-platform
  // version did. addChildAt on a child already in the tree just reorders it,
  // not a create/destroy, so this is cheap to do every frame.
  _restackBall() {
    const p = Physics.currentPlatform || PlayScreen.platforms[0];
    const v = p._visual;
    const idx = this.worldContainer.getChildIndex(v.hingeSprite);
    this.worldContainer.addChildAt(this._ballSprite, idx);
  },

  // Camera — pans worldContainer.y so the ball stays roughly at the same
  // screen-space height the single-platform version always kept it at
  // (Rob: camera follows the ball, rather than showing the whole tower at
  // once), smoothed rather than snapping frame to frame, and clamped so it
  // never scrolls past the top of the tower or below the base platform's
  // original resting view.
  _updateCamera() {
    const screenAnchorY = 760; // where the ball sits on screen at the base platform, matching the old fixed framing
    const basePivotY = PlayScreen.platforms[0].pivot.y;
    const topPivotY = PlayScreen.platforms[PlayScreen.platforms.length - 1].pivot.y;

    // worldContainer.y is added to every child's world position, so camY = screenAnchorY
    // - worldY: it's smallest (camY barely shifts anything) when the ball is down at the
    // base platform, and largest (shifts the world well down the screen, revealing what
    // was far above) when the ball is up near the top platform — so the base gives the
    // *lower* clamp bound and the top-plus-headroom gives the *upper* one, not the other
    // way around (an earlier version of this had the two swapped, which pinned the camera
    // at the upper bound permanently since min > max made the clamp always pick the min).
    const targetCamY = screenAnchorY - Physics.y;
    const camYAtBase = screenAnchorY - basePivotY;
    const camYAtTopHeadroom = screenAnchorY - (topPivotY - 260);
    const clamped = Math.max(camYAtBase, Math.min(camYAtTopHeadroom, targetCamY));

    const lerp = Math.min(1, this._dt * 6);
    this._camY += (clamped - this._camY) * lerp;
    this.worldContainer.y = this._camY;
  },

  // Syncs a pool of reusable Sprites to however many particles are currently
  // alive, calling styleFn(particle, t) for each to get its {x, y, size,
  // alpha, tint, additive}. Recolors via `.tint`, a free GPU operation — no
  // per-particle repainting the way the old Canvas 2D version needed.
  _syncParticlePool(pool, container, particles, texture, styleFn) {
    while (pool.length < particles.length) {
      const s = new PIXI.Sprite(texture);
      s.anchor.set(0.5);
      container.addChild(s);
      pool.push(s);
    }
    while (pool.length > particles.length) {
      container.removeChild(pool.pop());
    }
    for (let i = 0; i < particles.length; i++) {
      const t = particles[i].life / particles[i].maxLife;
      const st = styleFn(particles[i], t);
      const s = pool[i];
      s.position.set(st.x, st.y);
      s.width = s.height = Math.max(0, st.size);
      s.tint = st.tint;
      s.alpha = Math.max(0, Math.min(1, st.alpha));
      s.blendMode = st.additive ? 'add' : 'normal';
    }
  },

  // One platform's full per-frame refresh — rotation, liquid, glass parallax,
  // hinge glow/particles, jets. Mirrors the Phase 1 single-platform
  // refresh()/_refreshHinge()/_refreshJets(), just operating on `p`/`p._visual`
  // instead of the old global Platform/Difficulty.jets/HingeBubbles.
  _refreshPlatform(p) {
    const v = p._visual;
    v.platformContainer.rotation = p.angleRad;
    this._refreshLiquid(p);
    v.tubeHighlight.x = -p.angle * 3;
    this._refreshHinge(p);
    this._refreshJets(p);
  },

  _refreshHinge(p) {
    const v = p._visual;
    const { x, y } = p.pivot;
    const g = p.hingeGlow;
    const c = [
      Math.round(140 + (175 - 140) * g),
      Math.round(70 + (85 - 70) * g),
      Math.round(230 + (255 - 230) * g),
    ];
    const rgb = `rgb(${c.join(',')})`;

    this._syncParticlePool(v.hingeBubblePool, v.hingeBubbleContainer, p.hingeBubbles.bubbles, textures.hingeBubbleParticle, (bp, t) => ({
      x: bp.x + Math.sin(bp.wobblePhase) * bp.wobbleAmp, y: bp.y,
      size: bp.maxSize * (1 - t), alpha: 1 - t,
      tint: rgbToHex(254 + (63 - 254) * t, 19 + (203 - 19) * t, 117 + (255 - 117) * t),
      additive: false,
    }));

    const blurred = v.hingeGlowBlurred, solid = v.hingeGlowSolid;
    blurred.clear();
    solid.clear();
    v.hingeGlowBlurred.filters[0].strength = 4;
    const dotR = 17;
    blurred.circle(x, y, dotR).stroke({ width: 5, color: rgb, alpha: 0.4 + g * 0.6 });
    solid.circle(x, y, dotR).stroke({ width: 3, color: rgb, alpha: 0.5 + g * 0.5 });

    this._syncParticlePool(v.hingeMagicPool, v.hingeMagicContainer, p.hingeMagicParticles, textures.smokeParticle, (mp, t) => ({
      x: mp.x, y: mp.y,
      size: mp.maxSize * t, alpha: (150 / 255) * (1 - t),
      tint: rgbToHex(74 + (119 - 74) * t, 144 + (0 - 144) * t, 226 + (255 - 226) * t),
      additive: true,
    }));

    for (const r of [47, p.hingeRingRadius]) {
      blurred.circle(x, y, r).stroke({ width: 5, color: rgb, alpha: 0.4 + g * 0.6 });
      solid.circle(x, y, r).stroke({ width: 3, color: rgb, alpha: 0.5 + g * 0.5 });
    }

    this._syncParticlePool(v.hingeSparkPool, v.hingeSparkContainer, p.hingeSparkParticles, textures.glowParticle, (sp, t) => ({
      x: sp.x, y: sp.y,
      size: 15 * (1 - t), alpha: (70 / 255) * (1 - t),
      tint: rgbToHex(255, 255 + (33 - 255) * t, 255),
      additive: false,
    }));
  },

  _refreshJets(p) {
    const v = p._visual;
    const time = PlayScreen.elapsed;
    for (let i = 0; i < p.jetSystem.jets.length; i++) {
      const jet = p.jetSystem.jets[i];
      const { particleContainer, pool, nozzle } = v.jetContainers[i];
      this._syncParticlePool(pool, particleContainer, jet.particles, textures.jetParticle, (jp, t) => ({
        x: jp.x, y: jp.y,
        size: (60 + (20 - 60) * t) * 0.85,
        alpha: 1 - t,
        tint: rgbToHex(40 + (64 - 40) * t, 80 + (0 - 80) * t, 160 + (128 - 160) * t),
        additive: true,
      }));

      nozzle.clear();
      if (!jet.active) continue;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);

      // Position the whole nozzle Graphics at the jet's world location and draw
      // everything relative to its own local (0,0) — this is what lets the aura/
      // core gradients below be built ONCE and reused instead of constructed
      // fresh every frame (see the cached gradients set up in build()). An
      // earlier version created a brand new PIXI.FillGradient here every frame,
      // for every active jet (up to 24/frame across the tower) — each one bakes
      // its own small GPU texture, and none of that ever got freed, so it was a
      // genuine memory leak that grew until a phone's GPU ran out and crashed
      // ("Aw, Snap!" — Rob's test). This was the real fix; the particle-count
      // and jet-blur changes before it were real improvements but not the
      // actual cause.
      nozzle.position.set(jet.x, jet.y);
      nozzle.circle(0, 0, 24).fill(this._jetAuraGradient);

      // toFixed avoids JS stringifying a near-zero alpha as exponential notation
      // (e.g. "2.04e-7"), which Pixi's color parser rejects — Canvas 2D's parser
      // (the source this was ported from, difficulty.js) tolerates that fine.
      nozzle.circle(0, 0, 5 + pulse * 9).stroke({ width: 1.5, color: `rgba(180,210,255,${(0.5 * (1 - pulse)).toFixed(3)})` });

      const angleCenter = -Math.PI / 2, spread = 0.9, rayCount = 5;
      for (let r = 0; r < rayCount; r++) {
        const a = angleCenter - spread + (2 * spread) * (r / (rayCount - 1)) + Math.sin(time * 2 + r) * 0.05;
        const len = 9 + pulse * 4;
        nozzle.moveTo(Math.cos(a) * 3, Math.sin(a) * 3)
          .lineTo(Math.cos(a) * len, Math.sin(a) * len)
          .stroke({ width: 1, color: 'rgba(200,220,255,0.5)' });
      }

      nozzle.circle(0, 0, 6).fill(this._jetCoreGradient);
    }
  },

  // Rebuilds one platform's liquid fill + shine Graphics from its own
  // liquidColumns — has to run every frame since the column levels genuinely
  // change every frame (spring physics).
  _refreshLiquid(p) {
    const v = p._visual;
    const halfT = p._liquidHalfThickness();
    const cols = p.liquidColumns;
    if (!cols.length) return;

    const body = v.liquidBody;
    body.clear();
    body.moveTo(cols[0].x, halfT);
    body.lineTo(cols[0].x, cols[0].level);
    for (let i = 1; i < cols.length - 1; i++) {
      const midX = (cols[i].x + cols[i + 1].x) / 2;
      const midY = (cols[i].level + cols[i + 1].level) / 2;
      body.quadraticCurveTo(cols[i].x, cols[i].level, midX, midY);
    }
    const last = cols[cols.length - 1];
    body.lineTo(last.x, last.level);
    body.lineTo(last.x, halfT);
    body.closePath();

    const [tr, tg, tb] = Difficulty.tubeColor;
    const bodyGrad = new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: -halfT, x1: 0, y1: halfT,
      colorStops: [
        { offset: 0, color: `rgba(${lighten(tr, 90)},${lighten(tg, 90)},${lighten(tb, 20)},0.9)` },
        { offset: 0.35, color: `rgba(${tr | 0},${tg | 0},${tb | 0},0.95)` },
        { offset: 1, color: `rgba(${darken(tr, 0.55)},${darken(tg, 0.55)},${darken(tb, 0.55)},0.92)` },
      ],
      textureSpace: 'local',
    });
    body.fill(bodyGrad);

    const shine = v.liquidShine;
    shine.clear();
    const maxDepth = halfT * 2;
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i], b = cols[i + 1];
      const depthA = halfT - a.level, depthB = halfT - b.level;
      const depth = Math.min(depthA, depthB);
      const alpha = smoothstep(0, maxDepth * 0.22, depth) * 0.45;
      if (alpha <= 0.01) continue;
      shine.moveTo(a.x, a.level).lineTo(b.x, b.level)
        .stroke({ width: 3, color: `rgba(${lighten(tr, 150)},${lighten(tg, 150)},${lighten(tb, 150)},${alpha.toFixed(3)})` });
    }
  },
};
