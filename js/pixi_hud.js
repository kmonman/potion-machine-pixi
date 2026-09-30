// In-game HUD, rebuilt on Pixi — one merged score + power panel (mute
// lives outside this entirely — see index.html/game.js's #muteBtn, one
// persistent DOM button shared by every screen instead of a separate Pixi
// one per screen). The dedicated tap-to-jump buttons are gone (Rob: "allow
// the moon to jump anytime someone taps the screen anywhere... remove the
// jumping icons with the potion bottles" — see pixi_playscreen.js's
// background tap handler for the replacement).
// Reuses `PlayScreen` (old ui.js) directly for score/charge state
// (_scoreText(), blastCharges/blastThreshold) rather than recomputing any
// of it.
//
// Rob's layout (from his own mockup): one wide dark stadium panel —
// bubble cluster overhanging the left edge, score number and a slim charge
// bar stacked in the middle, and a mini moon with its own charge ring
// overhanging the right edge. Replaces the earlier two-separate-module
// (score pill top-left / power meter top-right) layout.
const HUD_COLOR = {
  void: 0x090511,
  deepViolet: 0x24103b,
  medViolet: 0x6830a5,
  electricPurple: 0x963dff,
  hotMagenta: 0xf000b8,
  brightPink: 0xff42d0,
  coolWhite: 0xf4ecff,
};

const HudPixi = {
  container: null,

  build(textures) {
    const c = new PIXI.Container();
    this.container = c;

    const margin = 18;
    const panel = { x: margin, y: 16, w: CONFIG.WIDTH - margin * 2, h: 72 };
    this._panel = panel;

    this._panelGfx = new PIXI.Graphics();
    c.addChild(this._panelGfx);

    // Bubble cluster, overhanging the panel's top-left corner.
    this._bubbles = new PIXI.Sprite(textures.bubblesFinal);
    const bubblesAR = textures.bubblesFinal.width / textures.bubblesFinal.height;
    this._bubbles.height = panel.h * 1.3;
    this._bubbles.width = this._bubbles.height * bubblesAR;
    this._bubbles.anchor.set(0.32, 0.62);
    this._bubbles.position.set(panel.x + 14, panel.y + panel.h * 0.58);
    c.addChild(this._bubbles);

    this._scoreNumber = buildTabularNumber(c, { size: 32, font: 'PotionTitle', color: 0xe9e2f5, baseline: 'middle' });

    // Charge bar — track + fill, stacked under the score number instead of
    // a separate module.
    this._barRect = { x: panel.x + 150, y: panel.y + panel.h * 0.66, w: panel.w - 150 - 110, h: 16 };
    this._barTrack = new PIXI.Graphics();
    c.addChild(this._barTrack);
    this._barFill = new PIXI.Graphics();
    c.addChild(this._barFill);

    // Moon emblem, overhanging the panel's right edge, with its own
    // glow + charge ring around it (Rob: "the white circle on the right
    // should be a mini moon with the charge around it" — and made bigger
    // this time so the ring actually reads, not the earlier too-small one).
    this._moonCenter = { x: panel.x + panel.w - 4, y: panel.y + panel.h / 2 };
    this._moonRadius = 36;
    this._moonGlow = new PIXI.Sprite(textures.glowParticle);
    this._moonGlow.anchor.set(0.5);
    this._moonGlow.blendMode = 'add';
    c.addChild(this._moonGlow);
    this._moonRing = new PIXI.Graphics();
    c.addChild(this._moonRing);
    this._moon = new PIXI.Sprite(textures.ball);
    this._moon.anchor.set(0.5);
    c.addChild(this._moon);
    this._moonSweep = new PIXI.Graphics();
    c.addChild(this._moonSweep);

    this._isLandscape = false;
    this._t = Math.random() * 10;
    this._meterWasReady = false;
    this._meterSweepT = null; // null = no sweep in flight
  },

  // Landscape no longer has to move anything here — the old blast buttons
  // were the only HUD element that needed repositioning off-edge in
  // landscape; the panel stays put same as before.
  setLandscapeMode(isLandscape, renderWidth) {
    this._isLandscape = isLandscape;
  },

  refresh() {
    const visible = !PlayScreen.isOver;
    this._panelGfx.visible = visible;
    this._bubbles.visible = visible;
    this._scoreNumber.setVisible(visible);
    this._barTrack.visible = visible;
    this._barFill.visible = visible;
    this._moonGlow.visible = visible;
    this._moonRing.visible = visible;
    this._moon.visible = visible;
    this._moonSweep.visible = visible;
    if (!visible) return;

    this._t += this._dt || 1 / 60;
    this._refreshPanel();
    this._refreshScoreAndBar();
    this._refreshMoon();
  },

  // The single dark stadium panel everything else sits on/overhangs.
  _refreshPanel() {
    const p = this._panel;
    const g = this._panelGfx;
    g.clear();
    g.roundRect(p.x, p.y, p.w, p.h, p.h / 2)
      .fill({ color: HUD_COLOR.void, alpha: 0.82 })
      .stroke({ width: 1.5, color: HUD_COLOR.medViolet, alpha: 0.9 });
    g.moveTo(p.x + 24, p.y + 1.5).lineTo(p.x + p.w - 24, p.y + 1.5)
      .stroke({ width: 1, color: HUD_COLOR.electricPurple, alpha: 0.22, cap: 'round' });
  },

  _refreshScoreAndBar() {
    const p = this._panel;
    this._scoreNumber.setText(PlayScreen._scoreText(), p.x + 150 + (this._barRect.w) / 2 - 20, p.y + p.h * 0.34);

    const ready = PlayScreen.blastCharges >= PlayScreen.MAX_BLAST_CHARGES;
    const progress = ready ? 1 : Math.max(0, Math.min(1, (PlayScreen.score - PlayScreen.blastThreshold) / 1000));
    const tube = (Physics.currentPlatform && Physics.currentPlatform.tubeColor) || [240, 0, 184];
    const tubeHex = rgbToHex(tube[0], tube[1], tube[2]);

    const { x, y, w, h } = this._barRect;
    this._barTrack.clear();
    this._barTrack.roundRect(x, y, w, h, h / 2).fill({ color: HUD_COLOR.deepViolet, alpha: 0.7 }).stroke({ width: 1, color: HUD_COLOR.medViolet, alpha: 0.6 });
    this._barFill.clear();
    const fw = Math.max(0, w * progress);
    if (fw > h) {
      this._barFill.roundRect(x, y, fw, h, h / 2).fill({ color: ready ? HUD_COLOR.brightPink : tubeHex, alpha: ready ? 1 : 0.9 });
    }
  },

  // Mini moon + glow + charge ring at the panel's right edge.
  _refreshMoon() {
    const ready = PlayScreen.blastCharges >= PlayScreen.MAX_BLAST_CHARGES;
    const progress = ready ? 1 : Math.max(0, Math.min(1, (PlayScreen.score - PlayScreen.blastThreshold) / 1000));
    const tube = (Physics.currentPlatform && Physics.currentPlatform.tubeColor) || [240, 0, 184];
    const tubeHex = rgbToHex(tube[0], tube[1], tube[2]);
    const { x: cx, y: cy } = this._moonCenter;
    const r = this._moonRadius;

    this._moonGlow.position.set(cx, cy);
    this._moonGlow.tint = ready ? HUD_COLOR.brightPink : tubeHex;
    const glowPulse = ready ? 0.85 + 0.15 * Math.sin(this._t * 4) : 1;
    this._moonGlow.width = this._moonGlow.height = r * 2.4 * (0.7 + 0.3 * progress) * glowPulse;
    this._moonGlow.alpha = 0.35 + 0.45 * progress;

    this._moon.position.set(cx, cy);
    this._moon.width = this._moon.height = r * 1.5;
    this._moon.tint = ready ? 0xfff2d8 : 0xffffff;

    // Charge ring — Rob: "the charge didn't render correctly because I
    // think the ball was too small" — sized off the now-much-bigger moon
    // radius above instead of the earlier tiny one, so the ring reads
    // clearly instead of being a near-invisible sliver.
    const rg = this._moonRing;
    rg.clear();
    rg.circle(cx, cy, r + 6).stroke({ width: 2, color: HUD_COLOR.medViolet, alpha: 0.5 });
    if (progress > 0.02) {
      const start = -Math.PI / 2;
      rg.arc(cx, cy, r + 6, start, start + progress * Math.PI * 2)
        .stroke({ width: 3, color: ready ? HUD_COLOR.brightPink : tubeHex, alpha: 0.95, cap: 'round' });
    }

    // Full-charge animation — a single traveling sweep around the ring the
    // instant it first fills, not a repeating flash.
    if (ready && !this._meterWasReady) this._meterSweepT = 0;
    this._meterWasReady = ready;
    const swg = this._moonSweep;
    swg.clear();
    if (this._meterSweepT !== null) {
      this._meterSweepT += this._dt || 1 / 60;
      const dur = 0.45;
      if (this._meterSweepT >= dur) {
        this._meterSweepT = null;
      } else {
        const t = this._meterSweepT / dur;
        const ang = -Math.PI / 2 + t * Math.PI * 2;
        swg.circle(cx + Math.cos(ang) * (r + 6), cy + Math.sin(ang) * (r + 6), 5)
          .fill({ color: HUD_COLOR.coolWhite, alpha: 0.9 * (1 - t) });
      }
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
