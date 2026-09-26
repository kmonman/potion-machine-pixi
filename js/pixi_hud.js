// In-game HUD, rebuilt on Pixi — the score pill and the 3-bottle
// blast-charge indicator (mute lives outside this entirely now — see
// index.html/game.js's #muteBtn, one persistent DOM button shared by every
// screen instead of a separate Pixi one per screen). The dedicated tap-to-
// jump buttons are gone (Rob: "allow the moon to jump anytime someone taps
// the screen anywhere... remove the jumping icons with the potion bottles"
// — see pixi_playscreen.js's background tap handler for the replacement).
// Reuses `PlayScreen` (old ui.js) directly for all the geometry/state
// (scorePillBtn, blastCharges, MAX_BLAST_CHARGES, _scoreText()) rather than
// recomputing any of it — that object's dense oval-matching math and state
// machine are unaffected by how things get drawn, only PlayScreen's old
// draw()/​_drawHud() methods are being replaced here.
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

    // Blast-charge indicator — 3 bottle icons (same filled/empty art Game
    // Over's own "potions made" summary row already uses), one per
    // MAX_BLAST_CHARGES, instead of the old uncapped numeric pill (Rob:
    // show the charge cap the same way Game Over shows potions — bottles
    // you fill up, not a raw number). Top-right, vertically centered on the
    // score pill.
    const sbRef = PlayScreen.scorePillBtn;
    const chargeIconH = 70, chargeIconW = chargeIconH * (72 / 88), chargeGap = 8;
    const chargeRowW = 3 * chargeIconW + 2 * chargeGap;
    const chargeRowRight = 700, chargeRowX = chargeRowRight - chargeRowW;
    const chargeRowCenterY = sbRef.y + sbRef.h / 2;
    this._chargeIcons = [];
    for (let i = 0; i < 3; i++) {
      const s = new PIXI.Sprite(textures.potionEmpty);
      s.anchor.set(0.5);
      s.width = chargeIconW; s.height = chargeIconH;
      s.position.set(chargeRowX + i * (chargeIconW + chargeGap) + chargeIconW / 2, chargeRowCenterY);
      c.addChild(s);
      this._chargeIcons.push(s);
    }
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
      for (const s of this._chargeIcons) s.visible = false;
    } else {
      this._scoreSprite.visible = true;
      this._scoreNumber.setVisible(true);
      for (const s of this._chargeIcons) s.visible = true;

      const sb = PlayScreen.scorePillBtn;
      this._scoreNumber.setText(PlayScreen._scoreText(), sb.x + 125 * PlayScreen.PILL_SCALE, sb.y + 35 * PlayScreen.PILL_SCALE);

      // Filled left-to-right up to however many charges are currently
      // banked (capped at MAX_BLAST_CHARGES — see ui.js's blastCharges
      // accrual).
      this._chargeIcons.forEach((s, i) => {
        s.texture = i < PlayScreen.blastCharges ? textures.potionFilled : textures.potionEmpty;
      });
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
