// Home screen, rebuilt on PixiJS (see PINBALL_EXPANSION_PLAN.md) — first vertical
// slice of the "whole game on Pixi" rebuild. Unlike the old Canvas 2D version
// (ui.js's HomeScreen, which redraws everything from scratch every frame), Pixi is
// retained-mode: every visual piece is created ONCE in build(), added to a
// Container, and left alone — only the handful of things that actually change
// (mute icon, warning text visibility) get touched per state update.
//
// Levels/PlayScreen are NOT migrated yet — this is intentionally the first proven
// slice, not the whole game. See game.js for how screens are switched.

// Shared by Home and Game Over's landscape layouts (both scale their content
// against this) — the render width their landscape numbers (drop/lift
// amounts, scales, margins) were actually tuned against. Gameplay's own
// zoom-out can push the real canvas wider than this now, so both screens
// scale their content up proportionally to renderWidth/this instead of
// spreading the same-size content further apart, or shrinking it into a
// fixed-size island in the middle of a wider canvas (both tried and
// rejected — see game.js's fitGameWrap and each screen's setRenderWidth).
const HOME_GAMEOVER_REFERENCE_WIDTH = 1100;

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

    // Both extended to renderWidth in landscape (see setLandscapeMode) — Rob
    // caught these still fixed at the 720 portrait width, leaving a visible
    // gap with nothing drawn past it on a wider landscape canvas.
    this._bg = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x0a0410);
    c.addChild(this._bg);

    this._sky = new PIXI.Sprite(textures.sky);
    this._sky.position.set(-19, -17);
    this._sky.width = 752; this._sky.height = 1309;
    c.addChild(this._sky);

    // Logo and the tube/hint illustration each get their own wrapper (pivot
    // at the sprite's own center, in its authored portrait position/size) so
    // landscape can scale+recenter them independently — same "pivot picks
    // the point, position picks where it lands" technique used for Game
    // Over's board/title. Portrait leaves both wrappers at identity
    // (scale 1, pivot/position 0,0), matching the original unwrapped layout.
    this._illustrationGroup = new PIXI.Container();
    c.addChild(this._illustrationGroup);
    // New tightly-cropped illustration (Rob) — no dead transparent margin
    // baked in like the old LiveGame4.png had, and a much wider aspect
    // ratio (423x280 native, ~1.51:1) instead of nearly square. Sized to
    // preserve that aspect ratio rather than force-fitting the old
    // dimensions, which would have stretched it.
    const liveGame = new PIXI.Sprite(textures.liveGame);
    const illusW = 692, illusH = illusW * (280 / 423);
    const illusX = (720 - illusW) / 2, illusY = 300; // moved up on portrait (Rob)
    liveGame.position.set(illusX, illusY);
    liveGame.width = illusW; liveGame.height = illusH;
    this._illustrationGroup.addChild(liveGame);
    this._illustrationCenter = { x: illusX + illusW / 2, y: illusY + illusH / 2 };

    this._logoGroup = new PIXI.Container();
    c.addChild(this._logoGroup);
    const logo = new PIXI.Sprite(textures.logo);
    logo.position.set(11, -12);
    logo.width = 677; logo.height = 369;
    this._logoGroup.addChild(logo);
    this._logoCenter = { x: 11 + 677 / 2, y: -12 + 369 / 2 };

    // Free Play and Levels each get their OWN wrapper (button + its caption)
    // rather than one shared group — landscape (Rob's mockup) sends them to
    // opposite edges of the screen, not a single translated pair like the
    // gameplay HUD's blast buttons.
    this._freePlayGroup = new PIXI.Container();
    c.addChild(this._freePlayGroup);
    const freePlayBtn = new PIXI.Sprite(textures.freePlayButton);
    freePlayBtn.position.set(45, 721);
    freePlayBtn.width = 285; freePlayBtn.height = 285;
    freePlayBtn.eventMode = 'static';
    freePlayBtn.cursor = 'pointer';
    freePlayBtn.on('pointertap', () => tryEnterGame('FreePlay'));
    this._freePlayGroup.addChild(freePlayBtn);
    this._freePlayCaption = this._centeredText('FREE PLAY\nfor high score', 81, 970, 209, 22, 'PotionBody', 0x77a3fc);
    this._freePlayGroup.addChild(this._freePlayCaption);
    this._freePlayCenter = { x: 45 + 285 / 2, y: 721 + 285 / 2 };

    this._levelsGroup = new PIXI.Container();
    c.addChild(this._levelsGroup);
    const levelModeBtn = new PIXI.Sprite(textures.levelModeButton);
    levelModeBtn.position.set(390, 721);
    levelModeBtn.width = 285; levelModeBtn.height = 285;
    levelModeBtn.eventMode = 'static';
    levelModeBtn.cursor = 'pointer';
    levelModeBtn.on('pointertap', () => tryEnterGame('Levels'));
    this._levelsGroup.addChild(levelModeBtn);
    this._levelsCaption = this._centeredText('Make potion to\nadvance LEVELS', 390, 970, 283, 22, 'PotionBody', 0x77a3fc);
    this._levelsGroup.addChild(this._levelsCaption);
    this._levelsCenter = { x: 390 + 285 / 2, y: 721 + 285 / 2 };

    this._nameWarningText = this._centeredText('Enter name before starting game', 133, 1132, 454, 24, 'PotionBody', 0xbd10e0);
    this._nameWarningText.visible = false;
    c.addChild(this._nameWarningText);
    this._nameWarningY = 1132;

    // Mute button — hit area (muteHit, 64x64) is a bit bigger than the visible
    // sprite (muteBtn, 57x68) for an easier tap target, same as the old version.
    // Moved to bottom-LEFT (Rob) — mirrored across from its original
    // bottom-right spot, keeping the same margin from the edge (25/26px)
    // just measured from the left side of the 720-wide design instead.
    this._muteGroup = new PIXI.Container();
    c.addChild(this._muteGroup);
    const muteHitX = 25, muteHitY = 1184, muteHitW = 64, muteHitH = 64;
    const muteBtnX = 26, muteBtnY = 1186, muteBtnW = 57, muteBtnH = 68;
    this._muteSprite = new PIXI.Sprite(state.muted ? textures.muteMuted : textures.muteUnmuted);
    this._muteSprite.position.set(muteBtnX, muteBtnY);
    this._muteSprite.width = muteBtnW; this._muteSprite.height = muteBtnH;
    this._muteGroup.addChild(this._muteSprite);

    const muteHit = new PIXI.Graphics().rect(muteHitX, muteHitY, muteHitW, muteHitH).fill({ color: 0xffffff, alpha: 0.001 });
    muteHit.eventMode = 'static';
    muteHit.cursor = 'pointer';
    muteHit.on('pointertap', () => toggleMute());
    this._muteGroup.addChild(muteHit);
    this._muteCenter = { x: muteHitX + muteHitW / 2, y: muteHitY + muteHitH / 2 };

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

  // Pivot at a group's own authored-center (so it scales around itself, not
  // its portrait top-left corner), then land that point at a target screen
  // position — same technique as Game Over's board/title.
  _setGroupTransform(group, center, scale, targetX, targetY) {
    group.pivot.set(center.x, center.y);
    group.scale.set(scale);
    group.position.set(targetX, targetY);
  },
  _resetGroupTransform(group) {
    group.pivot.set(0, 0);
    group.scale.set(1);
    group.position.set(0, 0);
  },

  // Called by game.js's fitGameWrap() on every resize/orientation change.
  // Rob's landscape mockup: logo top-center, the tube/hint illustration
  // centered below it, Free Play and Levels flanking it on opposite edges
  // (each shrunk to fit), the name field centered near the bottom, mute in
  // the bottom-right corner — a real landscape layout rather than the
  // portrait one just cropped. Portrait passes isLandscape=false and every
  // group resets to its authored (0,0)/scale-1 identity, unchanged.
  setLandscapeMode(isLandscape, renderWidth, visibleBottomY) {
    if (!this._logoGroup) return;
    if (isLandscape) {
      this._bg.clear().rect(0, 0, renderWidth, 1280).fill(0x0a0410);
      // sky is a single non-repeating nebula image, not a tileable texture —
      // stretching it to cover a much wider canvas distorts it, but that
      // reads far better than a hard-edged gap with nothing drawn at all.
      this._sky.position.x = -19;
      this._sky.width = renderWidth + 32;

      // The crop is always vertically centered on canvas-y=640 (see
      // game.js), so its top is exactly as far above 640 as visibleBottomY
      // is below it.
      const visibleTopY = 1280 - visibleBottomY;
      const cropHeight = visibleBottomY - visibleTopY;
      const centerX = renderWidth / 2;
      // Every size/width-axis-margin below scales with how much wider than
      // HOME_GAMEOVER_REFERENCE_WIDTH the canvas actually is — gameplay's
      // zoom-out can make that a lot wider now, and without this the
      // content either spread apart (too much gap) or, tried once already,
      // stayed a fixed small size centered in the middle with empty margins
      // on both sides (Rob: "things are not fitting well"). Vertical
      // spacing doesn't need this — it's already driven by the device's own
      // actual height via visibleTopY/cropHeight, not by renderWidth.
      const sizeScale = renderWidth / HOME_GAMEOVER_REFERENCE_WIDTH;

      // 10% bigger again + nudged up (Rob) — the +10 downward padding from
      // before became a small negative offset instead.
      const logoScale = 0.45 * 1.1 * 1.1 * 1.1 * sizeScale; // another 10% bigger (Rob)
      this._setGroupTransform(this._logoGroup, this._logoCenter, logoScale,
        centerX, visibleTopY + (369 * logoScale) / 2 - 10);

      const illusScale = 0.5 * 1.1 * sizeScale; // 50% was too big - 10% instead (Rob)
      this._setGroupTransform(this._illustrationGroup, this._illustrationCenter, illusScale,
        centerX, visibleTopY + cropHeight * 0.55);

      const btnScale = 0.45 * 1.4 * 1.5 * sizeScale; // buttons left as-is (Rob: "leave the buttons as is")
      const btnY = visibleTopY + cropHeight * 0.5;
      const EDGE_MARGIN = 60 * sizeScale;
      this._setGroupTransform(this._freePlayGroup, this._freePlayCenter, btnScale,
        EDGE_MARGIN + (285 * btnScale) / 2, btnY);
      this._setGroupTransform(this._levelsGroup, this._levelsCenter, btnScale,
        renderWidth - EDGE_MARGIN - (285 * btnScale) / 2, btnY);
      const muteScale = 0.8 * sizeScale;
      this._setGroupTransform(this._muteGroup, this._muteCenter, muteScale,
        40 * sizeScale, visibleBottomY - 30);

      // Name field is a real DOM element, not Pixi — but it's an absolutely
      // positioned child of #gameWrap, so it lives in the same 0-720/0-1280
      // coordinate space and gets carried along by gameWrap's shared CSS
      // transform exactly like the canvas. Centered, tucked under the
      // illustration near the bottom of the crop. 20% smaller (Rob) — box
      // and font size both scaled down together so the text still fits it.
      const nameW = 400 * 0.8 * sizeScale, nameH = 60 * 0.8 * sizeScale;
      nameInput.style.left = `${centerX - nameW / 2}px`;
      nameInput.style.top = `${visibleBottomY - nameH - 20}px`;
      nameInput.style.width = `${nameW}px`;
      nameInput.style.height = `${nameH}px`;
      nameInput.style.fontSize = `${42 * 0.8 * sizeScale}px`;
      this._nameWarningText.position.set(centerX, visibleBottomY - nameH - 45);
    } else {
      this._bg.clear().rect(0, 0, 720, 1280).fill(0x0a0410);
      this._sky.position.x = -19;
      this._sky.width = 752;
      this._resetGroupTransform(this._logoGroup);
      this._resetGroupTransform(this._illustrationGroup);
      this._resetGroupTransform(this._freePlayGroup);
      this._resetGroupTransform(this._levelsGroup);
      this._resetGroupTransform(this._muteGroup);
      nameInput.style.left = '88px';
      nameInput.style.top = '1066px';
      nameInput.style.width = '540px';
      nameInput.style.height = '72px';
      nameInput.style.fontSize = '42px';
      this._nameWarningText.position.set(360, this._nameWarningY);
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
