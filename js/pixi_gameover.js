// Game Over screen, rebuilt on Pixi — the last major piece of Phase 1 (see
// PINBALL_EXPANSION_PLAN.md). Same pattern as pixi_hud.js: reuses PlayScreen's
// (old ui.js) own already-worked-out layout/state directly (_goScoreLayout(),
// GO_BOARD_BORDER, GO_SCORE_*, _potionsFilled(), goBubbles, gameOverT, mode)
// rather than reimplementing any of that dense, source-verified geometry.
const GameOverPixi = {
  container: null,

  build(textures) {
    const c = new PIXI.Container();
    c.visible = false;
    this.container = c;

    this._skyBg = new PIXI.Sprite(textures.sky);
    this._skyBg.position.set(-19, -17);
    this._skyBg.width = 752; this._skyBg.height = 1309;
    c.addChild(this._skyBg);

    this._blackFade = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x000000);
    c.addChild(this._blackFade);

    const boardX = (720 - 759) / 2, boardY = 127, boardW = 759, boardH = 343;
    this._board = new PIXI.Container();
    this._board.position.set(boardX, boardY);
    c.addChild(this._board);

    const boardSprite = new PIXI.Sprite(textures.gameOverBoard);
    boardSprite.width = boardW; boardSprite.height = boardH;
    this._board.addChild(boardSprite);

    const ballOff = new PIXI.Sprite(textures.gameOverBallOff);
    ballOff.position.set(92 - boardX, 261 - boardY);
    ballOff.width = 172; ballOff.height = 106;
    this._board.addChild(ballOff);

    // Bubble-up effect — cropped to one isolated glossy bubble from
    // BubblesFinal.png's sprite sheet (sx300 sy0 228x210), masked to a rect
    // that shifts with the score's width (see PlayScreen._goScoreLayout()).
    const bubbleFrame = new PIXI.Rectangle(300, 0, 228, 210);
    this._bubbleTexture = new PIXI.Texture({ source: textures.bubblesFinal.source, frame: bubbleFrame });
    this._bubbleMask = new PIXI.Graphics();
    this._bubbleContainer = new PIXI.Container();
    this._bubbleContainer.mask = this._bubbleMask;
    this._board.addChild(this._bubbleMask, this._bubbleContainer);
    this._bubblePool = [];

    this._scoreText = new PIXI.Text({
      text: '0', style: { fontFamily: 'PotionTitle', fontSize: GO_SCORE_FONT_SIZE, fill: 0x9b9b9b },
    });
    this._scoreText.position.set(0, GO_SCORE_Y - boardY);
    this._board.addChild(this._scoreText);

    this._potionIcons = [428, 497, 562].map((px) => {
      const s = new PIXI.Sprite(textures.potionEmpty);
      s.position.set(px - boardX, 311 - boardY);
      s.width = 72; s.height = 88;
      this._board.addChild(s);
      return s;
    });

    // "GAME OVER" art — a blurred white duplicate underneath for the glow,
    // alpha driven by the same two-sine flicker formula as the old ctx
    // version (shadowBlur has no direct Pixi equivalent; a blurred tinted
    // copy behind the crisp sprite reads the same way).
    this._gameOverContainer = new PIXI.Container();
    this._gameOverContainer.position.set(360, 0); // y set per-frame once texture aspect is known
    c.addChild(this._gameOverContainer);
    const goW = 560, goH = goW * (textures.gameOverText.height / textures.gameOverText.width);
    this._gameOverGlow = new PIXI.Sprite(textures.gameOverText);
    this._gameOverGlow.anchor.set(0.5);
    this._gameOverGlow.width = goW; this._gameOverGlow.height = goH;
    this._gameOverGlow.tint = 0xffffff;
    this._gameOverGlow.filters = [new PIXI.BlurFilter({ strength: 6 })];
    this._gameOverSprite = new PIXI.Sprite(textures.gameOverText);
    this._gameOverSprite.anchor.set(0.5);
    this._gameOverSprite.width = goW; this._gameOverSprite.height = goH;
    this._gameOverContainer.addChild(this._gameOverGlow, this._gameOverSprite);
    this._gameOverH = goH;

    // Bottom 3-button pill — one image, 3 equal interactive hit-zones (home /
    // retry / leaderboard-or-levels) matching PlayScreen.hitTest()'s own
    // third-split logic exactly, just as real Pixi event zones instead of a
    // manual x-coordinate check.
    const barW = 430 * 1.6 * 1.1, barH = barW * (358 / 855);
    const barX = (720 - barW) / 2, barY = 1280 - barH - 20;
    this._barRect = { x: barX, y: barY, w: barW, h: barH };
    this._barFreeplay = new PIXI.Sprite(textures.bottomButtonsFreeplay);
    this._barLevels = new PIXI.Sprite(textures.bottomButtonsLevels);
    for (const s of [this._barFreeplay, this._barLevels]) {
      s.position.set(barX, barY);
      s.width = barW; s.height = barH;
    }
    c.addChild(this._barFreeplay, this._barLevels);
    const thirdW = barW / 3;
    ['home', 'retry', 'third'].forEach((target, i) => {
      const zone = new PIXI.Graphics().rect(barX + thirdW * i, barY, thirdW, barH).fill({ color: 0xffffff, alpha: 0.001 });
      zone.eventMode = 'static';
      zone.cursor = 'pointer';
      zone.on('pointertap', () => {
        if (PlayScreen.gameOverT < 1) return; // matches hitTest()'s own "not clickable until popped in" guard
        if (target === 'home') goHome();
        else if (target === 'retry') PlayScreen.enter(state.screen);
        else if (PlayScreen.mode === 'level1') state.screen = 'levels';
        else PlayScreen.showLeaderboardComingSoon();
      });
      c.addChild(zone);
    });

    this._leaderboardMsg = new PIXI.Text({
      text: 'Leaderboard coming soon!', style: { fontFamily: 'PotionBody', fontSize: 24, fill: 0xffffff, align: 'center' },
    });
    this._leaderboardMsg.anchor.set(0.5, 0);
    this._leaderboardMsg.position.set(360, barY - 40);
    c.addChild(this._leaderboardMsg);
  },

  refresh() {
    this.container.visible = PlayScreen.isOver;
    if (!PlayScreen.isOver) return;

    const fadeIn = Math.min(1, PlayScreen.gameOverT * 2);
    const t = easeOutBack(PlayScreen.gameOverT);

    this._skyBg.alpha = 0.92 * fadeIn;
    this._blackFade.alpha = 0.35 * fadeIn;
    this._board.alpha = fadeIn;

    const goLayout = PlayScreen._goScoreLayout();
    this._scoreText.text = goLayout.scoreStr;
    this._scoreText.x = goLayout.scoreLeft - this._board.x;

    const m = goLayout.mask;
    this._bubbleMask.clear().rect(m.x - this._board.x, m.y - this._board.y, m.w, m.h).fill(0xffffff);
    const maskBottom = m.y + m.h;
    const bubbles = PlayScreen.goBubbles;
    while (this._bubblePool.length < bubbles.length) {
      const s = new PIXI.Sprite(this._bubbleTexture);
      s.anchor.set(0.5);
      this._bubbleContainer.addChild(s);
      this._bubblePool.push(s);
    }
    while (this._bubblePool.length > bubbles.length) this._bubbleContainer.removeChild(this._bubblePool.pop());
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const x = b.x + Math.sin(b.wobblePhase) * b.wobbleAmp;
      const topFade = Math.min(1, Math.max(0, (b.y - m.y) / 20));
      const bottomFade = Math.min(1, Math.max(0, (maskBottom - b.y) / 25));
      const s = this._bubblePool[i];
      s.position.set(x - this._board.x, b.y - this._board.y);
      s.width = s.height = b.r * 2;
      s.alpha = Math.max(0, Math.min(topFade, bottomFade));
    }

    const filled = PlayScreen._potionsFilled();
    this._potionIcons.forEach((s, i) => { s.texture = i < filled ? textures.potionFilled : textures.potionEmpty; });

    // Three sine layers with deliberately non-aligned periods/phases (not simple
    // multiples of each other) instead of the original's two fast ones (180ms/
    // 47ms) — that combination repeated often enough to read as a fast, regular
    // pulse rather than a flicker. First pass (900/550/1300ms) read too slow —
    // split the difference back toward the original's speed (Rob).
    const now = Date.now();
    const flicker = 0.75 + 0.25 * (
      0.45 * Math.sin(now / 480) +
      0.35 * Math.sin(now / 300 + 1.3) +
      0.2 * Math.sin(now / 700 + 2.7)
    );
    this._gameOverContainer.y = 560 + this._gameOverH / 2;
    this._gameOverContainer.scale.set(t);
    this._gameOverContainer.alpha = fadeIn;
    this._gameOverGlow.alpha = Math.max(0, 0.9 * flicker);

    const bottomIsLevels = PlayScreen.mode === 'level1';
    this._barFreeplay.visible = !bottomIsLevels;
    this._barLevels.visible = bottomIsLevels;

    this._leaderboardMsg.alpha = Math.min(1, PlayScreen.leaderboardMsgT);
    this._leaderboardMsg.visible = PlayScreen.leaderboardMsgT > 0;
  },
};
