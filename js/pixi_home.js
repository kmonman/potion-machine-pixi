// Home screen, rebuilt on PixiJS (see PINBALL_EXPANSION_PLAN.md) — first vertical
// slice of the "whole game on Pixi" rebuild. Unlike the old Canvas 2D version
// (ui.js's HomeScreen, which redraws everything from scratch every frame), Pixi is
// retained-mode: every visual piece is created ONCE in build(), added to a
// Container, and left alone — only the handful of things that actually change
// (mute icon, warning text visibility) get touched per state update.
//
// Levels/PlayScreen are NOT migrated yet — this is intentionally the first proven
// slice, not the whole game. See game.js for how screens are switched.
const HomeScreenPixi = {
  container: null,
  _muteSprite: null,
  _nameWarningText: null,
  _motionOverlay: null,
  _motionText: null,
  _motionDeniedText: null,

  build(textures, state) {
    const c = new PIXI.Container();
    this.container = c;

    const bg = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x0a0410);
    c.addChild(bg);

    const sky = new PIXI.Sprite(textures.sky);
    sky.position.set(-19, -17);
    sky.width = 752; sky.height = 1309;
    c.addChild(sky);

    const liveGame = new PIXI.Sprite(textures.liveGame);
    liveGame.position.set(-10, 286);
    liveGame.width = 692; liveGame.height = 721;
    c.addChild(liveGame);

    const logo = new PIXI.Sprite(textures.logo);
    logo.position.set(11, -12);
    logo.width = 677; logo.height = 369;
    c.addChild(logo);

    // Free Play + Levels buttons and their captions, grouped so landscape can
    // move the pair as one unit (see setLandscapeMode) without touching their
    // authored portrait positions — same "wrapper + offset" approach used for
    // Game Over's board/bar (Rob liked that this doesn't disturb portrait at
    // all: the group just sits at offset (0,0) there).
    this._playButtonsGroup = new PIXI.Container();
    c.addChild(this._playButtonsGroup);
    // Bottom edge of the buttons in design coordinates (721 + 285) and the
    // x-midpoint between their two centers (187.5 and 532.5) — both used by
    // setLandscapeMode to reposition the group without re-deriving them.
    this._playButtonsBottom = 721 + 285;
    this._playButtonsCenterX = 360;

    const freePlayBtn = new PIXI.Sprite(textures.freePlayButton);
    freePlayBtn.position.set(45, 721);
    freePlayBtn.width = 285; freePlayBtn.height = 285;
    freePlayBtn.eventMode = 'static';
    freePlayBtn.cursor = 'pointer';
    freePlayBtn.on('pointertap', () => tryEnterGame('FreePlay'));
    this._playButtonsGroup.addChild(freePlayBtn);

    const levelModeBtn = new PIXI.Sprite(textures.levelModeButton);
    levelModeBtn.position.set(390, 721);
    levelModeBtn.width = 285; levelModeBtn.height = 285;
    levelModeBtn.eventMode = 'static';
    levelModeBtn.cursor = 'pointer';
    levelModeBtn.on('pointertap', () => tryEnterGame('Levels'));
    this._playButtonsGroup.addChild(levelModeBtn);

    this._playButtonsGroup.addChild(this._centeredText('FREE PLAY for high score', 81, 970, 209, 22, 'PotionBody', 0x77a3fc));
    this._playButtonsGroup.addChild(this._centeredText('Make potion to advance LEVELS', 390, 970, 283, 22, 'PotionBody', 0x77a3fc));

    this._nameWarningText = this._centeredText('Enter name before starting game', 133, 1132, 454, 24, 'PotionBody', 0xbd10e0);
    this._nameWarningText.visible = false;
    c.addChild(this._nameWarningText);

    // Mute button — hit area (muteHit, 64x64) is a bit bigger than the visible
    // sprite (muteBtn, 57x68) for an easier tap target, same as the old version.
    const muteHitX = 631, muteHitY = 1184, muteHitW = 64, muteHitH = 64;
    const muteBtnX = 637, muteBtnY = 1186, muteBtnW = 57, muteBtnH = 68;
    this._muteSprite = new PIXI.Sprite(state.muted ? textures.muteMuted : textures.muteUnmuted);
    this._muteSprite.position.set(muteBtnX, muteBtnY);
    this._muteSprite.width = muteBtnW; this._muteSprite.height = muteBtnH;
    c.addChild(this._muteSprite);

    const muteHit = new PIXI.Graphics().rect(muteHitX, muteHitY, muteHitW, muteHitH).fill({ color: 0xffffff, alpha: 0.001 });
    muteHit.eventMode = 'static';
    muteHit.cursor = 'pointer';
    muteHit.on('pointertap', () => toggleMute());
    c.addChild(muteHit);

    this._motionOverlay = new PIXI.Container();
    this._motionOverlay.visible = false;
    const motionSprite = new PIXI.Sprite(textures.motionButton);
    motionSprite.position.set(-21, 504);
    motionSprite.width = 756; motionSprite.height = 237;
    this._motionOverlay.addChild(motionSprite);
    this._motionText = this._centeredText('Requesting motion access…', -21, 504 + 237 + 10, 756, 22, 'PotionBody', 0xffffff);
    this._motionOverlay.addChild(this._motionText);
    c.addChild(this._motionOverlay);

    this._motionDeniedText = this._centeredText(
      'Motion access was denied.\nPlease allow motion access in your\nbrowser settings, then reload the page.',
      40, 560, 640, 24, 'PotionBody', 0xbd10e0,
    );
    this._motionDeniedText.visible = false;
    c.addChild(this._motionDeniedText);
  },

  // Small helper matching the old drawCenteredText's behavior (multi-line,
  // centered within a given box width) using Pixi's Text object.
  _centeredText(str, x, y, w, size, fontFamily, color) {
    const t = new PIXI.Text({
      text: str,
      style: { fontFamily, fontSize: size, fill: color, align: 'center', lineHeight: size * 1.15 },
    });
    t.anchor.set(0.5, 0);
    t.position.set(x + w / 2, y);
    return t;
  },

  // Called by game.js's fitGameWrap() on every resize/orientation change.
  // Moves the Free Play / Levels button pair as one unit (no scaling — Rob
  // wants them the same size and the same distance apart, just repositioned)
  // so they sit just above the bottom of the visible landscape crop and stay
  // centered as that crop's width changes, instead of sitting off past the
  // bottom of a portrait-height design entirely out of view. Portrait passes
  // isLandscape=false and the group sits at its authored (0,0) offset,
  // unchanged.
  setLandscapeMode(isLandscape, renderWidth, visibleBottomY) {
    if (!this._playButtonsGroup) return;
    if (isLandscape) {
      const BOTTOM_MARGIN = 40; // "slightly above the bottom" (Rob)
      const offsetY = (visibleBottomY - BOTTOM_MARGIN) - this._playButtonsBottom;
      const offsetX = renderWidth / 2 - this._playButtonsCenterX;
      this._playButtonsGroup.position.set(offsetX, offsetY);
    } else {
      this._playButtonsGroup.position.set(0, 0);
    }
  },

  // Called every frame (cheap — just visibility/texture swaps, no rebuilding)
  // to reflect state changes, replacing the old draw()'s state-dependent bits.
  refresh(textures, state) {
    this._muteSprite.texture = state.muted ? textures.muteMuted : textures.muteUnmuted;
    this._nameWarningText.visible = state.showNameWarning;
    this._motionOverlay.visible = state.requestingMotion;
    this._motionDeniedText.visible = state.motionDenied;
  },
};
