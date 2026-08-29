// Levels screen, rebuilt on PixiJS — same retained-mode pattern as pixi_home.js
// (build once, refresh() touches only what actually changes).
// How many levels actually have a built tower/threshold to play (see
// ui.js's PlayScreen._levelThresholdY) — bump this as each new one lands.
// Everything beyond it still unlocks in Storage (finishing Level N always
// unlocks N+1) but shows "soon" here until its own build catches up.
const BUILT_LEVELS = 10;
// Temporary (Rob: "keep them all unlocked for now" while all 10 get built
// out and evaluated in one pass) — every built level is tappable regardless
// of real progress. The actual unlock tracking (Storage.setHighestLevelUnlocked,
// state.highestLevelUnlocked) keeps running underneath exactly as before,
// this just stops the Levels screen from checking it — flip back to false
// once real per-level progression is wanted again.
const UNLOCK_ALL_FOR_TESTING = true;
const LevelsScreenPixi = {
  buttonSize: 132,
  positions: [
    { x: 9, y: 270, n: 1 }, { x: 149, y: 270, n: 2 }, { x: 289, y: 270, n: 3 },
    { x: 429, y: 270, n: 4 }, { x: 569, y: 270, n: 5 },
    { x: 9, y: 417, n: 6 }, { x: 149, y: 417, n: 7 }, { x: 289, y: 417, n: 8 },
    { x: 429, y: 417, n: 9 }, { x: 569, y: 417, n: 10 },
  ],
  container: null,
  _cells: [], // { n, box, numberText, soonText }

  build(textures, state) {
    const c = new PIXI.Container();
    this.container = c;

    const bg = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x0a0410);
    c.addChild(bg);

    // Glow — a blurred duplicate behind the crisp title (Rob: "add the same
    // glow to levels that you added to game over"). Game Over's own glow
    // slices its title into strips for a bottom-fade gradient because that
    // title is a raster image; this one's plain Pixi Text with no texture
    // to slice, so a single blurred copy stands in for it instead — same
    // flicker animation either way (see refresh()).
    const titleGlow = new PIXI.Text({
      text: 'Levels', style: { fontFamily: 'PotionTitle', fontSize: 64, fill: 0xffffff, align: 'center' },
    });
    titleGlow.anchor.set(0.5, 0);
    titleGlow.position.set(360, 130);
    titleGlow.filters = [new PIXI.BlurFilter({ strength: 6 })];
    c.addChild(titleGlow);
    this._titleGlow = titleGlow;

    const title = new PIXI.Text({
      text: 'Levels', style: { fontFamily: 'PotionTitle', fontSize: 64, fill: 0xffffff, align: 'center' },
    });
    title.anchor.set(0.5, 0);
    title.position.set(360, 130);
    c.addChild(title);

    const s = this.buttonSize;
    this._cells = this.positions.map((pos) => {
      const cell = new PIXI.Container();
      cell.position.set(pos.x, pos.y);

      // Rob's own button art — bright/glowing purple border when unlocked,
      // a dulled grey-bordered version when locked (swapped in refresh()
      // below), instead of the old programmatic rect+stroke placeholder.
      const box = new PIXI.Sprite(textures.levelButton);
      box.width = s; box.height = s;
      cell.addChild(box);

      const numberText = new PIXI.Text({
        text: String(pos.n), style: { fontFamily: 'PotionTitle', fontSize: 48, fill: 0xffffff, align: 'center' },
      });
      numberText.anchor.set(0.5);
      numberText.position.set(s / 2, s / 2 - 24 + 24); // matches old baseline-ish centering (size/2-24 box + half text height)
      cell.addChild(numberText);

      const soonText = new PIXI.Text({
        text: 'soon', style: { fontFamily: 'PotionBody', fontSize: 16, fill: 0x9b9b9b, align: 'center' },
      });
      soonText.anchor.set(0.5, 0);
      soonText.position.set(s / 2, s - 26);
      cell.addChild(soonText);

      if (pos.n <= BUILT_LEVELS) {
        cell.eventMode = 'static';
        cell.cursor = 'pointer';
        // Checked at tap time, not just once here at build time — a level
        // can go from locked to unlocked mid-session (finishing the one
        // before it) without this screen ever being rebuilt.
        cell.on('pointertap', () => {
          if (UNLOCK_ALL_FOR_TESTING || pos.n <= state.highestLevelUnlocked) enterPlayScreen('level' + pos.n);
        });
      }

      c.addChild(cell);
      return { n: pos.n, box, numberText, soonText };
    });

    // Rob's own glowing circular Home icon (matches the game's other round
    // icon buttons) instead of the old plain rect+text placeholder, moved
    // down to the bottom of the screen — well clear of the grid above and
    // the persistent mute/fullscreen DOM buttons further down in the real
    // corners (index.html/game.js).
    const homeBtnSize = 130;
    const homeBtn = new PIXI.Sprite(textures.levelsHomeButton);
    homeBtn.anchor.set(0.5);
    homeBtn.width = homeBtnSize; homeBtn.height = homeBtnSize;
    homeBtn.position.set(360, 1080);
    homeBtn.eventMode = 'static';
    homeBtn.cursor = 'pointer';
    homeBtn.on('pointertap', () => goHome());
    c.addChild(homeBtn);

    this.refresh(state);
  },

  refresh(state) {
    // Same three-sine flicker formula as Game Over's own title glow (Rob).
    const now = Date.now();
    const flicker = 0.75 + 0.25 * (
      0.45 * Math.sin(now / 480) +
      0.35 * Math.sin(now / 300 + 1.3) +
      0.2 * Math.sin(now / 700 + 2.7)
    );
    this._titleGlow.alpha = Math.max(0, 0.9 * flicker);

    for (const cell of this._cells) {
      const unlocked = UNLOCK_ALL_FOR_TESTING ? cell.n <= BUILT_LEVELS : cell.n <= state.highestLevelUnlocked;
      const built = cell.n <= BUILT_LEVELS;
      // Purple (144,19,254 = 0x9013fe) for an unlocked number, grey for a
      // locked one — matches the box art's own bright/dull states.
      const lineColor = unlocked ? 0x9013fe : 0x9b9b9b;
      cell.box.texture = unlocked ? textures.levelButton : textures.levelButtonDull;
      cell.numberText.style.fill = lineColor;
      cell.soonText.visible = unlocked && !built;
    }
  },
};
