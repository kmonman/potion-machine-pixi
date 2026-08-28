// Levels screen, rebuilt on PixiJS — same retained-mode pattern as pixi_home.js
// (build once, refresh() touches only what actually changes).
// How many levels actually have a built tower/threshold to play (see
// ui.js's PlayScreen._levelThresholdY) — bump this as each new one lands.
// Everything beyond it still unlocks in Storage (finishing Level N always
// unlocks N+1) but shows "soon" here until its own build catches up.
const BUILT_LEVELS = 2;
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

      const box = new PIXI.Graphics();
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
          if (pos.n <= state.highestLevelUnlocked) enterPlayScreen('level' + pos.n);
        });
      }

      c.addChild(cell);
      return { n: pos.n, box, numberText, soonText };
    });

    const homeBtn = new PIXI.Graphics().rect(0, 0, 100, 50).stroke({ width: 2, color: 0x9013fe });
    const homeBtnText = new PIXI.Text({ text: 'Home', style: { fontFamily: 'PotionBody', fontSize: 22, fill: 0x9013fe } });
    homeBtnText.anchor.set(0.5);
    homeBtnText.position.set(50, 25);
    homeBtn.addChild(homeBtnText);
    homeBtn.position.set(20, 40);
    homeBtn.eventMode = 'static';
    homeBtn.cursor = 'pointer';
    homeBtn.on('pointertap', () => goHome());
    c.addChild(homeBtn);

    this.refresh(state);
  },

  refresh(state) {
    const s = this.buttonSize;
    for (const cell of this._cells) {
      const unlocked = cell.n <= state.highestLevelUnlocked;
      const built = cell.n <= BUILT_LEVELS;
      const lineColor = unlocked ? 0x9013fe : 0x9b9b9b;
      const fillColor = unlocked ? 0x9013fe : 0x9b9b9b;
      cell.box.clear();
      cell.box.rect(0, 0, s, s).fill({ color: fillColor, alpha: unlocked ? 0.25 : 0.15 }).stroke({ width: 3, color: lineColor });
      cell.numberText.style.fill = lineColor;
      cell.soonText.visible = unlocked && !built;
    }
  },
};
