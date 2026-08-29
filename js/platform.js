// The see-saw platform (a rotating bar mounted on a fixed pole in the base case, or
// just floating for the platforms stacked above it — see `hasPole`). Not a physics
// object itself — its angle is driven by a smooth tween that continuously retargets
// to a new random angle every 3 seconds. Ball physics (physics.js) reads a platform's
// `angle` each frame to know what it's balancing on.
//
// Was a single global `Platform` object through Phase 1 (one platform on screen at a
// time). For the multi-platform tower (Rob: "each platform should have the same base
// properties but function independently") this is now a factory — `createPlatform()`
// — so each platform in the tower gets its own pivot, tween, liquid, and hinge glow/
// particle state, ticking on its own rather than sharing one global simulation.

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// How close the ball needs to be to a platform for that platform's purely
// decorative effects (ambient hinge smoke/sparks, jets) to keep running —
// Rob: "turn those off" once the tower grew to 12 platforms, since these
// previously ran unconditionally on EVERY platform every frame regardless
// of where the ball actually was (12 platforms' worth of ambient particles,
// all the time, for the whole game, is real constant background work that
// only existed for a handful of platforms originally). 800px comfortably
// covers everything the camera can actually show around the ball (it pans
// to keep the ball ~760px from the top of the 1280-tall canvas — see
// PlayScreenPixi._updateCamera), so nothing visibly freezes mid-screen;
// only platforms genuinely off-camera pause. Core state that stays visible
// or affects gameplay from a distance (angle tween, tube color/liquid
// slosh, the hinge glow's own touch-reactive brightness) is untouched.
const PARTICLE_ACTIVE_DIST_SQ = 800 * 800;

function createPlatform(pivotX, pivotY, opts = {}) {
  // Two independent size knobs: `scale` shrinks everything about a platform
  // uniformly (thickness, hinge sprite/glow, the works) — Rob tried this at
  // 0.6 for the top/middle platforms and reverted it. `lengthScale` only
  // narrows how far the tube stretches left/right, leaving its thickness and
  // the hinge completely alone (Rob's actual ask). Scaling these here (not
  // just the Pixi rendering) means Physics's collision math, which reads
  // length/thickness/hingeRingRadius directly, automatically matches whatever
  // size actually gets drawn.
  const scale = opts.scale ?? 1;
  const lengthScale = opts.lengthScale ?? 1;
  // How fast this platform's own tube-heat schedule (TUBE_STAGE_SCHEDULE, in
  // difficulty.js) runs — 1 = normal, <1 = slower, >1 = faster. Different per
  // platform (set in ui.js's _buildTower) so the tower's 3 tubes change color
  // at different intervals instead of all moving in lockstep (Rob).
  const tubeSpeed = opts.tubeSpeed ?? 1;
  // This platform's own designed pacing, kept separate from the live
  // `tubeSpeed` field below — PlayScreen.enter() rescales `tubeSpeed` off of
  // this every run (higher Levels want more frequent color changes, per
  // Rob: "rare in level 1, should become more common as the game
  // progresses, but very gradual"), and needs an untouched original to scale
  // from rather than compounding onto whatever last run left it at.
  const baseTubeSpeed = tubeSpeed;
  return {
    pivot: { x: pivotX, y: pivotY },
    visualScale: scale,
    lengthScale,
    // Shortened from the original's 674 (Rob's phone test: the tube reached close
    // enough to the screen edges that the ball couldn't actually fall down the gap
    // between the tube's end and the side wall). Widened back up 520→620 (Rob: felt
    // too small) — the 100px fall-through margin (Physics._checkBoundaries) still
    // gives room to drop.
    length: 620 * scale * lengthScale,
    thickness: 52 * scale,
    // The sprite's own outer ring (Hinge.png), measured directly from the asset
    // pixels: it sits at radius 42-49 of the 100x100 source, scaled to the 112px
    // display size (×1.12) → ~47-55. Used as the outer edge so Physics's "touching"
    // threshold lines up with where the ball visually reaches this real ring.
    hingeRingRadius: 55 * scale,

    // Only the base/ground platform gets a pole (Rob: the stacked platforms above it
    // are just floating bars, not mounted on their own post down to the ground).
    hasPole: !!opts.hasPole,
    poleHeight: 630,

    // This platform's own tube-heat progression (color, grip, tilt-force) —
    // see _updateTube below and TUBE_STAGE_SCHEDULE in difficulty.js. Used to
    // be one value shared by the whole run; now each platform's liquid heats
    // up independently, on its own schedule at its own tubeSpeed.
    tubeSpeed,
    baseTubeSpeed,
    tubeStage: 'Cool',
    tubePhaseIndex: 0,
    tubePhaseTimer: 0,
    grip: TUBE_STAGE_PARAMS.Cool.grip,
    tiltForce: TUBE_STAGE_PARAMS.Cool.tiltForce,
    tubeColor: TUBE_STAGE_PARAMS.Cool.color.slice(),
    tubeColorTarget: TUBE_STAGE_PARAMS.Cool.color.slice(),

    angle: 0, // degrees; positive = right end tilts down
    startAngle: 0,
    targetAngle: 0,
    tweenDuration: 3,
    tweenElapsed: 0,
    timer: 0,
    direction: 1,

    // Hinge glow + emitters + sparkle burst while the ball is touching THIS
    // platform's hinge. `touching` is set externally by Physics each frame (it
    // checks the ball's distance against every platform in the tower, not just
    // one) rather than read from a single global flag like the Phase 1 version.
    hingeGlow: 0, // 0 = idle, 1 = touched — brighter/warmer at 1, not dimmer
    hingeMagicParticles: [],
    hingeMagicTimer: 0,
    hingeSparkParticles: [],
    hingeSparkTimer: 0,
    touching: false,

    // ---------- Liquid: a "2D water" column simulation ----------
    // Springs between a row of surface columns, tension pulls each column toward a
    // target, damping bleeds energy, and a spread pass propagates changes to
    // neighbors so disturbances ripple as a wave. The per-column target isn't "flat
    // relative to the tube" — it's "flat relative to real gravity" re-expressed in
    // the tube's own rotated local coordinates, plus a small ambient ripple so the
    // surface never looks frozen.
    liquidColumns: [],
    liquidColumnCount: 48,
    liquidTension: 0.22,
    liquidDamping: 0.10,
    liquidSpread: 0.28,
    liquidSpreadPasses: 4,
    liquidAmbientAmplitude: 2.2,
    liquidAmbientSpeed: 1.6,
    liquidTime: 0,

    // Padding between the liquid and the tube's own edges.
    _liquidHalfLength() { return this.length / 2 - 6; },
    _liquidHalfThickness() { return this.thickness / 2 - 4; },

    reset() {
      this.angle = 0;
      // Fixed at 1, not randomized — every platform starts tilting the same
      // way (Rob: the tubes should all start off moving in the same
      // direction), same as before this was ever a multi-platform question.
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
      this.touching = false;
      this.tubePhaseIndex = 0;
      this.tubePhaseTimer = 0;
      this._applyTubeStage(TUBE_STAGE_SCHEDULE[0].stage);
      this.tubeColor = TUBE_STAGE_PARAMS[this.tubeStage].color.slice();
      this._initLiquid();
    },

    _applyTubeStage(stage) {
      this.tubeStage = stage;
      const params = TUBE_STAGE_PARAMS[stage];
      this.grip = params.grip;
      this.tiltForce = params.tiltForce;
      this.tubeColorTarget = params.color.slice();
    },

    // This platform's own tube-heat schedule (see TUBE_STAGE_SCHEDULE in
    // difficulty.js) — runs at `tubeSpeed` (a per-platform multiplier on dt)
    // so the tower's 3 tubes change stage at different intervals rather than
    // all in lockstep (Rob).
    _updateTube(dt) {
      this.tubePhaseTimer += dt * this.tubeSpeed;
      const entry = TUBE_STAGE_SCHEDULE[this.tubePhaseIndex];
      if (this.tubePhaseTimer >= entry.duration) {
        this.tubePhaseTimer = 0;
        this.tubePhaseIndex = (this.tubePhaseIndex + 1) % TUBE_STAGE_SCHEDULE.length;
        this._applyTubeStage(TUBE_STAGE_SCHEDULE[this.tubePhaseIndex].stage);
      }
      // Smooth color transitions (~0.5s) rather than snapping.
      const lerpSpeed = Math.min(1, dt / 0.5);
      for (let i = 0; i < 3; i++) {
        this.tubeColor[i] += (this.tubeColorTarget[i] - this.tubeColor[i]) * lerpSpeed;
      }
    },

    // Straight-line distance check against the ball's actual live position
    // (Physics is a global, same as every other file reaching into it) —
    // gates the purely decorative effects below, see PARTICLE_ACTIVE_DIST_SQ.
    isNearBall() {
      const dx = Physics.x - this.pivot.x, dy = Physics.y - this.pivot.y;
      return (dx * dx + dy * dy) <= PARTICLE_ACTIVE_DIST_SQ;
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

      this._updateTube(dt);
      this._updateLiquid(dt);
      this._updateHinge(dt, this.isNearBall());
    },

    // `particlesActive` false pauses the ambient smoke/sparks below in
    // place (existing particles just stop advancing, not cleared) — they
    // pick back up exactly where they left off once the ball's back in
    // range. The glow brightness itself always runs regardless: it's cheap,
    // and needs to react the instant the ball actually touches.
    _updateHinge(dt, particlesActive) {
      // Dims quickly-ish while touched (~0.7s), brightens back a bit faster (~0.3s).
      const target = this.touching ? 1 : 0;
      const speed = target > this.hingeGlow ? 1 / 0.7 : 1 / 0.3;
      this.hingeGlow += (target - this.hingeGlow) * Math.min(1, dt * speed * 3);

      if (!particlesActive) return;

      // HingeMagic — ambient smoke, constant regardless of touch state (Rob).
      // `while`, not `if` — a slower/less consistent frame rate otherwise silently
      // caps the real spawn rate at the frame rate instead of the intended flow rate.
      // Capped at 15 (down from the single-platform version's 20) — this runs
      // nonstop on EVERY platform in the tower simultaneously now, not just one, so
      // a phone GPU crashed ("Aw, Snap!") on the fully uncapped version (Rob's
      // phone test). Skip-when-full rather than trimming the oldest, same reasoning
      // as HingeBubbles below.
      this.hingeMagicTimer -= dt;
      let magicGuard = 0;
      while (this.hingeMagicTimer <= 0 && magicGuard < 30) {
        this.hingeMagicTimer += 0.5; // flow=2/s
        magicGuard++;
        if (this.hingeMagicParticles.length < 15) {
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
      }
      for (const p of this.hingeMagicParticles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life += dt;
      }
      this.hingeMagicParticles = this.hingeMagicParticles.filter((p) => p.life < p.maxLife);

      // HingeSparks — fast radiating burst, constant at the full rate (Rob liked
      // how active it looked while touching and wants that always-on). Capped at
      // 30 (down from 40) for the same multi-platform-GPU-crash reason as
      // HingeMagic above.
      const sparkFlow = 60;
      this.hingeSparkTimer -= dt;
      let sparkGuard = 0;
      while (this.hingeSparkTimer <= 0 && sparkGuard < 30) {
        this.hingeSparkTimer += 1 / sparkFlow;
        sparkGuard++;
        if (this.hingeSparkParticles.length < 30) {
          const a = Math.random() * Math.PI * 2;
          const spawnR = Math.random() * 30;
          const force = 50 + Math.random() * 40;
          this.hingeSparkParticles.push({
            x: this.pivot.x + Math.cos(a) * spawnR, y: this.pivot.y + Math.sin(a) * spawnR,
            vx: Math.cos(a) * force, vy: Math.sin(a) * force,
            life: 0, maxLife: 0.2 + Math.random() * 0.8,
          });
        }
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

    // Runs the liquid sim in fixed ~1/60s substeps instead of one shot at whatever
    // `dt` the frame happened to be (Rob: "the fluid is going haywire on mobile").
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

      for (const col of cols) {
        const gravityTarget = clamp(-col.x * tanA, -halfT, halfT);
        const ripple = Math.sin(this.liquidTime * this.liquidAmbientSpeed + col.x * 0.012) * this.liquidAmbientAmplitude;
        const target = clamp(gravityTarget + ripple, -halfT, halfT);
        col.velocity += (target - col.level) * this.liquidTension * steps;
        col.velocity *= Math.pow(1 - this.liquidDamping, steps);
        col.level += col.velocity * steps;
      }

      // Spread pass — only stays numerically stable if spread*steps stays well
      // under 1, so it's capped separately from the main spring integration above.
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

      // Defensive backstop — clamp hard rather than let any edge case blow up.
      const maxLevel = halfT * 3;
      const maxVelocity = 4000;
      for (const col of cols) {
        col.level = clamp(col.level, -maxLevel, maxLevel);
        col.velocity = clamp(col.velocity, -maxVelocity, maxVelocity);
      }
    },
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function smoothstep(lo, hi, v) {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}
function lighten(v, amt) { return Math.min(255, Math.round(v + amt)) | 0; }
function darken(v, factor) { return Math.round(v * factor) | 0; }
