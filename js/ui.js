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
    nameWarning: { x: 133, y: 1132, w: 454, h: 60 },
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

    if (state.showNameWarning) {
      drawCenteredText(ctx, 'Enter name before starting game', L.nameWarning.x, L.nameWarning.y, L.nameWarning.w,
        { size: 24, font: 'PotionBody', color: COLOR.warn });
    }

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

// ---------- Play screen (Level 1 / Free Play) ----------
// Core ball-on-a-see-saw mechanic. Both modes still share the same difficulty
// script (Level 1's own fixed schedule isn't built yet — see CLAUDE.md), but they
// do differ here: Level 1 has a 30s countdown and times out, Free Play just counts
// up and only ends when the ball falls.
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
  gameOverT: 0, // 0-1 pop-in progress once the run has ended
  leaderboardMsgT: 0, // >0 while the "coming soon" message is showing
  goBubbles: [], // continuously-bubbling particles next to the Game Over score
  goBubbleTimer: 0,

  // Free Play only: a charge every 1000 points, tap a blast button to spend one.
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

  // Vertical gap (world px) between platform pivots in the tower. Bumped from
  // 260 to 300 (Rob: move the top/middle platforms up higher). A blast's peak
  // vertical reach alone is still roughly force^2/(2*gravityY) ≈ 300px, but
  // the platforms are no longer stacked directly above one another (see
  // TOWER_X_OFFSET below), so the real distance a blast needs to cover is the
  // diagonal to a horizontally-offset target, well inside a 950-force blast's
  // actual projectile range (v^2/gravityY ≈ 600px) once aimed toward it rather
  // than straight up.
  TOWER_SPACING: 300,
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
  _buildTower() {
    const baseX = 360, baseY = 652;
    // Different tubeSpeed per platform (Rob: the three tubes should change at
    // different intervals) — 1 is TUBE_STAGE_SCHEDULE's own pacing, so these
    // drift the middle/top platforms out of sync with the base rather than
    // all three heating up in lockstep.
    const platforms = [
      createPlatform(baseX, baseY, { hasPole: true, tubeSpeed: 1 }),
      createPlatform(baseX + this.TOWER_X_OFFSET, baseY - this.TOWER_SPACING, { lengthScale: 0.7, tubeSpeed: 0.75 }),
      createPlatform(baseX - this.TOWER_X_OFFSET, baseY - this.TOWER_SPACING * 2, { lengthScale: 0.7, tubeSpeed: 1.3 }),
    ];
    // New platforms go higher than whatever's already there, not at some
    // in-between height that overlaps the existing ones (Rob) — this one
    // sits above the current topmost platform (the zigzag's top, index 2),
    // not just above the base.
    const topPivotY = platforms[2].pivot.y;
    platforms.push(createPlatform(baseX + this.SIDE_PLATFORM_X_OFFSET, topPivotY - 200, { lengthScale: 0.7, tubeSpeed: 1.1 }));
    platforms[0].jetSystem = createJetSystem();
    platforms[1].jetSystem = createJetSystem({ allowedIndices: [0] });
    platforms[2].jetSystem = createJetSystem({ allowedIndices: [1] });
    platforms[3].jetSystem = createJetSystem({ allowedIndices: [2, 3] }); // inner jets, for variety from the outer-only mid/top
    for (const p of platforms) {
      p.hingeBubbles = createHingeBubbles();
    }
    return platforms;
  },

  enter(mode) {
    this.mode = mode || this.mode;
    Difficulty.reset();
    // Reuse the same platform instances every run rather than rebuilding new
    // ones — game.js's main() seeds `this.platforms` once at boot (before
    // PlayScreenPixi.build() runs, which attaches Pixi display objects to each
    // platform via `p._visual`), and replacing those objects here would orphan
    // that whole Pixi visual tree. Just reset their state in place instead,
    // same as the old singleton Platform.reset() always did.
    if (!this.platforms) this.platforms = this._buildTower();
    for (const p of this.platforms) {
      p.reset();
      p.jetSystem.reset();
      p.hingeBubbles.reset();
    }
    Physics.reset(this.platforms);
    Fog.reset();
    this.score = 0;
    this.elapsed = 0;
    this.timedOut = false;
    this.gameOverT = 0;
    this.leaderboardMsgT = 0;
    this.goBubbles = [];
    this.goBubbleTimer = 0;
    this.blastCharges = 0;
    this.blastThreshold = 0;
    this.blastButtonsT = 0;
    // Brief pause before anything moves (Rob): the new screen appears with
    // the ball sitting at its starting spot just above the platform, held
    // there for a beat so the player actually sees the layout before the
    // ball drops, instead of it already falling the instant the screen
    // shows up.
    this.introT = 2;
  },

  get isOver() { return Physics.fellOff || this.timedOut; },
  get timeLimit() { return this.mode === 'level1' ? 30 : Infinity; },

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
    if (!this.isOver) {
      for (const p of this.platforms) {
        p.update(dt);
        // Jet mount points are distances along the bar, so they scale with
        // lengthScale specifically (how far the bar itself reaches), not the
        // general visualScale (which is 1 for every platform right now).
        p.jetSystem.update(dt, p.pivot, p.dir, p.lengthScale);
      }
      Difficulty.update(dt);
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

      if (this.mode === 'freeplay' && this.score >= this.blastThreshold + 1000) {
        this.blastCharges++;
        this.blastThreshold += 1000;
      }
    } else {
      for (const p of this.platforms) p.hingeBubbles.update(dt, false, p.pivot.x, p.pivot.y);
      this.gameOverT = Math.min(1, this.gameOverT + dt / 0.35);
      if (this.leaderboardMsgT > 0) this.leaderboardMsgT = Math.max(0, this.leaderboardMsgT - dt);
      this._updateGoBubbles(dt);
    }

    // Blast buttons show once the player has ever earned a potion this run
    // (stays true for the rest of the run even after spending down to 0 —
    // that's what the separate 0.35-alpha dimming in pixi_hud.js's refresh()
    // is for), and ease in/out (~0.3s) rather than popping instantly (Rob).
    const blastTarget = (this.mode === 'freeplay' && !this.isOver && this._potionsMade() > 0) ? 1 : 0;
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

  fireBlast() {
    if (this.mode !== 'freeplay' || this.blastCharges <= 0 || this.isOver) return;
    this.blastCharges--;
    // Bumped from 600 — this is now also the tower's climb mechanic (Rob: use
    // the existing potion blasters to get to the next platform up), so it needs
    // enough force to actually clear TOWER_SPACING, not just hop in place.
    Physics.applyBlast(950);
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
