// PlasmaOrb — a self-contained, multi-layered plasma/energy orb effect for
// PixiJS v8. Same "no build step, plain <script> tag" approach as the rest of
// this project: load it after js/vendor/pixi.min.js and it exposes one global,
// `PlasmaOrb`. Nothing in the game uses it yet — see plasma_orb_demo.html for
// a live test page with sliders.
//
// The orb is built from three coordinated layers, each its own small class,
// stacked back-to-front inside one container (`orb.view`):
//
//   1. CLOUD  (OrbCloudLayer)  — soft smoky puffs churning inside the sphere,
//      plus the dark body, bright Fresnel-style rim and outer halo.
//   2. SWIRL  (OrbSwirlLayer)  — small bright sparks spawned at the surface,
//      held in tight orbits by a vortex field + slight inward gravity.
//   3. ARCS   (OrbArcLayer)    — brief jagged electric discharges that snap
//      between two points on/near the surface, re-jittered every few ms.
//
// They "coordinate" through the parent orb: an arc firing briefly flashes the
// rim/halo/cloud and splashes a few extra sparks into the swirl.
//
// Usage:
//   const orb = new PlasmaOrb({ radius: 60, particleCount: 120,
//                               energyColor: 0xff4fb8, secondColor: 0x3aa8ff,
//                               arcFrequency: 1.5 });
//   someContainer.addChild(orb.view);
//   orb.view.position.set(x, y);
//   orb.update(dtSeconds);          // call once per frame
//   orb.radius = 80;                // every exposed parameter is live-tweakable
//   orb.discharge(3);               // force an arc burst (e.g. on an impact)
//   orb.destroy();                  // when done with it
//
// Everything is additive-blended (glows stack like light), except the dark
// body disc, which is normal-blended so the orb reads as a solid volume
// against whatever is behind it.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Small math / color helpers (kept private to this file)
  // ---------------------------------------------------------------------------

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function unpack(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
  function pack(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return (c(r) << 16) | (c(g) << 8) | c(b);
  }
  // Linear blend between two packed 0xRRGGBB colors.
  function mixColor(a, b, t) {
    const A = unpack(a), B = unpack(b);
    return pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }

  // Turns the "Energy Color" (plus an optional "Second Color") into the
  // handful of related tones each layer needs, so one or two parameters
  // recolor the whole orb consistently. With a second color, the halo/glow
  // stays the energy color, the rim takes the second color, and the smoke,
  // sparks and arcs mix both. Without one, `accent` just equals `energy`.
  function buildPalette(energy, second) {
    const accent = second == null ? energy : second;
    return {
      deep:   mixColor(mixColor(energy, accent, 0.5), 0x000000, 0.78), // dark inner body
      murk:   mixColor(energy, 0x000000, 0.45), // dimmer cloud puffs
      murk2:  mixColor(accent, 0x000000, 0.45),
      energy: energy,                           // main glow tone
      accent: accent,                           // second glow tone
      rim:    mixColor(accent, 0xffffff, 0.35), // Fresnel edge
      hot:    mixColor(energy, 0xffffff, 0.75), // spark cores / arc inner glow
      white:  0xffffff,
    };
  }

  // Cheap, smooth, divergence-free 2D "curl noise". The potential ψ is a sum of
  // drifting sine waves; the returned velocity (∂ψ/∂y, −∂ψ/∂x) swirls without
  // ever pushing stuff outward or inward on average — ideal for churning smoke.
  function curl(x, y, t, out) {
    // ψ = sin(1.7x + 0.9t)·cos(1.3y − 0.6t) + 0.5·sin(2.9y + 1.1t + 1.3x)
    const a = 1.7 * x + 0.9 * t, b = 1.3 * y - 0.6 * t;
    const c = 2.9 * y + 1.1 * t + 1.3 * x;
    const dPsiDx = 1.7 * Math.cos(a) * Math.cos(b) + 0.5 * 1.3 * Math.cos(c);
    const dPsiDy = -1.3 * Math.sin(a) * Math.sin(b) + 0.5 * 2.9 * Math.cos(c);
    out.x = dPsiDy;
    out.y = -dPsiDx;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Procedural textures — drawn once on offscreen canvases (white/grayscale,
  // so any color can be applied later with `.tint`, which is free on the GPU)
  // and shared by every orb instance.
  // ---------------------------------------------------------------------------

  let sharedTextures = null;

  function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  // Radial gradient from a list of [stop, alpha] pairs, white.
  function radialTexture(size, stops) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    for (const [s, a] of stops) g.addColorStop(s, `rgba(255,255,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return PIXI.Texture.from(c);
  }

  // A soft, lumpy smoke puff: layered value noise faded out toward the edge.
  function cloudTexture(size, seed) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    // Tiny seeded hash → value noise, so each puff variant looks different.
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
        const d = Math.sqrt(dx * dx + dy * dy);
        const falloff = clamp01(1 - d);
        // 3 octaves of noise.
        const n = noise(px / 22, py / 22) * 0.55 + noise(px / 11, py / 11) * 0.3 + noise(px / 5.5, py / 5.5) * 0.15;
        const a = clamp01(falloff * falloff * Math.pow(n, 2.2) * 2.4);
        const i = (py * size + px) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  function getTextures() {
    if (sharedTextures) return sharedTextures;
    sharedTextures = {
      // Solid disc with a soft edge — the dark body of the orb.
      body: radialTexture(256, [[0, 1], [0.86, 1], [0.97, 0.6], [1, 0]]),
      // Transparent middle that brightens toward the edge — fakes the
      // Fresnel effect (a sphere looks brightest where you see it edge-on).
      rim: radialTexture(256, [[0, 0], [0.6, 0], [0.78, 0.08], [0.9, 0.42], [0.965, 1], [1, 0]]),
      // Wide, soft falloff for the glow that spills outside the orb.
      halo: radialTexture(256, [[0, 0.9], [0.3, 0.5], [0.55, 0.18], [0.8, 0.05], [1, 0]]),
      // Bright pinpoint with a small soft glow — sparks / motes.
      spark: radialTexture(64, [[0, 1], [0.14, 1], [0.3, 0.5], [0.55, 0.12], [1, 0]]),
      // A few smoke-puff variants for visual variety.
      clouds: [cloudTexture(128, 1), cloudTexture(128, 2), cloudTexture(128, 3)],
    };
    return sharedTextures;
  }

  // ===========================================================================
  // LAYER 1 — CORE & CLOUD (volumetric body)
  // ===========================================================================
  //
  // Draw order inside this layer (back → front):
  //   halo  (additive, big soft glow outside the sphere)
  //   body  (normal blend, the dark "deep" base tone)
  //   puffs (additive, low opacity, masked to the sphere so smoke never leaks)
  //   rim   (additive, bright Fresnel edge)
  //
  // Each puff orbits the center on its own tilted circle (slow rotational
  // drift, projected from 3D so front puffs look brighter than back ones) and
  // is additionally pushed around by curl noise, with a spring pulling it
  // back so the churn never carries it away.

  class OrbCloudLayer {
    constructor(orb) {
      this.orb = orb;
      const tex = getTextures();

      // halo and body sit behind everything; `front` (puffs + rim) sits above
      // the swirl layer's "behind the orb" sparks — see PlasmaOrb constructor.
      this.front = new PIXI.Container();

      this.halo = new PIXI.Sprite(tex.halo);
      this.halo.anchor.set(0.5);
      this.halo.blendMode = 'add';

      this.body = new PIXI.Sprite(tex.body);
      this.body.anchor.set(0.5);

      this.puffContainer = new PIXI.Container();
      this.puffContainer.blendMode = 'add';
      this.mask = new PIXI.Graphics();
      this.puffContainer.addChild(this.mask);
      this.puffContainer.mask = this.mask;
      this._maskRadius = -1;

      this.rim = new PIXI.Sprite(tex.rim);
      this.rim.anchor.set(0.5);
      this.rim.blendMode = 'add';

      this.front.addChild(this.puffContainer, this.rim);

      this.puffs = [];
      this._tmp = { x: 0, y: 0 };
      this.setPuffCount(orb.options.cloudPuffs);
    }

    setPuffCount(n) {
      const tex = getTextures();
      while (this.puffs.length < n) {
        const sprite = new PIXI.Sprite(tex.clouds[this.puffs.length % tex.clouds.length]);
        sprite.anchor.set(0.5);
        this.puffContainer.addChild(sprite);
        // Random orbital plane: inclination + node angle.
        const inc = rand(0, Math.PI), node = rand(0, TAU);
        this.puffs.push({
          sprite,
          orbitR: rand(0.05, 0.55),          // fraction of orb radius
          phase: rand(0, TAU),
          speed: rand(0.25, 0.7) * (Math.random() < 0.8 ? 1 : -1), // rad/s, mostly one way
          cosI: Math.cos(inc), sinI: Math.sin(inc),
          cosN: Math.cos(node), sinN: Math.sin(node),
          size: rand(0.75, 1.25),            // fraction of orb diameter
          spin: rand(-0.35, 0.35),           // sprite self-rotation, rad/s
          baseAlpha: rand(0.1, 0.2),
          tintMix: Math.random(),            // where it sits between murk and energy
          alt: Math.random() < 0.5,          // uses the second color instead
          ox: 0, oy: 0,                      // curl-noise offset (px)
          seed: rand(0, 100),
        });
      }
      while (this.puffs.length > n) this.puffContainer.removeChild(this.puffs.pop().sprite);
    }

    update(dt, t) {
      const orb = this.orb;
      const R = orb.options.radius;
      const pal = orb.palette;
      const flash = orb.flash;              // 0..1, set by arc discharges
      const breathe = 0.5 + 0.5 * Math.sin(t * 1.7);

      // Halo breathes slightly and flares when an arc fires.
      this.halo.width = this.halo.height = R * (2.9 + 0.15 * breathe + 0.5 * flash);
      this.halo.tint = pal.energy;
      this.halo.alpha = 0.38 + 0.1 * breathe + 0.35 * flash;

      this.body.width = this.body.height = R * 2;
      this.body.tint = pal.deep;
      this.body.alpha = 0.92;

      this.rim.width = this.rim.height = R * 2.04;
      this.rim.tint = flash > 0.05 ? mixColor(pal.rim, pal.white, flash * 0.6) : pal.rim;
      this.rim.alpha = 0.75 + 0.15 * breathe + 0.25 * flash;

      if (this._maskRadius !== R) {
        this._maskRadius = R;
        this.mask.clear().circle(0, 0, R * 0.97).fill(0xffffff);
      }

      const tmp = this._tmp;
      const churn = orb.options.cloudChurn;
      for (const p of this.puffs) {
        // --- Rotational drift: point on a tilted circle, projected to 2D.
        p.phase += p.speed * dt;
        const cx = Math.cos(p.phase) * p.orbitR, cy = Math.sin(p.phase) * p.orbitR;
        // Tilt by inclination (around X), then rotate by node (around Z).
        const y1 = cy * p.cosI, z1 = cy * p.sinI;
        const x2 = cx * p.cosN - y1 * p.sinN;
        const y2 = cx * p.sinN + y1 * p.cosN;
        const depth = 0.5 + 0.5 * z1 / Math.max(0.001, p.orbitR); // 0 = back, 1 = front

        // --- Curl-noise churn, springing back toward the orbit point.
        curl((x2 * R + p.ox) / R * 2.2 + p.seed, (y2 * R + p.oy) / R * 2.2, t * 0.6, tmp);
        p.ox += (tmp.x * R * 0.35 * churn - p.ox * 1.2) * dt;
        p.oy += (tmp.y * R * 0.35 * churn - p.oy * 1.2) * dt;

        const s = p.sprite;
        s.position.set(x2 * R + p.ox, y2 * R + p.oy);
        s.rotation += p.spin * dt;
        s.width = s.height = R * 2 * p.size * (0.85 + 0.25 * depth);
        s.tint = p.alt ? mixColor(pal.murk2, pal.accent, p.tintMix) : mixColor(pal.murk, pal.energy, p.tintMix);
        s.alpha = p.baseAlpha * (0.55 + 0.45 * depth) * (1 + 0.8 * flash);
      }
    }
  }

  // ===========================================================================
  // LAYER 2 — ORBITING PARTICLES (swirl field)
  // ===========================================================================
  //
  // Sparks live in 3D around the orb's center and are projected to the screen
  // (x, y), using z for depth. Every frame each spark is steered toward a
  // vortex velocity (tangent to the sphere around its own orbit axis) and
  // pulled toward a target shell radius that slowly shrinks over its life —
  // so sparks swirl tightly around the core and spiral in as they fade,
  // instead of flying off in straight lines.
  //
  // Sparks behind the orb (z < 0) are drawn in `back` (under the dark body,
  // so the orb hides them); sparks in front are drawn in `front`.

  class OrbSwirlLayer {
    constructor(orb) {
      this.orb = orb;
      this.back = new PIXI.Container();
      this.front = new PIXI.Container();
      this.back.blendMode = 'add';
      this.front.blendMode = 'add';
      this.sparks = [];   // live sparks
      this.pool = [];     // dead sparks kept for reuse (no garbage per frame)
      this._emitCarry = 0;
      // The swirl's dominant axis. It wobbles slowly over time so the whole
      // field feels alive; each spark's own axis is jittered around it.
      this.axis = { x: 0.25, y: 1, z: 0.35 };
      this._prewarmed = false;
    }

    // Number of sparks spawned per second to hold roughly `particleCount`
    // alive at once, given the average 1.5s lifetime.
    get emitRate() { return this.orb.options.particleCount / 1.5; }

    _obtain() {
      let p = this.pool.pop();
      if (!p) {
        const s = new PIXI.Sprite(getTextures().spark);
        s.anchor.set(0.5);
        p = { sprite: s, inFront: true };
        this.front.addChild(s);
      } else {
        p.sprite.visible = true;
      }
      return p;
    }

    // Spawn one spark. `at` (optional, 3D point) forces the spawn location —
    // used by the arc layer to splash sparks from a discharge's endpoints.
    spawn(at) {
      const R = this.orb.options.radius;
      const p = this._obtain();

      // Random direction on the unit sphere.
      let dx, dy, dz, dist;
      if (at) {
        dx = at.x; dy = at.y; dz = at.z;
        dist = Math.hypot(dx, dy, dz) || 1;
        dx /= dist; dy /= dist; dz /= dist;
      } else {
        dz = rand(-1, 1);
        const a = rand(0, TAU), r = Math.sqrt(1 - dz * dz);
        dx = Math.cos(a) * r; dy = Math.sin(a) * r;
        dist = R * rand(1.0, 1.2); // surface or immediate perimeter
      }
      p.x = dx * dist; p.y = dy * dist; p.z = dz * dist;

      // This spark's orbit axis: the field axis plus some jitter.
      const A = this.axis;
      let ax = A.x + rand(-0.22, 0.22), ay = A.y + rand(-0.22, 0.22), az = A.z + rand(-0.22, 0.22);
      const al = Math.hypot(ax, ay, az) || 1;
      p.ax = ax / al; p.ay = ay / al; p.az = az / al;

      // Start already moving along the tangent so it joins the swirl smoothly.
      const tx = p.ay * dz - p.az * dy, ty = p.az * dx - p.ax * dz, tz = p.ax * dy - p.ay * dx;
      const sp = this.orb.options.swirlSpeed * R;
      p.vx = tx * sp + rand(-0.2, 0.2) * R;
      p.vy = ty * sp + rand(-0.2, 0.2) * R;
      p.vz = tz * sp + rand(-0.2, 0.2) * R;

      p.maxLife = rand(1.0, 2.0);   // 1.0–2.0s, per spec
      p.life = 0;
      p.size = rand(0.04, 0.075);  // fraction of orb radius
      p.shell = rand(1.04, 1.16);   // preferred orbit radius at birth (× R)
      p.hot = Math.random();        // how close to white its color sits
      p.alt = Math.random() < 0.5;  // uses the second color instead
      this.sparks.push(p);
      return p;
    }

    _kill(i) {
      const p = this.sparks[i];
      p.sprite.visible = false;
      this.pool.push(p);
      // Swap-remove: O(1), order doesn't matter for additive blending.
      this.sparks[i] = this.sparks[this.sparks.length - 1];
      this.sparks.pop();
    }

    update(dt, t) {
      const orb = this.orb;
      const opt = orb.options;
      const R = opt.radius;
      const pal = orb.palette;

      // First frame: fill the orb up immediately instead of fading in empty.
      if (!this._prewarmed) {
        this._prewarmed = true;
        const n = Math.round(opt.particleCount);
        for (let i = 0; i < n; i++) {
          const p = this.spawn();
          p.life = Math.random() * p.maxLife;
        }
      }

      // Slow wobble of the dominant swirl axis.
      this.axis.x = 0.3 * Math.sin(t * 0.37);
      this.axis.z = 0.35 * Math.cos(t * 0.29);

      // Continuous emission (fractional carry keeps the rate exact at any fps).
      this._emitCarry += this.emitRate * dt;
      while (this._emitCarry >= 1) { this._emitCarry -= 1; this.spawn(); }

      const steer = 5.0;                     // how hard sparks snap to the vortex
      const gravity = opt.inwardGravity * R; // constant inward pull (px/s²)
      const spring = 9.0;                    // pull toward the shell radius

      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const p = this.sparks[i];
        p.life += dt;
        if (p.life >= p.maxLife) { this._kill(i); continue; }
        const lt = p.life / p.maxLife;       // 0 → 1 over its life

        const dist = Math.hypot(p.x, p.y, p.z) || 0.001;
        const rx = p.x / dist, ry = p.y / dist, rz = p.z / dist;

        // Vortex field: desired velocity is tangent to the sphere around the
        // spark's orbit axis, a bit faster closer in (like a real vortex).
        let tx = p.ay * rz - p.az * ry, ty = p.az * rx - p.ax * rz, tz = p.ax * ry - p.ay * rx;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 0.0001) { tx /= tl; ty /= tl; tz /= tl; }
        const vortex = opt.swirlSpeed * R * Math.sqrt(R / dist);
        p.vx += (tx * vortex - p.vx) * steer * dt;
        p.vy += (ty * vortex - p.vy) * steer * dt;
        p.vz += (tz * vortex - p.vz) * steer * dt;

        // Inward gravity + spring toward a shell that tightens over life
        // (sparks spiral in toward the surface as they die).
        const shell = R * (p.shell - 0.14 * lt);
        const radialAcc = -gravity - spring * (dist - shell);
        p.vx += rx * radialAcc * dt;
        p.vy += ry * radialAcc * dt;
        p.vz += rz * radialAcc * dt;

        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

        // --- Render: move between back/front containers as it crosses z=0.
        const front = p.z >= 0;
        if (front !== p.inFront) {
          p.inFront = front;
          (front ? this.front : this.back).addChild(p.sprite);
        }

        const depth = clamp01(0.5 + 0.5 * p.z / (R * 1.2)); // 0 back … 1 front
        const fadeIn = clamp01(lt / 0.08);
        const fadeOut = Math.pow(1 - lt, 1.4);
        const sizeDecay = Math.pow(1 - lt, 0.6);
        const size = R * p.size * sizeDecay * (0.7 + 0.5 * depth) * 2;

        const s = p.sprite;
        s.position.set(p.x, p.y);
        // Stretch along screen-space motion for a tiny motion-blur streak.
        const speed2d = Math.hypot(p.vx, p.vy);
        s.rotation = Math.atan2(p.vy, p.vx);
        s.width = size * (1 + Math.min(3.5, speed2d / (R * 1.1)));
        s.height = size;
        s.tint = mixColor(p.alt ? pal.accent : pal.energy, pal.white, 0.35 + 0.6 * p.hot);
        s.alpha = fadeIn * fadeOut * (0.35 + 0.65 * depth);
      }
    }
  }

  // ===========================================================================
  // LAYER 3 — ELECTRIC DISCHARGES (arc layer)
  // ===========================================================================
  //
  // Bursts fire at random intervals averaging `arcFrequency` per second. Each
  // arc runs between two points on/near the surface, following the sphere's
  // curve (sometimes leaping outward, sometimes cutting across the face). Its
  // jagged shape comes from 1D midpoint displacement ("fractal" lightning)
  // applied perpendicular to that curve, regenerated ~50× a second so it
  // crackles. Each arc is drawn as stacked strokes — wide colored glow down
  // to a thin white-hot core — all additive. Lifetime is only 0.05–0.15s.

  const ARC_LEVELS = 5;                      // 2^5 + 1 = 33 points per arc
  const ARC_POINTS = (1 << ARC_LEVELS) + 1;

  class OrbArcLayer {
    constructor(orb) {
      this.orb = orb;
      this.view = new PIXI.Graphics();
      this.view.blendMode = 'add';
      this.bolts = [];
      this._timer = this._nextInterval();
      this._disp = new Float32Array(ARC_POINTS);
    }

    // Exponential (Poisson) spacing so snaps feel random, not metronomic.
    _nextInterval() {
      const f = this.orb.options.arcFrequency;
      if (f <= 0) return Infinity;
      return Math.max(0.03, -Math.log(1 - Math.random()) / f);
    }

    // Fire a burst of `count` arcs right now (default: 1–3).
    burst(count) {
      const n = count || (Math.random() < 0.55 ? 1 : Math.random() < 0.7 ? 2 : 3);
      for (let i = 0; i < n; i++) this._spawnArc();
      this.orb.flash = Math.min(1, this.orb.flash + 0.55);
    }

    _spawnArc() {
      const R = this.orb.options.radius;
      const outward = Math.random() < 0.7;   // leap off the surface vs cut across the face
      const arc = {
        a0: rand(0, TAU),
        sweep: rand(0.35, 1.3) * (Math.random() < 0.5 ? -1 : 1),
        r0: R * rand(0.88, 1.04),
        r1: R * rand(0.88, 1.04),
        bulge: outward ? R * rand(0.08, 0.32) : -R * rand(0.25, 0.55),
        life: 0,
        maxLife: rand(0.05, 0.15),
        jitterTimer: 0,
        pts: new Float32Array(ARC_POINTS * 2),
        branch: Math.random() < 0.4 ? { at: Math.floor(rand(0.25, 0.75) * ARC_POINTS), pts: new Float32Array(17 * 2), disp: new Float32Array(17), dir: rand(-0.6, 0.6) } : null,
      };
      this._jitter(arc);
      this.bolts.push(arc);

      // Coordinate with the swirl: splash a few sparks from each endpoint.
      const swirl = this.orb.swirl;
      for (const end of [0, ARC_POINTS - 1]) {
        const x = arc.pts[end * 2], y = arc.pts[end * 2 + 1];
        const zz = Math.sqrt(Math.max(0, R * R * 1.1 - x * x - y * y));
        for (let k = 0; k < 3; k++) swirl.spawn({ x, y, z: zz });
      }
    }

    // 1D midpoint displacement: each subdivision level adds a random offset at
    // the midpoints, halving the amplitude every level → natural-looking jag.
    _fractal(out, n, amp) {
      out[0] = 0; out[n - 1] = 0;
      let step = n - 1, a = amp;
      while (step > 1) {
        const half = step >> 1;
        for (let i = half; i < n - 1; i += step) {
          out[i] = (out[i - half] + out[i + half]) * 0.5 + rand(-a, a);
        }
        step = half;
        a *= 0.55;
      }
    }

    // Rebuilds an arc's point list: base curve along the sphere + fresh jag.
    _jitter(arc) {
      const R = this.orb.options.radius;
      const disp = this._disp;
      this._fractal(disp, ARC_POINTS, R * 0.16 * this.orb.options.arcJaggedness);
      for (let i = 0; i < ARC_POINTS; i++) {
        const s = i / (ARC_POINTS - 1);
        const ang = arc.a0 + arc.sweep * s;
        const rad = arc.r0 + (arc.r1 - arc.r0) * s + arc.bulge * Math.sin(Math.PI * s);
        // Displace along the radial direction (perpendicular to the curve).
        const r = rad + disp[i];
        arc.pts[i * 2] = Math.cos(ang) * r;
        arc.pts[i * 2 + 1] = Math.sin(ang) * r;
      }
      if (arc.branch) {
        const b = arc.branch, bp = b.pts;
        const sx = arc.pts[b.at * 2], sy = arc.pts[b.at * 2 + 1];
        // Fork heads mostly outward from where it splits off.
        const baseAng = Math.atan2(sy, sx) + b.dir;
        const len = R * 0.35;
        const bd = b.disp;
        this._fractal(bd, 17, R * 0.07 * this.orb.options.arcJaggedness);
        const nx = -Math.sin(baseAng), ny = Math.cos(baseAng);
        for (let i = 0; i < 17; i++) {
          const s = i / 16;
          bp[i * 2] = sx + Math.cos(baseAng) * len * s + nx * bd[i];
          bp[i * 2 + 1] = sy + Math.sin(baseAng) * len * s + ny * bd[i];
        }
      }
    }

    _trace(g, pts, count) {
      g.moveTo(pts[0], pts[1]);
      for (let i = 1; i < count; i++) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
    }

    // Stacked strokes, wide → thin: soft glow, colored outline, bright tone,
    // white-hot core.
    // (Pixi v8 starts a fresh path after every stroke(), so each pass
    // re-traces the points.)
    _drawBolt(g, pts, count, alpha, thick) {
      const pal = this.orb.palette;
      const w = Math.max(1, this.orb.options.radius / 60) * thick;
      const passes = [
        [16 * w, pal.energy, 0.12],
        [8 * w, pal.accent, 0.3],
        [3.5 * w, pal.hot, 0.65],
        [1.5 * w, pal.white, 1.0],
      ];
      for (const [width, color, a] of passes) {
        this._trace(g, pts, count);
        g.stroke({ width, color, alpha: a * alpha, cap: 'round', join: 'round' });
      }
    }

    update(dt) {
      // Scheduling.
      this._timer -= dt;
      if (this._timer <= 0) {
        this.burst();
        this._timer = this._nextInterval();
      }

      const g = this.view;
      g.clear();
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const arc = this.bolts[i];
        arc.life += dt;
        if (arc.life >= arc.maxLife) { this.bolts.splice(i, 1); continue; }

        // High-frequency jitter: fresh fractal shape ~50× per second.
        arc.jitterTimer -= dt;
        if (arc.jitterTimer <= 0) { this._jitter(arc); arc.jitterTimer = 0.02; }

        // Hard flicker instead of a smooth fade — electricity strobes.
        const lt = arc.life / arc.maxLife;
        const alpha = (1 - lt * 0.6) * (Math.random() < 0.15 ? 0.45 : 1);
        this._drawBolt(g, arc.pts, ARC_POINTS, alpha, 1);
        if (arc.branch) this._drawBolt(g, arc.branch.pts, 17, alpha * 0.8, 0.6);
      }
    }

    // Called when arcFrequency changes so a big drop/rise takes effect now.
    reschedule() {
      const next = this._nextInterval();
      this._timer = next === Infinity ? Infinity : Math.min(this._timer, next);
    }
  }

  // ===========================================================================
  // PlasmaOrb — the public object. Owns the three layers and their shared
  // state (palette, flash, clock), and exposes the tweakable parameters.
  // ===========================================================================

  // Tiny helper so a layer made of several display objects can be shown/hidden
  // as one: orb.layers.swirl.visible = false.
  class LayerToggle {
    constructor(objects) { this._objects = objects; this._visible = true; }
    get visible() { return this._visible; }
    set visible(v) {
      this._visible = v;
      for (const o of this._objects) o.visible = v;
    }
  }

  const DEFAULTS = {
    // --- The four headline parameters ---
    radius: 60,             // Orb Radius, in pixels
    particleCount: 120,     // Particle Count — orbiting sparks alive at once
    energyColor: 0x8a5cff,  // Energy Color — everything else is derived from it
    secondColor: null,      // optional Second Color blended in (null = single color)
    arcFrequency: 1.5,      // Arc Frequency — average discharge bursts per second (0 = off)

    // --- Secondary look controls ---
    cloudPuffs: 14,         // smoke puffs inside the sphere
    cloudChurn: 1.0,        // strength of the curl-noise churn
    swirlSpeed: 2.6,        // orbit speed, in orb-radii per second
    inwardGravity: 1.2,     // extra inward pull, in orb-radii per second²
    arcJaggedness: 1.0,     // multiplier on arc displacement
  };

  class PlasmaOrb {
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options || {});
      this.palette = buildPalette(this.options.energyColor, this.options.secondColor);
      this.flash = 0;   // 0..1 — spikes when arcs fire, decays quickly
      this._time = Math.random() * 100;

      this.view = new PIXI.Container();

      this.cloud = new OrbCloudLayer(this);
      this.swirl = new OrbSwirlLayer(this);
      this.arcs = new OrbArcLayer(this);

      // Final stacking order, back → front:
      //   halo, back-sparks, body | cloud puffs, rim | front-sparks | arcs
      this.view.addChild(
        this.cloud.halo,
        this.swirl.back,
        this.cloud.body,
        this.cloud.front,
        this.swirl.front,
        this.arcs.view,
      );

      // Handy for toggling a layer on/off: orb.layers.arcs.visible = false
      this.layers = {
        cloud: new LayerToggle([this.cloud.halo, this.cloud.body, this.cloud.front]),
        swirl: new LayerToggle([this.swirl.back, this.swirl.front]),
        arcs: new LayerToggle([this.arcs.view]),
      };
    }

    // Advance the whole effect by `dt` seconds. Call once per frame.
    update(dt) {
      dt = Math.min(dt, 0.1); // don't explode after a tab-switch pause
      this._time += dt;
      this.flash = Math.max(0, this.flash - dt * 6);
      this.cloud.update(dt, this._time);
      this.swirl.update(dt, this._time);
      this.arcs.update(dt);
    }

    // Force a discharge burst right now — hook this to gameplay moments.
    discharge(count) { this.arcs.burst(count); }

    // --- Exposed parameters (all take effect immediately) -------------------

    get radius() { return this.options.radius; }
    set radius(v) {
      v = Math.max(4, v);
      // Scale everything already in flight so a resize is instant, instead of
      // leaving sparks stranded at the old size until they spiral back in.
      const k = v / this.options.radius;
      this.options.radius = v;
      for (const p of this.swirl.sparks) {
        p.x *= k; p.y *= k; p.z *= k;
        p.vx *= k; p.vy *= k; p.vz *= k;
      }
      for (const p of this.cloud.puffs) { p.ox *= k; p.oy *= k; }
    }

    get particleCount() { return this.options.particleCount; }
    set particleCount(v) { this.options.particleCount = Math.max(0, v); }

    get energyColor() { return this.options.energyColor; }
    set energyColor(v) {
      this.options.energyColor = v;
      this.palette = buildPalette(v, this.options.secondColor);
    }

    get secondColor() { return this.options.secondColor; }
    set secondColor(v) {
      this.options.secondColor = v;
      this.palette = buildPalette(this.options.energyColor, v);
    }

    get arcFrequency() { return this.options.arcFrequency; }
    set arcFrequency(v) {
      this.options.arcFrequency = Math.max(0, v);
      this.arcs.reschedule();
    }

    get cloudPuffs() { return this.options.cloudPuffs; }
    set cloudPuffs(v) {
      this.options.cloudPuffs = Math.max(0, Math.round(v));
      this.cloud.setPuffCount(this.options.cloudPuffs);
    }

    destroy() {
      this.view.destroy({ children: true });
    }
  }

  PlasmaOrb.DEFAULTS = DEFAULTS;
  window.PlasmaOrb = PlasmaOrb;
})();
