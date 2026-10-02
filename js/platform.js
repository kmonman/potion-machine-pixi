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
  // Shortened from the original's 674 (Rob's phone test: the tube reached close
  // enough to the screen edges that the ball couldn't actually fall down the gap
  // between the tube's end and the side wall). Widened back up 520→620 (Rob: felt
  // too small) — the 100px fall-through margin (Physics._checkBoundaries) still
  // gives room to drop.
  const baseLength = 620 * scale * lengthScale;
  // Optional length "breathing" (Rob: tubes that pulse large to small and
  // back) — { min, max, period } as fractions of this platform's own
  // baseLength, period in seconds for one full min->max->min cycle. Off by
  // default (opts.lengthPulse unset) so every other platform's length stays
  // exactly what it always was; deliberately length-only, not thickness —
  // thickness feeds the liquid sim's own vertical clamping every step (see
  // _stepLiquid), and pulsing it would mean reworking that alongside this,
  // for not much extra gameplay payoff. `length` itself becomes a live,
  // per-frame value (see update() below) instead of fixed at creation —
  // Physics's collision math (physics.js) already reads it fresh every
  // call, so a moving one is a live hazard/window with no code changes
  // needed there. A ball resting past where the tube has shrunk to just
  // stops being "on" it and falls — the intended fair-if-you're-not-
  // watching behavior, not a bug.
  const lengthPulse = opts.lengthPulse || null;
  // A level's finish line (Rob: "make the line there as if it were one of
  // the other platforms so the moon stone can land on it") — a real,
  // collidable platform like any other, just never tilts (see reset()/
  // update() below skipping the angle tween entirely for it) and has no
  // Pixi visual of its own (see pixi_playscreen.js's refresh() — the goal-
  // line art's own painted line stands in for it visually; this object only
  // needs to exist for Physics to have solid geometry there).
  const isGoal = !!opts.isGoal;
  return {
    isGoal,
    pivot: { x: pivotX, y: pivotY },
    visualScale: scale,
    lengthScale,
    baseLength,
    length: baseLength,
    lengthPulse,
    _pulsePhase: 0,
    // Rob: "make the tube skinnier, not shorter... that looks better, it
    // gives our game more space" — tried live at -30% then -10% more on top
    // (0.7 * 0.9 = 0.63 of the original 52px) before settling here, applied
    // globally to every tube/level rather than just the one being previewed.
    thickness: 52 * 0.63 * scale,
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
    // Per-level color theme (Rob: "what would a different per level
    // color identity look like, can we try one?" — started as just the
    // Cool stage, then "let's see how the next five will look with the
    // next theme" asked for the whole Cool/Warm/Fire progression to be
    // swappable per level band). An optional { Cool, Warm, Fire } map of
    // [r,g,b]s, set by ui.js's enter() before reset() each run — any
    // stage missing from the map (or the map itself being null) falls
    // back to TUBE_STAGE_PARAMS' own default for that stage, so a level
    // can theme all three stages or just leave them alone.
    stageColorOverride: null,

    angle: 0, // degrees; positive = right end tilts down
    startAngle: 0,
    targetAngle: 0,
    // Rob's revised spec (after catching that fully disabling a spent
    // platform's jets/movement could strand a run with no way up): a
    // platform that's already handed a charge to the ball keeps tilting,
    // keeps its jets, and can still contribute to a future charge — the
    // ONLY things that change are cosmetic (its liquid/hinge-bubbles turn
    // dark grey, see pixi_playscreen.js's _refreshLiquid/_refreshHinge)
    // and that sitting on its hinge no longer scores points (see ui.js's
    // own score-accrual line) — fixing the actual problem Rob was really
    // after (sit-and-farm scoring on one hinge forever) without touching
    // traversal at all. Set once by ui.js the instant THIS platform is
    // the one the ball is resting on when a charge completes.
    chargeSpent: false,
    tweenDuration: 3,
    tweenElapsed: 0,
    timer: 0,
    direction: 1,
    // Steepest this platform's tilt is ever randomized to (min stays fixed
    // at 5° — see the targetAngle formula in reset()/update()). 20 matches
    // the original always-on range; PlayScreen.enter() lowers this for
    // early Levels (Rob: "start at 10 for the low levels and work your way
    // up to 20 by level 5") so a new player gets a flatter, easier-to-
    // balance-on surface while learning, not the full range Free Play and
    // higher levels get.
    maxTiltAngle: 20,

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
    // Counts down from JET_GRACE_SECONDS (ui.js) while this platform ISN'T
    // the one Physics.currentPlatform points at — its jets keep running
    // until this hits 0, not the instant the ball leaves (Rob: "it
    // shouldn't stop immediately when the ball leaves it, because it could
    // be just bouncing"). Reset back to the full grace period every frame
    // this platform actually IS current (see PlayScreen.update()).
    jetGraceRemaining: 0,

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

    // Rob's liquid polish pass — small bubbles rising through the fill,
    // popping when they reach the real (wavy) surface. See
    // _updateLiquidBubbles/_refreshLiquidBubbles.
    liquidBubbles: [],
    liquidBubbleTimer: 0,
    // Foam — tiny flecks a popped bubble leaves behind, right at the
    // surface (Rob: "a little frothier at the surface so it looks like
    // there's something in the tube"). See _updateLiquidBubbles.
    liquidFoam: [],

    // Padding between the liquid and the tube's own edges.
    _liquidHalfLength() { return this.length / 2 - 6; },
    _liquidHalfThickness() { return this.thickness / 2 - 4; },

    reset() {
      this.angle = 0;
      this.chargeSpent = false;
      // Randomized per platform (Rob: "all of the platforms start off
      // leaning the same direction... some should start leaning to the
      // right and others should start leaning to the left") — was fixed at
      // 1 so every platform tilted the same way from the very first tween.
      this.direction = Math.random() < 0.5 ? 1 : -1;
      this.startAngle = 0;
      // A goal platform never picks a real target angle — it stays flat at
      // 0 forever (see update()'s matching guard).
      this.targetAngle = this.isGoal ? 0 : (5 + Math.random() * (this.maxTiltAngle - 5)) * this.direction;
      this.tweenElapsed = 0;
      this.timer = 0;
      this.hingeGlow = 0;
      this.hingeMagicParticles = [];
      this.hingeMagicTimer = 0;
      this.hingeSparkParticles = [];
      this.hingeSparkTimer = 0;
      this.touching = false;
      this.jetGraceRemaining = 0;
      this.tubePhaseIndex = 0;
      this.tubePhaseTimer = 0;
      this._applyTubeStage(TUBE_STAGE_SCHEDULE[0].stage);
      this.tubeColor = this.tubeColorTarget.slice();
      this._initLiquid();
      this.liquidBubbles = [];
      this.liquidBubbleTimer = 0.3 + Math.random() * 0.5;
      this.liquidFoam = [];
    },

    _applyTubeStage(stage) {
      this.tubeStage = stage;
      const params = TUBE_STAGE_PARAMS[stage];
      this.grip = params.grip;
      this.tiltForce = params.tiltForce;
      // Per-level theme override (see stageColorOverride's own comment) —
      // falls back to this stage's normal params.color when there's no
      // override at all, or this particular stage isn't in it.
      const override = this.stageColorOverride && this.stageColorOverride[stage];
      this.tubeColorTarget = override ? override.slice() : params.color.slice();
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
      // A goal platform stays flat — skip the tilt tween/re-roll entirely
      // rather than letting it wobble like a normal platform (it's meant to
      // read as solid ground to land the run on, not another obstacle).
      if (this.isGoal) { this._updateTube(dt); this._updateLiquid(dt); this._updateLiquidBubbles(dt, this.isNearBall()); return; }
      this.timer += dt;
      this.tweenElapsed = Math.min(this.tweenElapsed + dt, this.tweenDuration);
      const t = this.tweenElapsed / this.tweenDuration;
      this.angle = this.startAngle + (this.targetAngle - this.startAngle) * easeInOutSine(t);

      if (this.timer >= this.tweenDuration) {
        this.direction *= -1;
        this.startAngle = this.targetAngle;
        this.targetAngle = (5 + Math.random() * (this.maxTiltAngle - 5)) * this.direction;
        this.tweenElapsed = 0;
        this.timer = 0;
      }

      if (this.lengthPulse) {
        this._pulsePhase = (this._pulsePhase + dt) % this.lengthPulse.period;
        // Eased 0->1->0 (cosine, not linear) so it settles smoothly at each
        // end instead of reversing direction with a sudden velocity flip.
        const cyclePos = this._pulsePhase / this.lengthPulse.period;
        const eased = 0.5 - 0.5 * Math.cos(cyclePos * Math.PI * 2);
        const { min, max } = this.lengthPulse;
        this.length = this.baseLength * (min + (max - min) * eased);
      }

      this._updateTube(dt);
      this._updateLiquid(dt);
      this._updateLiquidBubbles(dt, this.isNearBall());
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

    // Interpolates the current (wavy) surface level at an arbitrary x —
    // used by the bubbles below to know when they've actually reached the
    // real surface at their own position, not just some fixed height.
    _liquidLevelAt(x) {
      const cols = this.liquidColumns;
      if (!cols.length) return 0;
      if (x <= cols[0].x) return cols[0].level;
      const last = cols[cols.length - 1];
      if (x >= last.x) return last.level;
      for (let i = 0; i < cols.length - 1; i++) {
        if (x >= cols[i].x && x <= cols[i + 1].x) {
          const f = (x - cols[i].x) / (cols[i + 1].x - cols[i].x);
          return cols[i].level + (cols[i + 1].level - cols[i].level) * f;
        }
      }
      return 0;
    },

    // Rob's liquid polish pass: "spawn low-opacity circular bubbles inside
    // the liquid body. Bubbles should rise with slight buoyant
    // acceleration, wobble horizontally... and match the tube's lateral
    // inertia. When a bubble crosses the dynamic surface curve, despawn it
    // with a tiny splash/pop effect." Gated on `particlesActive` (ball
    // nearby) same as the hinge smoke/sparks above — this runs on every
    // platform in the tower at once, so an always-on version would be the
    // same kind of GPU cost that already crashed a real phone once before
    // (see _updateHinge's own comment).
    _updateLiquidBubbles(dt, particlesActive) {
      if (!particlesActive) return;
      const halfT = this._liquidHalfThickness();
      const halfL = this._liquidHalfLength();

      this.liquidBubbleTimer -= dt;
      let spawnGuard = 0;
      while (this.liquidBubbleTimer <= 0 && spawnGuard < 20) {
        // Rob: "add a lot more bubbles with contrast because I can't see
        // them so small" — much faster supply (was 0.25-0.75s) so the tube
        // reads as actively bubbling rather than one at a time.
        this.liquidBubbleTimer += 0.08 + Math.random() * 0.14;
        spawnGuard++;
        // Capped (Rob's phone-crash lesson again) — still bounded per
        // tube, just raised a lot (9 → 22) alongside the faster spawn
        // rate and bigger size below, since "a lot more" was the ask.
        if (this.liquidBubbles.length < 22) {
          // Rob: "only make them on the outside of the tube" — real
          // carbonation nucleates at the glass, not out in open liquid.
          // Picks a wall (left or right) and starts close to it instead
          // of anywhere across the full width.
          const wall = Math.random() < 0.5 ? -1 : 1;
          const startX = wall * (halfL * 0.55 + Math.random() * halfL * 0.35);
          this.liquidBubbles.push({
            x: startX,
            y: halfT - 2, // starts near the tube's rounded base
            startY: halfT - 2,
            r: 1.5 + Math.random() * 2, // Rob: smaller — was 4-9, now 1.5-3.5
            speed: 18 + Math.random() * 14, // px/s rise (buoyancy, world-space)
            // Turbulence (Rob: "add some turbulence... so they're moving
            // around") — two independent jitter axes (not just
            // sideways), each its own frequency/phase so bubbles don't
            // all jitter in lockstep.
            turbPhaseX: Math.random() * Math.PI * 2,
            turbPhaseY: Math.random() * Math.PI * 2,
            turbFreqX: 3 + Math.random() * 4,
            turbFreqY: 3 + Math.random() * 4,
            turbAmp: 2 + Math.random() * 2,
            speedMod: 1,
            popping: false, popT: 0,
          });
        }
      }

      // Rob: "always move from the top of the tube towards the bottom as
      // the tube is shifting... flowing with the liquid." Buoyancy always
      // pulls a bubble straight UP IN WORLD SPACE, not "toward the
      // tube's own surface" — those only agree when the tube is level. A
      // real bubble in a tilted tube also gets carried sideways along the
      // tube by that same upward pull, toward whichever end is currently
      // higher in world space, exactly the way the liquid itself is
      // already being pulled toward the low end (see _stepLiquid's own
      // gravityTarget = -x*tanA). Decomposing world-up into this
      // platform's own rotated dir/normal axes gives that for free and
      // correctly reverses as the tube rocks the other way, instead of
      // the old fixed "drift toward whichever way tilted" hack.
      const angle = this.angleRad;
      const alongFromUp = -Math.sin(angle); // world-up's component along the tube's length
      const perpFromUp = -Math.cos(angle);  // world-up's component toward the surface
      // Rob: "only pop when there is space between the liquid and the
      // tube" — a bubble waiting under a spot where the wavy surface is
      // pressed right up against the tube's own top wall (near-zero
      // headspace, e.g. mid-slosh) has nowhere real to break through into,
      // so it just holds just under the surface instead of popping into
      // the glass; the instant that local headspace opens back up (as the
      // wave keeps moving) it pops normally.
      const minHeadspace = 5;
      for (let i = this.liquidBubbles.length - 1; i >= 0; i--) {
        const b = this.liquidBubbles[i];
        if (b.popping) {
          b.popT += dt;
          if (b.popT >= 0.18) this.liquidBubbles.splice(i, 1);
          continue;
        }
        b.turbPhaseX += b.turbFreqX * dt;
        b.turbPhaseY += b.turbFreqY * dt;
        // speedMod wanders slowly within [0.6, 1.6] via damped random
        // kicks — a plain random walk rather than a fixed pattern, so two
        // bubbles never rise in lockstep.
        b.speedMod = clamp(b.speedMod + (Math.random() * 2 - 1) * dt * 1.5, 0.6, 1.6);
        const rise = b.speed * b.speedMod;
        const surfaceY = this._liquidLevelAt(b.x);
        const headspace = surfaceY - (-halfT);
        if (headspace > minHeadspace) {
          b.x = clamp(b.x + alongFromUp * rise * dt, -halfL * 0.94, halfL * 0.94);
          b.y += perpFromUp * rise * dt;
        } // else: holds in place, just under the crest, until space opens
        // Turbulence on top of the real flow above — small, fast jitter
        // on both axes so the path reads chaotic/"moving around" rather
        // than one clean line, without overriding where the flow is
        // actually carrying it.
        b.x = clamp(b.x + Math.sin(b.turbPhaseX) * b.turbAmp * dt * 6, -halfL * 0.94, halfL * 0.94);
        b.y += Math.sin(b.turbPhaseY) * b.turbAmp * dt * 6;

        if (b.y <= surfaceY + 2 && headspace > minHeadspace) {
          b.popping = true;
          b.popT = 0;
          // Froth — 2-4 tiny flecks scattered right where the bubble
          // popped, each drifting its own short distance along the
          // surface before fading. A handful of these lingering longer
          // than the pop flash itself (0.18s) is what actually reads as
          // "something frothy going on" rather than one bubble winking
          // out at a time — capped well below the bubble cap since these
          // are purely decorative and there can be several alive from
          // different pops at once.
          if (this.liquidFoam.length < 18) {
            const count = 2 + Math.floor(Math.random() * 3);
            for (let f = 0; f < count && this.liquidFoam.length < 18; f++) {
              this.liquidFoam.push({
                x: b.x + (Math.random() * 2 - 1) * (b.r + 2),
                driftX: (Math.random() * 2 - 1) * 10, // px/s along the surface
                r: 0.8 + Math.random() * 1.4,
                life: 0, maxLife: 0.35 + Math.random() * 0.35,
              });
            }
          }
        }
      }

      for (let i = this.liquidFoam.length - 1; i >= 0; i--) {
        const f = this.liquidFoam[i];
        f.life += dt;
        if (f.life >= f.maxLife) { this.liquidFoam.splice(i, 1); continue; }
        f.x += f.driftX * dt;
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
