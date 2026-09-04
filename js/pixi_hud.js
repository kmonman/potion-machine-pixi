// In-game HUD, rebuilt on Pixi — the score pill, the 3-bottle blast-charge
// indicator, and Free Play's blast buttons (mute lives outside this
// entirely now — see index.html/game.js's #muteBtn, one persistent DOM
// button shared by every screen instead of a separate Pixi one per
// screen). Reuses `PlayScreen` (old ui.js) directly for all the
// geometry/state (scorePillBtn, blastLeftBtn/RightBtn, blastCharges,
// MAX_BLAST_CHARGES, blastButtonsT, _scoreText()) rather than recomputing
// any of it — that object's dense oval-matching math and state machine are
// unaffected by how things get drawn, only PlayScreen's old draw()/​
// _drawHud() methods are being replaced here.
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


    // Blast buttons — ring (Blast.png) + bottle + a badge number, all scaled
    // together by the pop-in/out animation (PlayScreen.blastButtonsT), same
    // as the old ctx version's per-button save/scale/restore block.
    this._blastButtons = [PlayScreen.blastLeftBtn, PlayScreen.blastRightBtn].map((btn) => {
      const bc = new PIXI.Container();
      bc.position.set(btn.x + btn.w / 2, btn.y + btn.h / 2); // pivot at button center, matches the old scale-from-center behavior
      const ringR = btn.w * 0.5 * 0.7;
      const ring = new PIXI.Sprite(textures.blastRing);
      const ringDrawSize = (ringR / 0.595) * 2;
      ring.anchor.set(0.5);
      ring.width = ringDrawSize; ring.height = ringDrawSize;
      const bw = btn.w * 0.55, bh = bw * (176 / 144);
      const bottle = new PIXI.Sprite(textures.potionFilled);
      bottle.anchor.set(0.5);
      bottle.width = bw; bottle.height = bh;
      bc.addChild(ring, bottle);
      // Small circle behind the charge number, colored to match the pole's
      // own flat sprite fill (rgb(33,24,46), sampled directly from
      // NewSprite.png) — missed when this was first ported to Pixi, caught
      // during the side-by-side comparison against the live version.
      const numFontSize = btn.w * 0.11 * 1.15 * 1.5;
      const badgeBg = new PIXI.Graphics().circle(0, 0, numFontSize * 0.62).fill(0x21182e);
      badgeBg.position.set(-bw * 0.42, -bh * 0.42);
      const badge = new PIXI.Text({ text: '0', style: { fontFamily: 'PotionTitle', fontSize: numFontSize, fill: 0x9b9b9b } });
      badge.anchor.set(0.5);
      badge.position.set(-bw * 0.42, -bh * 0.42);
      bc.addChild(badgeBg, badge);
      bc.eventMode = 'static';
      bc.cursor = 'pointer';
      bc.on('pointertap', () => PlayScreen.fireBlast());
      c.addChild(bc);
      return { container: bc, badge, btn };
    });
    this._isLandscape = false;
  },

  // Called by game.js's fitGameWrap() on every resize/orientation change.
  // The two "potion bottle" blast buttons (Rob's term) pop in near the
  // bottom-left/right of the portrait design (y=920) — fine there, but in
  // the short landscape crop that's off past the visible area. Moves each
  // to hug its own screen edge instead, vertically centered on the canvas's
  // own middle (640 — same "centered top to bottom" reference point used
  // for Game Over/Home). Portrait passes isLandscape=false and each button
  // goes back to its authored (btn.x+w/2, btn.y+h/2) position, unchanged.
  setLandscapeMode(isLandscape, renderWidth) {
    if (!this._blastButtons) return;
    this._isLandscape = isLandscape;
    const EDGE_MARGIN = 50;
    for (let i = 0; i < this._blastButtons.length; i++) {
      const { container, btn } = this._blastButtons[i];
      if (isLandscape) {
        const x = i === 0 ? EDGE_MARGIN + btn.w / 2 : renderWidth - EDGE_MARGIN - btn.w / 2;
        container.position.set(x, 640);
      } else {
        container.position.set(btn.x + btn.w / 2, btn.y + btn.h / 2);
      }
    }
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

    // Charge Orb bonus (ui.js's chargedTimer) also makes a blast fireable
    // even at 0 banked charges — the button should light up for that window
    // too, not just sit dim while it's actually usable (the badge/icon fill
    // above stays truthful to the real banked count; this only affects the
    // active/dim look).
    const active = PlayScreen.blastCharges > 0 || PlayScreen.chargedTimer > 0;
    const t = PlayScreen.blastButtonsT;
    const scale = 0.85 + 0.15 * t;
    for (const b of this._blastButtons) {
      b.container.visible = t > 0.001;
      b.container.scale.set(scale);
      b.container.alpha = (active ? 1 : 0.35) * t;
      b.badge.text = String(PlayScreen.blastCharges);
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
