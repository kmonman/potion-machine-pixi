// Stage 3: the escalating-difficulty systems. The "moon" phase (tilt multiplier
// + overlay — Free Play only) still runs off this hand-authored script of timed
// phases (lifted verbatim from the original project's embedded JSON), unchanged.
// Tube heat/color used to come from this same script's `tube` field, shared by
// one global Difficulty object — now that each platform in the tower has its own
// independent liquid, tube progression moved to its own per-platform schedule
// (see TUBE_STAGE_SCHEDULE below, and platform.js's _updateTube) instead. The
// `tube` field in each phase below is unused dead data now, left in place rather
// than reworking this whole script just to strip one field out of it.
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
// Down to 3 stages (Rob: three blues — Warm/Hot/Fire — read as too similar/
// confusing; dropped the middle one so there's just one light blue and one
// dark blue left). 'Hot' removed entirely rather than left dead — nothing
// else reads TUBE_STAGE_PARAMS.Hot (unlike MOON_STAGE_PARAMS.Hot below,
// which is the separate global moon-phase system and unaffected by this —
// Rob's ask was about the tube specifically).
const TUBE_STAGE_PARAMS = {
  Cool: { grip: 0.90, tiltForce: 1, color: [255, 0, 195] }, // #ff00c3
  Warm: { grip: 0.78, tiltForce: 0.85, color: [126, 190, 252] }, // #7ebefc — light blue
  Fire: { grip: 0.40, tiltForce: 0.6, color: [0, 104, 255] }, // #0068ff — dark blue
};

// Each platform's tube runs its own copy of this schedule (see platform.js's
// _updateTube), each at its own speed (createPlatform's `tubeSpeed` option —
// set per platform in ui.js's _buildTower) so the tower's 3 tubes drift out of
// sync with each other instead of all matching color in lockstep. Much slower
// and more front-loaded toward Cool/Warm than the old FREE_PLAY_PHASES tube
// progression was (Rob: start with cool and warm, some hot later, fire much
// later). Cool is the base/home color the schedule keeps returning to and
// spends most of its time at (Rob) rather than an equal rotation through all
// stages — of a 244s cycle, Cool alone accounts for 180s (~74%), Warm 30s,
// Fire 34s. The two former 'Hot' entries (12s each) now just run Fire a
// little earlier/longer instead of a separate mid-blue stage — same overall
// pacing/cycle length as before, one fewer color in it.
const TUBE_STAGE_SCHEDULE = [
  { duration: 45, stage: 'Cool' },
  { duration: 15, stage: 'Warm' },
  { duration: 40, stage: 'Cool' },
  { duration: 15, stage: 'Warm' },
  { duration: 35, stage: 'Cool' },
  { duration: 12, stage: 'Fire' },
  { duration: 30, stage: 'Cool' },
  { duration: 22, stage: 'Fire' },
  { duration: 30, stage: 'Cool' },
];

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
const JET_IMPULSE_VY = -306; // px/s kick applied to the ball — 15% down from -360 (Rob: tilt force reduction should carry over to every force on the ball)
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
// `allowedIndices` restricts which of the 4 mount points (see JET_DEFS: 0/1 are
// the outer left/right jets, 2/3 the inner ones) this platform's jets are ever
// allowed to use — Rob wants the middle platform down to just its outer-left
// jet and the top platform down to just its outer-right jet, with the rest
// permanently off, rather than all 4 independently randomizing like the base
// platform still does.
function createJetSystem(opts = {}) {
  const allowedIndices = opts.allowedIndices || [0, 1, 2, 3];
  return {
    jets: JET_DEFS.map(() => ({ x: 0, y: 0, active: false, wasInRange: false, particles: [], spawnTimer: 0, toggleTimer: 0 })),
    jetCooldown: 0,
    // Exposed so code outside this closure (ui.js's tower-building, when
    // precomputing each platform's preferredIndex) can see which mounts
    // this platform is even allowed to use.
    allowedIndices,
    // Level-scoped jet rules (Rob: cap how many of a platform's jets can be
    // on at once, and on early levels bias the single allowed one toward
    // whichever mount is closest to the next platform up) — set externally
    // by PlayScreen.enter() each run (see ui.js's _jetTierForLevel), null
    // in Free Play. null keeps the original fully-independent per-jet
    // toggling below untouched, rather than risk changing Free Play's feel
    // to build this. Shape: { maxConcurrent, preferredIndex, directionalBias }.
    levelConfig: null,
    groupToggleTimer: 0,
    // Anti-stuck tracking for the "random" (non-directional-bias) tier — see
    // _updateCoordinated below.
    _lastJetIndex: null,
    _sameSideStreak: 0,

    reset() {
      this.jets = JET_DEFS.map(() => ({
        x: 0, y: 0, active: false, wasInRange: false, particles: [], spawnTimer: 0,
        toggleTimer: 1 + Math.random() * 3,
      }));
      this.jetCooldown = 0;
      this.groupToggleTimer = 1 + Math.random() * 3;
      this._lastJetIndex = null;
      this._sameSideStreak = 0;
    },

    // `scale` is the owning platform's visualScale — jet mount distances are
    // defined for the base platform's full-size bar, so a smaller platform
    // needs its jets pulled in proportionally or they'd hang off past the end
    // of its (now shorter) bar.
    update(dt, pivot, dir, scale = 1) {
      if (this.levelConfig) this._updateCoordinated(dt);
      else this._updateIndependent(dt);

      for (let i = 0; i < this.jets.length; i++) {
        const jet = this.jets[i];
        const distance = jet.active ? JET_DEFS[i].activeDistance * scale : JET_PARKED_DISTANCE;
        // -22, not -25 — moved down a couple pixels (Rob).
        jet.x = pivot.x + dir.x * distance;
        jet.y = pivot.y + dir.y * distance - 22;
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

    // Original behavior, untouched (Free Play only — see levelConfig
    // above): each allowed mount independently rolls its own on/off on its
    // own timer, no coordination or cap between them.
    _updateIndependent(dt) {
      for (let i = 0; i < this.jets.length; i++) {
        const jet = this.jets[i];
        if (allowedIndices.includes(i)) {
          jet.toggleTimer -= dt;
          if (jet.toggleTimer <= 0) {
            jet.toggleTimer = 1.5 + Math.random() * 3.5;
            jet.active = Math.random() < 0.45; // independently on/off, roughly ~2 of 4 active at a time
          }
        } else {
          jet.active = false; // this platform never uses this mount point
        }
      }
    },

    // Levels: at most levelConfig.maxConcurrent of this platform's
    // allowedIndices are ever on at once, re-rolled as a group on a shared
    // timer instead of each mount independently flipping its own coin (Rob:
    // caps of 2 on the base/"big" platform and 1 on every other/"small" one
    // for Levels 1-7, 3 on the big platform from Level 8 on). When
    // directionalBias is on (Levels 1-3), the active set is always just
    // levelConfig.preferredIndex — the mount closest to the next platform
    // up (see ui.js's _buildTower) — instead of a random pick among
    // whatever's allowed.
    //
    // Once bias is off (Level 4+), a single-jet platform picking purely
    // independently at random could still land on the same (unhelpful) side
    // many cycles in a row by pure chance — Rob caught this: "the jet only
    // stays on the left side... it can be maybe two times on one side, then
    // one side on the other, but it can't always be on one side." Tracked
    // with _lastJetIndex/_sameSideStreak so a 3rd consecutive repeat is
    // disallowed — forced to switch instead of re-rolled, so it's a real
    // guarantee, not just an unlikely coincidence to avoid.
    _updateCoordinated(dt) {
      this.groupToggleTimer -= dt;
      if (this.groupToggleTimer <= 0) {
        this.groupToggleTimer = 1.5 + Math.random() * 3.5;
        const { maxConcurrent, preferredIndex, directionalBias } = this.levelConfig;
        let activeSet;
        if (directionalBias && preferredIndex != null) {
          activeSet = [preferredIndex];
        } else if (maxConcurrent === 1 && allowedIndices.length > 1) {
          let picked;
          if (this._sameSideStreak >= 2) {
            picked = allowedIndices.find((i) => i !== this._lastJetIndex) ?? allowedIndices[0];
          } else {
            picked = allowedIndices[Math.floor(Math.random() * allowedIndices.length)];
          }
          this._sameSideStreak = picked === this._lastJetIndex ? this._sameSideStreak + 1 : 1;
          this._lastJetIndex = picked;
          activeSet = [picked];
        } else {
          const shuffled = allowedIndices.slice().sort(() => Math.random() - 0.5);
          activeSet = shuffled.slice(0, Math.min(maxConcurrent, allowedIndices.length));
        }
        for (let i = 0; i < this.jets.length; i++) {
          this.jets[i].active = activeSet.includes(i);
        }
      }
    },
  };
}

// Global run-wide difficulty (tube heat, moon phase, tilt feel) — stays a single
// shared progression regardless of which platform the ball is on, since it
// represents the overall run's difficulty ramping over time, not a per-platform
// thing. Jets are the part that's per-platform now (see createJetSystem above).
// Global run-wide moon phase only now — tube heat/grip/tilt-force/color moved
// to being per-platform (see TUBE_STAGE_SCHEDULE above and platform.js's
// _updateTube), since each platform's liquid is independent. Moon stays global
// since there's only one ball and the tilt-feel/overlay it drives applies to
// the ball regardless of which platform it's currently on.
const Difficulty = {
  phaseIndex: 0,
  phaseTimer: 0,
  phaseDuration: 0,

  moonStage: 'Cool',
  moonTiltMultiplier: 1,

  ballOpacity: 1,
  ballOpacityTarget: 1,
  moonOpacity: 0,
  moonOpacityTarget: 0,

  reset() {
    this.phaseIndex = 0;
    this.phaseTimer = 0;
    this.phaseDuration = FREE_PLAY_PHASES[0].duration;
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
    this.ballOpacity += (this.ballOpacityTarget - this.ballOpacity) * lerpSpeed;
    this.moonOpacity += (this.moonOpacityTarget - this.moonOpacity) * lerpSpeed;
  },

  _applyPhase(phase) {
    this.moonStage = phase.moon;
    const moonParams = MOON_STAGE_PARAMS[phase.moon];
    this.moonTiltMultiplier = moonParams.multiplier;
    this.moonImageKey = moonParams.image;
    this.ballOpacityTarget = moonParams.image ? 0.4 : 1;
    this.moonOpacityTarget = moonParams.image ? 1 : 0;
  },
};
