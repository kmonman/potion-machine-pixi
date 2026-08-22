// Stage 3: the escalating-difficulty systems. Free Play runs off a hand-authored
// script of timed "phases" (lifted verbatim from the original project's embedded
// JSON) — each one sets how hot the tube is, whether the "moon" is out, and which
// of 4 jets are firing. Level 1 will get its own (simpler, fixed-schedule) version
// later; for now both play modes share this since Level 1 doesn't have its own
// difficulty content built yet either.

const FREE_PLAY_PHASES = [
  { duration: 4, tube: 'Cool', moon: 'Cool', jets: [false, false, false, false] },
  { duration: 5, tube: 'Cool', moon: 'Cool', jets: [true, false, false, false] },
  { duration: 5, tube: 'Warm', moon: 'Cool', jets: [false, true, false, false] },
  { duration: 5, tube: 'Cool', moon: 'Warm', jets: [false, false, true, false] },
  { duration: 4, tube: 'Cool', moon: 'Cool', jets: [false, false, false, false] },
  { duration: 5, tube: 'Warm', moon: 'Warm', jets: [false, false, false, true] },
  { duration: 6, tube: 'Warm', moon: 'Cool', jets: [true, false, false, false] },
  { duration: 6, tube: 'Cool', moon: 'Warm', jets: [false, true, false, false] },
  { duration: 6, tube: 'Hot', moon: 'Cool', jets: [false, false, true, false] },
  { duration: 6, tube: 'Cool', moon: 'Hot', jets: [false, false, false, true] },
  { duration: 4, tube: 'Cool', moon: 'Cool', jets: [false, false, false, false] },
  { duration: 8, tube: 'Hot', moon: 'Hot', jets: [true, false, true, false] },
  { duration: 12, tube: 'Fire', moon: 'Cool', jets: [true, false, true, false] },
  { duration: 12, tube: 'Cool', moon: 'Fire', jets: [false, true, false, true] },
  { duration: 15, tube: 'Fire', moon: 'Fire', jets: [true, true, true, false] },
  { duration: 10, tube: 'Fire', moon: 'Cool', jets: [true, false, true, false] },
  { duration: 10, tube: 'Cool', moon: 'Fire', jets: [false, true, false, true] },
  { duration: 12, tube: 'Fire', moon: 'Fire', jets: [true, true, true, false] },
  { duration: 4, tube: 'Cool', moon: 'Cool', jets: [false, false, false, false] },
  { duration: 8, tube: 'Fire', moon: 'Cool', jets: [false, true, false, true] },
  { duration: 8, tube: 'Cool', moon: 'Fire', jets: [true, false, true, false] },
  { duration: 10, tube: 'Fire', moon: 'Fire', jets: [true, true, true, true] },
  { duration: 3, tube: 'Cool', moon: 'Cool', jets: [false, false, false, false] },
  { duration: 6, tube: 'Fire', moon: 'Cool', jets: [true, true, false, false] },
  { duration: 6, tube: 'Cool', moon: 'Fire', jets: [false, false, true, true] },
  { duration: 7, tube: 'Fire', moon: 'Fire', jets: [true, true, true, true] },
];

// "grip" is this port's single stand-in for the original's separate friction +
// linearDamping values (see CLAUDE.md — approximated by feel, not a unit-for-unit
// translation of GDevelop's Box2D numbers). tiltForce matches the original's own
// per-stage value directly since that one's just a multiplier, not physics-engine-specific.
const TUBE_STAGE_PARAMS = {
  Cool: { grip: 0.90, tiltForce: 1, color: [112, 43, 245] },
  Warm: { grip: 0.78, tiltForce: 0.85, color: [175, 31, 229] },
  Hot: { grip: 0.60, tiltForce: 0.7, color: [255, 0, 195] },
  Fire: { grip: 0.40, tiltForce: 0.6, color: [255, 0, 85] },
};

// Tilt multipliers toned down (Rob: "too much energy" at Fire) — was
// 1/1.5/2.5/4.
const MOON_STAGE_PARAMS = {
  Cool: { multiplier: 1, image: null },
  Warm: { multiplier: 1.25, image: 'moonWarm' },
  Hot: { multiplier: 2, image: 'moonHot' },
  Fire: { multiplier: 3, image: 'moonFire' },
};

// Jet mount points as a distance along the platform bar from the hinge (matches the
// original's ResetEmitter::onCreated switch — outer/middle mounts on each side).
// "Off" is parked far beyond the bar's length so the ball can never be near it,
// rather than a separate enabled flag — same trick the original used.
const JET_DEFS = [
  { activeDistance: -215 },
  { activeDistance: 215 },
  { activeDistance: -95 },
  { activeDistance: 95 },
];
const JET_PARKED_DISTANCE = 5000;
// Tuned down twice now — first pass (-700, 0.4s cooldown) was too strong and could
// re-fire almost back-to-back; second pass (-480, 0.3s) was still too high and
// Rob caught that a *time* cooldown alone still lets it hit repeatedly if the ball
// just sits near the jet (every 0.3s, over and over, as long as it lingers).
// Fixed for real by gating on entering the zone (see `wasInRange` below) instead
// of purely on a timer — one puff per pass through, not one puff per cooldown tick.
const JET_IMPULSE_VY = -360; // px/s kick applied to the ball
const JET_COOLDOWN = 0.2; // seconds — now just a safety debounce, not the main gate
const JET_CATCH_RADIUS = 25; // px, how close the ball's x needs to be to the jet's x
// With multiple platforms now sharing one world coordinate space, an x-only catch
// check can false-positive on a jet several platforms away that just happens to
// share an x coordinate while the ball is mid-flight past it. Added once platforms
// became instanced (Phase 2) — not needed back when only one platform existed.
const JET_CATCH_RADIUS_Y = 70;

// Each platform in the tower runs its own independent jets (Rob: platforms should
// "function independently", not share one global set) — flow/spawn/particle math
// unchanged from the original single-platform version, just no longer tied to the
// single scripted FREE_PLAY_PHASES schedule. Instead each jet flips on/off on its
// own randomized timer so platforms don't all pulse in lockstep.
function createJetSystem() {
  return {
    jets: JET_DEFS.map(() => ({ x: 0, y: 0, active: false, wasInRange: false, particles: [], spawnTimer: 0, toggleTimer: 0 })),
    jetCooldown: 0,

    reset() {
      this.jets = JET_DEFS.map(() => ({
        x: 0, y: 0, active: false, wasInRange: false, particles: [], spawnTimer: 0,
        toggleTimer: 1 + Math.random() * 3,
      }));
      this.jetCooldown = 0;
    },

    update(dt, pivot, dir) {
      for (let i = 0; i < this.jets.length; i++) {
        const jet = this.jets[i];
        jet.toggleTimer -= dt;
        if (jet.toggleTimer <= 0) {
          jet.toggleTimer = 1.5 + Math.random() * 3.5;
          jet.active = Math.random() < 0.45; // independently on/off, roughly ~2 of 4 active at a time
        }
        const distance = jet.active ? JET_DEFS[i].activeDistance : JET_PARKED_DISTANCE;
        jet.x = pivot.x + dir.x * distance;
        jet.y = pivot.y + dir.y * distance - 25;
      }

      if (this.jetCooldown > 0) this.jetCooldown = Math.max(0, this.jetCooldown - dt);

      for (const jet of this.jets) {
        if (jet.active) {
          const inRange = Math.abs(Physics.x - jet.x) < JET_CATCH_RADIUS && Math.abs(Physics.y - jet.y) < JET_CATCH_RADIUS_Y;
          // Fire only on the moment it *enters* the zone — a ball resting in the
          // zone for multiple frames only gets one puff, not one every cooldown tick.
          if (inRange && !jet.wasInRange && this.jetCooldown === 0) {
            Physics.vy = JET_IMPULSE_VY;
            this.jetCooldown = JET_COOLDOWN;
          }
          jet.wasInRange = inRange;

          // Real params, straight from the source project's own "Plasma1" particle
          // emitter: flow 100/s, force 300-600, life fixed 0.5s, size 80→20
          // (shrinks), color (40,80,160)→(64,0,128), alpha 1→0, additive,
          // zoneRadius 4, texture LightGlow.png.
          //
          // No particle cap here — the real GPU crash Rob hit turned out to be a
          // leak in the nozzle glow's gradient allocation (see pixi_playscreen.js),
          // not particle count; that's fixed now and the nozzle glow itself was
          // removed. A cap here (20, briefly) was inherited from the old Canvas 2D
          // single-platform version's *different* bottleneck (drawTintedParticle's
          // per-particle repaint cost), which doesn't apply to Pixi's native .tint
          // — capping it was making the stream read as thin/throttled instead of
          // continuous (Rob) for no actual performance reason.
          let spawnGuard = 0;
          jet.spawnTimer -= dt;
          while (jet.spawnTimer <= 0 && spawnGuard < 30) {
            jet.spawnTimer += 0.01; // flow=100/s
            spawnGuard++;
            const spread = (Math.random() - 0.5) * (2 * Math.PI / 180); // ~1° angle spread
            const force = 300 + Math.random() * 300;
            jet.particles.push({
              x: jet.x + (Math.random() - 0.5) * 4, // zoneRadius=4
              y: jet.y,
              vx: Math.sin(spread) * force,
              vy: -Math.cos(spread) * force,
              life: 0,
              maxLife: 0.5,
            });
          }
        } else {
          jet.wasInRange = false;
        }

        for (const p of jet.particles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life += dt;
        }
        jet.particles = jet.particles.filter((p) => p.life < p.maxLife);
      }
    },
  };
}

// Global run-wide difficulty (tube heat, moon phase, tilt feel) — stays a single
// shared progression regardless of which platform the ball is on, since it
// represents the overall run's difficulty ramping over time, not a per-platform
// thing. Jets are the part that's per-platform now (see createJetSystem above).
const Difficulty = {
  phaseIndex: 0,
  phaseTimer: 0,
  phaseDuration: 0,

  tubeStage: 'Cool',
  moonStage: 'Cool',
  tiltForce: 1,
  moonTiltMultiplier: 1,
  grip: 0.90,

  tubeColor: [112, 43, 245],
  tubeColorTarget: [112, 43, 245],
  ballOpacity: 1,
  ballOpacityTarget: 1,
  moonOpacity: 0,
  moonOpacityTarget: 0,

  reset() {
    this.phaseIndex = 0;
    this.phaseTimer = 0;
    this.phaseDuration = FREE_PLAY_PHASES[0].duration;
    this.tubeColor = [112, 43, 245];
    this.ballOpacity = 1;
    this.moonOpacity = 0;
    this._applyPhase(FREE_PLAY_PHASES[0]);
  },

  update(dt) {
    this.phaseTimer += dt;
    if (this.phaseTimer >= this.phaseDuration) {
      this.phaseTimer = 0;
      this.phaseIndex = (this.phaseIndex + 1) % FREE_PLAY_PHASES.length;
      this.phaseDuration = FREE_PLAY_PHASES[this.phaseIndex].duration;
      this._applyPhase(FREE_PLAY_PHASES[this.phaseIndex]);
    }

    // Smooth transitions (~0.5s) rather than snapping, matching the original's tweens.
    const lerpSpeed = Math.min(1, dt / 0.5);
    for (let i = 0; i < 3; i++) {
      this.tubeColor[i] += (this.tubeColorTarget[i] - this.tubeColor[i]) * lerpSpeed;
    }
    this.ballOpacity += (this.ballOpacityTarget - this.ballOpacity) * lerpSpeed;
    this.moonOpacity += (this.moonOpacityTarget - this.moonOpacity) * lerpSpeed;
  },

  _applyPhase(phase) {
    this.tubeStage = phase.tube;
    this.moonStage = phase.moon;

    const tubeParams = TUBE_STAGE_PARAMS[phase.tube];
    this.tiltForce = tubeParams.tiltForce;
    this.grip = tubeParams.grip;
    this.tubeColorTarget = tubeParams.color.slice();

    const moonParams = MOON_STAGE_PARAMS[phase.moon];
    this.moonTiltMultiplier = moonParams.multiplier;
    this.moonImageKey = moonParams.image;
    this.ballOpacityTarget = moonParams.image ? 0.4 : 1;
    this.moonOpacityTarget = moonParams.image ? 1 : 0;
  },
};
