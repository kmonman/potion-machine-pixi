// NebulaCloud — a self-contained, multi-layered "hot nebula storm cloud"
// effect for PixiJS v8. Sibling of js/plasma_orb.js, same plain <script> tag
// approach: load it after js/vendor/pixi.min.js and it exposes one global,
// `NebulaCloud`. Nothing in the game uses it yet — see nebula_cloud_demo.html
// for a live test page with sliders.
//
// Unlike the orb, nothing here orbits or spins around a center. The cloud
// stays put as a whole; its gas just keeps churning in place, pushed around
// by a slowly-evolving curl-noise flow field, and lightning flickers *inside*
// it, lighting up the gas around each strike.
//
// Layers, stacked back → front inside `cloud.view`:
//
//   1. GAS      (NebulaGasLayer)       — dozens of big soft glowing puffs
//      arranged in irregular lobes (not a neat ellipse): hot white-yellow
//      core, orange-red middle, deep red wispy edges. Additive.
//   2. LIGHTNING (NebulaLightningLayer) — a soft flash glow where each bolt
//      strikes, then the jagged bolts themselves.
//   3. DUST     (part of NebulaGasLayer) — dark, normal-blended smoke wisps
//      drawn OVER the lightning, so bolts look buried inside the cloud
//      rather than pasted on top — plus a faint glowing haze over that.
//   4. EMBERS   (NebulaEmberLayer)      — tiny hot motes and twinkling star
//      points drifting with the same flow field, slowly rising like heat.
//
// Coordination: every lightning strike reports a flash (position, reach,
// brightness); gas puffs near it brighten and shift toward white-hot, so the
// cloud visibly lights up from within where the bolt is.
//
// Usage:
//   const cloud = new NebulaCloud({ width: 420, height: 260, density: 40,
//                                   emberCount: 150, color: 0xff3a1a,
//                                   secondColor: 0xffa21f,
//                                   lightningFrequency: 1.2, turbulence: 1 });
//   someContainer.addChild(cloud.view);
//   cloud.view.position.set(x, y);   // center of the cloud
//   cloud.update(dtSeconds);         // once per frame
//   cloud.width = 500;               // every parameter is live-tweakable
//   cloud.strike(2);                 // force lightning now
//   cloud.destroy();
//
// Positions are stored in "normalized" cloud coordinates (-1..1 across the
// width/height), so resizing the cloud reshapes everything instantly.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers (private to this file)
  // ---------------------------------------------------------------------------

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // Normally-distributed random number (Box–Muller) — clusters near 0.
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

  // Main "Hot Color" + "Second Color" → every tone the layers use.
  //   dust  — near-black smoke lanes
  //   deep  — dark outer gas
  //   color — main body glow (reds)
  //   accent— the second color (oranges/yellows), used toward the core
  //   hot   — near-white core / lightning glow
  function buildPalette(color, second) {
    const accent = second == null ? color : second;
    return {
      dust:   mixColor(color, 0x000000, 0.88),
      deep:   mixColor(color, 0x000000, 0.5),
      color:  color,
      accent: accent,
      hot:    mixColor(accent, 0xffffff, 0.6),
      white:  0xffffff,
    };
  }

  // Two-octave curl noise: a smooth, swirling, divergence-free flow — gas
  // pushed by it churns and eddies but never piles up or empties out.
  function curl(x, y, t, out) {
    const a = 1.3 * x + 0.7 * t, b = 1.1 * y - 0.5 * t;
    const c = 2.7 * y + 0.9 * t + 1.9 * x, d = 3.1 * x - 0.8 * t - 1.2 * y;
    // ψ = sin(a)cos(b) + 0.5 sin(c) + 0.3 cos(d)
    const dPsiDx = 1.3 * Math.cos(a) * Math.cos(b) + 0.5 * 1.9 * Math.cos(c) - 0.3 * 3.1 * Math.sin(d);
    const dPsiDy = -1.1 * Math.sin(a) * Math.sin(b) + 0.5 * 2.7 * Math.cos(c) + 0.3 * 1.2 * Math.sin(d);
    out.x = dPsiDy;
    out.y = -dPsiDx;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Procedural textures (white/grayscale, recolored with `.tint`), built once
  // and shared by every cloud.
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

  // Lumpy gas puff from layered value noise. `stretch` > 1 makes long wisps
  // (noise sampled coarser horizontally), `contrast` sharpens the lumps.
  function gasTexture(size, seed, stretch, contrast) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const hash = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const smooth = (t) => t * t * (3 - 2 * t);
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = smooth(x - xi), yf = smooth(y - yi);
      const a = hash(xi, yi), b = hash(xi + 1, yi);
      const c2 = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return a + (b - a) * xf + (c2 - a) * yf + (a - b - c2 + d) * xf * yf;
    };
    const half = size / 2;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = (px - half) / half, dy = (py - half) / half;
        const d = Math.sqrt(dx * dx + dy * dy * stretch * stretch * 0.6);
        const falloff = clamp01(1 - d);
        const nx = px / stretch;
        const n = noise(nx / 26, py / 26) * 0.5 + noise(nx / 13, py / 13) * 0.3 + noise(nx / 6, py / 6) * 0.2;
        const a = clamp01(falloff * falloff * Math.pow(n, contrast) * 2.6);
        const i = (py * size + px) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  // Four-point twinkle star: a soft dot plus thin horizontal/vertical flares.
  function starTexture(size) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r * 0.45);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    for (const [w, h] of [[size, size * 0.06], [size * 0.06, size]]) {
      const lg = w > h
        ? ctx.createLinearGradient(0, 0, size, 0)
        : ctx.createLinearGradient(0, 0, 0, size);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(r - w / 2, r - h / 2, w, h);
    }
    return PIXI.Texture.from(c);
  }

  function getTextures() {
    if (sharedTextures) return sharedTextures;
    sharedTextures = {
      puffs: [gasTexture(128, 11, 1, 1.6), gasTexture(128, 12, 1, 2.2), gasTexture(128, 13, 1.4, 1.8), gasTexture(128, 14, 1, 2.6)],
      wisps: [gasTexture(128, 21, 2.2, 2.0), gasTexture(128, 22, 2.6, 2.4)],
      glow: radialTexture(128, [[0, 1], [0.2, 0.6], [0.5, 0.18], [0.8, 0.04], [1, 0]]),
      ember: radialTexture(32, [[0, 1], [0.2, 0.9], [0.45, 0.3], [1, 0]]),
      star: starTexture(64),
    };
    return sharedTextures;
  }

  // ===========================================================================
  // LAYER 1 + 3 — GAS & DUST
  // ===========================================================================
  //
  // Puffs are scattered around 3–5 random "lobes" (so every cloud has its
  // own irregular shape) and assigned a role by how central they are:
  //   core  → hot/second color, bright, smaller
  //   body  → main color
  //   edge  → deep color, bigger, stretched wisps
  // Each puff has a home point; a curl-noise offset pushes it around and a
  // soft spring pulls it back, so the gas swirls in place forever without
  // drifting apart. Opacity and size also "breathe" slowly per puff.

  class NebulaGasLayer {
    constructor(neb) {
      this.neb = neb;
      this.glow = new PIXI.Container();   // main glowing gas (additive)
      this.glow.blendMode = 'add';
      this.dust = new PIXI.Container();   // dark smoke over the lightning
      this.haze = new PIXI.Container();   // faint glow over the dust
      this.haze.blendMode = 'add';
      this.puffs = [];
      this.dusts = [];
      this.hazes = [];
      this._tmp = { x: 0, y: 0 };
      this._makeLobes();
      this.rebuild();
    }

    _makeLobes() {
      const n = 3 + Math.floor(Math.random() * 3);
      this.lobes = [];
      for (let i = 0; i < n; i++) {
        this.lobes.push({ u: rand(-0.45, 0.45), v: rand(-0.35, 0.35), spread: rand(0.22, 0.4) });
      }
      this.lobes[0].u *= 0.3; this.lobes[0].v *= 0.3; // one lobe near the middle = the hot core
    }

    // A random home point inside the cloud, clustered around the lobes.
    _home() {
      for (let tries = 0; tries < 12; tries++) {
        const L = this.lobes[Math.floor(Math.random() * this.lobes.length)];
        const u = L.u + randn() * L.spread, v = L.v + randn() * L.spread;
        if (u * u + v * v < 0.85) return { u, v };
      }
      return { u: randn() * 0.3, v: randn() * 0.3 };
    }

    _makePuff(container, texture, props) {
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.rotation = rand(0, TAU);
      container.addChild(sprite);
      return Object.assign({
        sprite,
        ox: 0, oy: 0,
        spin: rand(-0.04, 0.04),        // barely-there self-rotation (not an orbit)
        phase: rand(0, TAU),
        breathe: rand(0.3, 0.8),        // breathing speed, rad/s
        seed: rand(0, 50),
      }, props);
    }

    // (Re)creates all puffs for the current density.
    rebuild() {
      for (const list of [this.puffs, this.dusts, this.hazes]) {
        for (const p of list) p.sprite.destroy();
        list.length = 0;
      }
      const tex = getTextures();
      const n = Math.max(4, Math.round(this.neb.options.density));

      for (let i = 0; i < n; i++) {
        const h = this._home();
        const r = Math.sqrt(h.u * h.u + h.v * h.v);
        const role = r < 0.28 ? 'core' : r < 0.6 ? 'body' : 'edge';
        const wispy = role === 'edge' && Math.random() < 0.6;
        this.puffs.push(this._makePuff(this.glow,
          wispy ? tex.wisps[i % 2] : tex.puffs[i % tex.puffs.length], {
            u: h.u, v: h.v, role,
            size: role === 'core' ? rand(0.35, 0.6) : role === 'body' ? rand(0.5, 0.85) : rand(0.6, 1.0),
            baseAlpha: role === 'core' ? rand(0.12, 0.22) : role === 'body' ? rand(0.14, 0.24) : rand(0.12, 0.22),
            tintT: Math.random(),
          }));
      }
      // Sort so the brightest (core) puffs render last — additive order
      // doesn't change the result, but this keeps it tidy when debugging.
      this.puffs.sort((a, b) => (a.role === 'core') - (b.role === 'core'));
      this.puffs.forEach((p) => this.glow.addChild(p.sprite));

      const nd = Math.round(n * 0.3);
      for (let i = 0; i < nd; i++) {
        const h = this._home();
        this.dusts.push(this._makePuff(this.dust, tex.wisps[i % 2], {
          u: h.u * 1.1, v: h.v * 1.1,
          size: rand(0.45, 0.8),
          baseAlpha: rand(0.4, 0.65),
        }));
      }
      const nh = Math.round(n * 0.2);
      for (let i = 0; i < nh; i++) {
        const h = this._home();
        this.hazes.push(this._makePuff(this.haze, tex.puffs[i % tex.puffs.length], {
          u: h.u, v: h.v,
          size: rand(0.5, 0.9),
          baseAlpha: rand(0.05, 0.1),
        }));
      }
    }

    // Brightness boost at a pixel position from all live lightning flashes.
    _flashAt(x, y, flashes) {
      let b = 0;
      for (const f of flashes) {
        const dx = x - f.x, dy = y - f.y;
        const d2 = (dx * dx + dy * dy) / (f.r * f.r);
        if (d2 < 1) b += f.i * (1 - d2) * (1 - d2);
      }
      return Math.min(1, b);
    }

    // Moves one puff through the flow field and places its sprite.
    _step(p, dt, t, W, H, S) {
      const turb = this.neb.options.turbulence;
      const tmp = this._tmp;
      curl((p.u + p.ox) * 1.8 + p.seed * 0.01, (p.v + p.oy) * 1.8, t * 0.22 * turb, tmp);
      p.ox += (tmp.x * 0.07 * turb - p.ox * 0.45) * dt;
      p.oy += (tmp.y * 0.07 * turb - p.oy * 0.45) * dt;
      const s = p.sprite;
      s.position.set((p.u + p.ox) * W * 0.5, (p.v + p.oy) * H * 0.5);
      s.rotation += p.spin * dt * turb;
      const breathe = Math.sin(t * p.breathe + p.phase);
      // Puffs widen a little on wide clouds so the gas fills the shape.
      const aspect = Math.sqrt(W / H);
      const size = p.size * S * (1 + 0.08 * breathe);
      s.width = size * aspect;
      s.height = size / aspect;
      return breathe;
    }

    update(dt, t) {
      const neb = this.neb;
      const W = neb.options.width, H = neb.options.height, S = Math.min(W, H) * 1.1;
      const pal = neb.palette;
      const flashes = neb.lightning.flashes;

      for (const p of this.puffs) {
        const breathe = this._step(p, dt, t, W, H, S);
        const lit = this._flashAt(p.sprite.x, p.sprite.y, flashes);
        let tint;
        if (p.role === 'core') tint = mixColor(pal.accent, pal.hot, p.tintT * 0.45);
        else if (p.role === 'body') tint = mixColor(pal.color, pal.accent, p.tintT * 0.5);
        else tint = mixColor(pal.deep, pal.color, p.tintT * 0.6);
        if (lit > 0.02) tint = mixColor(tint, pal.hot, Math.min(0.5, lit * 0.4));
        p.sprite.tint = tint;
        p.sprite.alpha = clamp01(p.baseAlpha * (0.8 + 0.2 * breathe) * (1 + lit * 0.7));
      }
      for (const p of this.dusts) {
        const breathe = this._step(p, dt, t, W, H, S);
        p.sprite.tint = pal.dust;
        p.sprite.alpha = p.baseAlpha * (0.85 + 0.15 * breathe);
      }
      for (const p of this.hazes) {
        const breathe = this._step(p, dt, t, W, H, S);
        const lit = this._flashAt(p.sprite.x, p.sprite.y, flashes);
        p.sprite.tint = mixColor(pal.color, pal.hot, Math.min(1, lit));
        p.sprite.alpha = clamp01(p.baseAlpha * (0.8 + 0.2 * breathe) * (1 + lit * 1.5));
      }
    }
  }

  // ===========================================================================
  // LAYER 2 — INTERNAL LIGHTNING
  // ===========================================================================
  //
  // Strikes fire at random intervals averaging `lightningFrequency` per
  // second. Each bolt runs between two points inside the cloud, with a jagged
  // shape from 1D midpoint displacement (re-rolled ~30× a second so it
  // crackles) and 0–2 forks. It "re-strikes" (flickers off/on) during its
  // short life, like real cloud lightning. Every live bolt also publishes a
  // flash {x, y, r, i} that the gas layer uses to light itself up, and draws
  // a soft glow sprite at its middle.

  const MAIN_LEVELS = 5, MAIN_PTS = (1 << MAIN_LEVELS) + 1; // 33 points
  const FORK_PTS = 17;

  class NebulaLightningLayer {
    constructor(neb) {
      this.neb = neb;
      this.glow = new PIXI.Container();     // flash glows (under the bolts)
      this.glow.blendMode = 'add';
      this.view = new PIXI.Graphics();      // the bolts
      this.view.blendMode = 'add';
      this.bolts = [];
      this.flashes = [];                    // read by the gas layer each frame
      this._glowPool = [];
      this._timer = this._nextInterval();
    }

    _nextInterval() {
      const f = this.neb.options.lightningFrequency;
      if (f <= 0) return Infinity;
      return Math.max(0.05, -Math.log(1 - Math.random()) / f);
    }

    reschedule() {
      const next = this._nextInterval();
      this._timer = next === Infinity ? Infinity : Math.min(this._timer, next);
    }

    // Fire `count` bolts right now (default 1, sometimes 2).
    strike(count) {
      const n = count || (Math.random() < 0.7 ? 1 : 2);
      for (let i = 0; i < n; i++) this._spawn();
    }

    _spawn() {
      // Start somewhere inside the cloud, head off in a random direction.
      const gas = this.neb.gas;
      const a = gas._home();
      const ang = rand(0, TAU), len = rand(0.3, 0.65);
      let bu = a.u + Math.cos(ang) * len, bv = a.v + Math.sin(ang) * len * 0.8;
      const d = Math.sqrt(bu * bu + bv * bv);
      if (d > 0.62) { bu *= 0.62 / d; bv *= 0.62 / d; } // keep it inside
      const forks = [];
      const nf = Math.random() < 0.35 ? 0 : Math.random() < 0.6 ? 1 : 2;
      for (let i = 0; i < nf; i++) {
        forks.push({ at: Math.floor(rand(0.2, 0.8) * MAIN_PTS), dAng: rand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1),
          len: rand(0.3, 0.55), pts: new Float32Array(FORK_PTS * 2), disp: new Float32Array(FORK_PTS) });
      }
      let glow = this._glowPool.pop();
      if (!glow) {
        glow = new PIXI.Sprite(getTextures().glow);
        glow.anchor.set(0.5);
        this.glow.addChild(glow);
      }
      glow.visible = true;
      this.bolts.push({
        au: a.u, av: a.v, bu, bv,
        life: 0, maxLife: rand(0.12, 0.3),
        jitterTimer: 0,
        pts: new Float32Array(MAIN_PTS * 2),
        disp: new Float32Array(MAIN_PTS),
        forks, glow,
        // A few random "re-strike" dark gaps across its life.
        gapAt: rand(0.25, 0.6), gapLen: rand(0.08, 0.18),
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

    // Straight line from (x0,y0) to (x1,y1), displaced perpendicular.
    _line(pts, disp, n, x0, y0, x1, y1, amp) {
      this._fractal(disp, n, amp);
      const dx = x1 - x0, dy = y1 - y0;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      for (let i = 0; i < n; i++) {
        const s = i / (n - 1);
        pts[i * 2] = x0 + dx * s + nx * disp[i];
        pts[i * 2 + 1] = y0 + dy * s + ny * disp[i];
      }
      return L;
    }

    _jitter(b, W, H) {
      const jag = this.neb.options.lightningJaggedness;
      const x0 = b.au * W * 0.5, y0 = b.av * H * 0.5, x1 = b.bu * W * 0.5, y1 = b.bv * H * 0.5;
      const L = this._line(b.pts, b.disp, MAIN_PTS, x0, y0, x1, y1, Math.hypot(x1 - x0, y1 - y0) * 0.16 * jag);
      b.len = L;
      for (const f of b.forks) {
        const sx = b.pts[f.at * 2], sy = b.pts[f.at * 2 + 1];
        const a = Math.atan2(y1 - y0, x1 - x0) + f.dAng;
        const fl = L * f.len;
        this._line(f.pts, f.disp, FORK_PTS, sx, sy, sx + Math.cos(a) * fl, sy + Math.sin(a) * fl, fl * 0.2 * jag);
      }
    }

    _trace(g, pts, n) {
      g.moveTo(pts[0], pts[1]);
      for (let i = 1; i < n; i++) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
    }

    // Stacked strokes, wide → thin (Pixi v8 starts a new path after each
    // stroke(), so each pass re-traces the points).
    _drawBolt(g, pts, n, alpha, thick) {
      const pal = this.neb.palette;
      const o = this.neb.options;
      const w = Math.max(0.8, Math.min(o.width, o.height) / 260) * thick;
      const passes = [
        [18 * w, pal.color, 0.1],
        [8 * w, pal.accent, 0.28],
        [3.5 * w, pal.hot, 0.7],
        [1.4 * w, pal.white, 1.0],
      ];
      for (const [width, color, a] of passes) {
        this._trace(g, pts, n);
        g.stroke({ width, color, alpha: a * alpha, cap: 'round', join: 'round' });
      }
    }

    update(dt) {
      const o = this.neb.options;
      const W = o.width, H = o.height;
      const pal = this.neb.palette;

      this._timer -= dt;
      if (this._timer <= 0) { this.strike(); this._timer = this._nextInterval(); }

      const g = this.view;
      g.clear();
      this.flashes.length = 0;
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        b.life += dt;
        if (b.life >= b.maxLife) {
          b.glow.visible = false;
          this._glowPool.push(b.glow);
          this.bolts.splice(i, 1);
          continue;
        }
        b.jitterTimer -= dt;
        if (b.jitterTimer <= 0) { this._jitter(b, W, H); b.jitterTimer = 0.033; }

        const lt = b.life / b.maxLife;
        // Bright at first, fading, with one dark "re-strike" gap + random flicker.
        const inGap = lt > b.gapAt && lt < b.gapAt + b.gapLen;
        const alpha = inGap ? 0.12 : (1 - lt * 0.7) * (Math.random() < 0.12 ? 0.5 : 1);

        this._drawBolt(g, b.pts, MAIN_PTS, alpha, 1);
        for (const f of b.forks) this._drawBolt(g, f.pts, FORK_PTS, alpha * 0.75, 0.6);

        // Flash light at the bolt's middle — lights the gas around it.
        const mx = b.pts[(MAIN_PTS >> 1) * 2], my = b.pts[(MAIN_PTS >> 1) * 2 + 1];
        const reach = b.len * 0.7 + Math.min(W, H) * 0.1;
        this.flashes.push({ x: mx, y: my, r: reach, i: alpha });
        b.glow.position.set(mx, my);
        b.glow.width = reach * 2.2;
        b.glow.height = reach * 1.8;
        b.glow.tint = mixColor(pal.accent, pal.hot, 0.5);
        b.glow.alpha = 0.28 * alpha;
      }
    }
  }

  // ===========================================================================
  // LAYER 4 — EMBERS & STARS
  // ===========================================================================
  //
  // Small hot motes carried by the same flow field as the gas, drifting
  // slowly upward (heat rises), twinkling, living 2–5 seconds. About 1 in 8
  // is a larger four-point "star" twinkle for that nebula sparkle.

  class NebulaEmberLayer {
    constructor(neb) {
      this.neb = neb;
      this.view = new PIXI.Container();
      this.view.blendMode = 'add';
      this.embers = [];
      this.pool = [];
      this._carry = 0;
      this._tmp = { x: 0, y: 0 };
      this._prewarmed = false;
    }

    get emitRate() { return this.neb.options.emberCount / 3.5; } // avg life 3.5s

    spawn() {
      const tex = getTextures();
      const star = Math.random() < 0.12;
      let e = this.pool.pop();
      if (!e) {
        const s = new PIXI.Sprite(tex.ember);
        s.anchor.set(0.5);
        this.view.addChild(s);
        e = { sprite: s };
      }
      e.sprite.texture = star ? tex.star : tex.ember;
      e.sprite.visible = true;
      const h = this.neb.gas._home();
      e.u = h.u; e.v = h.v;
      e.star = star;
      e.life = 0;
      e.maxLife = rand(2, 5);
      e.size = star ? rand(0.035, 0.06) : rand(0.008, 0.02); // fraction of cloud size
      e.tw = rand(3, 9); e.ph = rand(0, TAU);                  // twinkle speed/phase
      e.hot = Math.random();
      this.embers.push(e);
      return e;
    }

    _kill(i) {
      const e = this.embers[i];
      e.sprite.visible = false;
      this.pool.push(e);
      this.embers[i] = this.embers[this.embers.length - 1];
      this.embers.pop();
    }

    update(dt, t) {
      const neb = this.neb;
      const o = neb.options;
      const W = o.width, H = o.height, S = Math.min(W, H);
      const pal = neb.palette;
      const tmp = this._tmp;

      if (!this._prewarmed) {
        this._prewarmed = true;
        for (let i = 0; i < o.emberCount; i++) { const e = this.spawn(); e.life = Math.random() * e.maxLife; }
      }
      this._carry += this.emitRate * dt;
      while (this._carry >= 1) { this._carry -= 1; this.spawn(); }

      for (let i = this.embers.length - 1; i >= 0; i--) {
        const e = this.embers[i];
        e.life += dt;
        if (e.life >= e.maxLife || e.u * e.u + e.v * e.v > 1.4) { this._kill(i); continue; }
        curl(e.u * 1.8, e.v * 1.8, t * 0.22 * o.turbulence, tmp);
        e.u += tmp.x * 0.05 * o.turbulence * dt;
        e.v += (tmp.y * 0.05 * o.turbulence - 0.03) * dt; // gentle rise

        const lt = e.life / e.maxLife;
        const fade = clamp01(lt / 0.15) * clamp01((1 - lt) / 0.3);
        const twinkle = 0.55 + 0.45 * Math.sin(t * e.tw + e.ph);
        const s = e.sprite;
        s.position.set(e.u * W * 0.5, e.v * H * 0.5);
        s.width = s.height = Math.max(1.5, e.size * S * (e.star ? 0.7 + 0.5 * twinkle : 1));
        s.tint = e.star ? mixColor(pal.hot, pal.white, 0.6) : mixColor(pal.accent, pal.hot, e.hot);
        s.alpha = fade * (e.star ? twinkle : 0.4 + 0.6 * twinkle);
      }
    }
  }

  // ===========================================================================
  // NebulaCloud — the public object.
  // ===========================================================================

  // Show/hide several display objects as one layer.
  class LayerToggle {
    constructor(objects) { this._objects = objects; this._visible = true; }
    get visible() { return this._visible; }
    set visible(v) { this._visible = v; for (const o of this._objects) o.visible = v; }
  }

  const DEFAULTS = {
    // --- Headline parameters ---
    width: 420,               // Cloud Width, px
    height: 260,              // Cloud Height, px
    density: 40,              // Gas Density — number of gas puffs
    emberCount: 150,          // Ember Count — drifting motes/stars alive at once
    color: 0xff3a1a,          // Hot Color — main body of the cloud
    secondColor: 0xffa21f,    // Second Color — toward the hot core (null = one color)
    lightningFrequency: 1.2,  // Lightning — average strikes per second (0 = off)
    turbulence: 1.0,          // Turbulence — how fast/strongly the gas churns

    // --- Secondary ---
    lightningJaggedness: 1.0,
  };

  class NebulaCloud {
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options || {});
      this.palette = buildPalette(this.options.color, this.options.secondColor);
      this._time = Math.random() * 100;

      this.view = new PIXI.Container();
      this.gas = new NebulaGasLayer(this);
      this.lightning = new NebulaLightningLayer(this);
      this.embers = new NebulaEmberLayer(this);

      // Back → front: glowing gas, strike glow, bolts, dark dust (buries
      // the bolts inside the cloud), faint haze, embers.
      this.view.addChild(
        this.gas.glow,
        this.lightning.glow,
        this.lightning.view,
        this.gas.dust,
        this.gas.haze,
        this.embers.view,
      );

      this.layers = {
        gas: new LayerToggle([this.gas.glow, this.gas.dust, this.gas.haze]),
        lightning: new LayerToggle([this.lightning.glow, this.lightning.view]),
        embers: new LayerToggle([this.embers.view]),
      };
    }

    update(dt) {
      dt = Math.min(dt, 0.1);
      this._time += dt;
      // Lightning first so this frame's flashes light this frame's gas.
      this.lightning.update(dt);
      this.gas.update(dt, this._time);
      this.embers.update(dt, this._time);
    }

    // Force lightning right now.
    strike(count) { this.lightning.strike(count); }

    // Re-roll the cloud's overall shape (new lobes + puffs).
    reshape() { this.gas._makeLobes(); this.gas.rebuild(); }

    // --- Exposed parameters (all live) --------------------------------------

    get width() { return this.options.width; }
    set width(v) { this.options.width = Math.max(20, v); }

    get height() { return this.options.height; }
    set height(v) { this.options.height = Math.max(20, v); }

    get density() { return this.options.density; }
    set density(v) {
      const n = Math.max(4, Math.round(v));
      if (n === this.options.density) return;
      this.options.density = n;
      this.gas.rebuild();
    }

    get emberCount() { return this.options.emberCount; }
    set emberCount(v) { this.options.emberCount = Math.max(0, v); }

    get color() { return this.options.color; }
    set color(v) {
      this.options.color = v;
      this.palette = buildPalette(v, this.options.secondColor);
    }

    get secondColor() { return this.options.secondColor; }
    set secondColor(v) {
      this.options.secondColor = v;
      this.palette = buildPalette(this.options.color, v);
    }

    get lightningFrequency() { return this.options.lightningFrequency; }
    set lightningFrequency(v) {
      this.options.lightningFrequency = Math.max(0, v);
      this.lightning.reschedule();
    }

    get turbulence() { return this.options.turbulence; }
    set turbulence(v) { this.options.turbulence = Math.max(0, v); }

    destroy() { this.view.destroy({ children: true }); }
  }

  NebulaCloud.DEFAULTS = DEFAULTS;
  window.NebulaCloud = NebulaCloud;
})();
