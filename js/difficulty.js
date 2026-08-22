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

  jets: [],
  jetCooldown: 0,

  reset() {
    this.phaseIndex = 0;
    this.phaseTimer = 0;
    this.phaseDuration = FREE_PLAY_PHASES[0].duration;
    this.jets = JET_DEFS.map(() => ({ x: 0, y: 0, active: false, wasInRange: false, particles: [], spawnTimer: 0 }));
    this.jetCooldown = 0;
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

    this._updateJets(dt);
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

    phase.jets.forEach((active, i) => { this.jets[i].active = active; });
  },

  _updateJets(dt) {
    const p = Platform;
    for (let i = 0; i < this.jets.length; i++) {
      const jet = this.jets[i];
      const distance = jet.active ? JET_DEFS[i].activeDistance : JET_PARKED_DISTANCE;
      jet.x = p.pivot.x + p.dir.x * distance;
      jet.y = p.pivot.y + p.dir.y * distance - 25;
    }

    if (this.jetCooldown > 0) this.jetCooldown = Math.max(0, this.jetCooldown - dt);

    for (const jet of this.jets) {
      if (jet.active) {
        const inRange = Math.abs(Physics.x - jet.x) < JET_CATCH_RADIUS;
        // Fire only on the moment it *enters* the zone (wasn't in range last frame,
        // is now) — a ball resting in the zone for multiple frames only gets one
        // puff, not a puff every time the cooldown happens to clear.
        if (inRange && !jet.wasInRange && this.jetCooldown === 0) {
          Physics.vy = JET_IMPULSE_VY;
          this.jetCooldown = JET_COOLDOWN;
        }
        jet.wasInRange = inRange;

        // Real params, straight from the source project's own "Plasma1"
        // particle emitter (the object the ImpulseJet behavior is actually
        // attached to): flow 100/s, force 300-600 (fast!), life fixed 0.5s,
        // size 80→20 (shrinks), color (40,80,160)→(64,0,128), alpha 1→0,
        // additive, zoneRadius 4, texture LightGlow.png. My hand-guessed
        // version (slow drifting 2.5-5.5px dots) was nowhere close — this is a
        // tight, fast, large glowing column, not a lazy sprinkle.
        // `while` (not `if`) so a big/late frame catches up and spawns
        // several particles at once instead of just one — on a slower or
        // less consistent frame rate (mobile), `if` silently caps the real
        // spawn rate at however many frames actually render per second
        // instead of the intended 100/s, which is exactly why the jets read
        // thin/weak on the phone (Rob) even though nothing about the flow
        // rate itself changed. Capped so one huge stall can't spawn hundreds
        // at once.
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

  drawJets(ctx, images) {
    for (const jet of this.jets) {
      // Rising plasma column (see _updateJets) — drawn even after the jet
      // switches off so the last puffs finish rising instead of vanishing.
      // Real source colors/sizes: starts large (80px) and opaque, shrinks to
      // 20px and fades to nothing over its fixed 0.5s life, additive blend,
      // blue (40,80,160) fading toward purple (64,0,128).
      for (const p of jet.particles) {
        const t = p.life / p.maxLife;
        const size = (60 + (20 - 60) * t) * 0.85; // -15% (Rob: too fuzzy), base narrowed (Rob: skinnier at the base)
        const alpha = 1 - t;
        const col = [
          Math.round(40 + (64 - 40) * t),
          Math.round(80 + (0 - 80) * t),
          Math.round(160 + (128 - 160) * t),
        ];
        drawTintedParticle(ctx, images.jetParticle, p.x, p.y, size, col, alpha, true);
      }

      // Nozzle/vent effect at the base, right at the tube's top surface
      // (Rob: fixed — jet.y is already the top surface, ~25px above the
      // pivot centerline that +25 was wrongly pulling it back down to; and
      // "be creative, look at how real emitters do it" — layered like a
      // typical game VFX nozzle: soft lingering aura + a bright core flash +
      // a thin pulsing shockwave ring + a small upward fan of spark rays,
      // rather than one flat blob). PlayScreen.elapsed drives the pulse/
      // rotation so it isn't static.
      if (jet.active) {
        const bx = jet.x, by = jet.y;
        const t = PlayScreen.elapsed;
        const pulse = 0.5 + 0.5 * Math.sin(t * 6);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // Softened — the crisp rays/ring read too sharp and mechanical
        // against the rest of the game's blurry neon look (Rob).
        ctx.filter = 'blur(3px)';

        const aura = ctx.createRadialGradient(bx, by, 0, bx, by, 24);
        aura.addColorStop(0, 'rgba(120, 170, 255, 0.35)');
        aura.addColorStop(1, 'rgba(90, 140, 255, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(bx, by, 24, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(180, 210, 255, ${0.5 * (1 - pulse)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, 5 + pulse * 9, 0, Math.PI * 2);
        ctx.stroke();

        const angleCenter = -Math.PI / 2;
        const spread = 0.9;
        const rayCount = 5;
        ctx.strokeStyle = 'rgba(200, 220, 255, 0.5)';
        ctx.lineWidth = 1;
        for (let i = 0; i < rayCount; i++) {
          const a = angleCenter - spread + (2 * spread) * (i / (rayCount - 1)) + Math.sin(t * 2 + i) * 0.05;
          const len = 9 + pulse * 4;
          ctx.beginPath();
          ctx.moveTo(bx + Math.cos(a) * 3, by + Math.sin(a) * 3);
          ctx.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
          ctx.stroke();
        }

        const core = ctx.createRadialGradient(bx, by, 0, bx, by, 6);
        core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        core.addColorStop(0.5, 'rgba(180, 210, 255, 0.6)');
        core.addColorStop(1, 'rgba(180, 210, 255, 0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }
  },

  drawMoon(ctx, images) {
    if (this.moonOpacity < 0.02 || !this.moonImageKey) return;
    const img = images[this.moonImageKey];
    if (!img) return;
    const s = 70;
    ctx.save();
    ctx.globalAlpha = this.moonOpacity;
    // Spin with the ball's own rolling rotation — without this the moon overlay
    // sat static while the (now-faded) ball underneath kept rotating, so it looked
    // like the ball stopped rolling whenever a moon phase was active.
    ctx.translate(Physics.x, Physics.y);
    ctx.rotate(Physics.rotation);
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  },
};
