// Three scrolling fog layers for parallax depth (back/mid/front, each drifting
// upward at a different speed). Each layer is two stacked copies of the same image
// that swap past each other as they scroll off — the standard endless-vertical-tile
// trick, ported directly from the original's own FogBack1/2 etc. pairing and
// cross-referencing wrap logic.
//
// All three are drawn behind the gameplay (platform/ball) — the original layered
// "front" fog above the action, but that risks obscuring the ball on a phone
// screen, so this port keeps every fog layer as background atmosphere only.
// The -1280 literals below are just placeholder initial values (this object
// literal evaluates before game.js's CONFIG exists yet, given the script
// load order) — reset()/update() below use CONFIG.HEIGHT for real, and
// reset() always runs before Fog is actually used (PlayScreen.enter() calls
// it), so these placeholders are overwritten before they matter.
const Fog = {
  layers: [
    { key: 'fogBack', speed: -6, y1: 0, y2: -1280 },
    { key: 'fogMid', speed: -18, y1: 0, y2: -1280 },
    { key: 'fogFront', speed: -42, y1: 0, y2: -1280 },
  ],

  reset() {
    for (const l of this.layers) { l.y1 = 0; l.y2 = -CONFIG.HEIGHT; }
  },

  update(dt) {
    for (const l of this.layers) {
      l.y1 += l.speed * dt;
      l.y2 += l.speed * dt;
      if (l.y1 < -CONFIG.HEIGHT) l.y1 = l.y2 + CONFIG.HEIGHT;
      if (l.y2 < -CONFIG.HEIGHT) l.y2 = l.y1 + CONFIG.HEIGHT;
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

// Bubbles that stream up from a platform's hinge while the ball is touching it —
// not an ambient background effect. The original project's hinge-bubble object is
// literally called "SparklesFront": flow 50/s, force 5-20 (gentle), life 0.2-8s
// (long-lived), size 30→0 (starts big, shrinks away), color pink(254,19,117)→
// cyan(63,203,255) with alpha 255→0, particleGravityY -40 (continuously
// accelerates upward), texture Bubble.png — read directly from the source
// project's own numbers rather than hand-guessed, then stretched 15% longer-lived
// (Rob liked that about an earlier hand-tuned version).
//
// Was a single global `HingeBubbles` object through Phase 1 (one hinge on screen
// at a time). For the multi-platform tower this is now a factory —
// `createHingeBubbles()` — so each platform's hinge gets its own independent
// bubble stream rather than sharing one global one.
function createHingeBubbles() {
  return {
    bubbles: [],
    spawnTimer: 0,

    reset() {
      this.bubbles = [];
      this.spawnTimer = 0;
    },

    // No cap here anymore — this was trimmed to 60 during the phone GPU crash
    // investigation, but the real cause turned out to be a memory leak in the
    // jet nozzle's gradient allocation (see pixi_playscreen.js), not particle
    // counts. That's fixed now, so this was just needlessly throttling how
    // full the bubble stream reads (Rob). Natural steady state settles around
    // ~225 concurrent bubbles given this emitter's flow/lifetime.
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
            maxLife: (0.2 + Math.random() * 7.8) * 1.15,
            maxSize: 30, // particleSize1 (shrinks to particleSize2=0)
            // A per-bubble sideways weave layered on top of the emitter's own
            // vx/vy, drawn as an x offset rather than baked into position so it
            // doesn't fight the real gravity/velocity integration below.
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
  };
}
