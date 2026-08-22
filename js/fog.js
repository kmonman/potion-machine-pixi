// Three scrolling fog layers for parallax depth (back/mid/front, each drifting
// upward at a different speed). Each layer is two stacked copies of the same image
// that swap past each other as they scroll off — the standard endless-vertical-tile
// trick, ported directly from the original's own FogBack1/2 etc. pairing and
// cross-referencing wrap logic.
//
// All three are drawn behind the gameplay (platform/ball) — the original layered
// "front" fog above the action, but that risks obscuring the ball on a phone
// screen, so this port keeps every fog layer as background atmosphere only.
const Fog = {
  layers: [
    { key: 'fogBack', speed: -6, y1: 0, y2: -1280 },
    { key: 'fogMid', speed: -18, y1: 0, y2: -1280 },
    { key: 'fogFront', speed: -42, y1: 0, y2: -1280 },
  ],

  reset() {
    for (const l of this.layers) { l.y1 = 0; l.y2 = -1280; }
  },

  update(dt) {
    for (const l of this.layers) {
      l.y1 += l.speed * dt;
      l.y2 += l.speed * dt;
      if (l.y1 < -1280) l.y1 = l.y2 + 1280;
      if (l.y2 < -1280) l.y2 = l.y1 + 1280;
    }
  },

  draw(ctx, images) {
    for (const l of this.layers) {
      const img = images[l.key];
      const imgFlip = images[l.key + 'Flip'];
      if (img) ctx.drawImage(img, 0, l.y1, 720, 1280);
      if (imgFlip) ctx.drawImage(imgFlip, 0, l.y2, 720, 1280);
    }
    this._drawVignette(ctx);
  },

  // The fog layers alone read as a flat, uniform texture — nothing like the Home
  // screen's background. This overlays a fade on top of the fog: solid background
  // color (dark, no fog) from the top down past the tube (Platform.pivot.y ≈ 652)
  // and further still for a deeper dark zone, then gradually getting lighter toward
  // the bottom of the screen. Pulled darker overall throughout for a spookier feel
  // — even at its clearest, near the bottom, it stays fairly dim.
  _drawVignette(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 1280);
    grad.addColorStop(0, 'rgba(10, 4, 16, 1)');
    grad.addColorStop(0.55, 'rgba(10, 4, 16, 1)'); // solid dark extends further past the tube
    grad.addColorStop(0.68, 'rgba(10, 4, 16, 0.78)');
    grad.addColorStop(0.82, 'rgba(10, 4, 16, 0.6)');
    grad.addColorStop(1, 'rgba(10, 4, 16, 0.45)'); // darker floor than before — stays dim, never fully clears
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 720, 1280);
  },
};

// Bubbles that stream up from the hinge while the ball is touching it — not an
// ambient background effect. (First pass had these spawning randomly across the
// whole screen at all times; Rob caught that they should specifically be part of
// the hinge-touch feedback, alongside the glow and sparkles.)
// Trying the *real* source emitter here for comparison (Rob) — the original
// project's hinge-bubble object is literally called "SparklesFront", with:
// flow 50/s, force 5-20 (gentle), life 0.2-8s (long-lived), size 30→0
// (starts big, shrinks away), color pink(254,19,117)→cyan(63,203,255) with
// alpha 255→0, particleGravityY -40 (continuously accelerates upward),
// texture Bubble.png. This is a full swap of the previous hand-tuned version
// (dense small circles, fixed 3s life, one pink tone) — easy to revert to
// that if this doesn't look right, nothing here is pushed yet.
const HingeBubbles = {
  bubbles: [],
  spawnTimer: 0,

  reset() {
    this.bubbles = [];
    this.spawnTimer = 0;
  },

  update(dt, emitting, x, y) {
    if (emitting) {
      this.spawnTimer -= dt;
      let bubbleGuard = 0;
      while (this.spawnTimer <= 0 && bubbleGuard < 20) {
        this.spawnTimer += 1 / 50; // flow=50/s
        bubbleGuard++;
        // angleA=0/angleB=180 in the source — spread across the whole upper
        // half (never aims downward), matching gravityY pulling everything
        // up regardless of its initial direction.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
        const force = 5 + Math.random() * 15; // emitterForceMin/Max 5-20
        this.bubbles.push({
          x, y,
          vx: Math.cos(angle) * force,
          vy: Math.sin(angle) * force,
          life: 0,
          // Slightly longer-lived than the real source values (Rob liked
          // that about the previous hand-tuned version) — same 0.2-8s
          // range, just stretched 15%.
          maxLife: (0.2 + Math.random() * 7.8) * 1.15,
          maxSize: 30, // particleSize1 (shrinks to particleSize2=0)
          // Borrowed from the previous hand-tuned version too (Rob: "the 3
          // dimensional twist as they flowed up") — a per-bubble sideways
          // weave layered on top of the emitter's own vx/vy, drawn as an x
          // offset rather than baked into position so it doesn't fight the
          // real gravity/velocity integration below.
          wobblePhase: Math.random() * Math.PI * 2,
          wobbleAmp: 6 + Math.random() * 10,
          wobbleSpeed: 1 + Math.random() * 1,
        });
      }
    }
    for (const b of this.bubbles) {
      b.vy += -40 * dt; // particleGravityY — continuously accelerates upward
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.wobblePhase += dt * b.wobbleSpeed;
      b.life += dt;
    }
    this.bubbles = this.bubbles.filter((b) => b.life < b.maxLife);
  },

  draw(ctx, images) {
    for (const b of this.bubbles) {
      const t = b.life / b.maxLife;
      const size = b.maxSize * (1 - t); // particleSize1→particleSize2 (30→0)
      const alpha = 1 - t; // particleAlpha1→particleAlpha2 (255→0)
      const drawX = b.x + Math.sin(b.wobblePhase) * b.wobbleAmp;
      const col = [
        Math.round(254 + (63 - 254) * t),
        Math.round(19 + (203 - 19) * t),
        Math.round(117 + (255 - 117) * t),
      ];
      if (images.hingeBubbleParticle) {
        drawTintedParticle(ctx, images.hingeBubbleParticle, drawX, b.y, size, col, alpha, false);
      }
    }
  },
};
