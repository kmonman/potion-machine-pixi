// In-game HUD, rebuilt on Pixi — just the score pill now (mute lives outside
// this entirely — see index.html/game.js's #muteBtn, one persistent DOM
// button shared by every screen instead of a separate Pixi one per screen).
// The dedicated tap-to-jump buttons are gone (Rob: "allow the moon to jump
// anytime someone taps the screen anywhere... remove the jumping icons with
// the potion bottles" — see pixi_playscreen.js's background tap handler for
// the replacement), and so is the 3-bottle charge indicator that used to sit
// top-right — Rob's follow-up on the "moon charge" PlasmaOrb system: "no
// potion bottles" at all anymore. The moon glowing (see
// pixi_playscreen.js's _updateMoonOrb) is the only charge indicator now.
// Reuses `PlayScreen` (old ui.js) directly for all the geometry/state
// (scorePillBtn, _scoreText()) rather than recomputing any of it — that
// object's dense oval-matching math and state machine are unaffected by how
// things get drawn, only PlayScreen's old draw()/​_drawHud() methods are
// being replaced here.
const HudPixi = {
  container: null,

  build(textures) {
    const c = new PIXI.Container();
    this.container = c;

    const sb = PlayScreen.scorePillBtn;
    this._scoreSprite = new PIXI.Sprite(textures.bubbleScore);
    this._scoreSprite.position.set(sb.x, sb.y);
    this._scoreSprite.width = sb.w; this._scoreSprite.height = sb.h;
    c.addChild(this._scoreSprite);
    this._scoreNumber = buildTabularNumber(c, { size: 34 * PlayScreen.PILL_SCALE, font: 'PotionTitle', color: 0x9b9b9b, baseline: 'top' });
    this._isLandscape = false;
  },

  // Landscape no longer has to move anything here — the old blast buttons
  // were the only HUD element that needed repositioning off-edge in
  // landscape; the charge icons/score pill stay put same as before.
  setLandscapeMode(isLandscape, renderWidth) {
    this._isLandscape = isLandscape;
  },

  refresh() {
    if (PlayScreen.isOver) {
      this._scoreSprite.visible = false;
      this._scoreNumber.setVisible(false);
    } else {
      this._scoreSprite.visible = true;
      this._scoreNumber.setVisible(true);

      const sb = PlayScreen.scorePillBtn;
      this._scoreNumber.setText(PlayScreen._scoreText(), sb.x + 125 * PlayScreen.PILL_SCALE, sb.y + 35 * PlayScreen.PILL_SCALE);
    }
  },
};

// Fixed-digit-pitch number display (see ui.js's drawTabularNumber for the
// original ctx-based version and why this exists — proportional fonts jitter
// a live-updating number left/right as different-width digits swap in).
// Ported to Pixi as a pool of Text children instead of per-frame fillText
// calls, using a throwaway 2D context purely for digit-width measurement
// (this has nothing to do with rendering — Pixi has no measureText of its
// own, so borrowing Canvas 2D's is the simplest way to get real glyph widths).
const _measureCtx = document.createElement('canvas').getContext('2d');
function buildTabularNumber(container, opts) {
  const pool = [];
  const fontFamily = opts.font || 'PotionBody';
  const anchorY = opts.baseline === 'middle' ? 0.5 : 0;
  return {
    setVisible(v) { for (const t of pool) t.visible = v; },
    setText(str, centerX, y) {
      _measureCtx.font = `${opts.size}px ${fontFamily}`;
      let digitW = 0;
      for (let d = 0; d <= 9; d++) digitW = Math.max(digitW, _measureCtx.measureText(String(d)).width);
      const chars = String(str).split('');
      const widths = chars.map((ch) => (/[0-9]/.test(ch) ? digitW : _measureCtx.measureText(ch).width));
      const totalW = widths.reduce((a, b) => a + b, 0);
      while (pool.length < chars.length) {
        const t = new PIXI.Text({ text: '', style: { fontFamily, fontSize: opts.size, fill: opts.color } });
        t.anchor.set(0.5, anchorY);
        container.addChild(t);
        pool.push(t);
      }
      while (pool.length > chars.length) container.removeChild(pool.pop());
      let cx = centerX - totalW / 2;
      for (let i = 0; i < chars.length; i++) {
        cx += widths[i] / 2;
        pool[i].text = chars[i];
        pool[i].visible = true;
        pool[i].position.set(cx, y);
        cx += widths[i] / 2;
      }
    },
  };
}
