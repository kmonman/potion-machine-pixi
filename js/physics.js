// Ball physics — a small hand-rolled 2D solver (not a general physics engine; the
// only real interaction in this game is "one circle resting on one rotating bar",
// so a full library like Matter.js would be overkill — see CLAUDE.md's flagged
// GDevelop-Physics2-replacement decision).
//
// Gravity here isn't "the world tilts" — it's a constant downward pull plus a
// sideways push from the tilt sensor, same idea as the original's per-object
// custom gravity vector. The ball then either free-falls or rests on the platform
// depending on where it is relative to the bar.

const Physics = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  radius: 32,
  // The display sprite is drawn larger than the collision circle (see draw()),
  // so resting the ball using the collision radius alone left it visually
  // sunk ~3px into the platform's surface instead of sitting cleanly on top of
  // it (Rob's ask) — rest against the display size instead.
  get displayRadius() { return this.radius * 2.1875 / 2; },
  rotation: 0, // radians — visual spin, doesn't affect physics

  gravityY: 1500, // px/s^2, constant downward pull — was 900, felt too floaty (Rob's feedback)
  tiltAccel: 964, // px/s^2 at full tilt (tiltX = ±1) — 15% down from 1134, still felt too strong (Rob)
  airDamping: 0.999,

  // True if the ball is touching ANY platform's hinge (used for scoring — see
  // ui.js). Each individual platform also tracks its own `.touching` flag (set
  // below, in _checkHinge) so its own glow/particles react to whether the ball
  // is on THAT platform specifically, not just "some platform somewhere".
  touchingHinge: false,
  fellOff: false,
  platforms: [],
  // Whichever platform the ball is currently resting on (or last rested on) —
  // used for things that need "the platform under the ball" specifically, like
  // the Potion Blast's launch direction.
  currentPlatform: null,
  // True from the moment a Potion Blast launches until the ball actually
  // lands somewhere (see applyBlast / _resolvePlatformCollision) — lets the
  // camera tell "airborne mid-jump" apart from "resting on a platform"
  // (Rob: while jumping the camera should pan to follow the ball left/right
  // as it flies, then settle back on the landing platform's hinge once it's
  // down — distinct from the camera intentionally NOT chasing every wobble
  // while just resting/rolling on a platform).
  airborne: false,

  // Dark matter cloud hazard (Rob: "floating across the screen... if the
  // ball touches it, it automatically takes it, adds downward pressure").
  // ui.js owns the actual cloud objects (position/drift, same "set this
  // array, physics just reads it" convention `platforms` already uses) and
  // moves them each frame before calling Physics.update(); physics.js only
  // needs to know where they currently are to test the ball against, and
  // how to make the ball fall through solid ground once one's been touched.
  darkMatterClouds: [],
  // Non-null while a drop is in progress — lands on the very first real
  // platform reached below the origin platform (Rob: "let's just make the
  // ball fall back down to whatever the next platform it hits first").
  // Used to be a countdown of N platforms to skip ("one to two levels
  // down"), but that could carry the ball down multiple real platforms —
  // or, since a match still had to land inside a real catch window on a
  // given frame, let a fast enough drop blow through every remaining
  // platform's window and fall all the way to the bottom of the tower —
  // both of which made the hazard feel far harsher than intended. Simpler
  // now: it's just "is a drop active", cleared the moment any non-origin
  // platform is actually reached (see _resolvePlatformCollision).
  // null = not currently dropping.
  darkMatterSkipsRemaining: null,
  // The platform the ball was actually resting on at the moment of touch —
  // excluded from ever catching the drop (see _resolvePlatformCollision):
  // without this, the very first catch-eligible check right after the
  // touch would just match the platform the ball hasn't even left yet,
  // ending the drop before it ever really fell anywhere.
  _darkMatterOriginPlatform: null,
  // Extra downward acceleration (added on top of normal gravityY) applied
  // the whole time a drop is in progress — Rob's follow-up: an earlier
  // version snapped vy to a fixed speed the instant the ball touched the
  // cloud, which read as bouncing off its edge rather than the ball
  // "flowing into it". A continuous extra pull instead lets its existing
  // velocity carry through smoothly and just builds from there, so there's
  // no one-frame velocity discontinuity to read as a bounce.
  DARK_MATTER_EXTRA_GRAVITY: 2200,

  // Plasma storm fields (see ui.js's _createPlasmaStorm) — same "ui.js owns
  // them, physics just reads the array" convention as darkMatterClouds.
  // While the stone is inside one, it gets a small sideways push in the
  // storm's direction (see _plasmaStormAccel).
  plasmaStorms: [],

  reset(platforms) {
    this.platforms = platforms;
    // Drop from the center of the base platform (Rob) — same -140 offset as
    // the original single-platform version, just relative to platforms[0]
    // (the ground platform) instead of a single global Platform singleton.
    const base = platforms[0];
    this.x = base.pivot.x;
    this.y = base.pivot.y - 140;
    this.vx = 0;
    this.vy = 0;
    this.rotation = 0;
    this.touchingHinge = false;
    this.airborne = false;
    this.fellOff = false;
    this.currentPlatform = base;
    this.darkMatterSkipsRemaining = null;
    this._darkMatterOriginPlatform = null;
    for (const p of platforms) p.touching = false;
  },

  // Runs physics in fixed ~1/60s substeps instead of one shot at whatever
  // `dt` the frame happened to be — same fix as the liquid sim
  // (Platform._updateLiquid) and applied here for the same reason: at a big
  // single-frame dt (mobile's choppier/larger per-frame timing, or any
  // desktop stall), the ball can travel further in one step than the
  // platform bar is thick, so the discrete collision check in
  // _resolvePlatformCollision can miss it entirely and let it fall straight
  // through — a real "tunneling" bug, not just a feel issue. Substepping
  // keeps each individual position/collision update at the same small dt
  // this was tuned at, so it can't outrun its own collision check regardless
  // of how large or uneven the real frame time is.
  update(dt, tiltX) {
    if (this.fellOff) return;
    const maxStepDt = 1 / 60;
    const maxSubsteps = 6; // covers MAX_DT (1/20s) with headroom
    let remaining = Math.min(dt, 0.1);
    let substeps = 0;
    while (remaining > 0 && substeps < maxSubsteps && !this.fellOff) {
      const stepDt = Math.min(remaining, maxStepDt);
      this._step(stepDt, tiltX);
      remaining -= stepDt;
      substeps++;
    }
  },

  _step(dt, tiltX) {
    // --- integrate free motion ---
    // Tilt strength is scaled by the current difficulty stage — heat and moon
    // phases both make the controls twitchier, matching the original's combined
    // TiltForce * MoonTiltMultiplier. Tube heat is per-platform now (each tube
    // has its own schedule), so this reads whichever platform the ball is
    // currently on/last rested on — the same "which tube's heat currently
    // affects the ball" logic applyBlast already uses for launch angle. Moon
    // stays a single global multiplier (only one ball, applies regardless of
    // platform).
    const tiltForce = (this.currentPlatform || this.platforms[0]).tiltForce;
    const difficultyMultiplier = tiltForce * Difficulty.moonTiltMultiplier;
    // Rob: "when it flies in the air, I'm able to control it too much" — tilt
    // steering is cut in half for the whole flight, up or down, once a jump's
    // airborne; full strength only while actually resting on a platform.
    // Rob's follow-up: "reduce the force of the ball when on a platform by
    // 20%... it's hard to control" — grounded steering itself also eased off
    // a notch, independent of the airborne cut above (0.5 airborne is half of
    // this new 0.8 grounded baseline, not half of the old full strength).
    const airborneTiltMultiplier = this.airborne ? 0.5 : 0.8;
    const gx = tiltX * this.tiltAccel * difficultyMultiplier * airborneTiltMultiplier;
    // Extra pull while a dark matter drop is in progress — see
    // DARK_MATTER_EXTRA_GRAVITY's own comment for why this is a continuous
    // accel rather than a one-time velocity snap.
    const gy = this.gravityY + (this.darkMatterSkipsRemaining !== null ? this.DARK_MATTER_EXTRA_GRAVITY : 0);
    this.vx += (gx + this._plasmaStormAccel()) * dt;
    this.vy += gy * dt;
    const damp = Math.pow(this.airDamping, dt * 60);
    this.vx *= damp;
    this.vy *= damp;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Rolling without slipping: a ball moving at vx across a surface below it spins
    // at vx/radius. Using this continuously (not just while touching the platform)
    // also keeps it spinning sensibly through the air, which looks right too.
    this.rotation += (this.vx / this.radius) * dt;

    this._checkDarkMatterClouds();
    // Always runs, dropping or not — see _resolvePlatformCollision's own
    // darkMatterSkipsRemaining handling for how it lets N real landings
    // pass through untouched instead of just disabling collision checking
    // wholesale for a stretch (the earlier version's tunnel-off-the-tower bug).
    this._resolvePlatformCollision(dt);
    this._checkBoundaries();
    this._checkHinge();

    // Falls off once it drops well below the lowest (base) platform — was a
    // flat 1100 back when there was only one platform on a 1280-tall screen;
    // now expressed relative to the base platform's own pivot so it still
    // means the same thing (about 450px below the platform) regardless of
    // where the tower sits or how tall it is.
    const base = this.platforms[0];
    if (this.y > base.pivot.y + 448) {
      this.fellOff = true;
    }
  },

  // Sideways acceleration from any plasma storm the stone is inside.
  // Scaled by the storm's own visibility (so the push fades in/out with it
  // and is zero while it's hidden) and by how deep inside the storm the
  // stone is — full strength in the middle, tapering to nothing across the
  // storm's soft outer edges (the same edges its visuals fade out over), so
  // there's no sudden shove at an invisible boundary.
  _plasmaStormAccel() {
    let ax = 0;
    for (const s of this.plasmaStorms) {
      if (s.visibility <= 0) continue;
      const u = Math.abs(this.x - s.x) / (s.width / 2);
      const v = Math.abs(this.y - s.y) / (s.height / 2);
      if (u >= 1 || v >= 1) continue;
      const edge = Math.min(1, (1 - u) / 0.35) * Math.min(1, (1 - v) / 0.4);
      ax += s.dir * s.push * s.visibility * edge;
    }
    return ax;
  },

  // Rob: "when the ball hits the plasma... I try to manually bump it, and
  // it doesn't register" — a tap normally does nothing while airborne (see
  // ui.js's fireBlast, "you shouldn't be able to jump again until it lands
  // on something"), but that same rule was silently eating every attempt
  // to fight the storm's sideways push mid-flight, since the storm only
  // ever touches the ball while it's already airborne between platforms.
  // ui.js's fireBlast reads this to let a tap through as a special,
  // bigger-than-normal jump specifically while inside a storm, instead of
  // being blocked outright.
  insidePlasmaStorm() {
    for (const s of this.plasmaStorms) {
      if (s.visibility <= 0) continue;
      const u = Math.abs(this.x - s.x) / (s.width / 2);
      const v = Math.abs(this.y - s.y) / (s.height / 2);
      if (u < 1 && v < 1) return true;
    }
    return false;
  },

  // Simple AABB touch test against each drifting cloud (each one's own
  // {x, y, width, height} in world space, moved by ui.js every frame before
  // Physics.update runs). Only arms a fresh drop if one isn't already in
  // progress — touching a second cloud mid-fall doesn't stack/extend it.
  _checkDarkMatterClouds() {
    if (this.darkMatterSkipsRemaining !== null) return;
    for (const c of this.darkMatterClouds) {
      const halfW = c.width / 2 + this.displayRadius, halfH = c.height / 2 + this.displayRadius;
      if (Math.abs(this.x - c.x) < halfW && Math.abs(this.y - c.y) < halfH) {
        // Any non-null value just marks "a drop is active" now (see this
        // field's own comment) — true works as well as a count would.
        this.darkMatterSkipsRemaining = true;
        this._darkMatterOriginPlatform = this.currentPlatform;
        this.airborne = true;
        return;
      }
    }
  },

  // Checks every platform in the tower and resolves against whichever one the
  // ball actually overlaps — with real spacing between platforms only one
  // should ever match at a time, but looping all of them (there are only a
  // handful) is simpler and safer than trying to guess which one is "current"
  // ahead of time.
  _resolvePlatformCollision(dt) {
    for (const p of this.platforms) {
      const dir = p.dir;
      const normal = p.normal;
      const rx = this.x - p.pivot.x;
      const ry = this.y - p.pivot.y;

      const along = rx * dir.x + ry * dir.y;
      const perp = rx * normal.x + ry * normal.y;

      const restPerp = -(p.thickness / 2 + this.displayRadius);
      const halfLength = p.length / 2;

      // `perp > restPerp` alone has no upper bound, so it also matches a ball
      // that has already fallen well past the bar and ended up on the wrong
      // side of it — normally impossible without tunneling (which the
      // substepping in update() now prevents), but the platform keeps
      // rotating to a new angle every few seconds, and `along`/`perp` are
      // recomputed against whatever the *current* rotated bar is every frame.
      // A ball that fell off near one end can have the bar's tip swing back
      // toward its world position, remapping it back into "along the bar,
      // deeply overlapping" even though it's actually well below/behind the
      // bar now — which read as the ball getting "sucked back onto the
      // platform" instead of falling all the way down (Rob). Capping how deep
      // an overlap still counts as "resting" rejects that case while still
      // catching genuine landings.
      //
      // Was a flat full ball-radius (35px) — Rob: a jump that only grazed a
      // platform's edge at a shallow angle, and should have kept falling
      // past it, was instead getting snapped up onto the platform as a
      // "freebie" ("I don't want it to make it unless it literally makes it
      // to the top"). Down to a flat 8px fixed that, but broke fast/legit
      // landings instead — Rob: "the moon started just falling through the
      // platforms" right after the moon-charge system (bigger BIG_BLAST_FORCE,
      // faster ball) shipped. A ball moving fast enough covers more than 8px
      // in a single 1/60s substep, so it can step clean over that whole
      // window in one substep and never register perp inside it at all —
      // tunneling straight through, not a near-miss. The window has to
      // scale with how far the ball can actually travel in one substep
      // (velocity * dt) or a fast enough ball always finds some window too
      // narrow for it, no matter the constant. 8px stays the floor (still the
      // exact fix for the original slow-grazing "freebie" case), but never
      // shrinks smaller than one substep's worth of travel.
      const stepTravel = Math.hypot(this.vx, this.vy) * dt;
      const maxRestOverlap = restPerp + Math.max(8, stepTravel);
      // Decompose velocity into along-bar / into-bar components up front — the
      // into-bar sign is what makes this a jump-through platform (Rob): a
      // blast launches the ball up through a platform's underside on the way
      // to a higher one (vNormal < 0, moving away from the surface, in the
      // air), but the moment it's actually falling onto a platform's TOP from
      // above (vNormal >= 0, moving into the surface), that same platform is
      // solid ground and catches it normally. Without this direction check, a
      // ball rising through a platform's underside could get caught exactly
      // like landing on top of it, stopping the climb dead.
      let vAlong = this.vx * dir.x + this.vy * dir.y;
      let vNormal = this.vx * normal.x + this.vy * normal.y;
      // Goal platform's catch region is widened a bit past its real
      // halfLength (the stopper below still clamps the ball well inside
      // the visual tip) — a ball sliding fast enough while resting near
      // the very end could otherwise cross from "inside" to "past
      // halfLength" in a single substep and never register as caught at
      // all that frame, falling through right where it should have hit
      // the stopper instead.
      const alongLimit = p.isGoal ? halfLength + 40 : halfLength;
      if (vNormal >= 0 && Math.abs(along) <= alongLimit && perp > restPerp && perp < maxRestOverlap) {
        // Dark matter drop in progress (see _checkDarkMatterClouds). Rob:
        // "when the ball hits the moon cloud, let's just make the ball
        // fall back down to whatever the next platform it hits first" —
        // lands on the very first real platform reached below the origin,
        // rather than the old skip-N-platforms count (which could carry
        // the ball down multiple platforms — or, if a fast drop tunneled
        // past a match on a given frame, all the way to the bottom of the
        // tower). The origin platform (whatever the ball was resting on at
        // the moment of touch) still never counts, or the very next check
        // right after touching would just re-match it before the ball has
        // gone anywhere — clearing the drop state here and falling through
        // to the normal landing logic below is what actually catches it.
        if (this.darkMatterSkipsRemaining !== null) {
          if (p === this._darkMatterOriginPlatform) continue;
          this.darkMatterSkipsRemaining = null;
          this._darkMatterOriginPlatform = null;
        }
        // Push the ball back to rest on the surface.
        let clampedAlong = along;
        const clampedPerp = restPerp;

        if (vNormal > 0) vNormal = 0; // stop moving into the surface
        // grip is meant as "fraction of speed kept per second of contact"
        // (hotter tube = less grip = harder to control) — Math.pow(grip, dt)
        // makes that true regardless of frame rate. Reads p.grip directly
        // (this platform's own heat) now that each tube heats up
        // independently, rather than one grip shared by the whole run.
        vAlong *= Math.pow(p.grip, dt);

        // The goal platform (Rob: "once you get to the top... it can't
        // roll off of it") gets an invisible stopper a radius in from each
        // real end — otherwise the very next frame the ball rolls past
        // `halfLength` it stops matching the catch condition above
        // entirely and just falls straight through/off, same as rolling
        // off any other platform (the normal, intended behavior everywhere
        // else in the tower, left untouched). Bounces back rather than
        // going dead at the wall (Rob's follow-up: "instead of having it
        // just stop, have it bounce back the other way but still slowing
        // down") — same soft, energy-losing bounce _checkBoundaries' own
        // screen-edge wall already uses, not a full elastic reflection.
        if (p.isGoal) {
          const STOPPER_RESTITUTION = 0.4;
          const stopLimit = halfLength - this.displayRadius;
          if (clampedAlong > stopLimit) { clampedAlong = stopLimit; if (vAlong > 0) vAlong = -vAlong * STOPPER_RESTITUTION; }
          else if (clampedAlong < -stopLimit) { clampedAlong = -stopLimit; if (vAlong < 0) vAlong = -vAlong * STOPPER_RESTITUTION; }
        }

        this.x = p.pivot.x + dir.x * clampedAlong + normal.x * clampedPerp;
        this.y = p.pivot.y + dir.y * clampedAlong + normal.y * clampedPerp;
        this.vx = dir.x * vAlong + normal.x * vNormal;
        this.vy = dir.y * vAlong + normal.y * vNormal;
        this.currentPlatform = p;
        this.airborne = false;
        return;
      }
    }
  },

  // Lets the ball drift off-screen before bouncing it back, rather than a hard
  // wall right at the visible edge — the platform's ends already reach fairly
  // close to the screen edges, so a wall exactly at the edge made the ball feel
  // like it could get pinned against the platform's tip. Margin widened 30→100px
  // (Rob's ask) so the ball has real room to fall past the tube's end and drop
  // vertically before the wall ever catches it, rather than being caught right
  // away with barely any time to fall.
  //
  // Bounce is deliberately soft (loses most of its speed), not a full elastic
  // reflection — a full-speed bounce (Rob's phone test) felt like the wall was
  // actively rewarding/launching the ball rather than just a neutral edge
  // correction, and could ping-pong back and forth several times before settling.
  //
  // Bounds are the tower's own actual reach now, not a fixed 0-CONFIG.WIDTH
  // (Rob: on Level 10, the ball would grind to a near-standstill out on the
  // 3rd/side platform — that platform sits at x=860 with a 434px bar, so
  // ~257px of its own surface fell past the old fixed wall at 820, and any
  // rightward drift while resting there got slammed backward every single
  // step, fighting itself down to zero net motion). Recomputed from the
  // platforms every call rather than cached once — cheap (a handful of
  // platforms, same cost the camera clamp already pays each frame) and
  // automatically covers however wide the tower ends up as more levels are
  // built, instead of needing another hand-tuned number here per level.
  _checkBoundaries() {
    const wallRestitution = 0.35;
    const margin = 100;
    let minX = 0, maxX = CONFIG.WIDTH;
    for (const p of this.platforms) {
      minX = Math.min(minX, p.pivot.x - p.length / 2);
      maxX = Math.max(maxX, p.pivot.x + p.length / 2);
    }
    if (this.x < minX - margin) {
      this.vx = Math.abs(this.vx) * wallRestitution;
    } else if (this.x > maxX + margin) {
      this.vx = -Math.abs(this.vx) * wallRestitution;
    }
  },

  // "Touching" now means the ball's edge has reached the hinge's actual glow
  // ring (its outer visible edge), not some disconnected collision radius —
  // Rob: this should register anywhere from the center dot out to the outer
  // ring, not just near dead center. Uses displayRadius since that's the
  // ball's real drawn size, not the (slightly smaller) physics radius.
  // Checks every platform independently — with the tower, the ball can only
  // realistically be near one hinge at a time, but each platform needs to know
  // for itself whether it's the one being touched right now.
  _checkHinge() {
    this.touchingHinge = false;
    for (const p of this.platforms) {
      const dx = this.x - p.pivot.x;
      const dy = this.y - p.pivot.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      p.touching = dist < (p.hingeRingRadius + this.displayRadius);
      if (p.touching) this.touchingHinge = true;
    }
  },

  // Free Play's "Potion Blast" power-up — a player-triggered impulse, direction
  // taken from whichever platform the ball is currently on (or last rested on)
  // — same formula shape as the original: sideways component from sin(angle),
  // upward component from cos(angle). This is also the tower's climb mechanic
  // now (Rob), so it needs to be strong enough to comfortably clear the gap to
  // the next platform up — see TOWER_SPACING in ui.js.
  applyBlast(force) {
    const rad = (this.currentPlatform || this.platforms[0]).angleRad;
    this.vx += Math.sin(rad) * force;
    this.vy -= Math.cos(rad) * force;
    this.airborne = true;
  },

  draw(ctx, images) {
    if (images.ball) {
      const s = this.displayRadius * 2; // display art is slightly larger than the collision circle, matches original
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      ctx.globalAlpha = Difficulty.ballOpacity; // fades out while a moon phase is active
      ctx.drawImage(images.ball, -s / 2, -s / 2, s, s);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.purple;
      ctx.fill();
    }
  },
};
