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
  tiltAccel: 1400, // px/s^2 at full tilt (tiltX = ±1)
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
    this.fellOff = false;
    this.currentPlatform = base;
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
    // TiltForce * MoonTiltMultiplier.
    const difficultyMultiplier = Difficulty.tiltForce * Difficulty.moonTiltMultiplier;
    const gx = tiltX * this.tiltAccel * difficultyMultiplier;
    const gy = this.gravityY;
    this.vx += gx * dt;
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
      // an overlap still counts as "resting" (one ball-radius) rejects that
      // case while still catching genuine landings.
      const maxRestOverlap = restPerp + this.displayRadius;
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
      if (vNormal >= 0 && Math.abs(along) <= halfLength && perp > restPerp && perp < maxRestOverlap) {
        // Push the ball back to rest on the surface.
        const clampedAlong = along;
        const clampedPerp = restPerp;
        this.x = p.pivot.x + dir.x * clampedAlong + normal.x * clampedPerp;
        this.y = p.pivot.y + dir.y * clampedAlong + normal.y * clampedPerp;

        if (vNormal > 0) vNormal = 0; // stop moving into the surface
        // Difficulty.grip is meant as "fraction of speed kept per second of contact"
        // (hotter tube = less grip = harder to control) — Math.pow(grip, dt) makes
        // that true regardless of frame rate.
        vAlong *= Math.pow(Difficulty.grip, dt);

        this.vx = dir.x * vAlong + normal.x * vNormal;
        this.vy = dir.y * vAlong + normal.y * vNormal;
        this.currentPlatform = p;
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
  _checkBoundaries() {
    const wallRestitution = 0.35;
    const margin = 100;
    if (this.x < -margin) {
      this.vx = Math.abs(this.vx) * wallRestitution;
    } else if (this.x > CONFIG.WIDTH + margin) {
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
