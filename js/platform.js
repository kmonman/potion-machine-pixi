// The see-saw platform (a rotating bar mounted on a fixed pole). It isn't a physics
// object — like the original, its angle is driven by a smooth tween that continuously
// retargets to a new random angle every 3 seconds. Ball physics (physics.js) reads
// Platform.angle each frame to know what it's balancing on.

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Offscreen scratch canvas for tinting particle textures per-frame (see
// drawTintedParticle) — reused every particle rather than allocated fresh,
// and kept isolated from the main canvas so the tint fill can't bleed onto
// anything else already drawn there.
const _particleTintCanvas = document.createElement('canvas');
_particleTintCanvas.width = 40;
_particleTintCanvas.height = 40;
const _particleTintCtx = _particleTintCanvas.getContext('2d');

function drawTintedParticle(ctx, img, px, py, size, color, alpha, additive) {
  if (!img || size <= 0.5 || alpha <= 0.01) return;
  const s = Math.min(40, Math.max(1, Math.ceil(size)));
  _particleTintCtx.clearRect(0, 0, 40, 40);
  _particleTintCtx.drawImage(img, 0, 0, s, s);
  _particleTintCtx.globalCompositeOperation = 'source-atop';
  _particleTintCtx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  _particleTintCtx.fillRect(0, 0, s, s);
  _particleTintCtx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
  ctx.drawImage(_particleTintCanvas, 0, 0, s, s, px - size / 2, py - size / 2, size, size);
  ctx.restore();
}

const Platform = {
  pivot: { x: 360, y: 652 },
  // Shortened from the original's 674 (Rob's phone test: the tube reached close
  // enough to the screen edges that the ball couldn't actually fall down the gap
  // between the tube's end and the side wall — it would hit the wall-bounce trigger
  // and get knocked back before it had cleared the tube's end and dropped far
  // enough to fall past it). Widened back up 520→620 (Rob: felt too small) — the
  // 100px fall-through margin (Physics._checkBoundaries) still gives room to drop.
  length: 620,
  thickness: 52,
  // The sprite's own outer ring (Hinge.png), measured directly from the asset
  // pixels: it sits at radius 42-49 of the 100x100 source, scaled to the 112px
  // display size drawHinge() actually draws at (×1.12) → ~47-55. Used as the
  // outer edge so Physics._checkHinge's "touching" threshold lines up with
  // where the ball visually reaches this real ring — not a separate glow shape
  // drawn at some other, disconnected radius.
  hingeRingRadius: 55,
  poleHeight: 630,

  angle: 0, // degrees; positive = right end tilts down
  startAngle: 0,
  targetAngle: 0,
  tweenDuration: 3,
  tweenElapsed: 0,
  timer: 0,
  direction: 1,

  // Hinge glow + emitters + sparkle burst while the ball is touching it. Rob's
  // real reference screenshots (a "not touching" and a "touching" shot of the
  // actual original game) showed this port's version was backwards (dimmer
  // while touched — an earlier, unverified guess) and too flat at idle.
  // Several follow-up misses trying to add texture between the core and outer
  // ring (rotating dots, a tick-mark reticle, twinkling dust) all ended up
  // reading as some kind of stray white blob once tuned. The real fix: the
  // source project's own JSON has two actual particle-emitter definitions tied
  // to the hinge — "HingeMagic" (slow ambient smoke, additive, blue→purple,
  // grows 0→30px over 2-4s, flow 2/s) and "HingeSparks" (fast radiating burst,
  // cyan→blue, shrinks 10→0px, lives 0.2-1s, force 50-90, flow 60/s) — read
  // directly from the project file's own numbers rather than guessed.
  hingeGlow: 0, // 0 = idle, 1 = touched — brighter/warmer at 1, not dimmer
  hingeMagicParticles: [],
  hingeMagicTimer: 0,
  hingeSparkParticles: [],
  hingeSparkTimer: 0,

  reset() {
    this.angle = 0;
    this.direction = 1;
    this.startAngle = 0;
    this.targetAngle = (5 + Math.random() * 15) * this.direction;
    this.tweenElapsed = 0;
    this.timer = 0;
    this.hingeGlow = 0;
    this.hingeMagicParticles = [];
    this.hingeMagicTimer = 0;
    this.hingeSparkParticles = [];
    this.hingeSparkTimer = 0;
    this._initLiquid();
  },

  update(dt) {
    this.timer += dt;
    this.tweenElapsed = Math.min(this.tweenElapsed + dt, this.tweenDuration);
    const t = this.tweenElapsed / this.tweenDuration;
    this.angle = this.startAngle + (this.targetAngle - this.startAngle) * easeInOutSine(t);

    if (this.timer >= this.tweenDuration) {
      this.direction *= -1;
      this.startAngle = this.targetAngle;
      this.targetAngle = (5 + Math.random() * 15) * this.direction;
      this.tweenElapsed = 0;
      this.timer = 0;
    }

    this._updateLiquid(dt);
    this._updateHinge(dt);
  },

  _updateHinge(dt) {
    // Dims quickly-ish while touched (~0.7s), brightens back a bit faster (~0.3s) —
    // matches the original's two different tween durations for the two directions.
    const target = Physics.touchingHinge ? 1 : 0;
    const speed = target > this.hingeGlow ? 1 / 0.7 : 1 / 0.3;
    this.hingeGlow += (target - this.hingeGlow) * Math.min(1, dt * speed * 3);

    // HingeMagic — ambient smoke, same real params (flow 2/s, force 1-3, life
    // 2-4s, grows to 30px) constantly regardless of touch state (Rob: undid
    // the idle-specific tuning — keep this identical whether touching or not).
    // `while`, not `if` — a slower/less consistent frame rate (mobile)
    // otherwise silently caps the real spawn rate at the frame rate instead
    // of the intended flow rate, same root cause as the jets reading thin on
    // the phone (Rob).
    this.hingeMagicTimer -= dt;
    let magicGuard = 0;
    while (this.hingeMagicTimer <= 0 && magicGuard < 30) {
      this.hingeMagicTimer += 0.5; // flow=2/s
      magicGuard++;
      const a = Math.random() * Math.PI * 2;
      const force = 1 + Math.random() * 2;
      this.hingeMagicParticles.push({
        x: this.pivot.x, y: this.pivot.y,
        vx: Math.cos(a) * force, vy: Math.sin(a) * force,
        life: 0,
        maxLife: 2 + Math.random() * 2,
        maxSize: 30,
      });
    }
    for (const p of this.hingeMagicParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
    }
    this.hingeMagicParticles = this.hingeMagicParticles.filter((p) => p.life < p.maxLife);

    // HingeSparks — fast radiating burst (real params: flow 60/s, force 50-90,
    // life 0.2-1s, zoneRadius 30). Constant at the full rate regardless of
    // touch now (Rob liked how much more active it looked while touching and
    // wants that always-on) — was ramped 3→60/s with hingeGlow before.
    const sparkFlow = 60;
    this.hingeSparkTimer -= dt;
    let sparkGuard = 0;
    while (this.hingeSparkTimer <= 0 && sparkGuard < 30) {
      this.hingeSparkTimer += 1 / sparkFlow;
      sparkGuard++;
      const a = Math.random() * Math.PI * 2;
      const spawnR = Math.random() * 30;
      const force = 50 + Math.random() * 40;
      this.hingeSparkParticles.push({
        x: this.pivot.x + Math.cos(a) * spawnR, y: this.pivot.y + Math.sin(a) * spawnR,
        vx: Math.cos(a) * force, vy: Math.sin(a) * force,
        life: 0, maxLife: 0.2 + Math.random() * 0.8,
      });
    }
    for (const p of this.hingeSparkParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
    }
    this.hingeSparkParticles = this.hingeSparkParticles.filter((p) => p.life < p.maxLife);
  },

  get angleRad() { return this.angle * Math.PI / 180; },
  // Unit vector along the bar (from pivot toward the "positive/right" end).
  get dir() { return { x: Math.cos(this.angleRad), y: Math.sin(this.angleRad) }; },
  // Unit vector perpendicular to the bar, pointing toward its underside.
  get normal() { return { x: -Math.sin(this.angleRad), y: Math.cos(this.angleRad) }; },

  draw(ctx, images) {
    const { x, y } = this.pivot;

    // Pole (static, drawn from the pivot straight down), with a glowing purple
    // outline — Rob pointed at another one of his games where the post has
    // this treatment; the base sprite (NewSprite.png) is just a flat dark bar
    // with no glow of its own.
    if (images.pole) {
      const poleW = 50, poleX = x - poleW / 2;
      ctx.drawImage(images.pole, poleX, y, poleW, this.poleHeight);
      ctx.save();
      // Gradient stroke — fades out toward the bottom of the pole instead of a
      // uniform line the whole way down (Rob's ask). shadowBlur reads the
      // stroke's own alpha at each point, so the glow fades along with it
      // rather than needing a separate mask.
      const fade = ctx.createLinearGradient(x, y, x, y + this.poleHeight);
      // Darker base line than the hinge match (Rob: "the pole should be
      // darker"), but with more glow spread than before (Rob: "both need to
      // glow more") — darkness and glow amount are separate knobs: alpha
      // controls the line itself, shadowBlur controls how far the glow spreads.
      fade.addColorStop(0, 'rgba(170, 100, 255, 0.35)');
      fade.addColorStop(0.6, 'rgba(170, 100, 255, 0.2)');
      fade.addColorStop(1, 'rgba(170, 100, 255, 0)');
      // Two passes, same neon technique as the hinge — a wide soft outer glow
      // first, then the crisp line on top with a tighter blur.
      ctx.shadowColor = 'rgba(150, 70, 230, 0.55)';
      ctx.shadowBlur = 34;
      ctx.strokeStyle = fade;
      ctx.lineWidth = 3;
      roundRectPath(ctx, poleX, y, poleW, this.poleHeight, 10);
      ctx.stroke();
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.restore();
    }

    // Platform bar, rotated around the pivot.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.angleRad);
    if (images.platform) {
      ctx.drawImage(images.platform, -this.length / 2, -this.thickness / 2, this.length, this.thickness);
    }
    this._drawLiquid(ctx);
    this._drawGlass(ctx, images);
    ctx.restore();
  },

  // Hinge glow + sprite + sparkles + jets — split out from draw() so the ball can
  // be drawn in between (Rob: the ball should render behind the hinge and its
  // bubbles, not on top of them like it did when everything here was one call
  // that ran before Physics.draw()).
  drawHinge(ctx, images) {
    const { x, y } = this.pivot;
    const g = this.hingeGlow; // 0 idle .. 1 touched — brighter/warmer at 1

    // Purple, brightening on touch (was drifting toward pink/magenta — Rob
    // wants it purple, not pink).
    const c = [
      Math.round(140 + (175 - 140) * g),
      Math.round(70 + (85 - 70) * g),
      Math.round(230 + (255 - 230) * g),
    ];
    const rgb = c.join(',');

    // Hinge bubbles drawn first, before the sprite itself — the sprite's own
    // art is opaque right where the dot sits, so drawing bubbles any later
    // than this still let them show through on top of the dot (Rob: "I still
    // see the red from the emitter in front of my dot") since a stroked
    // outline alone doesn't cover its own interior. This is the only point
    // in the draw order where something actually opaque sits on top of them
    // at the dot's location.
    HingeBubbles.draw(ctx, images);

    // Sprite drawn plain (untinted) — matches how the pole's own base sprite
    // is left alone and only gets a separate glowing outline on top, rather
    // than recoloring the sprite's own pixels (the source-atop tinting
    // approach used here previously).
    if (images.hinge) {
      const s = 112;
      ctx.drawImage(images.hinge, x - s / 2, y - s / 2, s, s);
    }

    // Same neon treatment on the center dot — a stroked outline on its edge
    // (matching the ring's technique exactly), not a filled disk.
    const dotR = 17;
    // Most of the glow removed here (Rob: not needed now that the stroke
    // itself is blurred via ctx.filter) — dropped the big radial-gradient halo
    // fill entirely and cut shadowBlur down to one modest pass instead of two
    // large ones (110/45).
    ctx.save();
    ctx.filter = 'blur(4px)'; // wider/blurrier (Rob) — was 2.5px
    // Idle raised back up a bit (Rob: idle was reading as too dull once the
    // wide glow got dropped) — was 0.25/15, now brighter and a bit more blur
    // at rest while touch still pops further above it.
    ctx.shadowColor = `rgba(${rgb}, ${0.45 + g * 0.55})`;
    ctx.shadowBlur = 20 + g * 15;
    ctx.strokeStyle = `rgba(${rgb}, ${0.4 + g * 0.6})`;
    ctx.lineWidth = 5; // wider (Rob) — was 3
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Solid opaque core pass, no blur/shadow — reads as a real solid line
    // sitting cleanly in front of whatever else is drawn behind it (the
    // bubbles, in this case), not a translucent haze.
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${rgb}, ${0.5 + g * 0.5})`;
    ctx.lineWidth = 3; // wider (Rob) — was 2
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.stroke();

    // HingeMagic — ambient growing smoke, additive blue→purple. Drawn *after*
    // the dot now, not before — spawning right at the dot's center meant the
    // sprite's own opaque dot fill was covering these almost entirely,
    // especially the now-smaller idle ones (Rob: "the little blue fuzz coming
    // out of the dot" wasn't visible). Each particle's own `maxSize` (set at
    // spawn — 30 touching, 13 idle) replaces the old flat 30 so idle ones
    // actually stay capped smaller instead of all sharing one size curve.
    for (const p of this.hingeMagicParticles) {
      const t = p.life / p.maxLife;
      const size = p.maxSize * t;
      const alpha = (150 / 255) * (1 - t);
      const col = [
        Math.round(74 + (119 - 74) * t),
        Math.round(144 + (0 - 144) * t),
        Math.round(226 + (255 - 226) * t),
      ];
      drawTintedParticle(ctx, images.smokeParticle, p.x, p.y, size, col, alpha, true);
    }

    // Glowing ring outline — same stroke + blurred-line technique as the dot.
    // Two strokes, one on the ring's inner edge (~47) and one on its outer
    // edge (this.hingeRingRadius, 55) — the sprite's ring is a band, not a
    // single line. Most of the glow removed here too (Rob) — dropped the big
    // radial-gradient halo fill and cut shadowBlur down to one modest pass.
    for (const r of [47, this.hingeRingRadius]) {
      ctx.save();
      ctx.filter = 'blur(4px)'; // wider/blurrier (Rob) — was 2.5px, matching the dot
      // Idle raised back up a bit (Rob: idle was reading as too dull once the
      // wide glow got dropped) — was 0.25/15, now brighter and a bit more blur
      // at rest while touch still pops further above it.
      ctx.shadowColor = `rgba(${rgb}, ${0.45 + g * 0.55})`;
      ctx.shadowBlur = 20 + g * 15;
      ctx.strokeStyle = `rgba(${rgb}, ${0.4 + g * 0.6})`;
      ctx.lineWidth = 5; // wider (Rob) — was 3
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // Solid opaque core pass on top, no blur/shadow — makes the ring read as
      // a real solid line in front of the bubbles instead of a translucent
      // haze (Rob: "the ring looks transparent").
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${rgb}, ${0.5 + g * 0.5})`;
      ctx.lineWidth = 3; // wider (Rob) — was 2
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // HingeSparks — fast radiating burst, cyan→blue, drawn on top so sparks
    // visibly fly outward over the ring. Replaces the old hand-guessed
    // "sparkles" burst with the source project's real "HingeSparks" emitter
    // params (see _updateHinge).
    for (const p of this.hingeSparkParticles) {
      const t = p.life / p.maxLife;
      const size = 15 * (1 - t); // +50% starting size (Rob)
      const alpha = (70 / 255) * (1 - t);
      // Starts white, fades to the same blue as before (was cyan→blue) — Rob's ask.
      const col = [
        Math.round(255 + (0 - 255) * t),
        Math.round(255 + (33 - 255) * t),
        255,
      ];
      drawTintedParticle(ctx, images.glowParticle, p.x, p.y, size, col, alpha, false);
    }

    // Jets are already positioned in world space (Difficulty computes them from
    // the pivot directly), so they're drawn outside the rotated block above.
    Difficulty.drawJets(ctx, images);
  },

  // ---------- Liquid: a "2D water" column simulation ----------
  // Standard technique (springs between a row of surface columns, tension pulls each
  // column toward a target, damping bleeds energy, and a spread pass propagates
  // changes to neighbors so disturbances ripple across the surface as a wave rather
  // than every column snapping independently). What makes it look like liquid *in a
  // tilting tube* specifically: the per-column target isn't "flat relative to the
  // tube" — it's "flat relative to real gravity", i.e. the world-horizontal plane
  // re-expressed in the tube's own (rotated) local coordinates. On top of that, a
  // small continuous ambient ripple (`_ambientWave`) keeps the surface visibly alive
  // even while the platform briefly isn't changing angle, instead of freezing solid.
  liquidColumns: [],
  liquidColumnCount: 48,
  liquidTension: 0.22,
  liquidDamping: 0.10,
  liquidSpread: 0.28,
  liquidSpreadPasses: 4,
  liquidAmbientAmplitude: 2.2,
  liquidAmbientSpeed: 1.6,
  liquidTime: 0,

  // Padding between the liquid and the tube's own edges — reduced (Rob: too
  // much gap) from 15/9 to 6/4.
  _liquidHalfLength() { return this.length / 2 - 6; },
  _liquidHalfThickness() { return this.thickness / 2 - 4; },

  _initLiquid() {
    const halfL = this._liquidHalfLength();
    const n = this.liquidColumnCount;
    this.liquidColumns = [];
    for (let i = 0; i < n; i++) {
      const x = -halfL + (2 * halfL) * (i / (n - 1));
      this.liquidColumns.push({ x, level: 0, velocity: 0 });
    }
    this.liquidTime = 0;
  },

  // Runs the liquid sim in fixed ~1/60s substeps instead of one shot at
  // whatever `dt` the frame happened to be (Rob: "the fluid is going haywire
  // on mobile"). The spread pass already had a cap for exactly this reason
  // (see below) after an earlier desktop-only version of this bug blew up
  // numerically at large dt — but the *spring* integration was still running
  // at the raw per-frame `steps`, and mobile browsers regularly deliver much
  // larger/less consistent per-frame dt than the desktop preview (background
  // tab throttling, slower devices, general timing jitter), which reads as
  // visibly jumpy/unstable motion even where the hard clamps kept it from
  // fully exploding. Substepping means every individual update always runs
  // at the same small, known-stable dt this whole simulation was tuned at,
  // regardless of how choppy the real frame timing is.
  _updateLiquid(dt) {
    const maxStepDt = 1 / 60;
    const maxSubsteps = 6; // safety cap so a huge stall can't spin this in a loop
    let remaining = Math.min(dt, 0.1);
    let substeps = 0;
    while (remaining > 0 && substeps < maxSubsteps) {
      const stepDt = Math.min(remaining, maxStepDt);
      this._stepLiquid(stepDt);
      remaining -= stepDt;
      substeps++;
    }
  },

  _stepLiquid(dt) {
    const steps = dt * 60; // constants tuned per-frame at ~60fps, like the physics elsewhere
    const halfT = this._liquidHalfThickness();
    const tanA = Math.tan(this.angleRad);
    const cols = this.liquidColumns;
    this.liquidTime += dt;

    // Spring each column toward "where real gravity puts the surface here", plus a
    // gentle traveling ripple so the liquid never looks perfectly frozen even when
    // the tube's angle is momentarily steady.
    for (const col of cols) {
      const gravityTarget = clamp(-col.x * tanA, -halfT, halfT);
      const ripple = Math.sin(this.liquidTime * this.liquidAmbientSpeed + col.x * 0.012) * this.liquidAmbientAmplitude;
      const target = clamp(gravityTarget + ripple, -halfT, halfT);
      col.velocity += (target - col.level) * this.liquidTension * steps;
      col.velocity *= Math.pow(1 - this.liquidDamping, steps);
      col.level += col.velocity * steps;
    }

    // Spread pass — propagate each column's motion to its neighbors so a change
    // travels across the surface as a wave instead of every column moving in
    // lockstep independence. This is an explicit diffusion-style update, which
    // only stays numerically stable if spread*steps stays well under 1 — with 4
    // passes compounding each other, an uncapped `steps` (which can spike to 3 at
    // MAX_DT after any frame stall/tab-throttle) blew this up exponentially (levels
    // reaching ~1e136). Cap the steps used here specifically, separate from the
    // main spring integration above which doesn't have this stability problem.
    const spreadSteps = Math.min(steps, 1);
    for (let pass = 0; pass < this.liquidSpreadPasses; pass++) {
      const leftDelta = new Array(cols.length).fill(0);
      const rightDelta = new Array(cols.length).fill(0);
      for (let i = 0; i < cols.length; i++) {
        if (i > 0) {
          leftDelta[i] = this.liquidSpread * (cols[i].level - cols[i - 1].level) * spreadSteps;
          cols[i - 1].velocity += leftDelta[i];
        }
        if (i < cols.length - 1) {
          rightDelta[i] = this.liquidSpread * (cols[i].level - cols[i + 1].level) * spreadSteps;
          cols[i + 1].velocity += rightDelta[i];
        }
      }
      for (let i = 0; i < cols.length; i++) {
        if (i > 0) cols[i - 1].level += leftDelta[i];
        if (i < cols.length - 1) cols[i + 1].level += rightDelta[i];
      }
    }

    // Defensive backstop — physically nothing should ever put the surface much
    // beyond the tube's walls, so clamp hard rather than let any future edge case
    // (or another dt spike this analysis missed) silently blow up again.
    const maxLevel = halfT * 3;
    const maxVelocity = 4000;
    for (const col of cols) {
      col.level = clamp(col.level, -maxLevel, maxLevel);
      col.velocity = clamp(col.velocity, -maxVelocity, maxVelocity);
    }
  },

  // Called while already translated+rotated to the platform's local space (origin
  // at the pivot, +X along the bar). Tube4.png is a fully opaque "empty tube" image,
  // so the liquid is drawn as a clipped overlay on top of it rather than behind it.
  _drawLiquid(ctx) {
    const halfL = this._liquidHalfLength();
    const halfT = this._liquidHalfThickness();
    const cols = this.liquidColumns;
    if (!cols.length) return;

    ctx.save();
    roundRectPath(ctx, -halfL, -halfT, halfL * 2, halfT * 2, halfT);
    ctx.clip();

    // Fill polygon, surface edge smoothed through quadratic curves between column
    // midpoints (a plain lineTo-per-column polyline looked faceted/segmented —
    // "jumpy" — especially with a coarse column count).
    ctx.beginPath();
    ctx.moveTo(cols[0].x, halfT);
    ctx.lineTo(cols[0].x, cols[0].level);
    smoothCurveThrough(ctx, cols);
    ctx.lineTo(cols[cols.length - 1].x, halfT);
    ctx.closePath();

    // Liquid color follows the current tube heat stage (cool purple → fire red-pink),
    // lerped smoothly by Difficulty rather than snapping between stages.
    const [tr, tg, tb] = Difficulty.tubeColor;
    const grad = ctx.createLinearGradient(0, -halfT, 0, halfT);
    grad.addColorStop(0, `rgba(${lighten(tr, 90)}, ${lighten(tg, 90)}, ${lighten(tb, 20)}, 0.9)`);
    grad.addColorStop(0.35, `rgba(${tr | 0}, ${tg | 0}, ${tb | 0}, 0.95)`);
    grad.addColorStop(1, `rgba(${darken(tr, 0.55)}, ${darken(tg, 0.55)}, ${darken(tb, 0.55)}, 0.92)`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Bright surface shine, faded by depth rather than a hard on/off cutoff — a
    // binary threshold made whole segments pop in and out of existence as columns
    // crossed it, which read as the liquid "jumping" instead of moving smoothly.
    // Drawn as short per-segment strokes so each one can carry its own opacity.
    // Tinted toward the liquid's own color (was flat near-white) and blended
    // with 'screen' instead of a plain overwrite, so it reads as a soft
    // reflection *of* the liquid rather than a separate white line sitting on
    // top of it (Rob's ask).
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const maxDepth = halfT * 2;
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i], b = cols[i + 1];
      const depthA = halfT - a.level, depthB = halfT - b.level;
      const depth = Math.min(depthA, depthB);
      const alpha = smoothstep(0, maxDepth * 0.22, depth) * 0.45; // darker still (Rob) — was 0.9, then 0.7
      if (alpha <= 0.01) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.level);
      ctx.lineTo(b.x, b.level);
      ctx.strokeStyle = `rgba(${lighten(tr, 150)}, ${lighten(tg, 150)}, ${lighten(tb, 150)}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  },

  // A glass layer drawn *in front of* the liquid — a subtle shadow along the lower
  // inside edge and a brighter shine streak near the top, both semi-transparent, so
  // the liquid reads as sitting inside/behind glass rather than being the top-most
  // surface. The shine drifts very slightly side to side as the tube rotates (a
  // cheap parallax cue, matching how the original's TubeHighlight layer nudged
  // itself based on Platform.Angle()) instead of sitting perfectly static.
  _drawGlass(ctx, images) {
    const parallax = -this.angle * 3;
    if (images.tubeShadow) {
      ctx.globalAlpha = 0.8;
      ctx.drawImage(images.tubeShadow, -this.length / 2, -this.thickness / 2, this.length, this.thickness);
    }
    if (images.tubeHighlight) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(images.tubeHighlight, -this.length / 2 + parallax, -this.thickness / 2, this.length, this.thickness);
    }
    ctx.globalAlpha = 1;
  },
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function smoothstep(lo, hi, v) {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

// Smooths a polyline by drawing quadratic curves through the midpoints of each
// consecutive pair of points, using the points themselves as control points —
// the standard cheap way to turn a coarse point sequence into a soft curve.
function smoothCurveThrough(ctx, pts) {
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].level + pts[i + 1].level) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].level, midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.level);
}

function lighten(v, amt) { return Math.min(255, Math.round(v + amt)) | 0; }
function darken(v, factor) { return Math.round(v * factor) | 0; }

// Rounded-rect path helper (drawn manually rather than relying on ctx.roundRect
// for wider browser support).
function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
