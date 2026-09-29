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

    // Moon-charge ring (Rob: "a new element in the top right that shows
    // how close we are to charging the moon to full charge") — a ring
    // that fills as score climbs toward the next Potion Blast charge
    // (see PlayScreen's own blastThreshold/blastCharges accrual, one
    // charge per 1000 points), with a small moon-like dot at its center.
    // A more direct progress readout than the moon-glow-on-the-ball cue
    // alone (Rob removed a literal 3-bottle version of this a while back
    // for being visual clutter — this is a single ring, not icons, and
    // explicitly asked for again now).
    this._chargeRing = new PIXI.Graphics();
    c.addChild(this._chargeRing);
    this._chargeMoon = new PIXI.Sprite(textures.ball);
    this._chargeMoon.anchor.set(0.5);
    c.addChild(this._chargeMoon);
    this._chargeRingCenter = { x: 640, y: 70 };
    this._chargeRingRadius = 32;
    this._chargeGlowT = 0;
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
      this._chargeRing.visible = false;
      this._chargeMoon.visible = false;
    } else {
      this._scoreSprite.visible = true;
      this._scoreNumber.setVisible(true);

      const sb = PlayScreen.scorePillBtn;
      this._scoreNumber.setText(PlayScreen._scoreText(), sb.x + 125 * PlayScreen.PILL_SCALE, sb.y + 35 * PlayScreen.PILL_SCALE);

      this._refreshChargeRing();
    }
  },

  // Progress toward the next Potion Blast charge (see ui.js's
  // blastThreshold/blastCharges — one charge banked per 1000 points),
  // drawn as a ring that fills clockwise from the top. Once a charge is
  // actually banked (blastCharges >= MAX_BLAST_CHARGES), the ring reads
  // full and gently pulses to read as "ready", rather than continuing to
  // visibly cycle even though scoring keeps quietly advancing
  // blastThreshold underneath.
  _refreshChargeRing() {
    const ready = PlayScreen.blastCharges >= PlayScreen.MAX_BLAST_CHARGES;
    const progress = ready ? 1 : Math.max(0, Math.min(1,
      (PlayScreen.score - PlayScreen.blastThreshold) / 1000));

    const { x, y } = this._chargeRingCenter;
    const r = this._chargeRingRadius;
    const g = this._chargeRing;
    g.clear();
    g.circle(x, y, r).stroke({ width: 6, color: 0x3a1a4a, alpha: 0.6 });
    if (progress > 0.001) {
      const start = -Math.PI / 2;
      g.arc(x, y, r, start, start + progress * Math.PI * 2)
        .stroke({ width: 6, color: ready ? 0xffe08a : 0xff4fb8, alpha: 1, cap: 'round' });
    }
    if (ready) {
      this._chargeGlowT += 1 / 60;
      const pulse = 0.75 + 0.25 * Math.sin(this._chargeGlowT * 4);
      g.circle(x, y, r + 3).stroke({ width: 2, color: 0xffe08a, alpha: 0.5 * pulse });
    }
    this._chargeMoon.visible = true;
    this._chargeMoon.position.set(x, y);
    this._chargeMoon.width = this._chargeMoon.height = r * 1.05;
    this._chargeMoon.tint = ready ? 0xffe08a : 0xffffff;
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
