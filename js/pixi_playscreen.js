// The gameplay screen, rebuilt on PixiJS — the big remaining piece of Phase 1
// (see PINBALL_EXPANSION_PLAN.md). Building this up in stages rather than one
// giant leap: this first pass gets the core scene up — scrolling fog
// background, the pole, the platform bar, and the ball sitting on/rolling
// with it — driven by the *same* fog.js/platform.js/physics.js update logic
// already used by the live Canvas 2D game (none of that math changed, only
// how it gets drawn). Liquid, the hinge glow/particles, jets, HUD, and the
// Game Over flow are NOT built yet — next chunks.
const PlayScreenPixi = {
  container: null,
  _fogSprites: [],
  _poleSprite: null,
  _poleGlow: null,
  _platformContainer: null, // rotates as a whole around the pivot
  _platformSprite: null,
  _ballSprite: null,

  build(textures) {
    const c = new PIXI.Container();
    this.container = c;

    const bg = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x0a0410);
    c.addChild(bg);

    // Fog — 3 layers, each 2 stacked sprites (see Fog.layers in fog.js for the
    // actual scroll/wrap math, unchanged). Built here as plain Sprites whose
    // y position gets set from Fog.layers each frame in refresh().
    for (const l of Fog.layers) {
      const img = new PIXI.Sprite(textures[l.key]);
      img.width = 720; img.height = 1280;
      const imgFlip = new PIXI.Sprite(textures[l.key + 'Flip']);
      imgFlip.width = 720; imgFlip.height = 1280;
      c.addChild(img, imgFlip);
      this._fogSprites.push({ key: l.key, sprite: img, spriteFlip: imgFlip });
    }

    // Vignette — same gradient shape as Fog._drawVignette, built once as a
    // Graphics fill using Pixi's gradient fill support (static, so no need to
    // rebuild it per frame the way the old ctx version implicitly did).
    const vignette = new PIXI.Graphics();
    const grad = new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: 0, x1: 0, y1: 1280,
      colorStops: [
        { offset: 0, color: 'rgba(10,4,16,1)' },
        { offset: 0.55, color: 'rgba(10,4,16,1)' },
        { offset: 0.68, color: 'rgba(10,4,16,0.78)' },
        { offset: 0.82, color: 'rgba(10,4,16,0.6)' },
        { offset: 1, color: 'rgba(10,4,16,0.45)' },
      ],
      textureSpace: 'local',
    });
    vignette.rect(0, 0, 720, 1280).fill(grad);
    c.addChild(vignette);

    // Pole — static sprite + a glowing rounded-rect outline drawn with a
    // vertical alpha fade (matches Platform.draw()'s two-pass shadowBlur
    // technique, approximated here with Pixi's blur filter since ctx's
    // per-stroke shadowBlur doesn't have a direct Pixi equivalent — a filter
    // blurs the whole graphics object instead of just its stroke, which
    // reads close enough at this glow's scale).
    const poleX = Platform.pivot.x - 25;
    this._poleSprite = new PIXI.Sprite(textures.pole);
    this._poleSprite.position.set(poleX, Platform.pivot.y);
    this._poleSprite.width = 50; this._poleSprite.height = Platform.poleHeight;
    c.addChild(this._poleSprite);

    this._poleGlow = new PIXI.Graphics();
    const poleGrad = new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: Platform.pivot.y, x1: 0, y1: Platform.pivot.y + Platform.poleHeight,
      colorStops: [
        { offset: 0, color: 'rgba(170,100,255,0.35)' },
        { offset: 0.6, color: 'rgba(170,100,255,0.2)' },
        { offset: 1, color: 'rgba(170,100,255,0)' },
      ],
      textureSpace: 'local',
    });
    this._poleGlow.roundRect(poleX, Platform.pivot.y, 50, Platform.poleHeight, 10).stroke({ width: 3, fill: poleGrad });
    this._poleGlow.filters = [new PIXI.BlurFilter({ strength: 6 })];
    c.addChild(this._poleGlow);

    // Platform bar — a Container so the whole assembly (bar sprite, and later
    // liquid/glass) rotates together around the pivot, same coordinate-space
    // trick as the old ctx.translate+rotate block in Platform.draw().
    this._platformContainer = new PIXI.Container();
    this._platformContainer.position.set(Platform.pivot.x, Platform.pivot.y);
    this._platformSprite = new PIXI.Sprite(textures.platform);
    this._platformSprite.anchor.set(0.5);
    this._platformSprite.width = Platform.length; this._platformSprite.height = Platform.thickness;
    this._platformContainer.addChild(this._platformSprite);

    // Liquid — rebuilt from scratch every frame in refresh() (the column
    // levels genuinely change every frame, unlike everything else here which
    // is a static shape just being repositioned), clipped to the tube's own
    // rounded-rect shape via a Pixi mask (Canvas 2D's ctx.clip() has no
    // direct Pixi equivalent — a mask achieves the same "only show what's
    // inside this shape" result). Two Graphics: the fill+gradient body, and
    // a separate 'screen'-blended shine on top, matching
    // Platform._drawLiquid()'s two-pass approach exactly.
    const halfL = Platform._liquidHalfLength(), halfT = Platform._liquidHalfThickness();
    this._liquidMask = new PIXI.Graphics().roundRect(-halfL, -halfT, halfL * 2, halfT * 2, halfT).fill(0xffffff);
    this._liquidBody = new PIXI.Graphics();
    this._liquidShine = new PIXI.Graphics();
    this._liquidShine.blendMode = 'screen';
    const liquidContainer = new PIXI.Container();
    liquidContainer.addChild(this._liquidBody, this._liquidShine, this._liquidMask);
    liquidContainer.mask = this._liquidMask;
    this._platformContainer.addChild(liquidContainer);

    // Glass — shadow + highlight sprites drawn in front of the liquid, same
    // as Platform._drawGlass(). Highlight's x gets nudged slightly per-frame
    // for the parallax cue (see refresh()).
    this._tubeShadow = new PIXI.Sprite(textures.tubeShadow);
    this._tubeShadow.anchor.set(0.5);
    this._tubeShadow.width = Platform.length; this._tubeShadow.height = Platform.thickness;
    this._tubeShadow.alpha = 0.8;
    this._tubeHighlight = new PIXI.Sprite(textures.tubeHighlight);
    this._tubeHighlight.anchor.set(0.5);
    this._tubeHighlight.width = Platform.length; this._tubeHighlight.height = Platform.thickness;
    this._tubeHighlight.alpha = 0.9;
    this._platformContainer.addChild(this._tubeShadow, this._tubeHighlight);

    c.addChild(this._platformContainer);

    // Ball — Physics.draw()'s equivalent: a sprite rotating around its own
    // center, position/rotation copied from Physics.x/y/rotation every frame.
    this._ballSprite = new PIXI.Sprite(textures.ball);
    this._ballSprite.anchor.set(0.5);
    const ballSize = Physics.displayRadius * 2;
    this._ballSprite.width = ballSize; this._ballSprite.height = ballSize;
    c.addChild(this._ballSprite);
  },

  update(dt, tiltX) {
    Platform.update(dt);
    Physics.update(dt, tiltX);
    Fog.update(dt);
  },

  refresh() {
    for (const f of this._fogSprites) {
      const l = Fog.layers.find((x) => x.key === f.key);
      f.sprite.y = l.y1;
      f.spriteFlip.y = l.y2;
    }

    this._platformContainer.rotation = Platform.angleRad;
    this._refreshLiquid();

    // Glass highlight parallax — same `-angle*3` nudge as the old
    // Platform._drawGlass(), just applied to a sprite's x instead of an
    // extra ctx.drawImage x-offset argument.
    this._tubeHighlight.x = -Platform.angle * 3;

    this._ballSprite.position.set(Physics.x, Physics.y);
    this._ballSprite.rotation = Physics.rotation;
  },

  // Rebuilds the liquid's fill + shine Graphics from Platform.liquidColumns —
  // has to run every frame since the column levels genuinely change every
  // frame (spring physics), unlike everything else in this file which is a
  // static shape just being repositioned. Mirrors Platform._drawLiquid()
  // line for line, just using Pixi's Graphics path API instead of Canvas 2D's.
  _refreshLiquid() {
    const halfT = Platform._liquidHalfThickness();
    const cols = Platform.liquidColumns;
    if (!cols.length) return;

    const body = this._liquidBody;
    body.clear();
    body.moveTo(cols[0].x, halfT);
    body.lineTo(cols[0].x, cols[0].level);
    for (let i = 1; i < cols.length - 1; i++) {
      const midX = (cols[i].x + cols[i + 1].x) / 2;
      const midY = (cols[i].level + cols[i + 1].level) / 2;
      body.quadraticCurveTo(cols[i].x, cols[i].level, midX, midY);
    }
    const last = cols[cols.length - 1];
    body.lineTo(last.x, last.level);
    body.lineTo(last.x, halfT);
    body.closePath();

    const [tr, tg, tb] = Difficulty.tubeColor;
    const bodyGrad = new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: -halfT, x1: 0, y1: halfT,
      colorStops: [
        { offset: 0, color: `rgba(${lighten(tr, 90)},${lighten(tg, 90)},${lighten(tb, 20)},0.9)` },
        { offset: 0.35, color: `rgba(${tr | 0},${tg | 0},${tb | 0},0.95)` },
        { offset: 1, color: `rgba(${darken(tr, 0.55)},${darken(tg, 0.55)},${darken(tb, 0.55)},0.92)` },
      ],
      textureSpace: 'local',
    });
    body.fill(bodyGrad);

    const shine = this._liquidShine;
    shine.clear();
    const maxDepth = halfT * 2;
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i], b = cols[i + 1];
      const depthA = halfT - a.level, depthB = halfT - b.level;
      const depth = Math.min(depthA, depthB);
      const alpha = smoothstep(0, maxDepth * 0.22, depth) * 0.45;
      if (alpha <= 0.01) continue;
      shine.moveTo(a.x, a.level).lineTo(b.x, b.level)
        .stroke({ width: 3, color: `rgba(${lighten(tr, 150)},${lighten(tg, 150)},${lighten(tb, 150)},${alpha.toFixed(3)})` });
    }
  },
};
