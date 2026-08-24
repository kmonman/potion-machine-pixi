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
  _camX: 0,
  _dt: 1 / 60,
  // Screen-fixed background width in world units — 720 (CONFIG.WIDTH) in
  // portrait. In landscape, game.js widens this so the background/fog
  // genuinely extends to fill the sides (Rob: didn't want empty CSS margin
  // there, wanted the game itself to extend) rather than being a fixed
  // 720-wide box with flat color/static image padding around it.
  renderWidth: 720,

  build(textures) {
    const c = new PIXI.Container();
    this.container = c;

    this._bg = new PIXI.Graphics().rect(0, 0, this.renderWidth, 1280).fill(0x0a0410);
    c.addChild(this._bg);

    // Fog — 3 layers, each 2 stacked sprites (see Fog.layers in fog.js for the
    // actual scroll/wrap math, unchanged). Screen-fixed background atmosphere,
    // not part of the panning world — it doesn't need to scroll with the camera.
    for (const l of Fog.layers) {
      const img = new PIXI.Sprite(textures[l.key]);
      img.width = this.renderWidth; img.height = 1280;
      const imgFlip = new PIXI.Sprite(textures[l.key + 'Flip']);
      imgFlip.width = this.renderWidth; imgFlip.height = 1280;
      c.addChild(img, imgFlip);
      this._fogSprites.push({ key: l.key, sprite: img, spriteFlip: imgFlip });
    }

    // Vignette — same gradient shape as Fog._drawVignette, built once as a
    // Graphics fill using Pixi's gradient fill support. Purely a vertical
    // gradient (x0/x1 both 0) so its width can change without touching the
    // gradient itself — only the rect() needs redrawing on resize.
    this._vignette = new PIXI.Graphics();
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
    this._vignette.rect(0, 0, this.renderWidth, 1280).fill(grad);
    c.addChild(this._vignette);

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
    // sprite, then the glow (dot + both rings) so it reads bright in front of
    // the sprite's own flat art, THEN the ball (see _restackBall — it gets
    // re-inserted right before hingeMagicContainer each frame, i.e. right
    // after the glow), so the ball sits in front of the sprite *and* the
    // glow — covering whatever small arc of the ring would otherwise overlap
    // it, without hiding the glow behind the opaque sprite the way an
    // earlier version of this ordering did (Rob: "the glow of the hinge is
    // missing" — that version put the glow behind the sprite too, not just
    // behind the ball).
    v.hingeBubbleContainer = new PIXI.Container();
    wc.addChild(v.hingeBubbleContainer);

    v.hingeSprite = new PIXI.Sprite(textures.hinge);
    v.hingeSprite.anchor.set(0.5);
    v.hingeSprite.width = 112 * p.visualScale; v.hingeSprite.height = 112 * p.visualScale;
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
    // core), wrapped in a blurred+additive container. The GPU crash on Rob's
    // phone ("Aw, Snap!") turned out to be a real memory leak in _refreshJets
    // (a fresh PIXI.FillGradient built every frame per active jet, never
    // freed — see that method) — NOT the blur filters themselves, which were
    // removed as a guess along the way and are restored here now that the
    // actual leak is fixed.
    // No nozzle/base-emitter Graphics anymore (Rob: removed — see _refreshJets)
    // — just the particle stream container per jet.
    v.jetContainers = JET_DEFS.map(() => {
      const jc = new PIXI.Container();
      jc.blendMode = 'add';
      wc.addChild(jc);
      return { particleContainer: jc, pool: [] };
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

  // Re-inserts the ball sprite right after whichever platform's hinge sprite
  // it currently belongs to (Physics.currentPlatform — the platform it's
  // resting on, or last rested on while mid-flight) — i.e. in front of that
  // platform's flat sprite art, but behind its glow (dot + rings) and
  // HingeMagic/HingeSparks (Rob: ball in front of the plain hinge sprite,
  // but behind the glow ring itself — the ring is meant to frame the ball
  // from in front, like a target).
  //
  // Explicitly removes the ball before computing the target index — calling
  // addChildAt on a child that's already elsewhere in the same container
  // reorders it, but the index has to be computed on the list *without* the
  // ball already in it. An earlier version computed the index first (with
  // the ball still present), which meant the removal-then-insert could land
  // the ball one slot off from where the index was measured, alternating
  // which side of the target ended up on frame to frame — Rob caught this
  // as the ball visibly flickering in and out of place.
  _restackBall() {
    const p = Physics.currentPlatform || PlayScreen.platforms[0];
    const v = p._visual;
    this.worldContainer.removeChild(this._ballSprite);
    const idx = this.worldContainer.getChildIndex(v.hingeGlowBlurred);
    this.worldContainer.addChildAt(this._ballSprite, idx);
  },

  // Camera — pans worldContainer.x/y so the ball stays roughly at the same
  // screen-space position the single-platform version always kept it at
  // (Rob: camera follows the ball, rather than showing the whole tower at
  // once), smoothed rather than snapping frame to frame, and clamped so it
  // never scrolls past the tower's actual extent in either direction.
  //
  // Horizontal panning (Rob: wants platforms placed off to the left/right of
  // the visible area, "expand the width of the game" without actually
  // changing the game's real portrait canvas — the phone display stays
  // exactly as it is) mirrors the vertical logic exactly, just computed from
  // the tower's leftmost/rightmost pivot X instead of its lowest/highest
  // pivot Y — see _updateCameraAxis for the shared math.
  //
  // X tracks the CURRENT PLATFORM's pivot rather than the ball's exact live
  // x (Rob: with the wider landscape view, chasing every wobble of the ball
  // rolling back and forth under tilt read as the camera "moving around too
  // much" — it should hold still while the ball's on one platform and only
  // pan when the ball actually moves to a different one). Y still tracks the
  // ball's exact position — that's the intentional "camera follows the ball
  // up the tower" behavior, unaffected by this.
  _updateCamera() {
    const pivotYs = PlayScreen.platforms.map((p) => p.pivot.y);
    const pivotXs = PlayScreen.platforms.map((p) => p.pivot.x);
    const currentPlatform = Physics.currentPlatform || PlayScreen.platforms[0];

    // Y: base platform (largest Y) gives the *lower* clamp bound, the
    // highest platform (smallest Y, plus headroom) gives the *upper* one —
    // an earlier version had these two swapped, which pinned the camera at
    // one bound permanently since min > max made the clamp always pick the
    // min. Same care applies to X below.
    this._camY = this._updateCameraAxis(this._camY, 760, Physics.y, Math.max(...pivotYs), Math.min(...pivotYs) - 260);
    this.worldContainer.y = this._camY;

    this._camX = this._updateCameraAxis(this._camX, this.renderWidth / 2, currentPlatform.pivot.x, Math.max(...pivotXs) + 260, Math.min(...pivotXs) - 260);
    this.worldContainer.x = this._camX;
  },

  // Called by game.js's fitGameWrap() whenever the landscape background gets
  // wider/narrower — resizes the screen-fixed background/fog/vignette to
  // match (they aren't part of worldContainer, so nothing else touches them)
  // and updates the camera's horizontal anchor so the ball still centers in
  // the new width instead of staying pinned to the old 360 (half of 720).
  setRenderWidth(width) {
    if (this.renderWidth === width || !this._bg) return;
    this.renderWidth = width;
    this._bg.clear().rect(0, 0, width, CONFIG.HEIGHT).fill(0x0a0410);
    this._vignette.clear();
    const grad = new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: 0, x1: 0, y1: CONFIG.HEIGHT,
      colorStops: [
        { offset: 0, color: 'rgba(10,4,16,1)' },
        { offset: 0.55, color: 'rgba(10,4,16,1)' },
        { offset: 0.68, color: 'rgba(10,4,16,0.78)' },
        { offset: 0.82, color: 'rgba(10,4,16,0.6)' },
        { offset: 1, color: 'rgba(10,4,16,0.45)' },
      ],
      textureSpace: 'local',
    });
    this._vignette.rect(0, 0, width, CONFIG.HEIGHT).fill(grad);
    for (const f of this._fogSprites) {
      f.sprite.width = width;
      f.spriteFlip.width = width;
    }
  },

  // Shared camera-axis math: pans by (screenAnchor - target), clamped so the
  // pan never reveals past `worldAtLowerBound`/`worldAtUpperBound` (world
  // positions, not camera values — this computes the correct camera-space
  // clamp direction from them), smoothed toward the new value rather than
  // snapping frame to frame.
  _updateCameraAxis(current, screenAnchor, target, worldAtLowerBound, worldAtUpperBound) {
    const targetCam = screenAnchor - target;
    const camAtLower = screenAnchor - worldAtLowerBound;
    const camAtUpper = screenAnchor - worldAtUpperBound;
    const clamped = Math.max(camAtLower, Math.min(camAtUpper, targetCam));
    const lerp = Math.min(1, this._dt * 6);
    return current + (clamped - current) * lerp;
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
    const dotR = 17 * p.visualScale;
    blurred.circle(x, y, dotR).stroke({ width: 5 * p.visualScale, color: rgb, alpha: 0.4 + g * 0.6 });
    solid.circle(x, y, dotR).stroke({ width: 3 * p.visualScale, color: rgb, alpha: 0.5 + g * 0.5 });

    this._syncParticlePool(v.hingeMagicPool, v.hingeMagicContainer, p.hingeMagicParticles, textures.smokeParticle, (mp, t) => ({
      x: mp.x, y: mp.y,
      size: mp.maxSize * t, alpha: (150 / 255) * (1 - t),
      tint: rgbToHex(74 + (119 - 74) * t, 144 + (0 - 144) * t, 226 + (255 - 226) * t),
      additive: true,
    }));

    for (const r of [47 * p.visualScale, p.hingeRingRadius]) {
      blurred.circle(x, y, r).stroke({ width: 5 * p.visualScale, color: rgb, alpha: 0.4 + g * 0.6 });
      solid.circle(x, y, r).stroke({ width: 3 * p.visualScale, color: rgb, alpha: 0.5 + g * 0.5 });
    }

    this._syncParticlePool(v.hingeSparkPool, v.hingeSparkContainer, p.hingeSparkParticles, textures.glowParticle, (sp, t) => ({
      x: sp.x, y: sp.y,
      size: 15 * (1 - t), alpha: (70 / 255) * (1 - t),
      tint: rgbToHex(255, 255 + (33 - 255) * t, 255),
      additive: false,
    }));
  },

  // The nozzle "base emitter" (aura + pulsing ring + spark rays + core, drawn
  // at the jet's origin point) was removed entirely (Rob: something read wrong
  // about it, simpler to just drop it) — the particle stream itself is the
  // jet's whole visual now.
  _refreshJets(p) {
    for (let i = 0; i < p.jetSystem.jets.length; i++) {
      const jet = p.jetSystem.jets[i];
      const { particleContainer, pool } = p._visual.jetContainers[i];
      this._syncParticlePool(pool, particleContainer, jet.particles, textures.jetParticle, (jp, t) => ({
        x: jp.x, y: jp.y,
        size: (60 + (20 - 60) * t) * 0.85,
        alpha: 1 - t,
        tint: rgbToHex(40 + (64 - 40) * t, 80 + (0 - 80) * t, 160 + (128 - 160) * t),
        additive: true,
      }));
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

    // Rebuilding a FillGradient bakes a new GPU texture — tubeColor lerps by
    // tiny fractions every frame (see platform.js), so comparing for exact
    // equality would still rebuild on essentially every frame, one leaking
    // texture per platform per frame, continuously, for as long as the game
    // runs. That's the same "new PIXI.FillGradient() every frame" pattern
    // that caused a real GPU crash once already (the jet nozzle, fixed
    // earlier) — just far more frequent here, and likely the actual cause
    // of the temporary freeze-then-recover Rob saw (GPU memory pressure
    // building up over a play session until the driver has to stall and
    // clean up). Only rebuilding once the color has visibly shifted keeps
    // the transition looking smooth while capping the rebuild rate to
    // something sane instead of every frame forever.
    const [tr, tg, tb] = p.tubeColor;
    const cached = v._liquidGradColor;
    const changed = !cached
      || Math.abs(cached[0] - tr) >= 2 || Math.abs(cached[1] - tg) >= 2 || Math.abs(cached[2] - tb) >= 2;
    if (changed) {
      v._liquidGradColor = [tr, tg, tb];
      v._liquidGradient = new PIXI.FillGradient({
        type: 'linear', x0: 0, y0: -halfT, x1: 0, y1: halfT,
        colorStops: [
          { offset: 0, color: `rgba(${lighten(tr, 90)},${lighten(tg, 90)},${lighten(tb, 20)},0.9)` },
          { offset: 0.35, color: `rgba(${tr | 0},${tg | 0},${tb | 0},0.95)` },
          { offset: 1, color: `rgba(${darken(tr, 0.55)},${darken(tg, 0.55)},${darken(tb, 0.55)},0.92)` },
        ],
        textureSpace: 'local',
      });
    }
    body.fill(v._liquidGradient);

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
