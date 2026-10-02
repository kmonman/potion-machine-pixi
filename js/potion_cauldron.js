// PotionCauldron — the boiling pink potion for Rob's cauldron art
// (assets/GoalLineCauldron.webp), for PixiJS v8. Same plain <script> tag
// approach as the other effects: load it after js/vendor/pixi.min.js and it
// exposes one global, `PotionCauldron`. Nothing in the game uses it yet —
// see potion_cauldron_demo.html.
//
// The view's origin (0, 0) is the CENTER of the potion surface. The surface
// is an ellipse `surfaceWidth` × `surfaceHeight` (seen slightly from above);
// match those to the art and everything on the surface stays inside the rim.
//
// Two phases:
//
//   REST — a slow, subtle boil: the surface glows and pulses, soft
//   highlights swirl across it like stirred liquid, solid lumps of thick
//   potion heave up in little clusters and slump back down (leaving a faint
//   ripple, sometimes a droplet), faint vapour drifts up.
//
//   FINALE — `brewOver()`: not an explosion, a boil-over. The boil builds
//   into a frenzy, there's a flash, a burst of steam billows up swirling
//   around, and a big pink potion VORTEX spirals out — glowing ribbons
//   twisting around each other, rotating as they rise, droplets flung
//   around the spiral and a shower of sparks — then the whole swirl
//   lifts off and flies upward, widening and fading, and the cauldron
//   settles back to its resting boil.
//
// Layers, back → front: column glow, steam (behind), vortex ribbons
// (optional real blur on a fixed area — ribbons are never rebuilt, only
// their points move, so it stays smooth), surface (glow + swirl + bubbles,
// masked to the potion ellipse), vortex droplets, sparks, vapour and
// front steam, flash.
//
// Usage:
//   const pot = new PotionCauldron({ surfaceWidth: 300, surfaceHeight: 44 });
//   someContainer.addChild(pot.view);
//   pot.view.position.set(potionCenterX, potionCenterY);
//   pot.update(dtSeconds);       // once per frame
//   pot.brewOver();              // play the finale
//   pot.rest();                  // cut back to the resting boil

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
  function unpack(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
  function pack(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return (c(r) << 16) | (c(g) << 8) | c(b);
  }
  function mixColor(a, b, t) {
    const A = unpack(a), B = unpack(b);
    return pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }

  // Smooth swirl field (same family as the other effects).
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
  // Procedural textures (white, tinted later), built once and shared.
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

  // A boiling bubble seen just breaking the surface: only a SHALLOW CAP of
  // it shows — a slice off the top of a sphere, well under half of it — with
  // a soft rim of liquid curving up to meet its edge (surface tension), so it
  // reads as mostly still under the potion rather than sitting on top.
  //
  // Geometry (texture units): the waterline is the bottom edge, y = 0, and
  // the cap spans x = -1..1 there. Its sphere's center sits CAP_C below the
  // waterline, so only the top CAP_H of it shows (CAP_H / width ≈ 0.3 —
  // a half-sphere would be 0.5). The meniscus flares out to x = ±SKIRT.
  const CAP_C = 0.533, CAP_R = Math.sqrt(1 + CAP_C * CAP_C), CAP_H = CAP_R - CAP_C; // ≈ 0.6
  const SKIRT = 1.3;
  const CAP_ASPECT = (CAP_H + 0.04) / (2 * SKIRT);   // texture height : width

  function capTexture(w, sheen) {
    const h = Math.round(w * CAP_ASPECT);
    const c = makeCanvas(w, h), ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const x = ((px + 0.5) / w * 2 - 1) * SKIRT;           // -SKIRT..SKIRT
        const y = (1 - (py + 0.5) / h) * (CAP_H + 0.04);      // 0 at the waterline
        const inCap = x * x + (y + CAP_C) * (y + CAP_C);
        const capEdge = Math.min(1, Math.max(0, (CAP_R * CAP_R - inCap) / 0.12));
        // Meniscus: liquid drawn up around the edge, a low concave flare.
        const ax = Math.abs(x);
        const skirtH = ax <= 1 ? 0.14 : 0.14 * Math.pow(Math.max(0, 1 - (ax - 1) / (SKIRT - 1)), 2);
        const skirt = y < skirtH ? Math.min(1, (skirtH - y) / 0.05) * (ax <= 1 ? 1 : 0.85) : 0;
        const up = y / CAP_H;                                  // 0 waterline → 1 crown
        let a, v;
        if (sheen) {
          // Glow across the crown + a hot highlight, cap only.
          const crown = Math.pow(Math.max(0, up), 1.4) * capEdge * 0.6;
          const spot = Math.exp(-(((x + 0.32) ** 2) + ((up - 0.68) ** 2) * 2.5) / 0.03) * capEdge;
          a = Math.min(1, crown + spot); v = 1;
        } else {
          a = Math.max(capEdge, skirt);
          a *= Math.min(1, y / 0.03 + 0.35);                   // melt into the surface at the waterline
          v = 0.72 + 0.28 * Math.pow(Math.max(0, up), 0.8);    // a touch brighter toward the crown
        }
        if (a <= 0) continue;
        const i = (py * w + px) * 4;
        const g = Math.round(Math.min(1, v) * 255);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
        img.data[i + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  // Liquid swirl: soft, curving bands of light like the sheen on a stirred
  // liquid — spiral arms bent by noise so they never look mechanical, kept
  // as gentle bright ribbons with dark gaps, faded out toward the rim.
  // `arms` and `twist` vary the pattern; two different ones turning against
  // each other give constantly-changing, never-repeating flowing light.
  function swirlTexture(size, arms, twist, seed) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const hash = (x, y) => {
      const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
      return v - Math.floor(v);
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
        const x = (px + 0.5 - half) / half, y = (py + 0.5 - half) / half;
        const r = Math.sqrt(x * x + y * y);
        if (r >= 1) continue;
        const th = Math.atan2(y, x);
        const n = noise(px / 18, py / 18) * 0.65 + noise(px / 9, py / 9) * 0.35;
        const wave = 0.5 + 0.5 * Math.sin(arms * th + twist * r + n * 4.2);
        const band = Math.pow(wave, 3.2);                       // narrow-ish soft bright ribbons
        const fade = Math.min(1, r / 0.12) * Math.pow(1 - r, 0.8); // calm center + soft rim
        const i = (py * size + px) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(Math.min(1, band * fade * (0.6 + 0.6 * n)) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  // A pop: just a thin ring.
  function ringTexture(size) {
    const c = makeCanvas(size), ctx = c.getContext('2d');
    const r = size / 2;
    const g = ctx.createRadialGradient(r, r, r * 0.7, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return PIXI.Texture.from(c);
  }

  // Soft lumpy puff for steam/vapour.
  function puffTexture(size, seed) {
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
        const n = noise(px / 14, py / 14) * 0.6 + noise(px / 7, py / 7) * 0.4;
        const a = clamp01(falloff * falloff * (0.4 + n * 1.2));
        const i = (py * size + px) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  // Vortex ribbon: bell-shaped across, faded at both ends along.
  function ribbonTexture(sharp) {
    const w = 256, h = 32;
    const c = makeCanvas(w, h), ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const d = (y + 0.5 - h / 2) / (h / 2);
      const across = Math.exp(-d * d * sharp);
      for (let x = 0; x < w; x++) {
        const s = x / (w - 1);
        const along = Math.min(1, s / 0.12) * Math.min(1, (1 - s) / 0.3);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(across * along * along * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return PIXI.Texture.from(c);
  }

  function getTextures() {
    if (sharedTextures) return sharedTextures;
    sharedTextures = {
      glow: radialTexture(128, [[0, 1], [0.25, 0.55], [0.55, 0.15], [1, 0]]),
      swirlA: swirlTexture(192, 3, 7.5, 71),
      swirlB: swirlTexture(192, 2, -6, 72),
      spark: radialTexture(32, [[0, 1], [0.18, 0.95], [0.45, 0.3], [1, 0]]),
      lump: capTexture(96, false),
      sheen: capTexture(96, true),
      ring: ringTexture(64),
      puffs: [puffTexture(96, 61), puffTexture(96, 62), puffTexture(96, 63)],
      ribbonSoft: ribbonTexture(4.5),
      ribbonCore: ribbonTexture(10),
    };
    return sharedTextures;
  }

  // ---------------------------------------------------------------------------
  // Pooled sprites
  // ---------------------------------------------------------------------------

  class Pool {
    constructor(container, texture) { this.container = container; this.texture = texture; this.live = []; this.dead = []; }
    get(texture) {
      let p = this.dead.pop();
      if (!p) {
        const s = new PIXI.Sprite(texture || this.texture);
        s.anchor.set(0.5);
        this.container.addChild(s);
        p = { sprite: s };
      }
      p.sprite.texture = texture || this.texture;
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

  const add = () => { const c = new PIXI.Container(); c.blendMode = 'add'; return c; };

  // ===========================================================================
  // PotionCauldron
  // ===========================================================================

  class LayerToggle {
    constructor(objects) { this._objects = objects; this._visible = true; }
    get visible() { return this._visible; }
    set visible(v) { this._visible = v; for (const o of this._objects) o.visible = v; }
  }

  const DEFAULTS = {
    // --- Resting boil ---
    surfaceWidth: 300,       // potion surface ellipse width, px (match the art)
    surfaceHeight: 44,       // potion surface ellipse height, px
    boil: 3,                 // bubbles per second while resting
    bubbleSize: 1.0,         // bubble size multiplier
    surfaceGlow: 1.0,        // brightness of the surface glow
    surfaceSwirl: 1.0,       // how fast the surface highlights swirl
    vapour: 1.0,             // resting vapour amount (0 = none)
    // --- Finale ---
    finaleDuration: 4.5,     // seconds, start to settled
    eruptHeight: 520,        // how high the vortex climbs, px
    vortexStrands: 4,        // ribbons twisting in the vortex
    vortexTurns: 2.2,        // how many times the spiral winds around
    spinSpeed: 3.5,          // vortex rotation, radians/sec
    vortexWidth: 1.0,        // vortex radius multiplier
    steamBurst: 1.0,         // finale steam amount
    sparkCount: 1.0,         // finale spark amount
    vortexBlur: 4,           // real blur on the vortex ribbons, px (0 = sharp)
    sparkBlur: 0,            // real blur on the sparks and droplets, px (0 = sharp)
    // --- Colors ---
    potionColor: 0xff3fc8,   // main potion pink
    glowColor: 0xff8ae6,     // light/highlight pink
    steamColor: 0xf3d6ee,    // steam
  };

  class PotionCauldron {
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options || {});
      this._time = Math.random() * 100;
      this._phase = 'rest';
      this._ft = 0;                 // seconds into the finale
      this._bubbleCarry = 0;
      this._vapourCarry = 0;
      this._tmp = { x: 0, y: 0 };
      const tex = getTextures();

      this.view = new PIXI.Container();

      // Column glow behind the vortex (finale).
      this.columnGlow = new PIXI.Sprite(tex.glow);
      this.columnGlow.anchor.set(0.5, 0.9);
      this.columnGlow.blendMode = 'add';

      // Steam behind and in front (normal blend — steam is matter, not light).
      this.steamBack = new PIXI.Container();
      this.steamFront = new PIXI.Container();
      this.steamPoolBack = new Pool(this.steamBack, tex.puffs[0]);
      this.steamPoolFront = new Pool(this.steamFront, tex.puffs[0]);

      // Vortex ribbons.
      this.vortex = add();
      this.vortexBlurFilter = new PIXI.BlurFilter({ strength: 0, quality: 3 });
      this.vortexBlurFilter.blendMode = 'add';
      this._fa = null;
      this.strands = [];

      // Surface (masked to the potion ellipse).
      this.surface = new PIXI.Container();
      this.surfaceGlow = new PIXI.Sprite(tex.glow);
      this.surfaceGlow.anchor.set(0.5);
      this.surfaceGlow.blendMode = 'add';
      this.swirlLayer = add();
      this.bubbleLayer = new PIXI.Container();
      this.surface.addChild(this.surfaceGlow, this.swirlLayer);
      this.surfaceMask = new PIXI.Graphics();
      this.surface.addChild(this.surfaceMask);
      this.surface.mask = this.surfaceMask;
      this._maskKey = '';
      // Swirl patterns live on a flattened "plane" container (scaled to the
      // surface's height/width), so each can simply rotate in its own flat
      // circle and come out as liquid turning in the potion's perspective.
      this.swirlPlane = new PIXI.Container();
      this.swirlLayer.addChild(this.swirlPlane);
      this.swirls = [
        { sprite: new PIXI.Sprite(tex.swirlA), speed: 0.22, alpha: 0.55, angle: rand(0, TAU) },
        { sprite: new PIXI.Sprite(tex.swirlB), speed: -0.15, alpha: 0.45, angle: rand(0, TAU) },
      ];
      for (const sw of this.swirls) { sw.sprite.anchor.set(0.5); this.swirlPlane.addChild(sw.sprite); }
      this.bubbles = new Pool(this.bubbleLayer, tex.lump);
      this.sheenLayer = add();                 // each lump's glowing sheen (see update)
      this.pops = new Pool(this.bubbleLayer, tex.ring);

      // Droplets, sparks, vapour, flash.
      this.dropLayer = add();
      this.drops = new Pool(this.dropLayer, tex.spark);
      this.sparkLayer = add();
      this.sparks = new Pool(this.sparkLayer, tex.spark);
      // Optional blur on sparks + droplets (plain sprites, nothing rebuilt
      // per frame, so a blur is cheap and smooth — see _applySparkBlur).
      this.sparkBlurFilter = new PIXI.BlurFilter({ strength: 0, quality: 3 });
      this.dropBlurFilter = new PIXI.BlurFilter({ strength: 0, quality: 3 });
      this.sparkBlurFilter.blendMode = 'add';
      this.dropBlurFilter.blendMode = 'add';
      this._sparkFa = null;
      this.vapourLayer = add();
      this.vapour = new Pool(this.vapourLayer, tex.puffs[1]);
      this.flash = new PIXI.Sprite(tex.glow);
      this.flash.anchor.set(0.5);
      this.flash.blendMode = 'add';
      this.flash.alpha = 0;

      this.view.addChild(this.columnGlow, this.steamBack, this.vortex, this.surface, this.bubbleLayer, this.sheenLayer,
        this.dropLayer, this.sparkLayer, this.vapourLayer, this.steamFront, this.flash);

      this.layers = {
        surface: new LayerToggle([this.surface]),
        bubbles: new LayerToggle([this.bubbleLayer, this.sheenLayer]),
        vapour: new LayerToggle([this.vapourLayer]),
        steam: new LayerToggle([this.steamBack, this.steamFront]),
        vortex: new LayerToggle([this.vortex, this.columnGlow, this.dropLayer]),
        sparks: new LayerToggle([this.sparkLayer, this.flash]),
      };
    }

    // ---------------------------------------------------------------- phases

    get phase() { return this._phase; }

    brewOver() {
      this._phase = 'finale';
      this._ft = 0;
      this._flashDone = false;
      this._burstDone = false;
      this._ensureStrands();
      for (const st of this.strands) { st.phaseOff = rand(0, TAU); st.radMul = rand(0.7, 1.2); st.wob = rand(0, TAU); }
    }

    rest() {
      this._phase = 'rest';
      this._ft = 0;
    }

    // ---------------------------------------------------------------- spawning

    _rx() { return this.options.surfaceWidth / 2; }
    _ry() { return this.options.surfaceHeight / 2; }

    // Random point on the potion surface (inside the ellipse, a bit in from the rim).
    _surfacePoint(inset) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * (inset || 0.85);
      return { x: Math.cos(a) * r * this._rx(), y: Math.sin(a) * r * this._ry() };
    }

    _spawnBubble(big) {
      const o = this.options;
      const p = this._surfacePoint(0.78);
      const n = Math.random() < 0.55 ? 1 : 2 + Math.floor(Math.random() * 2);   // often a little cluster
      for (let k = 0; k < n; k++) {
        const b = this.bubbles.get();
        b.x = p.x + (k ? rand(-1, 1) * this._rx() * 0.08 : 0);
        b.y = p.y + (k ? rand(-1, 1) * this._ry() * 0.12 : 0);
        b.life = -k * rand(0.05, 0.2);              // cluster members swell one after another
        b.maxLife = rand(0.7, 1.3) * (big ? 0.75 : 1);
        b.size = o.surfaceWidth * rand(0.03, 0.06) * o.bubbleSize * (big ? rand(1.3, 2) : 1) * (k ? 0.75 : 1);
      }
    }

    _pop(b) {
      const o = this.options;
      const r = this.pops.get();
      r.x = b.x; r.y = b.y; r.life = 0; r.maxLife = 0.45; r.size = b.size;
      const n = Math.random() < 0.3 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const d = this.drops.get();
        d.kind = 'splash';
        d.x = b.x; d.y = b.y;
        d.vx = rand(-40, 40) * (b.size / 10);
        d.vy = -rand(60, 130) * Math.sqrt(b.size / 8);
        d.life = 0; d.maxLife = rand(0.35, 0.6);
        d.size = Math.max(1.5, b.size * 0.22);
      }
      void o;
    }

    _spawnVapour(strong) {
      const o = this.options;
      const p = this._surfacePoint(0.7);
      const v = this.vapour.get(getTextures().puffs[Math.floor(Math.random() * 3)]);
      v.x = p.x; v.y = p.y;
      v.vx = rand(-8, 8); v.vy = -rand(18, 40) * (strong ? 3 : 1);
      v.life = 0; v.maxLife = rand(2.2, 3.8);
      v.size = o.surfaceWidth * rand(0.12, 0.22);
      v.spin = rand(-0.4, 0.4);
      v.seed = rand(0, 50);
      v.ember = Math.random() < 0.15;
    }

    _spawnSteam(front) {
      const o = this.options;
      const pool = front ? this.steamPoolFront : this.steamPoolBack;
      const p = this._surfacePoint(0.6);
      const s = pool.get(getTextures().puffs[Math.floor(Math.random() * 3)]);
      s.ang = Math.atan2(p.y / this._ry(), p.x / this._rx());   // angle around the vortex axis
      s.rad = Math.hypot(p.x / this._rx(), p.y / this._ry()) * this._rx();
      s.h = 0;                                   // height above surface
      s.vh = rand(160, 340) * (o.eruptHeight / 520);
      s.vrad = rand(30, 90);
      s.spin = rand(1.2, 2.4) * (Math.random() < 0.85 ? 1 : -1);  // orbit speed around the axis
      s.life = 0; s.maxLife = rand(1.8, 3.2);
      s.size = o.surfaceWidth * rand(0.25, 0.45);
      s.rot = rand(0, TAU); s.rotV = rand(-0.8, 0.8);
    }

    _spawnSpark(burst) {
      const o = this.options;
      const p = this._surfacePoint(0.5);
      const s = this.sparks.get();
      s.x = p.x; s.y = p.y;
      const ang = -Math.PI / 2 + rand(-1, 1) * (burst ? 0.9 : 0.5);
      const sp = rand(250, 620) * (o.eruptHeight / 520) * (burst ? 1.2 : 1);
      s.vx = Math.cos(ang) * sp; s.vy = Math.sin(ang) * sp;
      s.life = 0; s.maxLife = rand(0.6, 1.3);
      s.size = rand(2.5, 5) * (o.surfaceWidth / 300);
      s.hot = Math.random();
    }

    // A droplet flung around the vortex spiral (rides it up, spinning).
    _spawnVortexDrop() {
      const o = this.options;
      const d = this.drops.get();
      d.kind = 'vortex';
      d.ang = rand(0, TAU);
      d.h = rand(0, 0.15) * o.eruptHeight;
      d.vh = rand(220, 420) * (o.eruptHeight / 520);
      d.rad = this._rx() * rand(0.3, 0.8) * o.vortexWidth;
      d.vrad = rand(20, 70) * o.vortexWidth;
      d.spin = o.spinSpeed * rand(0.8, 1.3);
      d.life = 0; d.maxLife = rand(0.9, 1.7);
      d.size = rand(2.5, 6) * (o.surfaceWidth / 300);
    }

    _ensureStrands() {
      const n = Math.max(1, Math.round(this.options.vortexStrands));
      const tex = getTextures();
      while (this.strands.length < n) {
        const mk = (texture) => {
          const points = [];
          for (let i = 0; i < 48; i++) points.push(new PIXI.Point(0, -i));
          const rope = new PIXI.MeshRope({ texture, points, textureScale: 0 });
          rope.blendMode = 'add';
          this.vortex.addChild(rope);
          return rope;
        };
        this.strands.push({ glow: mk(tex.ribbonSoft), core: mk(tex.ribbonCore), phaseOff: rand(0, TAU), radMul: rand(0.7, 1.2), wob: rand(0, TAU) });
      }
      while (this.strands.length > n) {
        const st = this.strands.pop();
        st.glow.destroy(); st.core.destroy();
      }
    }

    // Blur for the sparks and droplets, on one fixed area covering
    // everywhere they can fly (a fixed area keeps the blur from resizing
    // every frame, which would jitter — see plasma_storm.js).
    _applySparkBlur() {
      const o = this.options, b = o.sparkBlur;
      this.sparkBlurFilter.strength = this.dropBlurFilter.strength = b;
      this.sparkLayer.filters = b > 0 ? [this.sparkBlurFilter] : null;
      this.dropLayer.filters = b > 0 ? [this.dropBlurFilter] : null;
      const key = o.surfaceWidth + ':' + o.eruptHeight + ':' + o.vortexWidth;
      if (b > 0 && this._sparkFa !== key) {
        const m = 40 + b * 3, rx = this._rx();
        const half = Math.max(rx * 3.5 * o.vortexWidth, o.eruptHeight * 0.8) + m;
        const area = new PIXI.Rectangle(-half, -o.eruptHeight * 2.4 - m, half * 2, o.eruptHeight * 2.4 + rx + m * 2);
        this.sparkLayer.filterArea = area;
        this.dropLayer.filterArea = area.clone();
        this._sparkFa = key;
      }
    }

    // ---------------------------------------------------------------- update

    update(dt) {
      dt = Math.min(dt, 0.1);
      this._time += dt;
      const t = this._time, o = this.options, tex = getTextures();
      const rx = this._rx(), ry = this._ry();
      const tmp = this._tmp;

      // ---- finale timeline → intensities (all 0 while resting)
      let frenzy = 0, steamOn = 0, vortexOn = 0, lift = 0, fade = 1;
      if (this._phase === 'finale') {
        this._ft += dt;
        const D = Math.max(2, o.finaleDuration), ft = this._ft;
        frenzy = smooth(ft / 0.6) * (1 - smooth((ft - D * 0.6) / (D * 0.3)));
        steamOn = ft > 0.45 && ft < D * 0.55 ? 1 : 0;
        vortexOn = smooth((ft - 0.5) / 0.5);
        lift = smooth((ft - D * 0.5) / (D * 0.45));                 // swirl detaches and flies up
        fade = 1 - smooth((ft - D * 0.72) / (D * 0.28));
        if (!this._flashDone && ft > 0.5) {
          this._flashDone = true;
          this.flash.alpha = 1;
          for (let i = 0; i < Math.round(40 * o.sparkCount); i++) this._spawnSpark(true);
        }
        if (ft >= D) this.rest();
      }

      // ---- surface glow + mask
      const key = rx + ':' + ry;
      if (key !== this._maskKey) {
        this._maskKey = key;
        this.surfaceMask.clear().ellipse(0, 0, rx * 0.97, ry * 0.94).fill(0xffffff);
      }
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.6) * Math.sin(t * 0.73 + 1);
      this.surfaceGlow.width = rx * 2.2;
      this.surfaceGlow.height = ry * 2.6;
      this.surfaceGlow.tint = mixColor(o.potionColor, o.glowColor, 0.3 + 0.5 * frenzy);
      this.surfaceGlow.alpha = Math.min(1, (0.55 * pulse + 0.6 * frenzy) * o.surfaceGlow);

      // ---- swirling surface highlights
      // Two soft swirl patterns turning slowly in opposite directions —
      // where they overlap the light keeps flowing and changing.
      this.swirlPlane.scale.set(1, ry / rx);
      const swirlRate = o.surfaceSwirl * (1 + 3 * frenzy);
      for (const sw of this.swirls) {
        sw.angle += sw.speed * swirlRate * dt;
        const sp = sw.sprite;
        sp.rotation = sw.angle;
        sp.width = sp.height = rx * 2.05;
        sp.tint = mixColor(o.glowColor, 0xffffff, 0.15);
        sp.alpha = Math.min(1, sw.alpha * (0.8 + 0.2 * Math.sin(t * 0.7 + sw.speed * 20)) * o.surfaceGlow * (1 + 0.8 * frenzy));
      }

      // ---- bubbles: slow boil, frenzy during the finale build
      const rate = o.boil * (1 + 9 * frenzy);
      this._bubbleCarry += rate * dt;
      while (this._bubbleCarry >= 1) { this._bubbleCarry -= 1; this._spawnBubble(frenzy > 0.3 && Math.random() < 0.5); }
      for (let i = this.bubbles.live.length - 1; i >= 0; i--) {
        const b = this.bubbles.live[i];
        b.life += dt;
        const s = b.sprite;
        if (!b.sheen) {
          b.sheen = new PIXI.Sprite(tex.sheen);
          b.sheen.anchor.set(0.5, 1);
          this.sheenLayer.addChild(b.sheen);
        }
        if (b.life < 0) { s.visible = b.sheen.visible = false; continue; }   // cluster member still waiting its turn
        s.visible = b.sheen.visible = true;
        const lt = b.life / b.maxLife;
        if (lt >= 1) { b.sheen.visible = false; this._pop(b); this.bubbles.kill(i); continue; }
        // Swells gently up to its low peak (only a shallow cap ever shows —
        // see capTexture), then pops at the top: _pop() runs at lt = 1.
        const rise = smooth(lt / 0.92);
        s.anchor.set(0.5, 1);
        s.position.set(b.x, b.y);
        s.width = b.size * SKIRT * (0.7 + 0.35 * rise);     // widens a little as it rises
        s.height = s.width * CAP_ASPECT * (0.35 + 0.65 * rise);
        s.tint = mixColor(o.potionColor, o.glowColor, 0.15); // vivid potion pink
        s.alpha = 0.95 * Math.min(1, rise * 3);
        const sh = b.sheen;
        sh.position.set(b.x, b.y);
        sh.width = s.width; sh.height = s.height;
        sh.tint = mixColor(o.glowColor, 0xffffff, 0.35);
        sh.alpha = 0.85 * rise * o.surfaceGlow;
      }
      for (let i = this.pops.live.length - 1; i >= 0; i--) {
        const r = this.pops.live[i];
        r.life += dt;
        const lt = r.life / r.maxLife;
        if (lt >= 1) { this.pops.kill(i); continue; }
        const s = r.sprite;
        s.position.set(r.x, r.y);
        s.width = r.size * (1 + 1.6 * lt); s.height = s.width * (ry / rx) * 2.2;
        s.tint = o.glowColor;
        s.alpha = 0.35 * (1 - lt);
      }

      // ---- resting vapour (and a little more during the build)
      this._vapourCarry += (1.4 * o.vapour + 6 * frenzy) * dt;
      while (this._vapourCarry >= 1) { this._vapourCarry -= 1; this._spawnVapour(frenzy > 0.2); }
      for (let i = this.vapour.live.length - 1; i >= 0; i--) {
        const v = this.vapour.live[i];
        v.life += dt;
        const lt = v.life / v.maxLife;
        if (lt >= 1) { this.vapour.kill(i); continue; }
        curl(v.x / rx * 1.5 + v.seed, v.y / (rx) * 1.5, t * 0.4, tmp);
        v.vx += tmp.x * 14 * dt;
        v.x += v.vx * dt; v.y += v.vy * dt;
        const s = v.sprite;
        s.position.set(v.x, v.y);
        s.rotation += v.spin * dt;
        const size = v.ember ? 3 + 2 * Math.sin(t * 6 + v.seed) : v.size * (0.6 + 1.2 * lt);
        s.texture = v.ember ? tex.spark : s.texture;
        s.width = s.height = size;
        s.tint = v.ember ? o.glowColor : mixColor(o.potionColor, o.steamColor, 0.5);
        s.alpha = (v.ember ? 0.9 : 0.16) * smooth(lt / 0.2) * (1 - lt);
      }

      // ---- finale steam: billows up, orbiting the axis as it rises
      if (steamOn) {
        const n = 14 * o.steamBurst * dt * (1 + (this._ft < 1 ? 2 : 0));
        this._steamCarry = (this._steamCarry || 0) + n;
        while (this._steamCarry >= 1) { this._steamCarry -= 1; this._spawnSteam(Math.random() < 0.45); }
      }
      for (const pool of [this.steamPoolBack, this.steamPoolFront]) {
        for (let i = pool.live.length - 1; i >= 0; i--) {
          const s = pool.live[i];
          s.life += dt;
          const lt = s.life / s.maxLife;
          if (lt >= 1) { pool.kill(i); continue; }
          s.h += s.vh * dt; s.vh *= Math.pow(0.55, dt);
          s.rad += s.vrad * dt;
          s.ang += s.spin * dt;
          s.rot += s.rotV * dt;
          const sp = s.sprite;
          sp.position.set(Math.cos(s.ang) * s.rad, Math.sin(s.ang) * s.rad * 0.35 - s.h);
          sp.rotation = s.rot;
          sp.width = sp.height = s.size * (0.7 + 2.2 * lt);
          sp.tint = mixColor(o.steamColor, o.glowColor, 0.25 * (1 - lt));
          sp.alpha = 0.42 * smooth(lt / 0.12) * Math.pow(1 - lt, 1.3);
        }
      }

      // ---- vortex: twisting ribbons rising out of the potion
      this._ensureStrands();
      const vis = vortexOn * fade;
      this.vortex.visible = this.layers.vortex.visible && vis > 0.003;
      if (this.vortex.visible) {
        const H = o.eruptHeight * (0.35 + 0.65 * smooth((this._ft - 0.5) / 1.2)) * (1 + 0.5 * lift);
        const baseH = lift * o.eruptHeight * 0.9;      // bottom of the swirl leaves the potion
        const R0 = rx * 0.45 * o.vortexWidth, spinA = this._ft * o.spinSpeed * (1 + 0.6 * lift);
        const n = this.strands.length;
        for (let k = 0; k < n; k++) {
          const st = this.strands[k];
          const off = (k / n) * TAU + st.phaseOff * 0.15;
          for (const [rope, wMul, aMul, tint] of [[st.glow, 1, 0.55, o.potionColor], [st.core, 0.32, 0.9, mixColor(o.glowColor, 0xffffff, 0.45)]]) {
            const pts = rope.geometry.points;
            for (let i = 0; i < pts.length; i++) {
              const s = i / (pts.length - 1);
              const ang = off + s * o.vortexTurns * TAU - spinA;
              // Organic, liquid look: each ribbon has its own width and a
              // slow breathing wobble, and the whole column sways a little.
              const r = R0 * (0.35 + 1.5 * s) * (1 + 0.6 * lift) * st.radMul
                * (1 + 0.18 * Math.sin(s * 5 + t * 2.3 + st.wob));
              const sway = Math.sin(s * 2.6 - t * 1.7) * rx * 0.18 * s;
              pts[i].x = Math.cos(ang) * r + sway;
              pts[i].y = Math.sin(ang) * r * 0.32 - (baseH + s * H);
            }
            rope.geometry._width = rx * 0.32 * wMul * (1 + 0.5 * lift) * o.vortexWidth;
            rope.tint = tint;
            rope.alpha = Math.min(1, aMul * vis * (1 + o.vortexBlur / 12));
          }
        }
        // Blur on a fixed area around the whole climb.
        const b = o.vortexBlur;
        this.vortexBlurFilter.strength = b;
        this.vortex.filters = b > 0 ? [this.vortexBlurFilter] : null;
        const fkey = rx + ':' + o.eruptHeight + ':' + o.vortexWidth;
        if (b > 0 && this._fa !== fkey) {
          const m = 40 + b * 3, half = rx * 3.2 * o.vortexWidth + m;
          this.vortex.filterArea = new PIXI.Rectangle(-half, -o.eruptHeight * 2.2 - m, half * 2, o.eruptHeight * 2.2 + ry * 4 + m * 2);
          this._fa = fkey;
        }
        // Droplets flung around the spiral.
        const dropRate = 30 * o.sparkCount * vis * (1 - lift * 0.7);
        this._dropCarry = (this._dropCarry || 0) + dropRate * dt;
        while (this._dropCarry >= 1) { this._dropCarry -= 1; this._spawnVortexDrop(); }
        // Column glow behind it.
        this.columnGlow.position.set(0, -baseH);
        this.columnGlow.width = rx * 2.4 * (1 + lift);
        this.columnGlow.height = H * 1.3;
        this.columnGlow.tint = o.potionColor;
        this.columnGlow.alpha = 0.45 * vis;
      } else {
        this.columnGlow.alpha = 0;
      }

      // ---- droplets (surface splashes + vortex droplets)
      this._applySparkBlur();
      const blurBoost = 1 + o.sparkBlur / 6;   // blur spreads them thin — brighten to compensate
      for (let i = this.drops.live.length - 1; i >= 0; i--) {
        const d = this.drops.live[i];
        d.life += dt;
        const lt = d.life / d.maxLife;
        if (lt >= 1) { this.drops.kill(i); continue; }
        const s = d.sprite;
        if (d.kind === 'splash') {
          d.vy += 420 * dt;
          d.x += d.vx * dt; d.y += d.vy * dt;
          s.position.set(d.x, d.y);
          s.width = s.height = d.size;
          s.tint = o.glowColor;
          s.alpha = Math.min(1, 0.9 * (1 - lt) * blurBoost);
        } else {
          d.h += d.vh * dt;
          d.rad += d.vrad * dt;
          d.ang += d.spin * dt;
          const depth = Math.sin(d.ang);                     // -1 back … 1 front
          s.position.set(Math.cos(d.ang) * d.rad, depth * d.rad * 0.32 - d.h);
          const sz = d.size * (0.75 + 0.35 * depth);
          s.rotation = d.ang + Math.PI / 2;
          s.width = sz * 2.4; s.height = sz;
          s.tint = mixColor(o.potionColor, o.glowColor, 0.5 + 0.5 * depth);
          s.alpha = Math.min(1, (0.55 + 0.45 * depth) * (1 - lt) * fade * blurBoost);
        }
      }

      // ---- sparks
      if (vortexOn > 0 && fade > 0.2 && Math.random() < 18 * o.sparkCount * dt * vis) this._spawnSpark(false);
      for (let i = this.sparks.live.length - 1; i >= 0; i--) {
        const p = this.sparks.live[i];
        p.life += dt;
        const lt = p.life / p.maxLife;
        if (lt >= 1) { this.sparks.kill(i); continue; }
        p.vy += 260 * dt; p.vx *= Math.pow(0.6, dt);
        p.x += p.vx * dt; p.y += p.vy * dt;
        const s = p.sprite;
        s.position.set(p.x, p.y);
        const sp = Math.hypot(p.vx, p.vy);
        s.rotation = Math.atan2(p.vy, p.vx);
        s.height = p.size * (1 - 0.5 * lt);
        s.width = s.height * (1.5 + sp / 110);
        s.tint = mixColor(o.glowColor, 0xffffff, 0.4 + 0.6 * p.hot);
        s.alpha = Math.min(1, (1 - lt) * blurBoost);
      }

      // ---- flash
      if (this.flash.alpha > 0) {
        this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2.2);
        this.flash.position.set(0, -ry * 2);
        this.flash.width = rx * 5; this.flash.height = rx * 4;
        this.flash.tint = mixColor(o.glowColor, 0xffffff, 0.5);
      }
    }

    // ---------------------------------------------------------------- params
    get boil() { return this.options.boil; }
    set boil(v) { this.options.boil = Math.max(0, v); }
    get surfaceWidth() { return this.options.surfaceWidth; }
    set surfaceWidth(v) { this.options.surfaceWidth = Math.max(20, v); }
    get surfaceHeight() { return this.options.surfaceHeight; }
    set surfaceHeight(v) { this.options.surfaceHeight = Math.max(4, v); }
    get potionColor() { return this.options.potionColor; }
    set potionColor(v) { this.options.potionColor = v; }
    get glowColor() { return this.options.glowColor; }
    set glowColor(v) { this.options.glowColor = v; }
    get steamColor() { return this.options.steamColor; }
    set steamColor(v) { this.options.steamColor = v; }

    destroy() { this.view.destroy({ children: true }); }
  }

  PotionCauldron.DEFAULTS = DEFAULTS;
  window.PotionCauldron = PotionCauldron;
})();
