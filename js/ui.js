// Drawing + tap-handling for each screen. Stage 1 scope: Home screen is built to
// match the original layout/art; Levels/Level1/FreePlay are simple placeholders
// (real art & gameplay land in later stages) so navigation + tilt input can be
// verified end-to-end on a phone before the physics/gameplay work begins.

const COLOR = {
  purple: 'rgb(144, 19, 254)',
  purpleDim: 'rgba(144, 19, 254, 0.55)',
  warn: 'rgb(189, 16, 224)',
  instructions: 'rgb(119, 163, 252)',
  locked: 'rgb(155, 155, 155)',
  bg: '#0a0410',
};

function rectContains(x, y, w, h, px, py) {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function drawImg(ctx, img, x, y, w, h) {
  if (!img) return;
  ctx.drawImage(img, x, y, w, h);
}

function drawCenteredText(ctx, text, x, y, w, opts) {
  ctx.save();
  ctx.font = `${opts.size}px ${opts.font || 'PotionBody'}`;
  ctx.fillStyle = opts.color || '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    ctx.fillText(line, x + w / 2, y + i * (opts.size * 1.15));
  });
  ctx.restore();
}

// Draws a number with every digit at a fixed pitch — a live-updating score in
// a proportional font (each digit a different width) visibly jitters
// left/right frame to frame as the total string width changes with whichever
// digits currently show (Rob: "the numbers are bouncing around because of the
// kerning"). Non-digit characters (the thousands comma) keep their own
// natural width, matching how "tabular figures" work in real fonts.
function drawTabularNumber(ctx, text, centerX, y, opts) {
  ctx.save();
  ctx.font = `${opts.size}px ${opts.font || 'PotionBody'}`;
  ctx.fillStyle = opts.color || '#fff';
  ctx.textBaseline = opts.baseline || 'top';
  ctx.textAlign = 'center';
  let digitW = 0;
  for (let d = 0; d <= 9; d++) digitW = Math.max(digitW, ctx.measureText(String(d)).width);
  const chars = String(text).split('');
  const widths = chars.map((c) => (/[0-9]/.test(c) ? digitW : ctx.measureText(c).width));
  const totalW = widths.reduce((a, b) => a + b, 0);
  let cx = centerX - totalW / 2;
  for (let i = 0; i < chars.length; i++) {
    cx += widths[i] / 2;
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] / 2;
  }
  ctx.restore();
  return totalW;
}

// ---------- Home screen ----------
const HomeScreen = {
  layout: {
    sky: { x: -19, y: -17, w: 752, h: 1309 },
    logo: { x: 11, y: -12, w: 677, h: 369 },
    liveGame: { x: -10, y: 286, w: 692, h: 721 },
    freePlayBtn: { x: 45, y: 721, w: 285, h: 285 },
    levelModeBtn: { x: 390, y: 721, w: 285, h: 285 },
    instrFreePlay: { x: 81, y: 970, w: 209, h: 135 },
    instrLevels: { x: 390, y: 970, w: 283, h: 135 },
    muteHit: { x: 631, y: 1184, w: 64, h: 64 },
    muteBtn: { x: 637, y: 1186, w: 57, h: 68 },
    motionOverlay: { x: -21, y: 504, w: 756, h: 237 },
  },

  draw(ctx, images, state) {
    const L = this.layout;
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, 720, 1280);
    drawImg(ctx, images.sky, L.sky.x, L.sky.y, L.sky.w, L.sky.h);
    drawImg(ctx, images.liveGame, L.liveGame.x, L.liveGame.y, L.liveGame.w, L.liveGame.h);
    drawImg(ctx, images.logo, L.logo.x, L.logo.y, L.logo.w, L.logo.h);
    drawImg(ctx, images.freePlayButton, L.freePlayBtn.x, L.freePlayBtn.y, L.freePlayBtn.w, L.freePlayBtn.h);
    drawImg(ctx, images.levelModeButton, L.levelModeBtn.x, L.levelModeBtn.y, L.levelModeBtn.w, L.levelModeBtn.h);

    drawCenteredText(ctx, 'FREE PLAY for high score', L.instrFreePlay.x, L.instrFreePlay.y, L.instrFreePlay.w,
      { size: 22, font: 'PotionBody', color: COLOR.instructions });
    drawCenteredText(ctx, 'Make potion to advance LEVELS', L.instrLevels.x, L.instrLevels.y, L.instrLevels.w,
      { size: 22, font: 'PotionBody', color: COLOR.instructions });

    const muteImg = state.muted ? images.muteMuted : images.muteUnmuted;
    drawImg(ctx, muteImg, L.muteBtn.x, L.muteBtn.y, L.muteBtn.w, L.muteBtn.h);

    if (state.requestingMotion) {
      drawImg(ctx, images.motionButton, L.motionOverlay.x, L.motionOverlay.y, L.motionOverlay.w, L.motionOverlay.h);
      drawCenteredText(ctx, 'Requesting motion access…', L.motionOverlay.x, L.motionOverlay.y + L.motionOverlay.h + 10,
        L.motionOverlay.w, { size: 22, font: 'PotionBody', color: '#fff' });
    }

    if (state.motionDenied) {
      drawCenteredText(ctx,
        'Motion access was denied.\nPlease allow motion access in your\nbrowser settings, then reload the page.',
        40, 560, 640, { size: 24, font: 'PotionBody', color: COLOR.warn });
    }
  },

  // Returns the tap target name, or null.
  hitTest(x, y) {
    const L = this.layout;
    if (rectContains(L.freePlayBtn.x, L.freePlayBtn.y, L.freePlayBtn.w, L.freePlayBtn.h, x, y)) return 'freePlay';
    if (rectContains(L.levelModeBtn.x, L.levelModeBtn.y, L.levelModeBtn.w, L.levelModeBtn.h, x, y)) return 'levelMode';
    if (rectContains(L.muteHit.x, L.muteHit.y, L.muteHit.w, L.muteHit.h, x, y)) return 'mute';
    return null;
  },
};

// ---------- Levels screen (placeholder — only Level 1 is real for now) ----------
const LevelsScreen = {
  buttonSize: 132,
  positions: [
    { x: 9, y: 270, n: 1 }, { x: 149, y: 270, n: 2 }, { x: 289, y: 270, n: 3 },
    { x: 429, y: 270, n: 4 }, { x: 569, y: 270, n: 5 },
    { x: 9, y: 417, n: 6 }, { x: 149, y: 417, n: 7 }, { x: 289, y: 417, n: 8 },
    { x: 429, y: 417, n: 9 }, { x: 569, y: 417, n: 10 },
  ],
  homeBtn: { x: 20, y: 40, w: 100, h: 50 },

  draw(ctx, images, state) {
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, 720, 1280);
    drawCenteredText(ctx, 'Levels', 0, 130, 720, { size: 64, font: 'PotionTitle', color: '#fff' });

    const s = this.buttonSize;
    this.positions.forEach((pos) => {
      const unlocked = pos.n <= state.highestLevelUnlocked;
      const built = pos.n === 1; // only Level 1 exists so far
      ctx.fillStyle = unlocked ? 'rgba(144, 19, 254, 0.25)' : 'rgba(155, 155, 155, 0.15)';
      ctx.fillRect(pos.x, pos.y, s, s);
      ctx.strokeStyle = unlocked ? COLOR.purple : COLOR.locked;
      ctx.lineWidth = 3;
      ctx.strokeRect(pos.x, pos.y, s, s);
      drawCenteredText(ctx, String(pos.n), pos.x, pos.y + s / 2 - 24, s,
        { size: 48, font: 'PotionTitle', color: unlocked ? COLOR.purple : COLOR.locked });
      if (unlocked && !built) {
        drawCenteredText(ctx, 'soon', pos.x, pos.y + s - 26, s, { size: 16, font: 'PotionBody', color: COLOR.locked });
      }
    });

    this.drawHomeButton(ctx);
  },

  drawHomeButton(ctx) {
    const b = this.homeBtn;
    ctx.strokeStyle = COLOR.purple;
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    drawCenteredText(ctx, 'Home', b.x, b.y + 14, b.w, { size: 22, font: 'PotionBody', color: COLOR.purple });
  },

  hitTest(x, y, state) {
    const b = this.homeBtn;
    if (rectContains(b.x, b.y, b.w, b.h, x, y)) return { target: 'home' };
    const s = this.buttonSize;
    for (const pos of this.positions) {
      if (rectContains(pos.x, pos.y, s, s, x, y)) {
        if (pos.n === 1) return { target: 'playLevel1' };
        return null; // locked or not built yet
      }
    }
    return null;
  },
};

// GameOver11.png's actual visible border, measured directly from the asset
// pixels (not the image's own x/y/w/h bounding box, which has a lot of glow
// padding around the real line): the purple line sits at roughly
// x37-681 y186-412 of the drawn board.
const GO_BOARD_BORDER = { left: 37, right: 681, top: 186, bottom: 412 };
const GO_SCORE_FONT_SIZE = 68;
// Right-anchored to line up with the rightmost potion icon (x562, w72 -> right
// edge 634) rather than the board's real border (681) — Rob: the score's right
// edge was creeping too close to the border and past the bottles underneath it.
const GO_SCORE_RIGHT = 634;
const GO_SCORE_Y = 220; // moved up slightly from 233 (Rob)
const GO_BUBBLE_GAP = 20; // gap between the bubble cluster and the score text
const GO_BUBBLE_MASK_W = 90;
const GO_BUBBLE_MASK_Y = 200;
const GO_BUBBLE_MASK_H = 95;

// ---------- Play screen (Levels / Free Play) ----------
// Core ball-on-a-see-saw mechanic, shared by every mode — Free Play just
// counts score up and only ends when the ball falls; each Level additionally
// tracks a height threshold (_levelThresholdY) that ends the run in a win
// instead once the ball climbs high enough to touch it.
const PlayScreen = {
  homeBtn: { x: 20, y: 138, w: 100, h: 44 },
  // Bottom-right corner, matching the Home screen's own mute button placement
  // (Rob: move it out of the top-right so the potion counter can go there).
  muteBtn: { x: 637, y: 1186, w: 57, h: 68 },
  // Whole pill structure (sprite + digit together, not just the digit font)
  // scaled 15% bigger (Rob), anchored at the same top-left corner as before.
  PILL_SCALE: 1.15,
  scorePillBtn: { x: 20, y: 20, w: 238 * 1.15, h: 104 * 1.15 },
  // Sized/positioned so the *ovals themselves* match — not the raw image
  // rects, and not the images' full opaque content either (my first attempt
  // used alpha>200 bounds, which wrongly included the bottle icon towering
  // over Potion Counter.png's actual oval, inflating its measured height).
  // Rob: "use the lines not the image boundaries to compare" — so this scans
  // a flat column of each PNG, away from the bubble cluster / bottle icon,
  // to isolate just the oval track's own pixel height:
  //   bubblescore3.png (476x208 native): oval flat-track spans y53-153 (100px),
  //     stable across x160-360.
  //   Potion Counter.png (477x259 native): oval flat-track spans y57-191 (134px),
  //     stable across x160-280.
  // Matching rendered oval height means solving potionScale from
  // scoreScale's own oval height, and bottom-aligning the ovals (not the
  // image rects) means solving y from each oval's own scaled bottom offset.
  potionCounterBtn: (() => {
    const scoreH = 104 * 1.15, scoreNativeH = 208, scoreOvalY0 = 53, scoreOvalY1 = 153;
    const potionNativeH = 259, potionNativeW = 477, potionOvalY0 = 57, potionOvalY1 = 191;
    const scoreScale = scoreH / scoreNativeH;
    const ovalH = (scoreOvalY1 - scoreOvalY0) * scoreScale; // the target oval height both pills must share
    const potionScale = ovalH / (potionOvalY1 - potionOvalY0);
    const h = potionScale * potionNativeH;
    const w = h * (potionNativeW / potionNativeH); // preserve native aspect so the rounded ends stay circular
    const scoreOvalBottom = 20 + scoreOvalY1 * scoreScale; // score pill's own oval bottom, in canvas y
    const y = scoreOvalBottom - potionOvalY1 * potionScale; // bottom-align the ovals themselves
    return { x: 720 - w, y, w, h };
  })(),
  score: 0,
  elapsed: 0,
  mode: 'freeplay',
  timedOut: false,
  levelComplete: false, // true once the ball reaches LEVEL1_THRESHOLD_Y in level1 mode
  _levelCompletePending: false, // true while the ball rolls to a stop above the goal line, before levelComplete flips the win screen in
  _levelCompleteTimer: 0,
  gameOverT: 0, // 0-1 pop-in progress once the run has ended (reused for the level-complete pop-in too)
  leaderboardMsgT: 0, // >0 while the "coming soon" message is showing
  goBubbles: [], // continuously-bubbling particles next to the Game Over score
  goBubbleTimer: 0,
  darkMatterClouds: [], // dark matter cloud hazards — see _buildDarkMatterClouds; real array set fresh each enter()
  plasmaStorms: [], // plasma storm fields — see _buildPlasmaStorms; real array set fresh each enter()

  // A charge every 1000 points, tap a blast button to spend one — shared by
  // every mode now (see the accrual comment in update() for why). Capped at
  // MAX_BLAST_CHARGES (Rob: without a cap, someone could just camp at the
  // base collecting charges indefinitely, then chain them all in one blast
  // to trivialize the whole climb — scoring past the cap simply doesn't
  // bank anything further until a charge gets spent). Down from 3 to 1 —
  // the potion-bottle charge icons are gone entirely now (Rob: "no potion
  // bottles, one charge per jump"), replaced by the moon itself glowing via
  // a PlasmaOrb effect (see pixi_playscreen.js) — a single orb only really
  // reads as "charged" or "not", not a stack of several, so the cap matches.
  MAX_BLAST_CHARGES: 1,
  blastCharges: 0,

  blastThreshold: 0,
  // Bigger again (Rob: the ring+bottle together were both shrinking as this
  // whole box shrank, making the bottle too small — not that the box itself
  // needed to be smaller). Kept centered on the same point as the original
  // 100x100 buttons (center 125,1000 / 595,1000).
  blastLeftBtn: { x: 45, y: 920, w: 160, h: 160 },
  blastRightBtn: { x: 515, y: 920, w: 160, h: 160 },
  // 0-1, eased toward 1 while the potion counter is above 0 and toward 0
  // otherwise — drives a subtle grow+fade instead of an instant show/hide
  // (Rob). See _drawBlastButtons.
  blastButtonsT: 0,
  introT: 0, // seconds left in the pre-drop pause at the start of a run, set in enter()

  // How long a platform's jets keep running after the ball leaves it before
  // actually cutting off (Rob: not instantly — "it could be just bouncing").
  JET_GRACE_SECONDS: 3,

  // Vertical gap (world px) between platform pivots in the tower. Bumped from
  // 260 to 300 (Rob: move the top/middle platforms up higher). A blast's peak
  // vertical reach alone is still roughly force^2/(2*gravityY) ≈ 300px, but
  // the platforms are no longer stacked directly above one another (see
  // TOWER_X_OFFSET below), so the real distance a blast needs to cover is the
  // diagonal to a horizontally-offset target, well inside a 950-force blast's
  // actual projectile range (v^2/gravityY ≈ 600px) once aimed toward it rather
  // than straight up.
  TOWER_SPACING: 300,
  // The occasional "big jump" gap some levels place, cleared only by a
  // charged-moon blast — 50% taller than a normal gap, matching
  // BIG_BLAST_FORCE's own "50% higher jump" spec exactly (300 * 1.5 = 450).
  BIG_TOWER_SPACING: 450,
  // Horizontal offset (world px) for the middle/top platforms — Rob: move one
  // right and one left instead of stacking every platform straight above the
  // base. Middle goes right, top goes left, so climbing the tower zigzags
  // rather than going straight up.
  TOWER_X_OFFSET: 130,
  // How far off to the side the 4th platform sits — well outside the 720px
  // screen width (Rob: wants platforms placed off to the left/right of the
  // visible area, with the camera panning sideways to reach them, rather than
  // widening the game's actual portrait canvas). See PlayScreenPixi's
  // _updateCamera, which now clamps against whichever platform is furthest
  // left/right, not just furthest up.
  SIDE_PLATFORM_X_OFFSET: 500,

  // Builds the tower — a fixed, hand-placed stack of platforms (Rob: hand-designed
  // layout, not procedural), each running its own independent jets/hinge-bubbles
  // (Rob: "each platform should function independently", not share one global
  // simulation). Only the base platform gets a pole (Rob: the ones above it are
  // just floating bars). Top/middle platforms are full height/thickness and
  // keep a full-size hinge (Rob tried uniformly shrinking everything at 60%
  // and reverted it) — the only thing narrower on them is the tube's length,
  // via lengthScale. They also keep their single-jet restriction — middle
  // only its outer-left jet (index 0), top only its outer-right jet (index 1)
  // — rather than the base platform's full independently-randomizing set of 4.
  // A 4th platform sits off to the right of the base, well past the screen's
  // own width, reachable with a sideways blast — the first real test of the
  // horizontal camera pan.
  // Levels get a gradually higher tube-heat pace than Free Play's tuned
  // baseline (Rob: "liquid color changes are rare in level 1, they should
  // become more common as the game progresses, but very gradual") — each
  // platform's tubeSpeed (set below in _buildTower, one per platform so the
  // tower's 3 tubes drift out of sync) gets scaled by this multiplier in
  // enter(), off of the platform's own untouched baseTubeSpeed. Free Play
  // itself is untouched (multiplier 1) since its own pacing was already
  // deliberately tuned (see TUBE_STAGE_SCHEDULE's own header comment).
  // Linear ramp, +0.15/level: Level 1 = 1.15x (a modest bump off of 1x,
  // addressing Rob's "too rare" note), Level 10 = 2.5x. Not exposed per
  // level individually — just this one small formula covers all 10 (see
  // _levelThresholdY for each one's actual tower height).
  _tubeSpeedMultiplier() {
    const n = this._levelNumber();
    return n === null ? 1 : 1.15 + (n - 1) * 0.15;
  },

  // Steepest a platform's tilt is ever randomized to, in degrees (min stays
  // fixed at 5° — see platform.js's targetAngle formula). Rob: "start at 10
  // for the low levels and work your way up to 20 by level 5" — a flatter,
  // easier-to-balance-on surface for a new player, ramping back up to the
  // original full range by Level 5 and staying there through Level 10. Free
  // Play is untouched (always the full 20° range, same as it always was).
  _maxTiltAngleForLevel() {
    const n = this._levelNumber();
    // Free Play untouched for now (Rob: "let's just apply the bumping to
    // the levels for now, I'll deal with free play later").
    if (n === null) return 20;
    // ~25% steeper across the board (Rob: "make the platforms tilt a
    // little more... now that we have more control over the ball") — was
    // 10°→20° over Levels 1-5, now 12.5°→25° over the same ramp, staying
    // at 25° through Level 10.
    return Math.min(25, 12.5 + (n - 1) * 3.125);
  },

  // How many of a platform's jets can be on at once, and whether the choice
  // of which one(s) is biased toward the mount closest to the next platform
  // up (see _buildTower's preferredIndex precomputation) — Rob: "no more
  // than 2 jets at once... on the big platforms, no more than 1 on the
  // small platforms" for Levels 1-7, biased toward the next platform for
  // Levels 1-3 specifically then "more random" from 4 on, "3 jets in the
  // higher levels on the large platforms" from Level 8 on. Free Play
  // returns null, which keeps every jet system's original fully-
  // independent per-mount toggling untouched (see difficulty.js's
  // createJetSystem) rather than risk changing its feel to build this.
  _jetTierForLevel() {
    const n = this._levelNumber();
    if (n === null) return null;
    return { bigMax: n <= 7 ? 2 : 3, smallMax: 1, directionalBias: n <= 3 };
  },

  // Which level number `this.mode` refers to ('level1' -> 1), or null for
  // Free Play. Central place for this parsing rather than repeating the
  // regex/prefix check at every call site.
  _levelNumber() {
    const m = /^level(\d+)$/.exec(this.mode);
    return m ? parseInt(m[1], 10) : null;
  },
  _isLevelMode() { return this._levelNumber() !== null; },

  // Shared finishing pass applied to every tower (the generic Level 5-10/
  // Free Play one below, and each of the short hand-placed Level 1-4 ones) —
  // hinge bubbles and the "which jet mount faces the next platform up"
  // precompute both used to be inlined once here when there was only one
  // tower; factored out so every tower gets the exact same treatment
  // without repeating this three separate ways.
  _finishTower(platforms) {
    for (const p of platforms) {
      if (!p.hingeBubbles) p.hingeBubbles = createHingeBubbles();
    }

    // Precompute each non-base platform's "closest jet to the next platform
    // up" mount index (Rob: on Levels 1-3, the one active jet should point
    // toward continuing the climb, not be random) — static geometry, so
    // this only needs figuring out once here rather than every run. Purely
    // a preference used when PlayScreen.enter() turns directional bias on;
    // has no effect on its own (see difficulty.js's _updateCoordinated).
    for (let i = 1; i < platforms.length - 1; i++) {
      const p = platforms[i], next = platforms[i + 1];
      const towardLeft = next.pivot.x < p.pivot.x;
      let best = null;
      for (const idx of p.jetSystem.allowedIndices) {
        const d = JET_DEFS[idx].activeDistance;
        if (towardLeft ? d < 0 : d > 0) {
          if (best === null || Math.abs(d) > Math.abs(JET_DEFS[best].activeDistance)) best = idx;
        }
      }
      // Falls back to whatever's actually allowed if none of this
      // platform's mounts happen to be on the preferred side (e.g.
      // platform 4 only ever had a left-side jet to begin with).
      p.jetSystem.preferredIndex = best !== null ? best : p.jetSystem.allowedIndices[0];
    }

    return platforms;
  },

  // One base platform, reused as element 0 of every tower below (Level 1-4's
  // own short towers AND the generic Level 5-10/Free Play one) — it always
  // looks and behaves the same regardless of which level you're playing, so
  // there's no reason to build 5 separate poles/base jet systems for it.
  // Safe to share the actual object: only one tower is ever "active"
  // (PlayScreen.platforms) at a time, and _buildTowers() below de-dupes it
  // back out of the flattened all-platforms list before Pixi visuals get
  // built, so it only ever gets ONE `_visual` attached.
  _buildBasePlatform() {
    const base = createPlatform(360, 652, { hasPole: true, tubeSpeed: 1 });
    base.jetSystem = createJetSystem();
    return base;
  },

  // Appends a real, solid "goal platform" above a level's topmost climbing
  // platform (Rob: "make sure that the top scene with the winning bar is a
  // ways higher than the lowest platform... make the line there as if it
  // were one of the other platforms so the moon stone can land on it" — the
  // witch/cauldron goal-line art's glowing line used to just be a bare Y
  // coordinate the ball flew past, with nothing actually solid there).
  // Flat (createPlatform's isGoal skips the tilt tween — see platform.js),
  // wide (lengthScale 1.1, wider than a normal small platform, so landing
  // on it doesn't feel like a tight target after a whole climb), and a full
  // TOWER_SPACING above the platform it's stacked on — same real gap as
  // between any other two platforms, not the old cramped ~80px. Given no
  // Pixi visual of its own — pixi_playscreen.js's refresh() skips it
  // entirely, since the goal-line art's own painted line already reads as
  // the surface; this object exists purely so Physics has real geometry to
  // rest the ball on there.
  _appendGoalPlatform(platforms) {
    const top = platforms[platforms.length - 1];
    const goal = createPlatform(360, top.pivot.y - this.TOWER_SPACING, { isGoal: true, lengthScale: 1.1 });
    goal.jetSystem = createJetSystem({ allowedIndices: [] });
    platforms.push(goal);
    return platforms;
  },

  // One dark matter cloud hazard, at pivotY (world space, same coordinate
  // system as a platform's pivot). Rob's follow-up: bouncing back and forth
  // within the visible width meant it could just sit there parked in the
  // player's way indefinitely, blocking climbing entirely — "it prevents
  // the player from being able to move to the next level." Now a one-way
  // pass instead: starts fully off-screen on one side, crosses, exits
  // fully off-screen the other side, then respawns back at its start and
  // does it again — so there's always a real window where it's gone.
  // width/height are its collision box (see physics.js's
  // _checkDarkMatterClouds) and also what pixi_playscreen.js sizes the
  // actual NebulaCloud visual to.
  _createDarkMatterCloud(pivotY, opts = {}) {
    // Rob: "most of them should be a little smaller than the one we had on
    // the first level" — Level 1's own cloud (see _buildDarkMatterClouds)
    // now passes its original 560x340 explicitly so it stays put as the
    // one deliberately-bigger reference cloud; every other one defaults to
    // this smaller size unless it overrides it. Kept as the collision box's
    // own default too so the hitbox always matches what's actually drawn.
    const width = opts.width ?? 400, height = opts.height ?? 250;
    const speed = opts.speed ?? 60; // px/s
    const dir = opts.startDir ?? (Math.random() < 0.5 ? 1 : -1);
    // Comfortably past CONFIG.WIDTH (720) on either side so it's genuinely
    // fully off-screen at both ends, not just clipped at the very edge.
    const margin = width / 2 + 80;
    const startX = dir > 0 ? -margin : 720 + margin;
    const endX = dir > 0 ? 720 + margin : -margin;
    // Rob: "don't have the dark cloud going across over and over in the
    // same spot. It should move around" — and the follow-up: "it should
    // come back somewhere else above or below where it was", not just a
    // subtle wobble. baseY/yRange/yMin let each new pass (see
    // _updateDarkMatterClouds) re-roll a clearly different height and
    // direction instead of retracing the exact same line, or drifting
    // only a few unnoticeable px. Kept within the ~300px gap between the
    // two real platforms it was placed for — a cloud placed to guarantee
    // a real platform below it after a drop (see _buildDarkMatterClouds)
    // can't wander far enough to reach either neighbor.
    return {
      x: startX, y: pivotY, startX, endX, width, height, vx: speed * dir,
      baseY: pivotY, yMin: opts.yMin ?? 40, yRange: opts.yRange ?? 110, speed,
    };
  },

  // Moves every active dark matter cloud straight across in its one
  // direction, respawning at its own off-screen start the instant it
  // fully exits the far side — re-rolling a new y (within yRange of its
  // own baseY) and direction each time it respawns, so repeated passes
  // don't all trace the identical line (Rob's "should move around").
  // Called every frame from update(), same as jets/platforms.
  _updateDarkMatterClouds(dt) {
    for (const c of this.darkMatterClouds) {
      c.x += c.vx * dt;
      const reachedEnd = c.vx > 0 ? c.x >= c.endX : c.x <= c.endX;
      if (reachedEnd) {
        c.x = c.startX;
        // Rob's follow-up: "it should come back somewhere else above or
        // below where it was" — a random sign each time could still pick
        // the SAME side twice in a row with a similar magnitude (e.g. two
        // "above baseY" draws close together), reading as barely moved
        // even though yMin technically held. Alternating sides on every
        // respawn instead (never the same side twice in a row) guarantees
        // real separation from wherever it just was, not just from
        // baseY - at least yMin above one time, yMin below the next.
        c._highSide = !c._highSide;
        const mag = c.yMin + Math.random() * (c.yRange - c.yMin);
        c.y = c.baseY + mag * (c._highSide ? 1 : -1);
        const dir = Math.random() < 0.5 ? 1 : -1;
        c.vx = c.speed * dir;
        c.startX = dir > 0 ? -(c.width / 2 + 80) : 720 + c.width / 2 + 80;
        c.endX = dir > 0 ? 720 + c.width / 2 + 80 : -(c.width / 2 + 80);
        c.x = c.startX;
      }
    }
  },

  // Which levels get dark matter clouds, and where. Level 1 stays
  // hazard-free (a clean intro climb for beginners); Levels 2-10 each get
  // one, per Rob: "start adding them to other levels going different ways
  // and different sizes across the screen. stretch some out as long as it
  // doesn't warp the shape" — startDir alternates per level so they don't
  // all drift the same way, sizes vary level to level, and a few are
  // stretched into long/flat shapes rather than every one being roughly
  // circular. Kept under ~4:1 width:height so NebulaCloud's own gas/ember
  // layers (tuned around roughly-round shapes) don't visibly distort into
  // something obviously wrong at extreme ratios.
  //
  // pivotY per level is hand-picked between two of that level's own real
  // platforms (see each _buildLevelN/​_buildSharedTower for their actual
  // pivots) so a drop always has a real platform right below it to land on
  // (physics.js's darkMatterSkipsRemaining — a touch now always drops the
  // ball onto the very next real platform it reaches, not further; see its
  // own comment for why the old multi-platform skip was cut) — same
  // reasoning as Level 2's original placement, just repeated per level's
  // own layout. Levels 5-10 all share one tower instance
  // (_buildSharedTower) but climb to a different height each (see
  // _levelThresholdY), so each level's pivot sits between the two
  // platforms just below *that level's own* threshold rather than reusing
  // one fixed spot.
  _buildDarkMatterClouds(levelNum) {
    // Each entry: width, height, pivotY, startDir (1 = left-to-right,
    // -1 = right-to-left). Rob: "the cloud is tough, let's not have any
    // until level 9" — pulled off Levels 2-8 entirely (were building up
    // 1-2 per level); Levels 9-10 keep their existing escalation (3, then
    // 4), each independently timed/directed and spread across that
    // level's own available climb (shared tower pivots, see the per-level
    // comments) so they don't all bunch at one height.
    const specs = {
      // Level 9 — 3 clouds, spread across platforms 3-10 (y=-148..-2248).
      9: [
        { width: 300, height: 190, pivotY: -450, startDir: -1 },
        { width: 500, height: 140, pivotY: -1200, startDir: 1 },       // long/flat
        { width: 360, height: 230, pivotY: -1950, startDir: -1 },
      ],
      // Level 10 — 4 clouds, spread across platforms 3-11 (y=-148..-2548).
      10: [
        { width: 320, height: 200, pivotY: -400, startDir: 1 },
        { width: 460, height: 150, pivotY: -1000, startDir: -1 },      // long/flat
        { width: 340, height: 220, pivotY: -1650, startDir: 1 },
        { width: 420, height: 260, pivotY: -2250, startDir: -1 },      // biggest, roundest
      ],
    };
    const list = specs[levelNum];
    if (!list) return [];
    return list.map(spec => this._createDarkMatterCloud(spec.pivotY, {
      width: spec.width, height: spec.height, startDir: spec.startDir,
    }));
  },

  // Plasma storm field (Rob: "put a plasma storm on level 4. it should
  // slowly appear for a few seconds then slowly disappear. There should be
  // a small force on the moon stone in the direction the storm is going
  // when the stone touches the storm"). Unlike a dark matter cloud it
  // doesn't travel across the screen — it stays put, spanning the full
  // width, and its own visuals stream right-to-left inside it. It cycles:
  // hidden → fades in → holds → fades out → hidden → … `visibility` (0..1)
  // is both how visible pixi_playscreen.js draws it and how strongly
  // physics.js pushes the stone, so the push fades in and out with the
  // storm itself and there's no push at all while it's gone.
  _createPlasmaStorm(pivotY, opts = {}) {
    return {
      x: 360, y: pivotY,
      // pivotY/360 are the center this drifts around. Rob's follow-up: "it
      // doesn't move... it moves slightly up and down the screen, but it
      // doesn't change direction in one viewing" — the old driftSpeed
      // (0.25) took ~25s for one full up-down cycle, far longer than a
      // single appearance (fadeIn+hold+fadeOut ≈ 10s back then), so it
      // only ever swept in one direction before fading back out; there
      // was also no horizontal drift at all, just the vertical bob. Now
      // moves on BOTH axes together (cos/sin off the same clock, so it
      // traces a slow loop rather than two independent wobbles) and fast
      // enough to complete more than one full loop — and so visibly
      // reverse direction — within a single appearance. driftT is its own
      // running clock, separate from the appear/hold/fade timer below, so
      // drifting continues smoothly through every phase rather than
      // resetting each cycle.
      baseY: pivotY,
      driftRangeY: opts.driftRangeY ?? 120,
      driftRangeX: opts.driftRangeX ?? 160,
      driftSpeed: opts.driftSpeed ?? 0.6, // ~10.5s per full loop — was 0.25 (~25s)
      // Offsets each storm's own drift loop so multiple storms on one
      // level (Rob: "more dark plasmas moving in opposite directions" on
      // higher levels) don't trace the exact same path in lockstep.
      driftT: opts.driftPhase ?? 0,
      width: opts.width ?? 1150, height: opts.height ?? 440,
      dir: opts.dir ?? -1,              // pushes/streams right → left (1 = left → right)
      push: opts.push ?? 150,           // px/s² at full strength — "small": ~15% of full tilt (280 slid a still stone off a platform in ~1.3s)
      // Rob: "should show up and last for a while, not just go away" —
      // hold roughly doubled (4 -> 9) and the gap between appearances
      // shortened (5 -> 3) so it spends most of its time visible instead
      // of mostly hidden. fadeIn/fadeOut left alone — those already read
      // as "slowly appear... slowly disappear" per Rob's original ask.
      fadeIn: opts.fadeIn ?? 3, hold: opts.hold ?? 9, fadeOut: opts.fadeOut ?? 3,
      offTime: opts.offTime ?? 3,
      phase: 'off', t: opts.firstDelay ?? 3, // first appearance a few seconds into the run
      visibility: 0,
    };
  },

  // Advances each storm's appear/hold/disappear cycle and its slow
  // looping drift. Fades use smoothstep so they ease in and out rather
  // than ramping linearly; the drift is a plain sine/cosine loop — smooth
  // and continuous, no phase to ease in/out of.
  _updatePlasmaStorms(dt) {
    const ease = (x) => x * x * (3 - 2 * x);
    for (const s of this.plasmaStorms) {
      s.driftT += dt;
      s.x = 360 + Math.cos(s.driftT * s.driftSpeed) * s.driftRangeX;
      s.y = s.baseY + Math.sin(s.driftT * s.driftSpeed) * s.driftRangeY;

      s.t -= dt;
      if (s.t <= 0) {
        if (s.phase === 'off') { s.phase = 'in'; s.t = s.fadeIn; }
        else if (s.phase === 'in') { s.phase = 'hold'; s.t = s.hold; }
        else if (s.phase === 'hold') { s.phase = 'out'; s.t = s.fadeOut; }
        else { s.phase = 'off'; s.t = s.offTime; }
      }
      if (s.phase === 'in') s.visibility = ease(1 - s.t / s.fadeIn);
      else if (s.phase === 'hold') s.visibility = 1;
      else if (s.phase === 'out') s.visibility = ease(s.t / s.fadeOut);
      else s.visibility = 0;
    }
  },

  // Which levels get a plasma storm, and where. Level 4's own original
  // spot (centered between its platforms at y=352/y=52, see
  // _buildLevel4) stays put. Rob's follow-up: "what levels is the plasma
  // storm on?... we need to add that on levels, maybe six or seven
  // plus... on the higher levels there should be more dark plasmas
  // moving in opposite directions" — Levels 6-10 now get one on the
  // shared tower (see _buildSharedTower's own pivots), escalating same
  // spirit as the dark matter clouds' own 1/2/3/4 ramp on Levels 7-10:
  // 1 storm on 6-7, 2 opposite-direction storms on 8-9, 3 on 10. Level 5
  // stays clear (dark clouds already start there) so the early shared-
  // tower levels aren't stacked with every hazard at once. 1150x440 is
  // Rob's test-page size (wider than the 720 screen, so its soft ends
  // sit off-screen).
  _buildPlasmaStorms(levelNum) {
    const specs = {
      4: [{ pivotY: 200 }],
      6: [{ pivotY: -1200, dir: 1 }],
      7: [{ pivotY: -1500, dir: -1 }],
      8: [
        { pivotY: -700, dir: 1, driftPhase: 0 },
        { pivotY: -1600, dir: -1, driftPhase: 4 },
      ],
      9: [
        { pivotY: -600, dir: -1, driftPhase: 1 },
        { pivotY: -1700, dir: 1, driftPhase: 5 },
      ],
      10: [
        { pivotY: -500, dir: 1, driftPhase: 0 },
        { pivotY: -1400, dir: -1, driftPhase: 3 },
        { pivotY: -2300, dir: 1, driftPhase: 6 },
      ],
    };
    const list = specs[levelNum];
    if (!list) return [];
    return list.map(spec => this._createPlasmaStorm(spec.pivotY, spec));
  },

  // Levels 1-4 (Rob: "we need a new design for each level" instead of every
  // level just being a shorter/taller slice of one shared tower — "keep the
  // first 5 levels pretty short so beginners can power through them and get
  // the hang of the game... more of a variation of how they're placed rather
  // than an increase"). Each is its own short, independent, hand-placed
  // climb rather than an index range into a bigger structure — varying only
  // the left/right pattern between levels for now, same TOWER_SPACING-scale
  // vertical gaps as always, and every tube held at the same 0.7 lengthScale
  // every other platform already uses (Rob: don't shrink tubes smaller than
  // what we've already had — that's for later, higher levels to introduce).
  // Real bigger gaps are also reserved for Level 5 and up. First pass, built
  // to react to, same as the original single tower was.

  // Level 1 — doubled from its original 3 jumps to 6 (Rob: "make the first
  // level twice as big and then build it from there" — too little climb to
  // read as real action once the every-jump blast is free). Keeps the
  // original first two platforms' exact placement (already played and
  // tuned) and continues their same right/left zigzag upward. One
  // BIG_TOWER_SPACING gap (p3->p4) is the level's one required big jump —
  // Rob: "starting with maybe only one big jump on the first three levels" —
  // everything else stays a normal free jump.
  _buildLevel1(base) {
    const platforms = [
      base,
      createPlatform(490, 352, { lengthScale: 0.7, tubeSpeed: 0.75 }),
      createPlatform(230, 52, { lengthScale: 0.7, tubeSpeed: 1.3 }),
      createPlatform(490, -248, { lengthScale: 0.7, tubeSpeed: 0.9 }),
      createPlatform(230, -248 - this.BIG_TOWER_SPACING, { lengthScale: 0.7, tubeSpeed: 1.1 }),
      createPlatform(490, -248 - this.BIG_TOWER_SPACING - this.TOWER_SPACING, { lengthScale: 0.7, tubeSpeed: 0.85 }),
    ];
    for (let i = 1; i < platforms.length; i++) {
      platforms[i].jetSystem = createJetSystem({ allowedIndices: [0, 1] });
    }
    return this._finishTower(this._appendGoalPlatform(platforms));
  },

  // Level 2 — same length (2 jumps) as Level 1, but drifts left twice in a
  // row instead of alternating sides. Tube length held at the same 0.7
  // every other platform already uses (Rob: don't go smaller than what
  // we've already had — that's for later, higher levels to introduce, not
  // these early ones) — the variety here is purely the left/left placement,
  // not the tube size.
  _buildLevel2(base) {
    const platforms = [
      base,
      createPlatform(230, 352, { lengthScale: 0.7, tubeSpeed: 0.9 }),
      createPlatform(170, 52, { lengthScale: 0.7, tubeSpeed: 1.1 }),
    ];
    platforms[1].jetSystem = createJetSystem({ allowedIndices: [0, 1] });
    platforms[2].jetSystem = createJetSystem({ allowedIndices: [2, 3] });
    return this._finishTower(this._appendGoalPlatform(platforms));
  },

  // Level 3 — one jump longer (3), a quicker right-left-right zigzag. Same
  // 0.7 tube length as everything else so far (see Level 2's comment).
  _buildLevel3(base) {
    const platforms = [
      base,
      createPlatform(490, 352, { lengthScale: 0.7, tubeSpeed: 0.8 }),
      createPlatform(230, 52, { lengthScale: 0.7, tubeSpeed: 1.2 }),
      createPlatform(470, -248, { lengthScale: 0.7, tubeSpeed: 1.0 }),
    ];
    platforms[1].jetSystem = createJetSystem({ allowedIndices: [0, 1] });
    platforms[2].jetSystem = createJetSystem({ allowedIndices: [2, 3] });
    platforms[3].jetSystem = createJetSystem({ allowedIndices: [0, 1] });
    return this._finishTower(this._appendGoalPlatform(platforms));
  },

  // Level 4 — also 3 jumps, left-left-right this time (a different pattern
  // from both Level 2's left-left and Level 3's right-left-right). Same 0.7
  // tube length again.
  _buildLevel4(base) {
    const platforms = [
      base,
      createPlatform(230, 352, { lengthScale: 0.7, tubeSpeed: 0.85 }),
      createPlatform(160, 52, { lengthScale: 0.7, tubeSpeed: 1.15 }),
      createPlatform(410, -248, { lengthScale: 0.7, tubeSpeed: 1.0 }),
    ];
    platforms[1].jetSystem = createJetSystem({ allowedIndices: [2, 3] });
    platforms[2].jetSystem = createJetSystem({ allowedIndices: [0, 1] });
    platforms[3].jetSystem = createJetSystem({ allowedIndices: [2, 3] });
    return this._finishTower(this._appendGoalPlatform(platforms));
  },

  // The original single hand-placed tower, now serving only Level 5-10 and
  // Free Play (Rob: these haven't been redesigned yet — leave them exactly
  // as they were rather than guess at 6 more layouts blind). `base` is the
  // same shared instance every other tower uses, not a fresh one.
  _buildSharedTower(base) {
    const baseX = 360, baseY = 652;
    const platforms = [
      base,
      createPlatform(baseX + this.TOWER_X_OFFSET, baseY - this.TOWER_SPACING, { lengthScale: 0.7, tubeSpeed: 0.75 }),
      createPlatform(baseX - this.TOWER_X_OFFSET, baseY - this.TOWER_SPACING * 2, { lengthScale: 0.7, tubeSpeed: 1.3 }),
    ];
    // New platforms go higher than whatever's already there, not at some
    // in-between height that overlaps the existing ones (Rob) — this one
    // sits above the current topmost platform (the zigzag's top, index 2),
    // not just above the base.
    const topPivotY = platforms[2].pivot.y;
    platforms.push(createPlatform(baseX + this.SIDE_PLATFORM_X_OFFSET, topPivotY - 200, { lengthScale: 0.7, tubeSpeed: 1.1 }));
    // 5th platform (Level 3's target, back when Level 3 still lived on this
    // shared tower) — continues the zigzag back to the left/center, another
    // TOWER_SPACING above the side platform.
    platforms.push(createPlatform(baseX - this.TOWER_X_OFFSET, platforms[3].pivot.y - this.TOWER_SPACING, { lengthScale: 0.7, tubeSpeed: 0.9 }));
    // Every small platform gets BOTH a left and a right mount now, not just
    // whichever single one was originally picked for visual variety (Rob:
    // "the jet only stays on the left side of the platform, but the next
    // platform is on the right side... I can't jump from the left side with
    // the jet to the platform on the right" — platform 4 specifically was
    // hardcoded to outer-left only, permanently mismatched with platform 5
    // sitting to its right, no way for the per-level bias/randomization
    // below to ever pick the correct side since there wasn't one to pick).
    // smallMax in _jetTierForLevel still caps it to one active at a time —
    // this just gives that one a real side to choose, in both directions,
    // instead of a single fixed mount.
    platforms[1].jetSystem = createJetSystem({ allowedIndices: [0, 1] });
    platforms[2].jetSystem = createJetSystem({ allowedIndices: [0, 1] });
    platforms[3].jetSystem = createJetSystem({ allowedIndices: [2, 3] }); // inner jets, for variety from the outer-only mid/top — already had both sides
    platforms[4].jetSystem = createJetSystem({ allowedIndices: [0, 1] });

    // Platforms 5-11 (Levels 4-10's targets, back when Level 4 still lived
    // here too) — continue the same zigzag straight on up from platform 4,
    // same TOWER_X_OFFSET/TOWER_SPACING as the hand-placed ones, no more
    // one-off detours like the side platform. Generated in a loop rather
    // than hand-placed one at a time (Rob: "do all 10, we can evaluate from
    // there" — a first pass to react to, not final tuning). tubeSpeed
    // cycles through a handful of distinct paces so no two neighboring
    // platforms drift in lockstep; jets alternate between the outer pair
    // and the inner pair per platform (both sides of one family, not a
    // single fixed mount — see above) for a little visual variety.
    const extraTubeSpeeds = [0.85, 1.2, 0.95, 1.25, 0.8, 1.15, 1.35];
    for (let i = 0; i < 7; i++) {
      const idx = 5 + i; // platforms[5..11], for Levels 4-10
      const x = idx % 2 === 1 ? baseX + this.TOWER_X_OFFSET : baseX - this.TOWER_X_OFFSET;
      const y = platforms[idx - 1].pivot.y - this.TOWER_SPACING;
      const extra = createPlatform(x, y, { lengthScale: 0.7, tubeSpeed: extraTubeSpeeds[i] });
      extra.jetSystem = createJetSystem({ allowedIndices: i % 2 === 0 ? [0, 1] : [2, 3] });
      platforms.push(extra);
    }

    return this._finishTower(platforms);
  },

  // Builds every tower up front (Rob: hand-designed layouts, not procedural)
  // — one per Level 1-4, plus the original generic one for Level 5-10/Free
  // Play — keyed by PlayScreen.mode string so enter() can just look its own
  // up. All share the same base platform instance (see _buildBasePlatform).
  _buildTowers() {
    const base = this._buildBasePlatform();
    return {
      level1: this._buildLevel1(base),
      level2: this._buildLevel2(base),
      level3: this._buildLevel3(base),
      level4: this._buildLevel4(base),
      shared: this._buildSharedTower(base),
    };
  },

  enter(mode) {
    this.mode = mode || this.mode;
    // Bumped every run so pixi_playscreen.js can snap the moon's charge
    // glow instantly to off instead of only easing there over its usual
    // ~0.35s — same "leave a marker here, let the renderer notice" pattern
    // moonDischargeCount already uses. Without this a run that ended
    // charged (or mid-fade) still showed a visible flash of glow for a
    // moment at the start of the next one, even with blastCharges already
    // reset above (Rob: "sometimes that carries over to the start of the
    // next game").
    this.runStartCount = (this.runStartCount || 0) + 1;
    // Zero the tilt sensor to however the phone is actually being held right
    // now (Rob: "right when the game starts... the ball just flies to the
    // left or right") — deviceorientation's gamma is an absolute angle from
    // dead-flat, not from however a player naturally rests their hand, so
    // without this whatever angle they happened to be holding the phone at
    // read as a real, full-strength tilt input from the very first frame.
    // Every run start recalibrates (see Input.calibrate's own comment for
    // why it's a "next reading" flag, not instant).
    Input.calibrate();
    Difficulty.reset();
    // Reuse the same platform instances every run rather than rebuilding new
    // ones — game.js's main() seeds `this.towers` once at boot (before
    // PlayScreenPixi.build() runs, which attaches Pixi display objects to
    // every platform across every tower via `p._visual`), and replacing
    // those objects here would orphan that whole Pixi visual tree. Just
    // reset their state in place instead, same as the old singleton
    // Platform.reset() always did.
    if (!this.towers) this.towers = this._buildTowers();
    // Levels 1-4 each get their own short, hand-placed tower now (see
    // _buildTowers) instead of sharing one big one sliced at different
    // heights; Level 5-10 and Free Play still use that original shared one
    // until they get their own real designs too.
    const levelNum = this._levelNumber();
    const towerKey = levelNum !== null && levelNum <= 4 ? 'level' + levelNum : 'shared';
    this.platforms = this.towers[towerKey];
    // Every platform in every tower still needs its jets/hinge-bubbles/goal-
    // line visibility kept current even while its tower isn't the active
    // one (see pixi_playscreen.js's refresh(), which force-hides anything
    // not in this set) — PlayScreenPixi.build() needs this same full list to
    // attach a Pixi visual to every platform across every tower up front.
    if (!this.allPlatforms) this.allPlatforms = [...new Set(Object.values(this.towers).flat())];
    const speedMul = this._tubeSpeedMultiplier();
    const maxTiltAngle = this._maxTiltAngleForLevel();
    const jetTier = this._jetTierForLevel();
    // Per-level color identity, banded 5 levels at a time (Rob: "we need
    // to have a background for the different levels... maybe we go five
    // levels at a time with the same color and then switch to a new
    // color every five levels"). Rob's follow-up: "I don't love the
    // amber, so let's go back to the pink for that" — Levels 1-5 use
    // null (no override = the default magenta Cool color, unchanged from
    // how the game always looked); Levels 6-10 switch to a jewel-toned
    // emerald, a deliberately different hue family from the default
    // pink→light-blue→dark-blue heat progression, so climbing into the
    // back half of the game reads as a distinct "zone". Free Play
    // (levelNum null) also stays null — unaffected. Read by platform.js's
    // reset()/_applyTubeStage whenever a run's tube cycles back to Cool.
    const coolColorOverride = levelNum !== null && levelNum > 5
      ? [56, 224, 168] // Levels 6-10 — #38e0a8, jewel emerald
      : null;
    // Same identity color, read by pixi_playscreen.js to warm the
    // background fog/vignette too (Rob: "are you thinking we make some
    // adjustments in the background too?") — kept as its own field rather
    // than reusing coolColorOverride directly since the background isn't
    // per-platform.
    this.levelAccentColor = coolColorOverride;
    for (const p of this.platforms) {
      // Set before reset() (not after) — reset() immediately rolls a fresh
      // targetAngle using this platform's current maxTiltAngle, so setting
      // it late would still leave this run's very first tween using
      // whatever level's cap happened to be set last.
      p.maxTiltAngle = maxTiltAngle;
      p.coolColorOverride = coolColorOverride;
      p.reset();
      // p.reset() doesn't touch tubeSpeed (only angle/hinge/tube-stage), so
      // this scaling sticks for the whole run without being clobbered, and
      // recomputes fresh from baseTubeSpeed every enter() rather than
      // compounding onto whatever the previous run left it at.
      p.tubeSpeed = p.baseTubeSpeed * speedMul;
      p.jetSystem.reset();
      // hasPole is only ever true for the base platform — the "big" one
      // Rob's jet-count rules distinguish from every "small" platform above
      // it. null in Free Play (jetTier itself is null there), which keeps
      // this jet system's original fully-independent per-mount toggling.
      p.jetSystem.levelConfig = jetTier ? {
        maxConcurrent: p.hasPole ? jetTier.bigMax : jetTier.smallMax,
        preferredIndex: p.jetSystem.preferredIndex ?? null,
        directionalBias: jetTier.directionalBias,
      } : null;
      p.hingeBubbles.reset();
    }
    Physics.reset(this.platforms);
    // Dark matter cloud hazard (Rob: floating clouds that drift across the
    // screen and drop the ball through 1-2 levels' worth of platforms on
    // touch — see physics.js's own darkMatterClouds handling for the actual
    // collision/drop). Built here, empty for every level for now — Rob
    // hasn't said yet which levels should actually have them (see
    // _buildDarkMatterClouds's own comment), so this wires up the full
    // mechanic without turning it on anywhere yet.
    this.darkMatterClouds = this._buildDarkMatterClouds(this._levelNumber());
    Physics.darkMatterClouds = this.darkMatterClouds;
    this.plasmaStorms = this._buildPlasmaStorms(this._levelNumber());
    Physics.plasmaStorms = this.plasmaStorms;
    Fog.reset();
    this.score = 0;
    this.elapsed = 0;
    this.timedOut = false;
    this.levelComplete = false;
    this._levelCompletePending = false;
    this._levelCompleteTimer = 0;
    this.gameOverT = 0;
    this.leaderboardMsgT = 0;
    this._scoreSubmitted = false;
    this.goBubbles = [];
    this.goBubbleTimer = 0;
    this.blastCharges = 0;
    this.blastThreshold = 0;
    this.blastButtonsT = 0;
    // NOT reset to 0 here (Rob: "when the game ends with the ball charged
    // up, sometimes that carries over to the start of the next game" — the
    // moon glow, not blastCharges itself, which already reset correctly
    // above). pixi_playscreen.js detects a new discharge purely by this
    // counter changing from whatever it last saw — resetting it to 0 every
    // run meant a run that had ANY discharge left _moonDischargeSeen at a
    // stale nonzero value, so the very next run's fresh 0 looked like a
    // brand-new discharge the instant it started, replaying the moon's
    // charge-spent flash/glow for a jump that never happened. It only
    // needs to keep changing on a real discharge, not stay small — letting
    // it climb forever across the whole session does that with no reset
    // needed at all.
    this._introJustEnded = false;
    // Brief pause before anything moves (Rob): the new screen appears with
    // the ball sitting at its starting spot just above the platform, held
    // there for a beat so the player actually sees the layout before the
    // ball drops, instead of it already falling the instant the screen
    // shows up.
    this.introT = 2;
  },

  get isOver() { return Physics.fellOff || this.timedOut || this.levelComplete; },
  // Level 1's old 30s time limit predates the new "climb to a threshold
  // line" goal (Rob) and isn't part of that design - Infinity for every
  // mode now, timedOut/timeLimit left in place (just never triggered)
  // rather than ripped out, in case a real per-level time attack is wanted
  // later.
  get timeLimit() { return Infinity; },
  // World-space y a level's ball needs to reach (Physics.y counts *down* as
  // the ball climbs) to complete it — computed off the tower's own actual
  // platform pivots (not hand-copied magic numbers) so it can't drift out of
  // sync if a tower's layout ever changes. Levels 1-4 each have their own
  // short, independent tower now (see _buildTowers), each with a real solid
  // "goal platform" appended above its topmost climbing platform (see
  // _appendGoalPlatform) — the threshold is that goal platform's own actual
  // resting surface (its pivot, lifted by the same thickness/2 +
  // displayRadius offset Physics uses to rest a ball on any platform), not
  // an eyeballed margin above thin air the way it was before that existed.
  // Levels 5-10 still climb the original shared tower (platforms 5-11 of
  // it), goal just above each one in turn — a first pass to react to and
  // retune once there's been real play on each (Rob: "do all 10, we can
  // evaluate from there"), not a final balance pass. Clamped at 10
  // (platform 11) since that's as tall as that shared tower currently goes.
  // Rob (Level 8): "one of the levels is overlapping the PNG at the top.
  // It shouldn't get that close. You should have to jump to the top." The
  // old -60 gap was way tighter than the real jump distance between any
  // two platforms (TOWER_SPACING, 300) — barely more than the ball's own
  // radius — so the goal line's art sat almost on top of the last real
  // platform instead of requiring an actual jump up to it, the same real
  // gap Levels 1-4's own appended goal platform already uses.
  _levelThresholdY(levelNum) {
    const p = this.platforms;
    if (levelNum <= 4) {
      const goal = p[p.length - 1];
      return goal.pivot.y - (goal.thickness / 2 + Physics.displayRadius);
    }
    const n = Math.min(levelNum, 10);
    return p[n + 1].pivot.y - this.TOWER_SPACING;
  },

  update(dt, tiltX) {
    Fog.update(dt);
    // Hold everything still for the intro pause — platforms, jets, physics,
    // scoring, the run timer all stay frozen at their just-reset starting
    // state (ball included) until it counts down to 0, then gameplay starts
    // normally on the very next frame.
    if (this.introT > 0) {
      this.introT -= dt;
      return;
    }
    // Hard guarantee the ball starts its very first fall from true rest,
    // whatever the actual cause of Rob's "ball flies off right when it
    // drops" turns out to be — a stray blast-button tap, a sensor reading,
    // anything else that could apply velocity during the frozen intro pause
    // above. Runs exactly once per run, the first frame the intro pause
    // ends (_introJustEnded reset in enter()), not every frame — a real
    // blast/jet/tilt taken immediately after intro should still work
    // normally starting the very next frame.
    if (!this._introJustEnded) {
      this._introJustEnded = true;
      Physics.vx = 0;
      Physics.vy = 0;
      // Recalibrate again right here, not just once back in enter() (Rob:
      // "it's almost like the phone is slightly tilted" — a slow drift off
      // the platform, not a launch, so this isn't the velocity reset above;
      // it's the tilt baseline itself being off). enter()'s calibrate() call
      // happens the instant the level is entered, before the ~2s "Ready...
      // Go!" pause — plenty of time for a hand to settle into a slightly
      // different resting angle than whatever it was doing at that first
      // instant, which would read as a small constant residual tilt for the
      // whole run once gameplay actually starts. Recalibrating at the exact
      // moment gameplay begins instead zeroes to however the phone is
      // *actually* being held right as it matters.
      Input.calibrate();
    }
    if (!this.isOver) {
      for (const p of this.platforms) {
        p.update(dt);
        // Only the platform the ball is actually on (plus a grace window
        // after it leaves) runs its jets now (Rob: "the jets on the
        // platforms that the ball is not on are not going... this keeps
        // the game clean" — then, once it cut off the instant the ball
        // left: "it shouldn't stop immediately... it could be just
        // bouncing... maybe 3 seconds after it leaves"). Grace timer lives
        // on the platform itself (see platform.js's jetGraceRemaining),
        // reset to the full window every frame it IS current so a bounce
        // that comes right back never even gets close to running out.
        // currentPlatform stays set to wherever the ball last rested even
        // while airborne mid-blast (see physics.js), same convention
        // already used for a blast's own launch direction. Jet mount
        // points are distances along the bar, so they scale with
        // lengthScale specifically (how far the bar itself reaches), not
        // the general visualScale (1 for every platform right now).
        // Derived from the live p.length (not the static p.lengthScale) so
        // a pulsing tube's jets slide along with it instead of staying
        // parked at the tube's un-pulsed size.
        const isCurrentPlatform = p === Physics.currentPlatform;
        if (isCurrentPlatform) p.jetGraceRemaining = this.JET_GRACE_SECONDS;
        else if (p.jetGraceRemaining > 0) p.jetGraceRemaining -= dt;
        const jetScale = p.length / (620 * p.visualScale);
        if (isCurrentPlatform || p.jetGraceRemaining > 0) {
          p.jetSystem.update(dt, p.pivot, p.dir, jetScale);
        } else {
          // Rob: "not all of the plasma jets are staying connected to the
          // moving platforms" — mount position still needs to track this
          // platform's real tilt every frame even once it's past the
          // grace window and done making spawn/active-toggle decisions
          // (see jetSystem.updatePositions' own comment), or the plasma
          // jet visual (which, unlike the old particles, sits there
          // continuously) reads as drifting off the bar as it keeps
          // tilting under a stale frozen point.
          p.jetSystem.updatePositions(p.pivot, p.dir, jetScale);
          // Past the grace window — no more spawning/active-toggle
          // decisions for this platform, but any particles already
          // mid-flight still need to keep moving and fading on their own,
          // or they freeze into a static leftover image right where update()
          // stopped touching them (Rob: "the stream stops and there's just
          // a static image of the jet there rather than the jet kind of
          // like going up and dissipating"). Cheap once there's nothing
          // left to advance — jet.particles is empty within half a second.
          p.jetSystem._advanceParticles(dt);
        }
      }
      Difficulty.update(dt);
      this._updateDarkMatterClouds(dt);
      this._updatePlasmaStorms(dt);
      Physics.update(dt, tiltX);
      for (const p of this.platforms) {
        p.hingeBubbles.update(dt, p.touching, p.pivot.x, p.pivot.y);
      }
      // Back to 6,000 points/minute (100/s) — the earlier 1,000/min slowdown was
      // to make the live-updating digits readable, which is now handled by the
      // tabular-number fix instead, so full speed is safe again (Rob).
      if (Physics.touchingHinge) this.score += 100 * dt;
      this.elapsed += dt;
      if (this.elapsed >= this.timeLimit) this.timedOut = true;

      // Potion Blasts are the tower's only way to climb from one platform to
      // the next (gravity alone never lets the ball gain height — see
      // physics.js) — this used to only accrue/spend in Free Play, which
      // silently left Level 1 with no legitimate way to ever climb high
      // enough to reach its own goal line (Rob: "refine level 1 to make it
      // playable"). Now shared by every mode.
      if (this.score >= this.blastThreshold + 1000) {
        this.blastCharges = Math.min(this.MAX_BLAST_CHARGES, this.blastCharges + 1);
        this.blastThreshold += 1000;
      }

      // Level win condition — Physics.y counts down as the ball climbs, so
      // "reached" means at or above (numerically <=) the threshold. Unlocks
      // the next level in Storage right away, not on some later "confirm"
      // tap - the player has already earned it the moment they touch the line.
      if (this._isLevelMode()) {
        const n = this._levelNumber();
        if (!this._levelCompletePending && Physics.y <= this._levelThresholdY(n)) {
          this._levelCompletePending = true;
          this._levelCompleteTimer = 0;
          Storage.setHighestLevelUnlocked(n + 1);
          // Keep the live in-memory copy (game.js's `state`) in sync too, not
          // just what's persisted — LevelsScreenPixi reads state.highestLevelUnlocked
          // directly, and without this the unlock wouldn't show up on the
          // Levels page until the next full page load re-read it from Storage.
          state.highestLevelUnlocked = Math.max(state.highestLevelUnlocked, n + 1);
        }
        // Let the ball keep rolling past the goal line and actually come to
        // rest on the platform before the win screen flips in (Rob: "let the
        // ball go over that line and then land on it, that's when the game
        // should be over"), instead of cutting straight to it the instant
        // the line is crossed. "Landed" = resting on a platform's hinge with
        // its speed settled, not just still airborne from the jet that sent
        // it over the line. MIN_ROLL_DELAY guarantees the roll is visible
        // even if it happens to already be resting the instant it crosses;
        // MAX_ROLL_DELAY is a fallback so a ball that never fully settles
        // (jitters forever at a tiny speed) can't stall the win screen.
        if (this._levelCompletePending) {
          this._levelCompleteTimer += dt;
          const MIN_ROLL_DELAY = 0.6;
          const MAX_ROLL_DELAY = 3;
          const SETTLE_SPEED = 12; // px/s
          const hasLanded = Physics.touchingHinge
            && Math.abs(Physics.vx) < SETTLE_SPEED && Math.abs(Physics.vy) < SETTLE_SPEED;
          if (this._levelCompleteTimer >= MAX_ROLL_DELAY
            || (this._levelCompleteTimer >= MIN_ROLL_DELAY && hasLanded)) {
            this.levelComplete = true;
          }
        }
      }
    } else {
      // Send a finished Free Play run to the online leaderboard, exactly once per run.
      if (!this._scoreSubmitted) {
        this._scoreSubmitted = true;
        if (this.mode === 'freeplay') Leaderboard.submitFreePlayScore(Math.floor(this.score));
      }
      for (const p of this.platforms) p.hingeBubbles.update(dt, false, p.pivot.x, p.pivot.y);
      this.gameOverT = Math.min(1, this.gameOverT + dt / 0.35);
      if (this.leaderboardMsgT > 0) this.leaderboardMsgT = Math.max(0, this.leaderboardMsgT - dt);
      this._updateGoBubbles(dt);
    }

    // Blast buttons show as soon as a run starts, not gated on ever having
    // earned a potion (Rob: waiting on a charge before you could take your
    // very first jump was the "sit around and wait" problem — the normal
    // jump is free/always-available now, see fireBlast() below; a banked
    // charge just makes that same tap into a bigger jump). Still eases
    // in/out (~0.3s) rather than popping instantly.
    const blastTarget = !this.isOver ? 1 : 0;
    this.blastButtonsT += (blastTarget - this.blastButtonsT) * Math.min(1, dt / 0.3);
  },

  // Score width varies (585 vs. a 5-digit "12,345"), so the bubble cluster next
  // to it needs to shift left to make room instead of overlapping — measured via
  // the real canvas font rather than a fixed layout. Shared by the update tick
  // (spawns bubbles using the mask bounds) and the draw call (clips to them),
  // so both agree on where the mask currently is; safe to compute independently
  // in each since the score is frozen for the whole time the screen is up.
  _goScoreLayout() {
    ctx.save();
    ctx.font = `${GO_SCORE_FONT_SIZE}px PotionTitle`;
    const scoreStr = this._scoreText();
    const textWidth = ctx.measureText(scoreStr).width;
    ctx.restore();

    const scoreLeft = GO_SCORE_RIGHT - textWidth;
    const maskRight = scoreLeft - GO_BUBBLE_GAP;
    const maskX = Math.max(GO_BOARD_BORDER.left + 10, maskRight - GO_BUBBLE_MASK_W);
    const maskW = Math.max(20, Math.min(GO_BUBBLE_MASK_W, maskRight - maskX));
    return {
      scoreStr, scoreLeft, textWidth,
      mask: { x: maskX, y: GO_BUBBLE_MASK_Y, w: maskW, h: GO_BUBBLE_MASK_H },
    };
  },

  // Small continuous bubble-up effect next to the Game Over score, clipped to a
  // mask so bubbles appear to rise up out of the panel rather than float freely
  // (matches the original's own "BubbleMask" object over its equivalent effect).
  _updateGoBubbles(dt) {
    const m = this._goScoreLayout().mask;
    this.goBubbleTimer -= dt;
    // `while`, not `if` — same frame-rate-independence fix as the jets/hinge
    // particles (see difficulty.js/platform.js).
    let goBubbleGuard = 0;
    while (this.goBubbleTimer <= 0 && goBubbleGuard < 20) {
      this.goBubbleTimer += 0.12;
      goBubbleGuard++;
      this.goBubbles.push({
        x: m.x + m.w / 2 + (Math.random() - 0.5) * m.w * 0.7,
        y: m.y + m.h + 10,
        r: 4 + Math.random() * 7,
        speed: 30 + Math.random() * 25,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleAmp: 6 + Math.random() * 10,
        life: 0,
        maxLife: (m.h + 30) / (30 + 12.5), // roughly the time to drift from bottom to top
      });
    }
    for (const b of this.goBubbles) {
      b.y -= b.speed * dt;
      b.wobblePhase += dt * 1.4;
      b.life += dt;
    }
    this.goBubbles = this.goBubbles.filter((b) => b.y > m.y - 10);
  },

  showLeaderboardComingSoon() {
    this.leaderboardMsgT = 1.6;
  },

  // Force for the normal, every-platform jump — always free, no charge
  // spent, tap it anytime (Rob: waiting on a charge before every single hop
  // was the game's "not enough action" problem). Unchanged from the
  // original single-tier value (Rob: the boost shouldn't inherit tilt's
  // reduction — a Potion Blast is a deliberate, player-triggered launch, not
  // a steering force) — tuned to comfortably clear one TOWER_SPACING gap.
  BLAST_FORCE: 950,
  // Force for the "big jump", spent from a charged moon — a charged moon
  // jumps 50% HIGHER than normal (Rob's exact spec for the PlasmaOrb "moon
  // charge" system replacing the old potion-bottle charges). Height under
  // constant gravity scales with force squared, so a 50%-higher jump needs
  // force scaled by sqrt(1.5), not 1.5x outright — 950 * sqrt(1.5) ≈ 1163.
  BIG_BLAST_FORCE: 1163,

  // Bumped by the same monotonically each time a charge is actually spent on
  // a big jump — pixi_playscreen.js's refresh() watches this (not a boolean)
  // so it can't miss a discharge that happens to land on the same frame as
  // the last one it noticed, and fires the PlasmaOrb's spark-burst effect
  // for each one. ui.js has no direct handle on the Pixi orb object itself
  // (rendering stays over there), so this is the same "leave a marker here,
  // let the renderer notice and animate it" pattern pixi_gameover.js's own
  // win-particle burst already uses.
  moonDischargeCount: 0,

  _lastBlastAt: 0, // Date.now() of the last accepted tap — see the debounce below
  fireBlast() {
    // introT > 0 shouldn't be reachable via the HUD button (it stays
    // invisible/non-hit-testable until blastButtonsT eases in, which only
    // starts after the intro pause) but belt-and-suspenders against firing
    // during the frozen "Ready" pause regardless of how it got called.
    if (this.isOver || this.introT > 0) return;
    // Rob: "once I hit the jump button, you shouldn't be able to jump again
    // until it lands on something" — Physics.airborne is set true the
    // instant a blast fires and only cleared back to false on landing (see
    // physics.js), so it's exactly "still mid-jump from the last tap."
    if (Physics.airborne) return;
    // iOS Safari can fire two separate tap events for what the player felt
    // as one single tap (Rob: "you can double tap and add multiple jumps on
    // iOS... versus just one jump" — Android doesn't do this). A real
    // double-fire lands within a handful of ms of each other; 200ms comfortably
    // swallows that while still being far shorter than any realistic gap
    // between two deliberate jumps in normal play.
    const now = Date.now();
    if (now - this._lastBlastAt < 200) return;
    this._lastBlastAt = now;
    // Same single tap either way — spends a charge for the bigger jump only
    // when one's actually banked, otherwise it's just the free normal jump.
    const big = this.blastCharges > 0;
    if (big) {
      this.blastCharges--;
      this.moonDischargeCount++;
    }
    Physics.applyBlast(big ? this.BIG_BLAST_FORCE : this.BLAST_FORCE);
  },

  _timeText() {
    if (this.mode === 'level1') return String(Math.max(0, Math.ceil(this.timeLimit - this.elapsed)));
    return String(Math.floor(this.elapsed));
  },

  _potionsFilled() {
    if (this.score >= 2000) return 3;
    if (this.score >= 1000) return 2;
    if (this.score >= 500) return 1;
    return 0;
  },

  // Live HUD potion counter (top-right pill) — uncapped, +1 every 1,000 points,
  // unlike _potionsFilled() above which caps at 3 for the Game Over board icons.
  _potionsMade() {
    return Math.floor(this.score / 1000);
  },

  draw(ctx, images, sceneLabel) {
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, 720, 1280);
    // Same dark-to-light gradient backdrop as the Home screen and the Game Over
    // overlay (Background 1.png), sitting behind the rising fog layers rather
    // than the plain flat fill this screen used before.
    if (images.sky) drawImg(ctx, images.sky, -19, -17, 752, 1309);

    Fog.draw(ctx, images);
    Platform.draw(ctx, images);
    // Ball (and its moon-phase overlay, same position) drawn behind the hinge
    // glow/sprite and the hinge bubbles (Rob's ask) — previously drawn last, so
    // both rendered on top instead of appearing to sit under/against the hinge.
    Physics.draw(ctx, images);
    Difficulty.drawMoon(ctx, images);
    // HingeBubbles now draws from inside Platform.drawHinge() itself, between
    // the dot and the ring, so it isn't called separately here anymore.
    Platform.drawHinge(ctx, images);

    this._drawHud(ctx, images, sceneLabel);

    if (this.isOver) this._drawGameOver(ctx, images);
  },

  _drawHud(ctx, images, sceneLabel) {
    // Score pill — hidden once the run is over (matches the Game Over
    // screenshot, which shows no player name, just the fell-off icon +
    // score inside the board itself — see _drawGameOver). Player name label
    // removed from here per Rob (was drawn as "<name> ·" before the pill).
    if (!this.isOver) {
      const sb = this.scorePillBtn;
      if (images.bubbleScore) {
        ctx.drawImage(images.bubbleScore, sb.x, sb.y, sb.w, sb.h);
      }
      // Digit x/y offsets and font size scaled by the same PILL_SCALE as the
      // pill sprite itself (Rob: "not just the numbers the whole structure").
      drawTabularNumber(ctx, this._scoreText(), sb.x + 125 * this.PILL_SCALE, sb.y + 35 * this.PILL_SCALE,
        { size: 34 * this.PILL_SCALE, font: 'PotionTitle', color: '#9b9b9b' });

      // Potion counter — top-right pill (Free Play's "Timer" instance in the
      // source, despite the misleading name it uses Potion Counter.png).
      // +1 every 1,000 points (Rob). Digit color matches the score pill's
      // number (Rob's gray, #9b9b9b) for consistency between the two pills.
      const cb = this.potionCounterBtn;
      if (images.potionCounter) {
        // The potion pill ends up scaled down more aggressively than the
        // score pill relative to each PNG's own native resolution (their
        // ovals are sized to match, but Potion Counter.png is natively
        // taller), which shrinks its *baked-in* glow halo along with it —
        // so at this size the glow reads much fainter than the score pill's
        // (Rob). Reinforce it with an extra blurred, slightly oversized copy
        // underneath rather than redrawing the border by hand.
        ctx.save();
        ctx.filter = 'blur(5px)';
        ctx.globalAlpha = 0.7;
        ctx.drawImage(images.potionCounter, cb.x - 3, cb.y - 3, cb.w + 6, cb.h + 6);
        ctx.restore();
        ctx.drawImage(images.potionCounter, cb.x, cb.y, cb.w, cb.h);
      }
      // Digit x-offset kept at the same fraction of pill width as the real
      // source's text-vs-pill offset (82/191), so it stays put as the pill's
      // own size changes. Y uses the oval's own vertical center (native
      // y57-191, center 124 of 259) rather than the full image's center —
      // the oval sits with uneven top/bottom padding in the source PNG (the
      // bottle towers above it), so cb.h/2 landed visibly low (Rob).
      drawTabularNumber(ctx, String(this._potionsMade()), cb.x + cb.w * (97 / 191), cb.y + cb.h * (124 / 259),
        { size: 34 * this.PILL_SCALE, font: 'PotionTitle', color: '#9b9b9b', baseline: 'middle' });
    }

    // In-game mute toggle — same shared mute state as Home, now moved to the
    // bottom-right corner (Rob) to match the Home screen's own placement,
    // vacating the top-right for the potion counter pill above.
    const muteImg = state.muted ? images.muteMuted : images.muteUnmuted;
    drawImg(ctx, muteImg, this.muteBtn.x, this.muteBtn.y, this.muteBtn.w, this.muteBtn.h);

    if (this.mode === 'freeplay' && this.blastButtonsT > 0.001) this._drawBlastButtons(ctx, images);
  },

  _drawBlastButtons(ctx, images) {
    const t = this.blastButtonsT;
    const active = this.blastCharges > 0;
    // Subtle grow+fade tied to blastButtonsT instead of an instant pop
    // in/out (Rob) — scale eases 85%→100% while alpha fades 0→1, each
    // button scaling from its own center so it doesn't drift position.
    const scale = 0.85 + 0.15 * t;
    ctx.save();
    ctx.globalAlpha = (active ? 1 : 0.35) * t;
    for (const btn of [this.blastLeftBtn, this.blastRightBtn]) {
      const cx = btn.x + btn.w / 2, cy = btn.y + btn.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      // Ring is the real asset now (Blast.png — Rob added it to assets/,
      // "the button is called blast") instead of a hand-drawn stroke, since
      // my canvas-drawn gradient highlight didn't read right. It already has
      // the glowing purple ring + top glossy reflection baked in. Measured
      // its crisp ring band directly (rgb(121,62,249) — same color as
      // Blast2.png's, confirming it's the matching asset): radius 267px out
      // of the 897px-wide canvas's 448.5px half-width, ratio 0.595. Scaled
      // so that band lands at the same ringR as before (circle smaller,
      // bottle stays the same size — btn.w * 0.55 below, untouched).
      const ringR = btn.w * 0.5 * 0.7;
      if (images.blastRing) {
        const ringDrawSize = (ringR / 0.595) * 2;
        drawImg(ctx, images.blastRing, cx - ringDrawSize / 2, cy - ringDrawSize / 2, ringDrawSize, ringDrawSize);
      }

      const bw = btn.w * 0.55, bh = bw * (176 / 144);
      if (images.potionFilled) {
        drawImg(ctx, images.potionFilled, cx - bw / 2, cy - bh / 2, bw, bh);
      }

      // Charge-count number pulled in tight against the bottle's own
      // top-left corner (Rob) rather than out near the ring, so its offset
      // is anchored to the bottle's own half-width instead of ringR.
      const numX = cx - bw * 0.42, numY = cy - bh * 0.42;
      const numFontSize = btn.w * 0.11 * 1.15 * 1.5;

      // Small circle behind the number, colored to match the pole's own flat
      // sprite fill (Rob) — sampled directly from NewSprite.png's center
      // pixel: rgb(33,24,46), a dark slate-purple, not the bright ring purple.
      ctx.beginPath();
      ctx.arc(numX, numY, numFontSize * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(33, 24, 46)';
      ctx.fill();

      ctx.font = `${numFontSize}px PotionTitle`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#9b9b9b';
      ctx.fillText(String(this.blastCharges), numX, numY);

      ctx.restore();
    }
    ctx.restore();
  },

  _scoreText() {
    const s = Math.floor(this.score);
    return s >= 1000 ? `${Math.floor(s / 1000)},${String(s % 1000).padStart(3, '0')}` : String(s);
  },

  // Rebuilt to match the original's actual layout, pulled from the source project's
  // own scene coordinates (not guessed) — a full-screen dark fade, the real "GAME
  // OVER" art positioned about 44% down the screen (x50 y563 w624 out of the
  // 720x1280 scene, independent of any card/board — there's no solid panel behind
  // it, just the dark fade), and the button pill pinned near the bottom. The first
  // version of this screen invented its own mid-screen "card" with a solid backing,
  // a duplicate purple score readout, and a potion-fill row — none of which
  // actually appear in the real game (confirmed against Rob's screenshot of it).
  _drawGameOver(ctx, images) {
    const fadeIn = Math.min(1, this.gameOverT * 2);

    // Backdrop: the same gradient used behind the Home screen (dark at the
    // bottom, lighter toward the top) — the original's own "DarkOverlay" object
    // reuses this exact image at ~90% opacity rather than a flat black fill,
    // which is what this port was doing before (that read as a plain black
    // screen instead of the moody gradient in Rob's reference).
    if (images.sky) {
      ctx.save();
      ctx.globalAlpha = 0.92 * fadeIn;
      drawImg(ctx, images.sky, -19, -17, 752, 1309);
      ctx.restore();
    }
    ctx.fillStyle = `rgba(0,0,0,${0.35 * fadeIn})`;
    ctx.fillRect(0, 0, 720, 1280);

    const t = easeOutBack(this.gameOverT);

    // The board: a glow-outline frame (GameOver11.png) with a genuinely
    // transparent interior — no solid backing behind it. Positioned at the
    // original's own coordinates (x≈-20 y127 w759 h343 in the 720x1280 scene) —
    // it sits directly below the small top-left HUD pill (which ends at y124),
    // close enough that the two read as one continuous panel, matching Rob's
    // reference screenshot.
    const boardX = (720 - 759) / 2, boardY = 127, boardW = 759, boardH = 343;
    if (images.gameOverBoard) {
      ctx.save();
      ctx.globalAlpha = fadeIn;
      drawImg(ctx, images.gameOverBoard, boardX, boardY, boardW, boardH);

      // "Ball fell off the platform" icon — a real asset (Ball Off.png: a small
      // gray T-shaped platform silhouette with a pink dot beside it), object name
      // "GameOver2" in the source. Real position is x=92 y=261 w=172 h=106 in the
      // 720x1280 scene — my first pass at this (boardX+55, boardY+48, 100x62) was
      // an unverified guess made before I'd actually found this object in the
      // source file, and sat noticeably too high/small.
      if (images.gameOverBallOff) drawImg(ctx, images.gameOverBallOff, 92, 261, 172, 106);

      const goLayout = this._goScoreLayout();

      // Bubble-up effect immediately left of the score, clipped to a mask so
      // the bubbles read as rising up out of the panel rather than floating
      // freely (Rob: "masked by the panel and bubbling up") — matches the
      // original's own "BubbleMask" object over its equivalent effect. Uses the
      // real bubble art (BubblesFinal.png, cropped to one isolated glossy bubble
      // near its top-right) instead of flat hand-drawn circles, for a more
      // realistic look. The mask itself shifts left as the score gets wider
      // (via _goScoreLayout) so a 4-5 digit score doesn't run into it.
      const BUBBLE_SPRITE = { sx: 300, sy: 0, sw: 228, sh: 210 };
      const mask = goLayout.mask;
      ctx.save();
      ctx.beginPath();
      ctx.rect(mask.x, mask.y, mask.w, mask.h);
      ctx.clip();
      if (images.bubblesFinal) {
        const maskBottom = mask.y + mask.h;
        for (const b of this.goBubbles) {
          const x = b.x + Math.sin(b.wobblePhase) * b.wobbleAmp;
          // Fades at both the top (fully faded out before reaching the border
          // line) and the bottom (fades IN over ~25px instead of snapping to
          // full opacity right at the mask edge, which read as bubbles
          // "coming out of a line" rather than emerging gradually).
          const topFade = Math.min(1, Math.max(0, (b.y - mask.y) / 20));
          const bottomFade = Math.min(1, Math.max(0, (maskBottom - b.y) / 25));
          const edgeFade = Math.min(topFade, bottomFade);
          if (edgeFade <= 0.01) continue;
          ctx.globalAlpha = edgeFade;
          ctx.drawImage(images.bubblesFinal, BUBBLE_SPRITE.sx, BUBBLE_SPRITE.sy, BUBBLE_SPRITE.sw, BUBBLE_SPRITE.sh,
            x - b.r, b.y - b.r, b.r * 2, b.r * 2);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // Final score — the source's own "FinalScoreText" object, right-anchored
      // near the board's real right border (x=670 of the measured x37-681 line)
      // instead of a fixed-width centered box, so it grows leftward for longer
      // numbers (pushing the bubble mask over with it) rather than overflowing
      // the border or overlapping the bubbles. Grey #9b9b9b per Rob's spec —
      // matching "GAME OVER" itself, not the small HUD pill's white/purple tone.
      ctx.save();
      ctx.font = `${GO_SCORE_FONT_SIZE}px PotionTitle`;
      ctx.fillStyle = '#9b9b9b';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 3;
      ctx.fillText(goLayout.scoreStr, goLayout.scoreLeft, GO_SCORE_Y);
      ctx.restore();

      // 3 potion-fill icons inside the board, at the original's own relative
      // position (x428/497/562 y311 out of the 720-wide scene).
      const filled = this._potionsFilled();
      const potionXs = [428, 497, 562];
      potionXs.forEach((px, i) => {
        const img = i < filled ? images.potionFilled : images.potionEmpty;
        if (img) drawImg(ctx, img, px, 311, 72, 88);
      });
      ctx.restore();
    }

    if (images.gameOverText) {
      const w = 560, h = w * (images.gameOverText.height / images.gameOverText.width);
      // Slight glow + flicker concentrated toward the bottom of the letters —
      // two overlapping sine waves so it doesn't read as a perfectly regular
      // pulse, more like an unstable neon sign. White and more subtle per Rob's
      // follow-up (was purple-tinted and too strong).
      const now = Date.now();
      const flicker = 0.7 + 0.3 * (0.6 * Math.sin(now / 180) + 0.4 * Math.sin(now / 47));
      ctx.save();
      ctx.globalAlpha = fadeIn;
      ctx.translate(360, 560 + h / 2);
      ctx.scale(t, t);
      ctx.shadowColor = `rgba(255, 255, 255, ${Math.max(0, 0.35 * flicker)})`;
      ctx.shadowBlur = 12 * flicker;
      ctx.shadowOffsetY = 8;
      drawImg(ctx, images.gameOverText, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    // Row of 3 round buttons (home / restart / 3rd shortcut) — one combined pill
    // image with 3 equal tap-zones, matching the original (previously this port
    // substituted its own plain text buttons because I'd assumed the original had
    // no real art here — it did, just uncopied). Free Play's 3rd icon opens the
    // leaderboard; Level 1's opens the levels grid. Sized at the source art's own
    // aspect ratio (855x358 in the original scene) instead of the squashed 460x96
    // this port used at first.
    const barW = 430 * 1.6 * 1.1, barH = barW * (358 / 855); // Rob: 60% bigger, then +10% more
    const barX = (720 - barW) / 2, barY = 1280 - barH - 20; // pinned near the bottom with a small margin
    const bottomImg = this.mode === 'level1' ? images.bottomButtonsLevels : images.bottomButtonsFreeplay;
    if (bottomImg) drawImg(ctx, bottomImg, barX, barY, barW, barH);
    this.bottomButtonsRect = { x: barX, y: barY, w: barW, h: barH };

    if (this.leaderboardMsgT > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.leaderboardMsgT);
      drawCenteredText(ctx, 'Leaderboard coming soon!', 0, barY - 40, 720,
        { size: 24, font: 'PotionBody', color: '#fff' });
      ctx.restore();
    }
  },

  hitTest(x, y) {
    if (this.isOver) {
      if (this.gameOverT < 1) return null;
      const b = this.bottomButtonsRect;
      if (b && rectContains(b.x, b.y, b.w, b.h, x, y)) {
        const third = Math.floor((x - b.x) / (b.w / 3));
        if (third === 0) return { target: 'home' };
        if (third === 1) return { target: 'retry' };
        return { target: this.mode === 'level1' ? 'levels' : 'leaderboard' };
      }
      return null;
    }
    if (rectContains(this.muteBtn.x, this.muteBtn.y, this.muteBtn.w, this.muteBtn.h, x, y)) return { target: 'mute' };
    if (this.mode === 'freeplay' && this.blastButtonsT > 0.5) {
      if (rectContains(this.blastLeftBtn.x, this.blastLeftBtn.y, this.blastLeftBtn.w, this.blastLeftBtn.h, x, y)) return { target: 'blast' };
      if (rectContains(this.blastRightBtn.x, this.blastRightBtn.y, this.blastRightBtn.w, this.blastRightBtn.h, x, y)) return { target: 'blast' };
    }
    return null;
  },
};

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
