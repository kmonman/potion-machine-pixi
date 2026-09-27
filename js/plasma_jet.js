// PlasmaJet — a self-contained plasma jet shooting straight UP, for PixiJS
// v8. Sibling of plasma_orb.js / nebula_cloud.js / plasma_storm.js, same
// plain <script> tag approach: load it after js/vendor/pixi.min.js and it
// exposes one global, `PlasmaJet`. Nothing in the game uses it yet — see
// plasma_jet_demo.html for a live test page with sliders.
//
// The view's origin (0, 0) is the NOZZLE — put it on the platform surface
// and the jet rises from there (toward -y). Layers, back → front:
//
//   1. BASE GLOW  — soft light splashing on the platform around the nozzle.
//   2. BEAM       — a wobbling glowing column: a soft colored glow ribbon and
//      a thin white-hot core ribbon, both fading out toward the top. Drawn
//      as ribbons (MeshRope) whose points just move each frame — never
//      rebuilt — plus an optional real blur on a fixed-size area (the same
//      combination that made plasma_storm.js hitch-free).
//   3. BLOBS      — glowing plasma puffs rising in pulses (the "segmented"
//      look), swelling and fading with height, nudged by curl noise.
//   4. PULSES     — bright energy packets racing up the beam.
//   5. SPARKS     — small hot streaks shooting up and slightly outward,
//      optionally softened by their own real blur (`sparkBlur`).
//   6. ARCS       — brief jagged electric crackles jumping off the column.
//
// Coordination: `surge()` makes the whole jet flare at once — taller,
// brighter and wider beam, a burst of blobs/sparks/pulses and crackling
// arcs. `on = false/true` fades the jet smoothly down/up (the game's jets
// switch on and off). While fully off it skips all its work.
//
// Usage:
//   const jet = new PlasmaJet({ height: 360, width: 60 });
//   someContainer.addChild(jet.view);
//   jet.view.position.set(nozzleX, nozzleY);
//   jet.update(dtSeconds);        // once per frame
//   jet.on = false;               // fade out (true to fade back in)
//   jet.surge();                  // flare now (e.g. when it launches the stone)
//   jet.destroy();

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function unpack(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
  function pack(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return (c(r) << 16) | (c(g) << 8) | c(b);
  }
  function mixColor(a, b, t) {
    const A = unpack(a), B = unpack(b);
    return pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }

  function buildPalette(color, second) {
    const accent = second == null ? color : second;
    return {
      color: color,
      accent: accent,
      deep: mixColor(color, 0x000000, 0.5),
      hot: mixColor(color, 0xffffff, 0.6),
      white: 0xffffff,
    };
  }

  // Smooth swirl (same family as the other effects) — used for the blobs'
  // sideways drift so they waver instead of rising dead straight.
  function curlX(x, y, t) {
    return Math.cos(1.7 * y + 0.9 * t) * Math.cos(1.3 * x - 0.6 * t) + 0.5 * Math.cos(2.9 * y + 1.1 * t + 1.3 * x);
  }

  // ---------------------------------------------------------------------------
  // Procedural textures (white, recolored with `.tint`), built once, shared.
  // ---------------------------------------------------------------------------

  let sharedTextures = null;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h || w;
    return c;
  }

  function radialTexture(size, stops) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    for (const [s, a] of stops) g.addColorStop(s, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return PIXI.Texture.from(c);
  }

  // Soft lumpy plasma puff (value noise with a round falloff).
  function blobTexture(size, seed) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const hash = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const sm = (t) => t * t * (3 - 2 * t);
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = sm(x - xi), yf = sm(y - yi);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c2 = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return a + (b - a) * xf + (c2 - a) * yf + (a - b - c2 + d) * xf * yf;
    };
    const half = size / 2;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = (px - half) / half, dy = (py - half) / half;
        const falloff = clamp01(1 - Math.sqrt(dx * dx + dy * dy));
        const n = noise(px / 12, py / 12) * 0.6 + noise(px / 6, py / 6) * 0.4;
        const a = clamp01(Math.pow(falloff, 1.3) * (0.55 + n * 0.9));
        const i = (py * size + px) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  // Beam ribbon texture. MeshRope maps the texture's width along the rope
  // (x = 0 at the nozzle, x = w at the top) and its height across it.
  // Across: a bell-shaped glow (`sharp` = how tight). Along: a quick fade-in
  // right at the nozzle, then a long fade-out toward the top.
  function beamTexture(sharp) {
    const w = 256, h = 32;
    const c = makeCanvas(w, h), ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const d = (y + 0.5 - h / 2) / (h / 2);
      const across = Math.exp(-d * d * sharp);
      for (let x = 0; x < w; x++) {
        const s = x / (w - 1);
        const along = Math.min(1, s / 0.04) * Math.pow(1 - s, 1.4);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(across * along * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  function getTextures() {
    if (sharedTextures) return sharedTextures;
    sharedTextures = {
      glow: radialTexture(128, [[0, 1], [0.25, 0.55], [0.55, 0.15], [1, 0]]),
      spark: radialTexture(32, [[0, 1], [0.18, 0.95], [0.45, 0.3], [1, 0]]),
      blobs: [blobTexture(64, 41), blobTexture(64, 42), blobTexture(64, 43)],
      beamSoft: beamTexture(4.5),
      beamCore: beamTexture(9),
    };
    return sharedTextures;
  }

  // ===========================================================================
  // BEAM
  // ===========================================================================

  const BEAM_PTS = 40;

  class JetBeam {
    constructor(jet) {
      this.jet = jet;
      const tex = getTextures();
      this.container = new PIXI.Container();
      this.container.blendMode = 'add';
      this.glow = this._rope(tex.beamSoft);
      this.core = this._rope(tex.beamCore);
      this.blur = new PIXI.BlurFilter({ strength: jet.options.blur, quality: 3 });
      this.blur.blendMode = 'add';
      this._fa = null;
    }

    _rope(texture) {
      const points = [];
      for (let i = 0; i < BEAM_PTS; i++) points.push(new PIXI.Point(0, -i));
      const rope = new PIXI.MeshRope({ texture, points, textureScale: 0 });
      rope.blendMode = 'add';
      this.container.addChild(rope);
      return rope;
    }

    // Blur on a fixed-size area (see plasma_storm.js) — without it Pixi
    // resizes the blur's texture every frame as the beam wobbles, which
    // jitters.
    _applyBlur(H, W) {
      const b = this.jet.options.blur;
      this.blur.strength = b;
      this.container.filters = b > 0 ? [this.blur] : null;
      if (b > 0 && (!this._fa || this._fa.h !== H || this._fa.w !== W)) {
        const m = 40 + b * 3;
        this.container.filterArea = new PIXI.Rectangle(-W * 2 - m, -H * 1.4 - m, W * 4 + 2 * m, H * 1.4 + 2 * m);
        this._fa = { h: H, w: W };
      }
    }

    // x offset of the beam's centerline at height fraction s (0 nozzle → 1 top).
    wobbleX(s, t) {
      const o = this.jet.options;
      return Math.sin(s * 7 - t * 5.3) * o.wobble * o.width * 0.35 * s
           + Math.sin(s * 13 - t * 9.1) * o.wobble * o.width * 0.12 * s;
    }

    update(dt, t, power, surge) {
      const o = this.jet.options, pal = this.jet.palette;
      const H = o.height, W = o.width;
      this._applyBlur(H, W);
      // Length: grows with power, flares with a surge.
      const len = H * (0.35 + 0.65 * power) * (1 + 0.3 * surge);
      const flicker = 0.9 + 0.1 * Math.sin(t * 31) * Math.sin(t * 17.3);
      for (const rope of [this.glow, this.core]) {
        const pts = rope.geometry.points;
        for (let i = 0; i < BEAM_PTS; i++) {
          const s = i / (BEAM_PTS - 1);
          pts[i].x = this.wobbleX(s, t);
          pts[i].y = -s * len;
        }
      }
      // RopeGeometry's width is read-only in this Pixi build, but its
      // per-frame vertex update reads the private _width — setting it is free.
      this.glow.geometry._width = W * 1.6 * (1 + 0.5 * surge);
      this.core.geometry._width = W * 0.45 * (1 + 0.4 * surge);
      this.glow.tint = mixColor(pal.color, pal.accent, 0.25);
      this.core.tint = mixColor(pal.hot, pal.white, 0.4 + 0.4 * surge);
      const a = o.intensity * power * flicker;
      this.glow.alpha = Math.min(1, 0.7 * a * (1 + 0.6 * surge) * (1 + o.blur / 10));
      this.core.alpha = Math.min(1, 0.85 * a * (1 + 0.4 * surge) * (1 + o.blur / 14));
      this.container.alpha = o.beamOpacity;
    }
  }

  // ===========================================================================
  // PARTICLE LAYERS (blobs, pulses, sparks) — one pooled-sprite helper
  // ===========================================================================

  class SpritePool {
    constructor(container, texture) {
      this.container = container;
      this.texture = texture;
      this.live = [];
      this.dead = [];
    }
    get(texture) {
      let p = this.dead.pop();
      if (!p) {
        const s = new PIXI.Sprite(texture || this.texture);
        s.anchor.set(0.5);
        this.container.addChild(s);
        p = { sprite: s };
      }
      if (texture) p.sprite.texture = texture;
      p.sprite.visible = true;
      this.live.push(p);
      return p;
    }
    kill(i) {
      const p = this.live[i];
      p.sprite.visible = false;
      this.dead.push(p);
      this.live[i] = this.live[this.live.length - 1];
      this.live.pop();
    }
  }

  // ===========================================================================
  // ARCS — brief jagged crackles jumping off the column
  // ===========================================================================

  const ARC_PTS = 17;

  class JetArcs {
    constructor(jet) {
      this.jet = jet;
      this.view = new PIXI.Graphics();
      this.view.blendMode = 'add';
      this.bolts = [];
      this._timer = this._next();
      this._drawn = false;
    }

    _next() {
      const f = this.jet.options.arcFrequency;
      return f <= 0 ? Infinity : Math.max(0.04, -Math.log(1 - Math.random()) / f);
    }
    reschedule() {
      const n = this._next();
      this._timer = n === Infinity ? Infinity : Math.min(this._timer, n);
    }

    spawn() {
      this.bolts.push({
        s0: rand(0.05, 0.75),                       // height fraction on the beam
        side: Math.random() < 0.5 ? -1 : 1,
        reach: rand(0.6, 1.6),                      // × width, sideways
        rise: rand(-0.15, 0.25),                    // × width, up/down
        life: 0, maxLife: rand(0.05, 0.13),
        pts: new Float32Array(ARC_PTS * 2),
        disp: new Float32Array(ARC_PTS),
        jitter: 0,
      });
    }

    _fractal(out, n, amp) {
      out[0] = 0; out[n - 1] = 0;
      let step = n - 1, a = amp;
      while (step > 1) {
        const half = step >> 1;
        for (let i = half; i < n - 1; i += step) out[i] = (out[i - half] + out[i + half]) * 0.5 + rand(-a, a);
        step = half;
        a *= 0.55;
      }
    }

    update(dt, t, power, len) {
      const o = this.jet.options, pal = this.jet.palette, W = o.width;
      if (power > 0.3) {
        this._timer -= dt;
        if (this._timer <= 0) { this.spawn(); this._timer = this._next(); }
      }
      const g = this.view;
      if (!this.bolts.length) {
        if (this._drawn) { g.clear(); this._drawn = false; }  // don't rebuild an empty shape every frame
        return;
      }
      g.clear();
      this._drawn = true;
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        b.life += dt;
        if (b.life >= b.maxLife) { this.bolts.splice(i, 1); continue; }
        b.jitter -= dt;
        if (b.jitter <= 0) {
          b.jitter = 0.025;
          const x0 = this.jet.beam.wobbleX(b.s0, t), y0 = -b.s0 * len;
          const x1 = x0 + b.side * b.reach * W, y1 = y0 - b.rise * W;
          const L = Math.hypot(x1 - x0, y1 - y0) || 1;
          const nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
          this._fractal(b.disp, ARC_PTS, L * 0.22);
          for (let k = 0; k < ARC_PTS; k++) {
            const s = k / (ARC_PTS - 1);
            b.pts[k * 2] = x0 + (x1 - x0) * s + nx * b.disp[k];
            b.pts[k * 2 + 1] = y0 + (y1 - y0) * s + ny * b.disp[k];
          }
        }
        const a = (1 - (b.life / b.maxLife) * 0.6) * (Math.random() < 0.15 ? 0.5 : 1) * power;
        const w = Math.max(0.8, W / 60);
        for (const [wd, c, al] of [[7 * w, pal.color, 0.25], [3 * w, pal.hot, 0.6], [1.2 * w, pal.white, 1]]) {
          g.moveTo(b.pts[0], b.pts[1]);
          for (let k = 1; k < ARC_PTS; k++) g.lineTo(b.pts[k * 2], b.pts[k * 2 + 1]);
          g.stroke({ width: wd, color: c, alpha: al * a, cap: 'round', join: 'round' });
        }
      }
    }
  }

  // ===========================================================================
  // PlasmaJet — the public object
  // ===========================================================================

  class LayerToggle {
    constructor(objects) { this._objects = objects; this._visible = true; }
    get visible() { return this._visible; }
    set visible(v) { this._visible = v; for (const o of this._objects) o.visible = v; }
  }

  const DEFAULTS = {
    height: 360,            // Jet Height — how tall the full-power jet reaches, px
    width: 56,              // Jet Width — thickness of the column, px
    speed: 420,             // Rise Speed — how fast blobs/pulses travel up, px/s
    intensity: 1.0,         // overall brightness
    blobRate: 11,           // Blobs per second
    pulseRate: 1.6,         // how quickly the blob stream "pulses" (clumps), per second
    sparkCount: 60,         // Sparks alive at once (roughly)
    arcFrequency: 1.5,      // Arcs per second (0 = off)
    wobble: 1.0,            // how much the column sways
    blur: 4,                // Beam Blur, px (0 = sharp)
    beamOpacity: 1.0,       // Beam Opacity
    sparkBlur: 0,           // Spark Blur, px (0 = sharp)
    color: 0xff40e0,        // Main Color
    secondColor: 0xb04dff,  // Second Color (null = one color)
  };

  class PlasmaJet {
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options || {});
      this.palette = buildPalette(this.options.color, this.options.secondColor);
      this._time = Math.random() * 100;
      this._power = 1;        // eased 0..1 toward `on`
      this._on = true;
      this._surge = 0;        // 0..1, decays
      this._blobCarry = 0;
      this._sparkCarry = 0;
      this._pulseTimer = rand(0.3, 1);

      const tex = getTextures();
      this.view = new PIXI.Container();

      this.baseGlow = new PIXI.Sprite(tex.glow);
      this.baseGlow.anchor.set(0.5);
      this.baseGlow.blendMode = 'add';
      this.baseCore = new PIXI.Sprite(tex.glow);
      this.baseCore.anchor.set(0.5);
      this.baseCore.blendMode = 'add';

      this.beam = new JetBeam(this);

      const add = () => { const c = new PIXI.Container(); c.blendMode = 'add'; return c; };
      this.blobLayer = add();
      this.pulseLayer = add();
      this.sparkLayer = add();
      this.blobs = new SpritePool(this.blobLayer, tex.blobs[0]);
      this.pulses = new SpritePool(this.pulseLayer, tex.glow);
      this.sparks = new SpritePool(this.sparkLayer, tex.spark);
      // Optional real blur on the sparks (see _applySparkBlur).
      this.sparkBlurFilter = new PIXI.BlurFilter({ strength: 0, quality: 3 });
      this.sparkBlurFilter.blendMode = 'add';
      this._sparkFa = null;
      this.arcs = new JetArcs(this);

      this.view.addChild(this.baseGlow, this.beam.container, this.blobLayer, this.pulseLayer,
        this.sparkLayer, this.arcs.view, this.baseCore);

      this.layers = {
        base: new LayerToggle([this.baseGlow, this.baseCore]),
        beam: new LayerToggle([this.beam.container]),
        blobs: new LayerToggle([this.blobLayer]),
        pulses: new LayerToggle([this.pulseLayer]),
        sparks: new LayerToggle([this.sparkLayer]),
        arcs: new LayerToggle([this.arcs.view]),
      };
    }

    // --- spawning ---------------------------------------------------------

    _spawnBlob(burst) {
      const o = this.options, W = o.width;
      const b = this.blobs.get(getTextures().blobs[Math.floor(Math.random() * 3)]);
      b.y = -rand(0, W * 0.3);
      b.x = rand(-0.15, 0.15) * W;
      b.vy = -o.speed * rand(0.75, 1.05) * (burst ? 1.25 : 1);
      b.vx = rand(-0.08, 0.08) * W;
      b.life = 0;
      b.maxLife = (o.height / o.speed) * rand(0.8, 1.15);
      b.size = rand(0.8, 1.2);
      b.spin = rand(-2, 2);
      b.sprite.rotation = rand(0, TAU);
      b.tintT = Math.random();
      b.seed = rand(0, 50);
    }

    _spawnSpark(burst) {
      const o = this.options, W = o.width;
      const p = this.sparks.get();
      p.x = rand(-0.2, 0.2) * W;
      p.y = -rand(0, W * 0.4);
      const spread = burst ? 0.5 : 0.22;
      const ang = -Math.PI / 2 + rand(-spread, spread);
      const sp = o.speed * rand(1.1, 1.9) * (burst ? 1.3 : 1);
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.life = 0;
      p.maxLife = rand(0.35, 0.8);
      p.size = rand(0.05, 0.1) * W;
      p.hot = Math.random();
    }

    _spawnPulse() {
      const p = this.pulses.get();
      p.s = 0;                                  // height fraction travelled
      p.speed = rand(1.7, 2.3);                 // × Rise Speed
      p.size = rand(0.9, 1.2);
    }

    // --- per frame ----------------------------------------------------------

    update(dt) {
      dt = Math.min(dt, 0.1);
      this._time += dt;
      const t = this._time;
      const o = this.options, pal = this.palette, W = o.width, H = o.height;

      // Ease power toward on/off (~0.35s), surge decays (~0.6s).
      this._power += ((this._on ? 1 : 0) - this._power) * Math.min(1, dt / 0.35);
      if (!this._on && this._power < 0.002) this._power = 0;
      this._surge = Math.max(0, this._surge - dt / 0.6);
      const power = this._power, surge = this._surge;

      // Fully off and nothing left in flight → skip all work.
      const idle = power === 0 && !this.blobs.live.length && !this.sparks.live.length
        && !this.pulses.live.length && !this.arcs.bolts.length;
      this.view.visible = !idle;
      if (idle) return;

      // Base glow — flickers, flares with a surge.
      const flick = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 13.7);
      this.baseGlow.width = W * 3.2 * (1 + 0.4 * surge);
      this.baseGlow.height = W * 1.1 * (1 + 0.3 * surge);
      this.baseGlow.tint = pal.color;
      this.baseGlow.alpha = 0.55 * o.intensity * power * flick;
      this.baseCore.width = W * 1.1;
      this.baseCore.height = W * 0.5;
      this.baseCore.tint = pal.hot;
      this.baseCore.alpha = 0.8 * o.intensity * power * flick;

      // Beam.
      this.beam.update(dt, t, power, surge);
      const len = H * (0.35 + 0.65 * power) * (1 + 0.3 * surge);

      // Blobs — emission rate swells and dips with a slow pulse so the
      // stream comes out in clumps (the segmented look in Rob's reference).
      const clump = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * TAU * o.pulseRate), 2);
      this._blobCarry += o.blobRate * clump * power * dt;
      while (this._blobCarry >= 1) { this._blobCarry -= 1; this._spawnBlob(false); }
      for (let i = this.blobs.live.length - 1; i >= 0; i--) {
        const b = this.blobs.live[i];
        b.life += dt;
        const lt = b.life / b.maxLife;
        if (lt >= 1) { this.blobs.kill(i); continue; }
        b.vx += curlX(b.x / W, b.y / H * 3 + b.seed, t) * W * 0.5 * o.wobble * dt;
        b.vx *= Math.pow(0.4, dt);
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const s = b.sprite;
        s.position.set(b.x, b.y);
        s.rotation += b.spin * dt;
        const size = W * b.size * (0.95 + 0.9 * lt) * (1 + 0.3 * surge);
        s.width = size;
        s.height = size * 1.45;   // taller than wide, like the rising plasma blobs in Rob's reference
        s.tint = lt < 0.25 ? mixColor(pal.hot, pal.color, lt / 0.25) : mixColor(pal.color, pal.accent, (lt - 0.25) / 0.75 * b.tintT);
        s.alpha = Math.min(1, clamp01(lt / 0.06) * Math.pow(1 - lt, 1.1) * 1.15 * o.intensity);
      }

      // Pulses — bright packets racing up the beam.
      this._pulseTimer -= dt;
      if (this._pulseTimer <= 0 && power > 0.5) { this._spawnPulse(); this._pulseTimer = rand(0.5, 1.4); }
      for (let i = this.pulses.live.length - 1; i >= 0; i--) {
        const p = this.pulses.live[i];
        p.s += (o.speed * p.speed / Math.max(1, len)) * dt;
        if (p.s >= 1) { this.pulses.kill(i); continue; }
        const s = p.sprite;
        s.position.set(this.beam.wobbleX(p.s, t), -p.s * len);
        s.width = W * 0.9 * p.size;
        s.height = W * 2.2 * p.size;
        s.tint = mixColor(pal.hot, pal.white, 0.5);
        s.alpha = clamp01(p.s / 0.05) * Math.pow(1 - p.s, 1.2) * 0.8 * o.intensity * o.beamOpacity;
      }

      // Sparks.
      this._applySparkBlur(W, H);
      const sparkBoost = 1 + o.sparkBlur / 6;   // blur spreads a spark thin — brighten to compensate
      this._sparkCarry += (o.sparkCount / 0.55) * power * dt;
      while (this._sparkCarry >= 1) { this._sparkCarry -= 1; this._spawnSpark(false); }
      for (let i = this.sparks.live.length - 1; i >= 0; i--) {
        const p = this.sparks.live[i];
        p.life += dt;
        const lt = p.life / p.maxLife;
        if (lt >= 1) { this.sparks.kill(i); continue; }
        p.vy += 220 * dt;              // slows as it rises
        p.x += p.vx * dt; p.y += p.vy * dt;
        const s = p.sprite;
        s.position.set(p.x, p.y);
        const sp = Math.hypot(p.vx, p.vy);
        s.rotation = Math.atan2(p.vy, p.vx);
        s.height = Math.max(1.5, p.size * (1 - lt * 0.5));
        s.width = s.height * (1.5 + sp / 90);
        s.tint = mixColor(pal.hot, pal.white, p.hot);
        s.alpha = Math.min(1, clamp01(lt / 0.1) * (1 - lt) * o.intensity * sparkBoost);
      }

      // Arcs.
      this.arcs.update(dt, t, power, len);
    }

    // Spark blur, on a fixed-size area around the jet (sparks fly up and a
    // bit outward) — a fixed area stops the blur's texture resizing every
    // frame as sparks move, which would jitter (see plasma_storm.js).
    _applySparkBlur(W, H) {
      const b = this.options.sparkBlur;
      this.sparkBlurFilter.strength = b;
      this.sparkLayer.filters = b > 0 ? [this.sparkBlurFilter] : null;
      if (b > 0 && (!this._sparkFa || this._sparkFa.w !== W || this._sparkFa.h !== H)) {
        const m = 40 + b * 3;
        this.sparkLayer.filterArea = new PIXI.Rectangle(-W * 4 - m, -H * 1.5 - m, W * 8 + 2 * m, H * 1.5 + 2 * m);
        this._sparkFa = { w: W, h: H };
      }
    }

    // Flare the whole jet right now.
    surge() {
      this._surge = 1;
      for (let i = 0; i < 6; i++) this._spawnBlob(true);
      for (let i = 0; i < 25; i++) this._spawnSpark(true);
      this._spawnPulse(); this._spawnPulse();
      this.arcs.spawn(); this.arcs.spawn();
    }

    // --- Exposed parameters (all live) --------------------------------------
    get on() { return this._on; }
    set on(v) { this._on = !!v; }
    get height() { return this.options.height; }
    set height(v) { this.options.height = Math.max(20, v); }
    get width() { return this.options.width; }
    set width(v) { this.options.width = Math.max(4, v); }
    get speed() { return this.options.speed; }
    set speed(v) { this.options.speed = Math.max(20, v); }
    get intensity() { return this.options.intensity; }
    set intensity(v) { this.options.intensity = Math.max(0, v); }
    get blobRate() { return this.options.blobRate; }
    set blobRate(v) { this.options.blobRate = Math.max(0, v); }
    get pulseRate() { return this.options.pulseRate; }
    set pulseRate(v) { this.options.pulseRate = Math.max(0, v); }
    get sparkCount() { return this.options.sparkCount; }
    set sparkCount(v) { this.options.sparkCount = Math.max(0, v); }
    get arcFrequency() { return this.options.arcFrequency; }
    set arcFrequency(v) { this.options.arcFrequency = Math.max(0, v); this.arcs.reschedule(); }
    get wobble() { return this.options.wobble; }
    set wobble(v) { this.options.wobble = Math.max(0, v); }
    get blur() { return this.options.blur; }
    set blur(v) { this.options.blur = Math.max(0, v); }
    get beamOpacity() { return this.options.beamOpacity; }
    set beamOpacity(v) { this.options.beamOpacity = Math.max(0, Math.min(1, v)); }
    get sparkBlur() { return this.options.sparkBlur; }
    set sparkBlur(v) { this.options.sparkBlur = Math.max(0, v); }
    get color() { return this.options.color; }
    set color(v) { this.options.color = v; this.palette = buildPalette(v, this.options.secondColor); }
    get secondColor() { return this.options.secondColor; }
    set secondColor(v) { this.options.secondColor = v; this.palette = buildPalette(this.options.color, v); }

    destroy() { this.view.destroy({ children: true }); }
  }

  PlasmaJet.DEFAULTS = DEFAULTS;
  window.PlasmaJet = PlasmaJet;
})();
