// The gameplay screen, rebuilt on PixiJS — the big remaining piece of Phase 1
// (see PINBALL_EXPANSION_PLAN.md). Building this up in stages rather than one
// giant leap: this first pass gets the core scene up — scrolling fog
// background, the pole, the platform bar, and the ball sitting on/rolling
// with it — driven by the *same* fog.js/platform.js/physics.js update logic
// already used by the live Canvas 2D game (none of that math changed, only
// how it gets drawn). Liquid, the hinge glow/particles, jets, HUD, and the
// Game Over flow are NOT built yet — next chunks.

// Pixi sprite tints take a single packed 0xRRGGBB number, not separate
// channels — the old ctx-based particle code kept r/g/b as separate lerped
// floats the whole way through, so this just packs them at the point of use.
function rgbToHex(r, g, b) {
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
}
function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

const PlayScreenPixi = {
  container: null,
  _fogSprites: [],
  _poleSprite: null,
  _poleGlow: null,
  _platformContainer: null, // rotates as a whole around the pivot
  _platformSprite: null,
  _ballSprite: null,

  build(textures) {
    const c = new PIXI.Container();
    this.container = c;

    const bg = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x0a0410);
    c.addChild(bg);

    // Fog — 3 layers, each 2 stacked sprites (see Fog.layers in fog.js for the
    // actual scroll/wrap math, unchanged). Built here as plain Sprites whose
    // y position gets set from Fog.layers each frame in refresh().
    for (const l of Fog.layers) {
      const img = new PIXI.Sprite(textures[l.key]);
      img.width = 720; img.height = 1280;
      const imgFlip = new PIXI.Sprite(textures[l.key + 'Flip']);
      imgFlip.width = 720; imgFlip.height = 1280;
      c.addChild(img, imgFlip);
      this._fogSprites.push({ key: l.key, sprite: img, spriteFlip: imgFlip });
    }

    // Vignette — same gradient shape as Fog._drawVignette, built once as a
    // Graphics fill using Pixi's gradient fill support (static, so no need to
    // rebuild it per frame the way the old ctx version implicitly did).
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

    // Pole — static sprite + a glowing rounded-rect outline. First attempt
    // used one blurred pass and read noticeably dimmer than the live Canvas
    // version — switched to the same two-pass technique already working
    // well on the hinge (a blurred layer underneath + a crisp solid layer on
    // top), instead of trying to tune a single blur pass to compensate.
    const poleX = Platform.pivot.x - 25;
    this._poleSprite = new PIXI.Sprite(textures.pole);
    this._poleSprite.position.set(poleX, Platform.pivot.y);
    this._poleSprite.width = 50; this._poleSprite.height = Platform.poleHeight;
    c.addChild(this._poleSprite);

    const poleGrad = new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: Platform.pivot.y, x1: 0, y1: Platform.pivot.y + Platform.poleHeight,
      colorStops: [
        { offset: 0, color: 'rgba(170,100,255,0.9)' },
        { offset: 0.6, color: 'rgba(170,100,255,0.55)' },
        { offset: 1, color: 'rgba(170,100,255,0)' },
      ],
      textureSpace: 'local',
    });
    this._poleGlowBlurred = new PIXI.Graphics()
      .roundRect(poleX, Platform.pivot.y, 50, Platform.poleHeight, 10).stroke({ width: 6, fill: poleGrad });
    this._poleGlowBlurred.filters = [new PIXI.BlurFilter({ strength: 8 })];
    this._poleGlowSolid = new PIXI.Graphics()
      .roundRect(poleX, Platform.pivot.y, 50, Platform.poleHeight, 10).stroke({ width: 3, fill: poleGrad });
    c.addChild(this._poleGlowBlurred, this._poleGlowSolid);

    // Platform bar — a Container so the whole assembly (bar sprite, and later
    // liquid/glass) rotates together around the pivot, same coordinate-space
    // trick as the old ctx.translate+rotate block in Platform.draw().
    this._platformContainer = new PIXI.Container();
    this._platformContainer.position.set(Platform.pivot.x, Platform.pivot.y);
    this._platformSprite = new PIXI.Sprite(textures.platform);
    this._platformSprite.anchor.set(0.5);
    this._platformSprite.width = Platform.length; this._platformSprite.height = Platform.thickness;
    this._platformContainer.addChild(this._platformSprite);

    // Liquid — rebuilt from scratch every frame in refresh() (the column
    // levels genuinely change every frame, unlike everything else here which
    // is a static shape just being repositioned), clipped to the tube's own
    // rounded-rect shape via a Pixi mask (Canvas 2D's ctx.clip() has no
    // direct Pixi equivalent — a mask achieves the same "only show what's
    // inside this shape" result). Two Graphics: the fill+gradient body, and
    // a separate 'screen'-blended shine on top, matching
    // Platform._drawLiquid()'s two-pass approach exactly.
    const halfL = Platform._liquidHalfLength(), halfT = Platform._liquidHalfThickness();
    this._liquidMask = new PIXI.Graphics().roundRect(-halfL, -halfT, halfL * 2, halfT * 2, halfT).fill(0xffffff);
    this._liquidBody = new PIXI.Graphics();
    this._liquidShine = new PIXI.Graphics();
    this._liquidShine.blendMode = 'screen';
    const liquidContainer = new PIXI.Container();
    liquidContainer.addChild(this._liquidBody, this._liquidShine, this._liquidMask);
    liquidContainer.mask = this._liquidMask;
    this._platformContainer.addChild(liquidContainer);

    // Glass — shadow + highlight sprites drawn in front of the liquid, same
    // as Platform._drawGlass(). Highlight's x gets nudged slightly per-frame
    // for the parallax cue (see refresh()).
    this._tubeShadow = new PIXI.Sprite(textures.tubeShadow);
    this._tubeShadow.anchor.set(0.5);
    this._tubeShadow.width = Platform.length; this._tubeShadow.height = Platform.thickness;
    this._tubeShadow.alpha = 0.8;
    this._tubeHighlight = new PIXI.Sprite(textures.tubeHighlight);
    this._tubeHighlight.anchor.set(0.5);
    this._tubeHighlight.width = Platform.length; this._tubeHighlight.height = Platform.thickness;
    this._tubeHighlight.alpha = 0.9;
    this._platformContainer.addChild(this._tubeShadow, this._tubeHighlight);

    c.addChild(this._platformContainer);

    // Hinge — z-order matters a lot here (many rounds of Rob's feedback
    // landed on this exact order): bubbles behind everything (the sprite's
    // own opaque pixels are what hides them at the dot, not a draw-order
    // trick alone), then the sprite, then the dot glow, then HingeMagic
    // smoke, then the ring glow, then HingeSparks on top.
    this._hingeBubbleContainer = new PIXI.Container();
    c.addChild(this._hingeBubbleContainer);

    this._hingeSprite = new PIXI.Sprite(textures.hinge);
    this._hingeSprite.anchor.set(0.5);
    this._hingeSprite.width = 112; this._hingeSprite.height = 112;
    this._hingeSprite.position.set(Platform.pivot.x, Platform.pivot.y);
    c.addChild(this._hingeSprite);

    // Dot + ring glow — same two-pass technique as the pole (a blurred
    // stroke layer + a crisp solid one on top), rebuilt every frame since
    // the color/blur strength both animate with hingeGlow (0 idle → 1
    // touched). Two separate Graphics (blurred vs solid) since a Pixi
    // filter blurs its *whole* object — can't blur just one of two strokes
    // sharing a single Graphics the way ctx's per-call shadowBlur could.
    this._hingeGlowBlurred = new PIXI.Graphics();
    this._hingeGlowBlurred.filters = [new PIXI.BlurFilter({ strength: 4 })];
    this._hingeGlowSolid = new PIXI.Graphics();
    c.addChild(this._hingeGlowBlurred, this._hingeGlowSolid);

    this._hingeMagicContainer = new PIXI.Container();
    this._hingeMagicContainer.blendMode = 'add';
    c.addChild(this._hingeMagicContainer);

    // Ring's own glow is drawn AFTER HingeMagic (see drawHinge's real order),
    // reusing the same two Graphics objects — redrawn fresh each frame
    // alongside the dot in _refreshHinge() rather than needing 4 separate
    // Graphics objects for dot+ring.

    this._hingeSparkContainer = new PIXI.Container();
    c.addChild(this._hingeSparkContainer);

    this._hingeMagicPool = [];
    this._hingeSparkPool = [];
    this._hingeBubblePool = [];

    // Jets — one particle container per jet (see Difficulty.drawJets). Built
    // from JET_DEFS directly, not Difficulty.jets — the latter starts as an
    // empty array and is only populated by Difficulty.reset() (called from
    // PlayScreen.enter(), i.e. only once the player actually starts a run),
    // which hasn't happened yet at boot time when build() runs.
    // Each jet's base "nozzle" glow (aura + pulsing ring + spark rays + core —
    // see Difficulty.drawJets) is its own small rebuilt-every-frame Graphics,
    // same pattern as the hinge dot/ring, wrapped in a blurred+additive
    // container matching the ctx version's `filter='blur(3px)'` +
    // `globalCompositeOperation='lighter'` pairing.
    this._jetContainers = JET_DEFS.map(() => {
      const jc = new PIXI.Container();
      jc.blendMode = 'add';
      const nozzle = new PIXI.Graphics();
      const nozzleWrap = new PIXI.Container();
      nozzleWrap.blendMode = 'add';
      nozzleWrap.filters = [new PIXI.BlurFilter({ strength: 3 })];
      nozzleWrap.addChild(nozzle);
      c.addChild(jc, nozzleWrap);
      return { particleContainer: jc, pool: [], nozzle };
    });

    // Ball — Physics.draw()'s equivalent: a sprite rotating around its own
    // center, position/rotation copied from Physics.x/y/rotation every frame.
    // Added *after* the hinge/bubbles (Rob: the ball renders behind the
    // hinge and its bubbles) but before nothing else yet — HUD isn't built.
    this._ballSprite = new PIXI.Sprite(textures.ball);
    this._ballSprite.anchor.set(0.5);
    const ballSize = Physics.displayRadius * 2;
    this._ballSprite.width = ballSize; this._ballSprite.height = ballSize;
    c.addChildAt(this._ballSprite, c.getChildIndex(this._hingeBubbleContainer));
  },

  // Delegates to the OLD ui.js's PlayScreen.update() rather than calling
  // Platform/Physics/Fog updates directly (an earlier version of this file
  // did exactly that, which was a real bug caught while starting the HUD
  // work: it skipped PlayScreen's own logic entirely — score accumulation,
  // blast-charge thresholds, elapsed time, game-over detection, the blast
  // buttons' pop-animation timer, AND Difficulty.update() (tube/moon phase
  // progression) — none of that was ever running. PlayScreen.update() is
  // the real single entry point; it calls Platform/Physics/Fog/Difficulty/
  // HingeBubbles updates itself internally, this just delegates to it whole.
  update(dt, tiltX) {
    PlayScreen.update(dt, tiltX);
  },

  refresh() {
    for (const f of this._fogSprites) {
      const l = Fog.layers.find((x) => x.key === f.key);
      f.sprite.y = l.y1;
      f.spriteFlip.y = l.y2;
    }

    this._platformContainer.rotation = Platform.angleRad;
    this._refreshLiquid();

    // Glass highlight parallax — same `-angle*3` nudge as the old
    // Platform._drawGlass(), just applied to a sprite's x instead of an
    // extra ctx.drawImage x-offset argument.
    this._tubeHighlight.x = -Platform.angle * 3;

    this._ballSprite.position.set(Physics.x, Physics.y);
    this._ballSprite.rotation = Physics.rotation;

    this._refreshHinge();
    this._refreshJets();
  },

  // Syncs a pool of reusable Sprites to however many particles are
  // currently alive, calling styleFn(particle, t) for each to get its
  // {x, y, size, alpha, tint, additive}. Reusing sprites instead of
  // creating/destroying one per particle per frame avoids needless churn —
  // and unlike the old Canvas 2D drawTintedParticle helper (which repainted
  // an offscreen canvas from scratch per particle per frame, the actual
  // measured cause of the mobile lag investigated earlier), Pixi sprites
  // recolor via `.tint`, a genuinely free GPU operation, no repainting at all.
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

  _refreshHinge() {
    const { x, y } = Platform.pivot;
    const g = Platform.hingeGlow;
    const c = [
      Math.round(140 + (175 - 140) * g),
      Math.round(70 + (85 - 70) * g),
      Math.round(230 + (255 - 230) * g),
    ];
    const rgb = `rgb(${c.join(',')})`;

    this._syncParticlePool(this._hingeBubblePool, this._hingeBubbleContainer, HingeBubbles.bubbles, textures.hingeBubbleParticle, (p, t) => ({
      x: p.x + Math.sin(p.wobblePhase) * p.wobbleAmp, y: p.y,
      size: p.maxSize * (1 - t), alpha: 1 - t,
      tint: rgbToHex(254 + (63 - 254) * t, 19 + (203 - 19) * t, 117 + (255 - 117) * t),
      additive: false,
    }));

    // Dot + ring glow, both drawn into the same pair of Graphics (blurred
    // pass, solid pass) since only the dot's/ring's own radius differs —
    // matches drawHinge()'s real draw order (dot first, then — after
    // HingeMagic below — the ring), but since both share one Graphics pair
    // here, the ring's stroke is added in the *second* half of this method
    // rather than needing a separate Graphics per radius.
    const blurred = this._hingeGlowBlurred, solid = this._hingeGlowSolid;
    blurred.clear();
    solid.clear();
    this._hingeGlowBlurred.filters[0].strength = 4;
    const dotR = 17;
    blurred.circle(x, y, dotR).stroke({ width: 5, color: rgb, alpha: 0.4 + g * 0.6 });
    solid.circle(x, y, dotR).stroke({ width: 3, color: rgb, alpha: 0.5 + g * 0.5 });

    this._syncParticlePool(this._hingeMagicPool, this._hingeMagicContainer, Platform.hingeMagicParticles, textures.smokeParticle, (p, t) => ({
      x: p.x, y: p.y,
      size: p.maxSize * t, alpha: (150 / 255) * (1 - t),
      tint: rgbToHex(74 + (119 - 74) * t, 144 + (0 - 144) * t, 226 + (255 - 226) * t),
      additive: true,
    }));

    for (const r of [47, Platform.hingeRingRadius]) {
      blurred.circle(x, y, r).stroke({ width: 5, color: rgb, alpha: 0.4 + g * 0.6 });
      solid.circle(x, y, r).stroke({ width: 3, color: rgb, alpha: 0.5 + g * 0.5 });
    }

    this._syncParticlePool(this._hingeSparkPool, this._hingeSparkContainer, Platform.hingeSparkParticles, textures.glowParticle, (p, t) => ({
      x: p.x, y: p.y,
      size: 15 * (1 - t), alpha: (70 / 255) * (1 - t),
      tint: rgbToHex(255, 255 + (33 - 255) * t, 255),
      additive: false,
    }));
  },

  _refreshJets() {
    const time = PlayScreen.elapsed;
    for (let i = 0; i < Difficulty.jets.length; i++) {
      const jet = Difficulty.jets[i];
      const { particleContainer, pool, nozzle } = this._jetContainers[i];
      this._syncParticlePool(pool, particleContainer, jet.particles, textures.jetParticle, (p, t) => ({
        x: p.x, y: p.y,
        size: (60 + (20 - 60) * t) * 0.85,
        alpha: 1 - t,
        tint: rgbToHex(40 + (64 - 40) * t, 80 + (0 - 80) * t, 160 + (128 - 160) * t),
        additive: true,
      }));

      nozzle.clear();
      if (!jet.active) continue;
      const bx = jet.x, by = jet.y;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);

      const aura = new PIXI.FillGradient({
        type: 'radial', center: { x: bx, y: by }, innerRadius: 0, outerCenter: { x: bx, y: by }, outerRadius: 24,
        colorStops: [
          { offset: 0, color: 'rgba(120,170,255,0.35)' },
          { offset: 1, color: 'rgba(90,140,255,0)' },
        ],
        textureSpace: 'local',
      });
      nozzle.circle(bx, by, 24).fill(aura);

      // toFixed avoids JS stringifying a near-zero alpha as exponential notation
      // (e.g. "2.04e-7"), which Pixi's color parser rejects — Canvas 2D's parser
      // (the source this was ported from, difficulty.js) tolerates that fine.
      nozzle.circle(bx, by, 5 + pulse * 9).stroke({ width: 1.5, color: `rgba(180,210,255,${(0.5 * (1 - pulse)).toFixed(3)})` });

      const angleCenter = -Math.PI / 2, spread = 0.9, rayCount = 5;
      for (let r = 0; r < rayCount; r++) {
        const a = angleCenter - spread + (2 * spread) * (r / (rayCount - 1)) + Math.sin(time * 2 + r) * 0.05;
        const len = 9 + pulse * 4;
        nozzle.moveTo(bx + Math.cos(a) * 3, by + Math.sin(a) * 3)
          .lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len)
          .stroke({ width: 1, color: 'rgba(200,220,255,0.5)' });
      }

      const core = new PIXI.FillGradient({
        type: 'radial', center: { x: bx, y: by }, innerRadius: 0, outerCenter: { x: bx, y: by }, outerRadius: 6,
        colorStops: [
          { offset: 0, color: 'rgba(255,255,255,0.95)' },
          { offset: 0.5, color: 'rgba(180,210,255,0.6)' },
          { offset: 1, color: 'rgba(180,210,255,0)' },
        ],
        textureSpace: 'local',
      });
      nozzle.circle(bx, by, 6).fill(core);
    }
  },

  // Rebuilds the liquid's fill + shine Graphics from Platform.liquidColumns —
  // has to run every frame since the column levels genuinely change every
  // frame (spring physics), unlike everything else in this file which is a
  // static shape just being repositioned. Mirrors Platform._drawLiquid()
  // line for line, just using Pixi's Graphics path API instead of Canvas 2D's.
  _refreshLiquid() {
    const halfT = Platform._liquidHalfThickness();
    const cols = Platform.liquidColumns;
    if (!cols.length) return;

    const body = this._liquidBody;
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

    const shine = this._liquidShine;
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
