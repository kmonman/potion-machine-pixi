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
    // Rob's own revised scoreboard art (assets/ScoreBoard2.png) — bubbles,
    // panel, AND an empty narrow pill slot near the bottom all baked into
    // one image now; only the dynamic fill still gets drawn here.
    this._scoreBoard = new PIXI.Sprite(textures.scoreBoard2);
    c.addChild(this._scoreBoard);
    const boardAR = textures.scoreBoard2.width / textures.scoreBoard2.height;
    const boardH = 148; // display height
    this._scoreBoard.height = boardH;
    this._scoreBoard.width = boardH * boardAR;
    this._scoreBoard.position.set(margin, 14);
    const board = this._scoreBoard;

    // Big, dominant number sitting in the upper portion of the pill. Rob:
    // "use my old version to see how big the font needs to be" — measured
    // his earlier baked-in "1,640" off that reference image with the same
    // Python/Pillow scan (glyph bbox height 69px of a 269px-tall image,
    // ~25.6% of the board's own height; PotionTitle's cap-height runs
    // roughly 70% of its nominal font-size, so size ≈ boardH*0.2565/0.7).
    this._scoreNumber = buildTabularNumber(c, { size: boardH * 0.2565 / 0.7, font: 'PotionTitle', color: 0xe9e2f5, baseline: 'middle' });
    // Rob: "move the score numbers up two pixels to make room" (for the
    // bar-top sparks riding just below it).
    this._numberPos = { x: board.x + board.width * 0.509, y: board.y + board.height * 0.463 - 2 };

    // Empty pill slot bounds, measured directly off the source PNG
    // (assets/ScoreBoard2.png, 612x269 native) with a Python/Pillow pixel
    // scan — Rob: "take time to measure so it fits exactly, don't stop
    // working until you take a screenshot and see that it fits." Stored
    // as fractions of the image so they scale correctly at any display
    // size instead of hardcoded pixels.
    const slotFrac = { left: 0.2214, right: 0.7696, top: 0.6766, bottom: 0.7751 };
    this._barRect = {
      x: board.x + board.width * slotFrac.left,
      y: board.y + board.height * slotFrac.top,
      w: board.width * (slotFrac.right - slotFrac.left),
      h: board.height * (slotFrac.bottom - slotFrac.top),
    };
    this._barFill = new PIXI.Graphics();
    c.addChild(this._barFill);
    this._barSweep = new PIXI.Graphics();
    c.addChild(this._barSweep);

    // Full-power indicator, take 2 — Rob: "we don't need an orb. We just
    // need the top of the long pink pill to show some energy... match the
    // energy of our normal moonstone when it has energy." A thin strip of
    // sparking particles riding the bar's own top edge instead of a
    // separate circular effect — same pink/blue energy palette the real
    // charged-moon orb uses (pixi_playscreen.js's _moonOrb: 0xff4fb8 /
    // 0x3aa8ff), not gold.
    this._barSparkContainer = new PIXI.Container();
    c.addChild(this._barSparkContainer);
    // A second container, softly blurred, for a portion of the sparks —
    // Rob: "add a slight blur to some of the bubbles... so it looks more
    // like our moon stone when charged" (the real orb mixes sharp and
    // soft particles — see plasma_orb.js). One shared BlurFilter on the
    // whole container rather than one filter per sprite (same "don't
    // allocate a filter per particle" lesson the jet nozzle leak taught).
    this._barSparkBlurContainer = new PIXI.Container();
    this._barSparkBlurContainer.filters = [new PIXI.BlurFilter({ strength: 2.2, quality: 2 })];
    c.addChild(this._barSparkBlurContainer);
    this._barSparkPool = [];
    this._barSparkBlurPool = [];
    this._barSparkData = [];
    this._barSparkSpawnTimer = 0;

    // The "Reserve Core" — Rob: "tuck that gold orb away, we're going to
    // use it later." Built but not added to the HUD container or updated
    // for now, ready to wire up again whenever that later feature happens.
    this._reserveCore = new PlasmaOrb({
      radius: 17, particleCount: 26, cloudPuffs: 5, cloudChurn: 0.8,
      swirlSpeed: 2.2, arcFrequency: 0, energyColor: 0xffe08a,
    });

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
    this._scoreBoard.visible = visible;
    this._scoreNumber.setVisible(visible);
    this._barFill.visible = visible;
    this._barSweep.visible = visible;
    this._barSparkContainer.visible = visible;
    if (!visible) return;

    this._t += this._dt || 1 / 60;
    this._scoreNumber.setText(PlayScreen._scoreText(), this._numberPos.x, this._numberPos.y);
    this._refreshBar();
    this._refreshBarSparks();
  },

  // Fills the empty pill slot baked into Rob's ScoreBoard2.png. Premium-
  // arcade treatment per Rob's ask: lit along the top edge, a shadow along
  // the bottom — a top-to-bottom gradient on the fill itself, not a flat
  // color — plus a bright leading edge at the fill's current front.
  _refreshBar() {
    const ready = PlayScreen.blastCharges >= PlayScreen.MAX_BLAST_CHARGES;
    const progress = ready ? 1 : Math.max(0, Math.min(1, (PlayScreen.score - PlayScreen.blastThreshold) / 1000));
    // Rob: "make the pink color a little darker like my base pink for the
    // potion" — dimmed toward the tube's own base pink instead of reading
    // bright/washed out.
    const tube = (Physics.currentPlatform && Physics.currentPlatform.tubeColor) || [240, 0, 184];
    const darken = 0.8;
    const baseColor = (ready ? [255, 66, 208] : tube).map((v) => v * darken);

    const { x, y, w, h } = this._barRect;
    const fw = Math.max(0, w * progress);
    const fg = this._barFill;
    fg.clear();
    if (fw > h * 0.6) {
      const r = h / 2;
      // Light along the top, shadow along the bottom — lerp the fill's
      // own color toward white near y0 and toward black near y1, same
      // "light source from above" trick the earlier reservoir design used.
      const grad = new PIXI.FillGradient({ type: 'linear', x0: 0, y0: y, x1: 0, y1: y + h });
      const lerp = (t) => {
        const mix = t < 0.5
          ? baseColor.map((c) => Math.round(c + (255 - c) * (0.5 - t) * 0.7))
          : baseColor.map((c) => Math.round(c * (1 - (t - 0.5) * 0.9)));
        return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
      };
      grad.addColorStop(0, lerp(0));
      grad.addColorStop(0.45, lerp(0.45));
      grad.addColorStop(1, lerp(1));
      fg.roundRect(x, y, fw, h, r).fill(grad);
      // Rob: "remove the little ball at the end" — no leading-edge dot.
    }

    // Full-charge pulse on the bar itself — a once-off flare, not a
    // repeating flash.
    if (ready && !this._meterWasReady) this._meterSweepT = 0;
    this._meterWasReady = ready;
    const swg = this._barSweep;
    swg.clear();
    if (this._meterSweepT !== null) {
      this._meterSweepT += this._dt || 1 / 60;
      const dur = 0.4;
      if (this._meterSweepT >= dur) {
        this._meterSweepT = null;
      } else {
        const pulse = 1 - this._meterSweepT / dur;
        swg.roundRect(x, y, fw, h, h / 2).stroke({ width: 4, color: HUD_COLOR.coolWhite, alpha: 0.8 * pulse });
      }
    }
  },

  // Thin strip of sparking energy riding the bar's own top edge — Rob:
  // "the top of the long pink pill to show some energy... match the
  // energy of our normal moonstone when it has energy" (pink/blue, not
  // gold). Density and brightness build with progress, same spirit as the
  // real moon orb's own arcs — just living along a line instead of a
  // sphere.
  _refreshBarSparks() {
    const ready = PlayScreen.blastCharges >= PlayScreen.MAX_BLAST_CHARGES;
    const progress = ready ? 1 : Math.max(0, Math.min(1, (PlayScreen.score - PlayScreen.blastThreshold) / 1000));
    const { x, y, w } = this._barRect;
    const fw = Math.max(0, w * progress);
    const dt = this._dt || 1 / 60;

    // Rob: "make sure those bubbles on the charge bar don't start until it
    // reaches the end of the bar — it fills the bar" — only once fully
    // charged now, not building up gradually alongside the fill.
    const data = this._barSparkData;
    if (ready) {
      this._barSparkSpawnTimer -= dt;
      const rate = 1 / 55;
      let guard = 0;
      while (this._barSparkSpawnTimer <= 0 && guard < 15) {
        this._barSparkSpawnTimer += rate;
        guard++;
        // Rob: "make some of the bubbles white now but keep the pink and
        // blue... maybe fifteen percent white" — carved out of the same
        // roll, rest keeps its original ~40/60 pink/blue split.
        const roll = Math.random();
        const tint = roll < 0.15 ? 'white' : roll < 0.15 + 0.85 * 0.4 ? 'pink' : 'blue';
        data.push({
          x: x + Math.random() * fw, y: y + 1,
          vy: -(14 + Math.random() * 16),
          life: 0, maxLife: 0.28 + Math.random() * 0.22,
          size: 2 + Math.random() * 2.5,
          tint,
          blurred: Math.random() < 0.35, // Rob: "a slight blur to some of the bubbles"
        });
      }
    }
    for (let i = data.length - 1; i >= 0; i--) {
      const s = data[i];
      s.life += dt;
      if (s.life >= s.maxLife) { data.splice(i, 1); continue; }
      s.y += s.vy * dt;
    }
    const sharp = data.filter((s) => !s.blurred);
    const blurred = data.filter((s) => s.blurred);
    const syncPool = (pool, container, list) => {
      while (pool.length < list.length) {
        const sp = new PIXI.Graphics();
        container.addChild(sp);
        pool.push(sp);
      }
      while (pool.length > list.length) container.removeChild(pool.pop());
      for (let i = 0; i < list.length; i++) {
        const s = list[i], sp = pool[i];
        const t = s.life / s.maxLife;
        sp.clear();
        const color = s.tint === 'white' ? 0xffffff : s.tint === 'pink' ? 0xff4fb8 : 0x3aa8ff;
        sp.circle(0, 0, s.size * (1 - t * 0.5)).fill({ color, alpha: (1 - t) * (ready ? 1 : 0.75) });
        sp.position.set(s.x, s.y);
      }
    };
    syncPool(this._barSparkPool, this._barSparkContainer, sharp);
    syncPool(this._barSparkBlurPool, this._barSparkBlurContainer, blurred);
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
