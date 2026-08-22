// In-game HUD, rebuilt on Pixi — the score/potion-counter pills, mute button, and
// Free Play's blast buttons. Reuses `PlayScreen` (old ui.js) directly for all the
// geometry/state (scorePillBtn, potionCounterBtn, muteBtn, blastLeftBtn/RightBtn,
// blastCharges, blastButtonsT, _scoreText(), _potionsMade()) rather than
// recomputing any of it — that object's dense oval-matching math and state machine
// are unaffected by how things get drawn, only PlayScreen's old draw()/​_drawHud()
// methods are being replaced here.
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

    const cb = PlayScreen.potionCounterBtn;
    // Blurred oversized copy underneath, same trick as the old ctx version
    // (Rob: the potion pill's baked-in glow reads fainter than the score
    // pill's since it's scaled down more aggressively) — a Pixi Sprite with
    // a blur filter instead of ctx.filter='blur()'.
    this._potionGlowSprite = new PIXI.Sprite(textures.potionCounter);
    this._potionGlowSprite.position.set(cb.x - 3, cb.y - 3);
    this._potionGlowSprite.width = cb.w + 6; this._potionGlowSprite.height = cb.h + 6;
    this._potionGlowSprite.alpha = 0.7;
    this._potionGlowSprite.filters = [new PIXI.BlurFilter({ strength: 5 })];
    this._potionSprite = new PIXI.Sprite(textures.potionCounter);
    this._potionSprite.position.set(cb.x, cb.y);
    this._potionSprite.width = cb.w; this._potionSprite.height = cb.h;
    c.addChild(this._potionGlowSprite, this._potionSprite);
    this._potionNumber = buildTabularNumber(c, { size: 34 * PlayScreen.PILL_SCALE, font: 'PotionTitle', color: 0x9b9b9b, baseline: 'middle' });

    const mb = PlayScreen.muteBtn;
    this._muteSprite = new PIXI.Sprite(state.muted ? textures.muteMuted : textures.muteUnmuted);
    this._muteSprite.position.set(mb.x, mb.y);
    this._muteSprite.width = mb.w; this._muteSprite.height = mb.h;
    this._muteSprite.eventMode = 'static';
    this._muteSprite.cursor = 'pointer';
    this._muteSprite.on('pointertap', () => toggleMute());
    c.addChild(this._muteSprite);

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
  },

  refresh() {
    if (PlayScreen.isOver) {
      this._scoreSprite.visible = false;
      this._scoreNumber.setVisible(false);
      this._potionGlowSprite.visible = false;
      this._potionSprite.visible = false;
      this._potionNumber.setVisible(false);
    } else {
      this._scoreSprite.visible = true;
      this._potionGlowSprite.visible = true;
      this._potionSprite.visible = true;
      this._scoreNumber.setVisible(true);
      this._potionNumber.setVisible(true);

      const sb = PlayScreen.scorePillBtn;
      this._scoreNumber.setText(PlayScreen._scoreText(), sb.x + 125 * PlayScreen.PILL_SCALE, sb.y + 35 * PlayScreen.PILL_SCALE);

      const cb = PlayScreen.potionCounterBtn;
      this._potionNumber.setText(String(PlayScreen._potionsMade()), cb.x + cb.w * (97 / 191), cb.y + cb.h * (124 / 259));
    }

    this._muteSprite.texture = state.muted ? textures.muteMuted : textures.muteUnmuted;

    const active = PlayScreen.blastCharges > 0;
    const t = PlayScreen.blastButtonsT;
    const scale = 0.85 + 0.15 * t;
    for (const b of this._blastButtons) {
      b.container.visible = PlayScreen.mode === 'freeplay' && t > 0.001;
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
