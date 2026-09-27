// PlasmaStorm — a large, self-contained "plasma storm / force field" effect
// for PixiJS v8 that streams continuously from RIGHT to LEFT. Sibling of
// plasma_orb.js and nebula_cloud.js, same plain <script> tag approach: load
// it after js/vendor/pixi.min.js and it exposes one global, `PlasmaStorm`.
// Nothing in the game uses it yet — see plasma_storm_demo.html.
//
// No lightning here — the look is a flowing energy field. Layers, back → front
// inside `storm.view`:
//
//   1. GAS         (StormGasLayer)   — big stretched plasma wisps drifting
//      left in two depths (slow dim ones behind, faster bright ones in front)
//      with a gentle up/down undulation from curl noise.
//   2. FLOW LINES  (StormFlowLayer)  — long glowing wavy "field lines" whose
//      waves travel leftward, each with a bright energy packet racing along it,
//      drawn as soft glowing ribbons.
//   3. PARTICLES   (StormParticleLayer) — fast streaking motes stretched along
//      their motion, riding the same flow.
//
// Coordination: every so often a FORCE WAVE (a tall soft band of light) sweeps
// right→left faster than the flow. Wherever it is, the gas and
// particles brighten — like a shockwave rolling through the field.
//
// Every layer fades out toward all four edges, so the storm has no hard
// borders and can be laid over a scene. Positions are stored in normalized
// coordinates (u, v from -1..1 across width/height), so resizing is instant.
//
// Usage:
//   const storm = new PlasmaStorm({ width: 720, height: 420 });
//   someContainer.addChild(storm.view);
//   storm.view.position.set(x, y);   // center of the field
//   storm.update(dtSeconds);         // once per frame
//   storm.flowSpeed = 300;           // everything is live-tweakable
//   storm.wave();                    // send a force wave through now
//   storm.destroy();

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function randn() {
    let u = 0; while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
  }
  function unpack(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
  function pack(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return (c(r) << 16) | (c(g) << 8) | c(b);
  }
  function mixColor(a, b, t) {
    const A = unpack(a), B = unpack(b);
    return pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }

  // Soft fade toward the left/right ends (u) and top/bottom (v).
  const edgeU = (u) => clamp01((1.05 - Math.abs(u)) / 0.35);
  const edgeV = (v) => clamp01((1.0 - Math.abs(v)) / 0.4);

  function buildPalette(color, second) {
    const accent = second == null ? color : second;
    return {
      deep:   mixColor(color, 0x000000, 0.65),
      color:  color,
      accent: accent,
      mid:    mixColor(color, accent, 0.5),
      hot:    mixColor(color, 0xffffff, 0.65),
      white:  0xffffff,
    };
  }

  // Smooth divergence-free flow (see nebula_cloud.js) — used here only for
  // the vertical undulation of gas and particles.
  function curl(x, y, t, out) {
    const a = 1.3 * x + 0.7 * t, b = 1.1 * y - 0.5 * t;
    const c = 2.7 * y + 0.9 * t + 1.9 * x;
    const dPsiDx = 1.3 * Math.cos(a) * Math.cos(b) + 0.5 * 1.9 * Math.cos(c);
    const dPsiDy = -1.1 * Math.sin(a) * Math.sin(b) + 0.5 * 2.7 * Math.cos(c);
    out.x = dPsiDy;
    out.y = -dPsiDx;
    return out;
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

  // Long streaky plasma wisp: value noise sampled much coarser horizontally.
  function wispTexture(w, h, seed) {
    const c = makeCanvas(w, h), ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
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
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const dx = (px - w / 2) / (w / 2), dy = (py - h / 2) / (h / 2);
        const falloff = clamp01(1 - Math.sqrt(dx * dx + dy * dy));
        const n = noise(px / 40, py / 7) * 0.55 + noise(px / 18, py / 3.5) * 0.3 + noise(px / 9, py / 2) * 0.15;
        const a = clamp01(falloff * Math.pow(n, 1.8) * 2.4);
        const i = (py * w + px) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  // Ribbon texture for the flow lines: across its height, a bell-shaped
  // glow (`sharp` sets how tight it is); along its length, fades at both
  // ends so every ribbon tapers out instead of ending abruptly.
  function ribbonTexture(sharp) {
    const w = 256, h = 32;
    const c = makeCanvas(w, h), ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const d = (y + 0.5 - h / 2) / (h / 2);          // -1..1 across
      const across = Math.exp(-d * d * sharp);
      for (let x = 0; x < w; x++) {
        const e = Math.min(x, w - 1 - x) / (w * 0.17);  // end taper
        const along = e >= 1 ? 1 : e * e * (3 - 2 * e);
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
      wisps: [wispTexture(256, 64, 31), wispTexture(256, 64, 32), wispTexture(256, 64, 33)],
      glow: radialTexture(128, [[0, 1], [0.25, 0.55], [0.55, 0.15], [1, 0]]),
      mote: radialTexture(32, [[0, 1], [0.2, 0.9], [0.45, 0.3], [1, 0]]),
      ribbonSoft: ribbonTexture(4.5),   // soft glow profile (≈0 at its edges, so no visible rim)
      ribbonCore: ribbonTexture(6),     // tight, brighter core profile
    };
    return sharedTextures;
  }

  // ===========================================================================
  // FORCE WAVES — shared "shockwave" bands sweeping right → left.
  // ===========================================================================

  class StormWaves {
    constructor(storm) {
      this.storm = storm;
      this.list = [];                      // { u, width, strength }
      this.view = new PIXI.Container();    // the visible band glows
      this.view.blendMode = 'add';
      this._pool = [];
      this._timer = rand(0.5, 1.5);
    }

    _nextInterval() {
      const f = this.storm.options.waveFrequency;
      return f <= 0 ? Infinity : Math.max(0.3, -Math.log(1 - Math.random()) / f);
    }
    reschedule() {
      const n = this._nextInterval();
      this._timer = n === Infinity ? Infinity : Math.min(this._timer, n);
    }

    spawn() {
      let s = this._pool.pop();
      if (!s) {
        s = new PIXI.Sprite(getTextures().glow);
        s.anchor.set(0.5);
        this.view.addChild(s);
      }
      s.visible = true;
      this.list.push({ u: 1.25, width: rand(0.1, 0.2), strength: rand(0.7, 1), sprite: s });
    }

    // How much force-wave light is at horizontal position u (0 = none).
    at(u) {
      let b = 0;
      for (const w of this.list) {
        const d = (u - w.u) / w.width;
        b += w.strength * Math.exp(-d * d);
      }
      return b;
    }

    update(dt) {
      const o = this.storm.options;
      const pal = this.storm.palette;
      this._timer -= dt;
      if (this._timer <= 0) { this.spawn(); this._timer = this._nextInterval(); }
      // Waves move 1.8× faster than the flow itself.
      const du = (o.flowSpeed * 1.8) / (o.width / 2) * dt;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const w = this.list[i];
        w.u -= du;
        if (w.u < -1.3) {
          w.sprite.visible = false;
          this._pool.push(w.sprite);
          this.list.splice(i, 1);
          continue;
        }
        const s = w.sprite;
        s.position.set(w.u * o.width / 2, 0);
        s.width = w.width * o.width * 1.4;
        s.height = o.height * 1.1;
        s.tint = pal.accent;
        s.alpha = 0.22 * w.strength * edgeU(w.u);
      }
    }
  }

  // ===========================================================================
  // LAYER 1 — GAS
  // ===========================================================================

  class StormGasLayer {
    constructor(storm) {
      this.storm = storm;
      this.back = new PIXI.Container();  this.back.blendMode = 'add';
      this.front = new PIXI.Container(); this.front.blendMode = 'add';
      this.puffs = [];
      this._tmp = { x: 0, y: 0 };
      this.rebuild();
    }

    rebuild() {
      for (const p of this.puffs) p.sprite.destroy();
      this.puffs.length = 0;
      const tex = getTextures();
      const n = Math.max(4, Math.round(this.storm.options.density));
      for (let i = 0; i < n; i++) {
        const front = i % 3 === 0;                 // a third in front, faster & brighter
        const s = new PIXI.Sprite(tex.wisps[i % tex.wisps.length]);
        s.anchor.set(0.5);
        (front ? this.front : this.back).addChild(s);
        const p = { sprite: s, front };
        this._reset(p, rand(-1.3, 1.3));
        this.puffs.push(p);
      }
    }

    _reset(p, u) {
      p.u = u;
      p.v = Math.max(-0.8, Math.min(0.8, randn() * 0.45));
      p.oy = 0;
      p.speed = p.front ? rand(1.0, 1.35) : rand(0.45, 0.75);  // × flowSpeed
      p.len = p.front ? rand(0.35, 0.6) : rand(0.5, 0.9);      // × width
      p.thick = p.front ? rand(0.18, 0.32) : rand(0.35, 0.65);  // × height
      p.baseAlpha = p.front ? rand(0.18, 0.3) : rand(0.14, 0.24);
      p.tintT = Math.random();
      p.flip = Math.random() < 0.5 ? -1 : 1;
      p.seed = rand(0, 50);
    }

    update(dt, t) {
      const storm = this.storm, o = storm.options, pal = storm.palette;
      const W = o.width, H = o.height;
      const tmp = this._tmp;
      const du = o.flowSpeed / (W / 2) * dt;
      for (const p of this.puffs) {
        p.u -= du * p.speed;
        if (p.u < -1.35) this._reset(p, 1.35);     // left the field → re-enter on the right
        curl(p.u * 1.5 + p.seed, p.v * 2, t * 0.3 * o.turbulence, tmp);
        p.oy += (tmp.y * 0.08 * o.turbulence - p.oy * 0.6) * dt;
        const v = p.v + p.oy;
        const s = p.sprite;
        s.position.set(p.u * W / 2, v * H / 2);
        // Size via scale, not width/height: Pixi's width setter keeps the
        // sprite's current flip direction, so assigning a negative width every
        // frame flipped mirrored wisps back and forth (visible jitter).
        s.scale.set((p.len * W / s.texture.width) * p.flip, p.thick * H / s.texture.height);
        const wave = storm.waves.at(p.u);
        const base = p.front ? mixColor(pal.color, pal.accent, p.tintT) : mixColor(pal.deep, pal.color, p.tintT);
        s.tint = wave > 0.05 ? mixColor(base, pal.hot, Math.min(0.6, wave * 0.5)) : base;
        s.alpha = clamp01(p.baseAlpha * o.intensity * edgeU(p.u) * edgeV(v) * (1 + wave * 0.9));
      }
    }
  }

  // ===========================================================================
  // LAYER 2 — FLOW LINES
  // ===========================================================================
  //
  // Each line is y = base + A·sin(k·x + ω·t + φ) + a smaller second wave.
  // With +ω·t the wave crests travel toward -x, i.e. right → left. Each line
  // fades in, lives a few seconds, fades out and is reborn somewhere else so
  // the pattern never repeats. A short bright "energy packet" races along
  // every line.
  //
  // Drawn as ribbons (MeshRope), not redrawn shapes: every line is a fixed
  // strip of points and each frame only those points move. A real BlurFilter
  // (strength = `lineBlur`) then softens the whole layer. An earlier version
  // redrew every line from scratch each frame AND blurred it — that combo
  // periodically stalled the GPU (visible start-stop hitches). Blurring
  // ribbons instead tested completely smooth. The ribbon texture also fades
  // at both ends, so lines taper out smoothly at the field's edges.

  const LINE_PTS = 48;     // points along each line
  const PACKET_PTS = 12;   // points along each energy packet

  class StormFlowLayer {
    constructor(storm) {
      this.storm = storm;
      this.container = new PIXI.Container();
      this.container.blendMode = 'add';
      this.lines = [];
      this._phase = 0;
      this.blur = new PIXI.BlurFilter({ strength: storm.options.lineBlur, quality: 3 });
      this.blur.blendMode = 'add';
      this.applyBlur();
    }

    // 0 removes the filter entirely (saves a render pass).
    applyBlur() {
      const b = this.storm.options.lineBlur;
      this.blur.strength = b;
      this.container.filters = b > 0 ? [this.blur] : null;
    }

    // A fixed blur area: otherwise Pixi resizes the blur's off-screen texture
    // to the lines' bounds every frame as they wave, which made the blurred
    // layer jitter by a pixel or two.
    _fixFilterArea(W, H) {
      if (this._fa && this._fa.w === W && this._fa.h === H) return;
      const m = H * 0.3 + 60;
      this.container.filterArea = new PIXI.Rectangle(-W / 2 - m, -H / 2 - m, W + 2 * m, H + 2 * m);
      this._fa = { w: W, h: H };
    }

    _makeRope(texture, count) {
      const points = [];
      for (let i = 0; i < count; i++) points.push(new PIXI.Point(i, 0));
      const rope = new PIXI.MeshRope({ texture, points, textureScale: 0 });
      rope.blendMode = 'add';
      this.container.addChild(rope);
      return rope;
    }

    // RopeGeometry's `width` is read-only in this Pixi build, but its vertex
    // update (run automatically every frame) reads the private `_width`
    // each time — so setting that is free and takes effect immediately.
    _setWidth(rope, w) { rope.geometry._width = w; }

    _newParams(L, prewarm) {
      L.v = Math.max(-0.7, Math.min(0.7, randn() * 0.42));
      L.a1 = rand(0.05, 0.16); L.k1 = rand(1.5, 3); L.w1 = rand(1.0, 2.0); L.p1 = rand(0, TAU);
      L.a2 = rand(0.012, 0.035); L.k2 = rand(3, 5); L.w2 = rand(1.2, 2.4); L.p2 = rand(0, TAU);
      L.maxLife = rand(3, 7);
      L.life = prewarm ? Math.random() * L.maxLife : 0;
      L.thick = rand(0.6, 1.3);
      L.tintT = Math.random();
      L.packet = rand(-1, 1.4); L.packetSpeed = rand(1.8, 2.5); L.packetLen = rand(0.12, 0.25);
    }

    _newLine() {
      const tex = getTextures();
      const L = {
        glow: this._makeRope(tex.ribbonSoft, LINE_PTS),
        core: this._makeRope(tex.ribbonCore, LINE_PTS),
        pGlow: this._makeRope(tex.ribbonSoft, PACKET_PTS),
        pCore: this._makeRope(tex.ribbonCore, PACKET_PTS),
      };
      this._newParams(L, true);
      return L;
    }

    _y(L, u, t, H) {
      return (L.v + L.a1 * Math.sin(L.k1 * u * Math.PI + L.w1 * t + L.p1)
                  + L.a2 * Math.sin(L.k2 * u * Math.PI + L.w2 * t + L.p2)) * H / 2;
    }

    // Lay a rope's points along the line between u0 and u1.
    _place(rope, L, u0, u1, tw, W, H) {
      const pts = rope.geometry.points;
      const n = pts.length;
      for (let k = 0; k < n; k++) {
        const u = u0 + (u1 - u0) * (k / (n - 1));
        pts[k].x = u * W / 2;
        pts[k].y = this._y(L, u, tw, H);
      }
    }

    update(dt) {
      const storm = this.storm, o = storm.options, pal = storm.palette;
      const W = o.width, H = o.height;

      const target = Math.round(o.lineCount);
      while (this.lines.length < target) this.lines.push(this._newLine());
      while (this.lines.length > target) {
        const L = this.lines.pop();
        for (const r of [L.glow, L.core, L.pGlow, L.pCore]) r.destroy();
      }

      this.container.alpha = o.lineOpacity;
      // Wave phase is accumulated (not t × speed), so changing the flow speed
      // mid-run changes how fast the waves move without snapping them.
      this._phase += dt * (o.flowSpeed / 220);
      const tw = this._phase;
      const du = o.flowSpeed / (W / 2) * dt;
      const blur = o.lineBlur;
      this._fixFilterArea(W, H);
      // Blur spreads each line's light thin, so compensate: the blurrier the
      // lines, the wider and brighter they're drawn before blurring.
      const w = Math.max(0.8, H / 400) * (1 + blur / 12);
      const boost = 1 + blur / 5;
      const glowW = 6.5 * w, coreW = 2.2 * w;

      for (const L of this.lines) {
        L.life += dt;
        if (L.life >= L.maxLife) this._newParams(L, false);
        const lt = L.life / L.maxLife;
        const env = clamp01(lt / 0.2) * clamp01((1 - lt) / 0.25) * o.intensity * edgeV(L.v);
        const color = mixColor(pal.color, pal.accent, L.tintT);

        this._place(L.glow, L, -1.05, 1.05, tw, W, H);
        this._place(L.core, L, -1.05, 1.05, tw, W, H);
        this._setWidth(L.glow, glowW * L.thick);
        this._setWidth(L.core, coreW * L.thick);
        L.glow.tint = color;
        L.glow.alpha = Math.min(1, 0.22 * env * boost);
        L.core.tint = mixColor(color, pal.hot, 0.6);
        L.core.alpha = Math.min(1, 0.38 * env * boost);

        // Energy packet racing left along the line.
        L.packet -= du * L.packetSpeed;
        if (L.packet < -1.3) L.packet = rand(1.2, 1.8);
        const pu0 = L.packet, pu1 = L.packet + L.packetLen;
        const pa = env * edgeU(pu0 + L.packetLen / 2);
        this._place(L.pGlow, L, pu0, pu1, tw, W, H);
        this._place(L.pCore, L, pu0, pu1, tw, W, H);
        this._setWidth(L.pGlow, glowW * 1.5 * L.thick);
        this._setWidth(L.pCore, coreW * 1.6 * L.thick);
        L.pGlow.tint = pal.hot;
        L.pGlow.alpha = Math.min(1, 0.22 * pa * boost);
        L.pCore.tint = pal.white;
        L.pCore.alpha = Math.min(1, 0.6 * pa * boost);
      }
    }
  }

  // ===========================================================================
  // LAYER 3 — PARTICLES
  // ===========================================================================

  class StormParticleLayer {
    constructor(storm) {
      this.storm = storm;
      this.view = new PIXI.Container();
      this.view.blendMode = 'add';
      this.motes = [];
      this._tmp = { x: 0, y: 0 };
    }

    _reset(m, u) {
      m.u = u;
      m.v = rand(-0.9, 0.9);
      m.speed = rand(1.2, 2.6);          // × flowSpeed — faster than the gas
      m.size = rand(0.006, 0.014);       // × height
      m.hot = Math.random();
      m.tw = rand(1.5, 3.5); m.ph = rand(0, TAU);
    }

    update(dt, t) {
      const storm = this.storm, o = storm.options, pal = storm.palette;
      const W = o.width, H = o.height;
      const n = Math.round(o.particleCount);
      const tex = getTextures().mote;
      while (this.motes.length < n) {
        const s = new PIXI.Sprite(tex);
        s.anchor.set(0.5);
        this.view.addChild(s);
        const m = { sprite: s };
        this._reset(m, rand(-1.2, 1.2));
        this.motes.push(m);
      }
      while (this.motes.length > n) this.motes.pop().sprite.destroy();

      this.view.alpha = o.particleOpacity;   // whole-layer transparency
      const tmp = this._tmp;
      const du = o.flowSpeed / (W / 2) * dt;
      for (const m of this.motes) {
        m.u -= du * m.speed;
        if (m.u < -1.2) this._reset(m, rand(1.1, 1.3));
        curl(m.u * 1.5, m.v * 2, t * 0.3 * o.turbulence, tmp);
        const vy = tmp.y * 0.12 * o.turbulence;
        m.v += vy * dt;
        m.v = Math.max(-0.95, Math.min(0.95, m.v)); // stay inside, no teleporting
        const s = m.sprite;
        s.position.set(m.u * W / 2, m.v * H / 2);
        // Streak length follows speed; tilt follows its up/down drift.
        const px = m.speed * o.flowSpeed, py = vy * H / 2;
        s.rotation = Math.atan2(py, -px);
        s.height = Math.max(1.5, m.size * H);
        s.width = s.height * (2 + px / 60);
        s.tint = mixColor(pal.accent, pal.white, 0.3 + 0.6 * m.hot);
        const twinkle = 0.6 + 0.4 * Math.sin(t * m.tw + m.ph);
        s.alpha = clamp01(twinkle * edgeU(m.u) * edgeV(m.v) * (0.7 + storm.waves.at(m.u) * 0.6));
      }
    }
  }

  // ===========================================================================
  // PlasmaStorm — the public object.
  // ===========================================================================

  class LayerToggle {
    constructor(objects) { this._objects = objects; this._visible = true; }
    get visible() { return this._visible; }
    set visible(v) { this._visible = v; for (const o of this._objects) o.visible = v; }
  }

  const DEFAULTS = {
    width: 720,             // Field Width, px
    height: 420,            // Field Height, px
    flowSpeed: 220,         // Flow Speed — px per second, right → left
    intensity: 1.0,         // overall brightness of gas + lines
    density: 30,            // Gas Density — number of plasma wisps
    lineCount: 9,           // Field Lines — glowing wavy lines
    particleCount: 140,     // Particles — streaking motes
    waveFrequency: 0.5,     // Force Waves per second (0 = off)
    lineBlur: 6,            // Line Blur — softness of the field lines, px (0 = sharp)
    lineOpacity: 1.0,       // Line Opacity — 0 = invisible, 1 = fully solid
    particleOpacity: 1.0,   // Particle Opacity — 0 = invisible, 1 = fully solid
    turbulence: 1.0,        // how much things undulate up/down
    color: 0x29d4ff,        // Main Color
    secondColor: 0xb04dff,  // Second Color (null = one color)
  };

  class PlasmaStorm {
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options || {});
      this.palette = buildPalette(this.options.color, this.options.secondColor);
      this._time = Math.random() * 100;

      this.view = new PIXI.Container();
      this.waves = new StormWaves(this);
      this.gas = new StormGasLayer(this);
      this.flow = new StormFlowLayer(this);
      this.particles = new StormParticleLayer(this);

      this.view.addChild(
        this.gas.back,
        this.waves.view,
        this.flow.container,
        this.gas.front,
        this.particles.view,
      );

      this.layers = {
        gas: new LayerToggle([this.gas.back, this.gas.front]),
        lines: new LayerToggle([this.flow.container]),
        particles: new LayerToggle([this.particles.view]),
        waves: new LayerToggle([this.waves.view]),
      };
    }

    update(dt) {
      dt = Math.min(dt, 0.1);
      this._time += dt;
      this.waves.update(dt);        // first, so every layer sees this frame's waves
      this.gas.update(dt, this._time);
      this.flow.update(dt);
      this.particles.update(dt, this._time);
    }

    // Send a force wave through right now.
    wave() { this.waves.spawn(); }

    // --- Exposed parameters (all live) --------------------------------------
    get width() { return this.options.width; }
    set width(v) { this.options.width = Math.max(50, v); }
    get height() { return this.options.height; }
    set height(v) { this.options.height = Math.max(30, v); }
    get flowSpeed() { return this.options.flowSpeed; }
    set flowSpeed(v) { this.options.flowSpeed = Math.max(0, v); }
    get intensity() { return this.options.intensity; }
    set intensity(v) { this.options.intensity = Math.max(0, v); }
    get density() { return this.options.density; }
    set density(v) {
      const n = Math.max(4, Math.round(v));
      if (n === this.options.density) return;
      this.options.density = n;
      this.gas.rebuild();
    }
    get lineCount() { return this.options.lineCount; }
    set lineCount(v) { this.options.lineCount = Math.max(0, Math.round(v)); }
    get particleCount() { return this.options.particleCount; }
    set particleCount(v) { this.options.particleCount = Math.max(0, Math.round(v)); }
    get waveFrequency() { return this.options.waveFrequency; }
    set waveFrequency(v) { this.options.waveFrequency = Math.max(0, v); this.waves.reschedule(); }
    get lineBlur() { return this.options.lineBlur; }
    set lineBlur(v) { this.options.lineBlur = Math.max(0, v); this.flow.applyBlur(); }
    get lineOpacity() { return this.options.lineOpacity; }
    set lineOpacity(v) { this.options.lineOpacity = Math.max(0, Math.min(1, v)); }
    get particleOpacity() { return this.options.particleOpacity; }
    set particleOpacity(v) { this.options.particleOpacity = Math.max(0, Math.min(1, v)); }
    get turbulence() { return this.options.turbulence; }
    set turbulence(v) { this.options.turbulence = Math.max(0, v); }
    get color() { return this.options.color; }
    set color(v) { this.options.color = v; this.palette = buildPalette(v, this.options.secondColor); }
    get secondColor() { return this.options.secondColor; }
    set secondColor(v) { this.options.secondColor = v; this.palette = buildPalette(this.options.color, v); }

    destroy() { this.view.destroy({ children: true }); }
  }

  PlasmaStorm.DEFAULTS = DEFAULTS;
  window.PlasmaStorm = PlasmaStorm;
})();
