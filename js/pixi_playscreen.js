// The gameplay screen, rebuilt on PixiJS. Phase 1 built this around one global
// `Platform`; Phase 2 (the pinball-tower expansion) turned `Platform` into a
// factory (see platform.js) so multiple independent platforms can exist at once,
// stacked in a `PlayScreen.platforms` array — this file's job is now to build a
// Pixi visual "bundle" per platform instead of one fixed set of sprites, plus a
// world/camera split: platforms + the ball live inside `worldContainer`, which
// pans vertically to follow the ball as it climbs/falls (Rob: camera follows the
// ball, doesn't show the whole tower fixed); the background/fog/vignette and the
// HUD stay screen-fixed, outside the panning container.

// Pixi sprite tints take a single packed 0xRRGGBB number, not separate
// channels — the old ctx-based particle code kept r/g/b as separate lerped
// floats the whole way through, so this just packs them at the point of use.
function rgbToHex(r, g, b) {
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
}
function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }
// Small dashed-shape helpers for the Level 1-2 goal-height indicator (Rob:
// "a white dotted line"). Pixi has no native dash support on strokes, so
// these just draw short segments with gaps by hand.
function drawDashedEllipseImpl(g, cx, cy, rx, ry, dashLen, gapLen, color, alpha) {
  // Pixi's arc() only draws circles, so each dash is its own short polyline
  // sampled along the ellipse's parametric curve instead.
  const circumference = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const dashCount = Math.max(8, Math.round(circumference / (dashLen + gapLen)));
  const dashFrac = (dashLen / (dashLen + gapLen)) / dashCount;
  const samplesPerDash = 4;
  for (let i = 0; i < dashCount; i++) {
    const t0 = i / dashCount;
    for (let s = 0; s <= samplesPerDash; s++) {
      const t = t0 + dashFrac * (s / samplesPerDash);
      const ang = t * Math.PI * 2;
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
      if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }
  g.stroke({ width: 3, color, alpha });
}
function drawDashedLineImpl(g, x0, x1, y, dashLen, gapLen, color, alpha) {
  for (let x = x0; x < x1; x += dashLen + gapLen) {
    g.moveTo(x, y).lineTo(Math.min(x + dashLen, x1), y);
  }
  g.stroke({ width: 3, color, alpha });
}
// Rob's cauldron colors are "match the base platform color, with a lighter
// version for the glow and a pale tint for the steam" — one shared helper
// for both, just a different mix fraction toward white.
function mixTowardWhiteHex(r, g, b, t) {
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

const PlayScreenPixi = {
  container: null,
  worldContainer: null,
  _fogSprites: [],
  _ballSprite: null,
  _camY: 0,
  _camX: 0,
  _dt: 1 / 60,
  // Screen-fixed background width in world units — 720 (CONFIG.WIDTH) in
  // portrait. In landscape, game.js widens this so the background/fog
  // genuinely extends to fill the sides (Rob: didn't want empty CSS margin
  // there, wanted the game itself to extend) rather than being a fixed
  // 720-wide box with flat color/static image padding around it.
  renderWidth: 720,

  build(textures) {
    const c = new PIXI.Container();
    this.container = c;

    this._bg = new PIXI.Graphics().rect(0, 0, this.renderWidth, 1280).fill(0x0a0410);
    // Tap anywhere on screen to jump (Rob: "allow the moon to jump anytime
    // someone taps the screen anywhere... remove the jumping icons with the
    // potion bottles — we're not going to use those anymore"), replacing
    // the two dedicated tap-to-jump buttons (see pixi_hud.js). Wired on the
    // full-screen background rather than the stage/canvas itself so it only
    // fires during actual gameplay (this container's own screen), and sits
    // behind every other interactive object in the tree (buttons, Game
    // Over's bottom bar) — Pixi hit-tests front-to-back and stops at the
    // first interactive match, so this background tap never steals a touch
    // meant for something drawn on top of it. fireBlast() itself already
    // no-ops when the run is over or still in its intro pause.
    //
    // Rob: "tap to jump... swipe up to jump charged" — a plain tap and a
    // real upward swipe used to do the exact same thing (both just fired
    // pointertap); now they're split by tracking where the pointer went
    // down vs up and reading the vertical distance. allowChargeSpend (see
    // ui.js's fireBlast) is only true for the swipe — a tap stays the
    // free normal jump no matter how big a charge is banked.
    this._bg.eventMode = 'static';
    this._bg.cursor = 'pointer';
    let pressY = null;
    const SWIPE_UP_MIN_PX = 40;
    this._bg.on('pointerdown', (e) => { pressY = e.global.y; });
    const resolvePress = (e) => {
      if (pressY === null) return;
      const dy = pressY - e.global.y; // positive = moved up
      pressY = null;
      PlayScreen.fireBlast(dy > SWIPE_UP_MIN_PX);
    };
    this._bg.on('pointerup', resolvePress);
    this._bg.on('pointerupoutside', resolvePress);
    c.addChild(this._bg);

    // Fog — 3 layers, each 2 stacked sprites (see Fog.layers in fog.js for the
    // actual scroll/wrap math, unchanged). Screen-fixed background atmosphere,
    // not part of the panning world — it doesn't need to scroll with the camera.
    for (const l of Fog.layers) {
      const img = new PIXI.Sprite(textures[l.key]);
      img.width = this.renderWidth; img.height = 1280;
      const imgFlip = new PIXI.Sprite(textures[l.key + 'Flip']);
      imgFlip.width = this.renderWidth; imgFlip.height = 1280;
      c.addChild(img, imgFlip);
      this._fogSprites.push({ key: l.key, sprite: img, spriteFlip: imgFlip });
    }

    // Vignette — same gradient shape as Fog._drawVignette, built once as a
    // Graphics fill using Pixi's gradient fill support. Purely a vertical
    // gradient (x0/x1 both 0) so its width can change without touching the
    // gradient itself — only the rect() needs redrawing on resize.
    this._vignette = new PIXI.Graphics();
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
    this._vignette.rect(0, 0, this.renderWidth, 1280).fill(grad);
    c.addChild(this._vignette);

    // Background embers (Rob: "looks good except the background is a
    // little boring") — slow-drifting warm motes, screen-fixed like the
    // fog/vignette, only spawned on levels with their own color identity
    // (see ui.js's levelAccentColor) so every other level's background
    // stays exactly as plain as it's always been. Behind worldContainer
    // (added right after this), so platforms/ball always read clearly on
    // top of them.
    this._emberContainer = new PIXI.Container();
    this._emberContainer.blendMode = 'add';
    c.addChild(this._emberContainer);
    this._embers = [];
    this._emberPool = [];

    // Cliff silhouette layer (Rob sent a reference image of jagged
    // cliffs + iridescent orbs: "adding something like this to the
    // background... maybe making it like screen transparent... with the
    // layer you already have"). A tall (369x2000) strip, scaled to the
    // screen width and scrolled the same slow-upward/two-stacked-copies
    // way the fog layers already do (see Fog.layers/refresh() below),
    // just with its own real scaled height for the wrap math instead of
    // fog's fixed 1280. Kept semi-transparent per Rob's "screen
    // transparent" — this sits behind the fog/vignette conceptually but
    // is added after them here since Pixi draws children in add order
    // and this should read as a midground silhouette the fog drifts in
    // front of, not a flat backdrop the fog sits on top of.
    const cliffAspect = textures.bgCliffs.height / textures.bgCliffs.width;
    this._cliffScaledHeight = this.renderWidth * cliffAspect;
    this._cliffLayer = { y1: 0, y2: -this._cliffScaledHeight, speed: -10 };
    this._cliffSprite = new PIXI.Sprite(textures.bgCliffs);
    this._cliffSprite.width = this.renderWidth; this._cliffSprite.height = this._cliffScaledHeight;
    this._cliffSpriteB = new PIXI.Sprite(textures.bgCliffs);
    this._cliffSpriteB.width = this.renderWidth; this._cliffSpriteB.height = this._cliffScaledHeight;
    this._cliffSprite.alpha = this._cliffSpriteB.alpha = 0.4;
    // Rob: "too much green in the background. let's remove the stones
    // from all of them for now. I'm going to find some new images" —
    // pulled off screen (not added to the display list) rather than
    // deleting the whole layer, so swapping in new art later is just
    // pointing textures.bgCliffs at a new file plus re-adding these two
    // lines. Position/tint/scroll logic below still runs harmlessly on
    // them either way (they're just never actually drawn).
    // c.addChild(this._cliffSprite, this._cliffSpriteB);

    // The panning world — every platform and the ball live in here. Built once
    // PlayScreen.platforms exists (PlayScreen.enter() runs before the first
    // build() call from game.js's main(), same ordering Phase 1 relied on for
    // JET_DEFS).
    this.worldContainer = new PIXI.Container();
    c.addChild(this.worldContainer);

    // Built before the platforms/ball below (Rob: the win art should sit
    // behind everything so the ball and platforms are visible in front of
    // it as it climbs past, not drawn on top of them).
    // Each Level's goal line (Rob: "a line/threshold at the top where the
    // level is completed"). In worldContainer so it pans with the camera
    // like everything else the ball climbs past; only actually shown while
    // in a Level (not Free Play), and only until it's been reached (see
    // refresh() below) — no reason to keep drawing it once it's done its
    // job.
    //
    // Built once at y=0 in group-local coordinates, then positioned every
    // level via this._goalLineGroup.position.y instead of baking a specific
    // level's goalY into the art's own position — different Levels sit at
    // different heights (see PlayScreen._levelThresholdY), and
    // level1/freeplay/level2 all share this one screen/container.
    //
    // Art (Rob): a glowing cauldron under a starfield, with its bright pink
    // potion surface as the actual goal line the ball climbs to — replaced
    // the earlier witch/cat piece (same role, new look, Rob supplied the
    // source render). The raw image has a plain black background and hard
    // rectangular edges, unlike the old art's own built-in fade, so
    // GoalLineCauldron.webp is a pre-processed version with a vertical fade
    // (opaque down to just past the liquid line, transparent by the bottom
    // edge) and a feathered left/right edge baked into its alpha channel —
    // see the Python/Pillow composite used to build it — so it still blends
    // into the game's own dark background with no separate mask here.
    this._goalLineGroup = new PIXI.Container();
    // Sized well past the 720px canvas width (Rob: "make that PNG image
    // much bigger") — centered, so it bleeds off both edges rather than
    // being fit to the canvas. Safe to scale freely: the pink line always
    // lands at this group's own y=0 regardless of this value (see
    // GOAL_LINE_LINE_FRAC below), so making the art bigger never shifts the
    // level's actual goal line out of sync with it.
    const GOAL_LINE_DISPLAY_W = 1560; // 1300 * 1.2 (Rob: "20% bigger... when I jump to that last level, it's all I see")
    const goalLineSprite = new PIXI.Sprite(textures.goalLineWitch);
    const goalLineAspect = textures.goalLineWitch.height / textures.goalLineWitch.width;
    const goalLineDisplayH = GOAL_LINE_DISPLAY_W * goalLineAspect;
    // How far down the source art (GoalLineCauldron.webp, 1672x941) the
    // glowing potion-surface line actually sits — measured directly off the
    // source pixels (brightest row in the cauldron's liquid), not eyeballed,
    // so this stays correct if the art is ever re-cropped/re-exported at a
    // different size with the line elsewhere.
    const GOAL_LINE_LINE_FRAC = 522 / 941;
    goalLineSprite.position.set(360 - GOAL_LINE_DISPLAY_W / 2, -goalLineDisplayH * GOAL_LINE_LINE_FRAC);
    // Distance from the line (this group's own y=0) up to the image's actual
    // top edge — used by _updateCamera to keep the camera from panning past
    // where this art still covers the screen (see its own comment).
    this._goalLineTopOffset = goalLineDisplayH * GOAL_LINE_LINE_FRAC;
    goalLineSprite.width = GOAL_LINE_DISPLAY_W;
    goalLineSprite.height = goalLineDisplayH;
    // Boiling potion effect (handoff from the Plasma Energy Orb chat, Rob's
    // tuned settings) — a child of the goal-line sprite itself rather than a
    // sibling, so it inherits the sprite's own scale automatically and every
    // option below stays in the ART's own pixel space (1672x941). (845, 505)
    // is the potion-surface ellipse's measured center in that space. Colors
    // are set live in refresh() (match each level's own base-tube color);
    // brewOver() fires on level-complete, also in refresh().
    this._potionCauldron = new PotionCauldron({
      boil: 5.5, bubbleSize: 2, surfaceGlow: 1.15, surfaceSwirl: 2.8, vapour: 2.7,
      finaleDuration: 3.75, eruptHeight: 520, vortexStrands: 1, vortexTurns: 1.1, spinSpeed: 2.3,
      vortexWidth: 1, vortexBlur: 20, steamBurst: 1.8, sparkCount: 1.7, sparkBlur: 2.5,
      surfaceWidth: 300, surfaceHeight: 44,
    });
    this._potionCauldron.view.position.set(845, 505);
    goalLineSprite.addChild(this._potionCauldron.view);
    // Clips the ball sprite to its top half while it's sitting sunk in the
    // cauldron (Rob: "it should be partially submerged... we should only
    // see about half of it") — a plain rectangle above the liquid surface
    // line, resized/repositioned every frame in refresh() to track the bob.
    this._cauldronMask = new PIXI.Graphics();
    this.worldContainer.addChild(this._cauldronMask);
    this._potionBrewSeen = false;
    this._potionRunStartSeen = PlayScreen.runStartCount;
    this._goalLabel = new PIXI.Text({
      // Rob: "the text is too pink" — white instead, so it reads as a UI
      // label over the art rather than blending into the pink potion glow.
      text: '', style: { fontFamily: 'PotionTitle', fontSize: 32, fill: 0xffffff, align: 'center' },
    });
    this._goalLabel.anchor.set(0.5, 1);
    // Sits in the open misty gap between the cauldron and the potion-surface
    // line (see the art) rather than right on top of either.
    this._goalLabel.position.set(360, -70);
    this._goalLineGroup.addChild(goalLineSprite, this._goalLabel);

    // Rob: "there's nothing to indicate [the goal height] to players... make
    // a white dotted line around the rim of the cauldron... it should extend
    // left and right at precisely where the moon stone will stop even if the
    // pot is missed." First couple levels only (see refresh()'s own
    // visibility toggle) — a dashed ellipse over the pot's own rim plus a
    // dashed line spanning the full width at the same height as the art's
    // own baked-in goal line (this group's local y=0, same reference every
    // other goal-line measurement in this file already uses).
    this._goalTargetLine = new PIXI.Graphics();
    this._goalLineGroup.addChild(this._goalTargetLine);
    this._drawDashedEllipse(this._goalTargetLine, 360, 0, 148, 20, 10, 8, 0xffffff, 0.9);
    this._drawDashedLine(this._goalTargetLine, -2000, 2000, 0, 10, 8, 0xffffff, 0.9);
    this.worldContainer.addChild(this._goalLineGroup);

    // Plasma storm fields (Rob: Level 4's appearing/disappearing storm —
    // see ui.js's _createPlasmaStorm for the cycle and physics.js for the
    // push). Added this early so it draws behind the platforms and the
    // ball: it's a backdrop field the stone passes through, not a cloud it
    // sinks into. Mapped per PlayScreen.plasmaStorms entry, same as the
    // dark matter visuals (see _updatePlasmaStorms).
    this._plasmaStormContainer = new PIXI.Container();
    this.worldContainer.addChild(this._plasmaStormContainer);
    this._plasmaStormVisuals = new Map();
    this._goalLineLevelNum = null; // cache so refresh() only repositions/relabels on an actual level change

    for (const p of PlayScreen.platforms) {
      this._buildPlatformVisual(p, textures);
    }

    // Level 12 dot-collection test bed (Rob) — plain placeholder circles for
    // now ("we will replace them with whatever we want them to look like
    // later"). One Graphics per dot, built once up front same as every
    // other platform visual; refresh() just repositions/hides them off
    // PlayScreen._dotWorldPos() + d.collected every frame. A separate
    // container (not parented to any one platform) since a dot's world
    // position already bakes in its own platform's pivot/tilt.
    this._dotContainer = new PIXI.Container();
    this.worldContainer.addChild(this._dotContainer);
    for (const d of PlayScreen.towerDots.level12) {
      const g = new PIXI.Graphics().circle(0, 0, 10).fill({ color: 0xff42d0, alpha: 0.95 });
      g.visible = false;
      this._dotContainer.addChild(g);
      d._visual = g;
    }

    // Ball — a sprite rotating around its own center, position/rotation copied
    // from Physics.x/y/rotation every frame. Z-order relative to each
    // platform's hinge/bubbles is re-applied every frame in refresh() (see
    // _restackBall) since which platform it's "behind" changes as it climbs.
    this._ballSprite = new PIXI.Sprite(textures.ball);
    this._ballSprite.anchor.set(0.5);
    const ballSize = Physics.displayRadius * 2;
    this._ballSprite.width = ballSize; this._ballSprite.height = ballSize;

    // Moon charge — a PlasmaOrb glow wrapped around the existing moon/ball
    // art (Rob: replaces the old potion-bottle charge system entirely; the
    // moon itself glows when a charge is banked, dark/off otherwise). Added
    // right before the ball sprite so it renders as an aura behind it, not
    // covering it. Only ever visible while a charge is actually banked (see
    // refresh()) — off is the resting state, not a dim idle glow, so it
    // reads as a clear on/off "charged" signal.
    this._moonOrb = new PlasmaOrb({
      // Tighter (was 1.6x — Rob: "the orb around the moonstone is too big"),
      // and even more sparks alive at once (Rob's follow-up: the blur pass
      // below buried the ball itself — "bring it back to how it was but
      // just shrink it down," with more particles standing in for the
      // fuzz/brightness instead) — original was 70/1.2.
      radius: Physics.displayRadius * 1.2, particleCount: 260,
      energyColor: 0xff4fb8, secondColor: 0x3aa8ff, arcFrequency: 3.5, arcJaggedness: 1.4,
      // A spark's own size is a fraction of `radius`, so shrinking the orb
      // to 1.2x (from 1.6x) shrank every spark right along with it, down to
      // just a couple px each — Rob: "it's like we lost all of the
      // particles... figure out how to get them back so I can see them."
      // sparkScale keeps sparks a visible size independent of the orb's
      // own (now much smaller) radius.
      sparkScale: 2.2,
    });
    // No filters — the blur+brightness pass tried for "fuzzier and
    // brighter" made the whole orb wash out and bury the moon underneath it
    // (Rob: "everything is too blurred around the ball so you can barely
    // see it"). Back to the orb's own crisp/additive look, unfiltered.
    // Cloud layer off (Rob: "the cloud is covering the moon... remove the
    // cloud element and just keep the electrical and particles swirling
    // around our existing moon") — that layer is the smoky puffs plus a
    // solid dark body disc meant to read as the orb's own volume, which
    // was sitting right on top of the moon/ball art instead of just
    // glowing around it. Swirl (sparks) + arcs (electric discharges) stay,
    // which is exactly "electrical and particles swirling around" the moon.
    this._moonOrb.layers.cloud.visible = false;
    this._moonOrb.view.visible = false;
    this._moonOrb.view.alpha = 0;
    this.worldContainer.addChild(this._moonOrb.view);

    // Soft light-blue ambient glow behind the ball (Rob: "keep working on
    // that emitter around the moon... add a little light blue glow around
    // the moon to go along with the emitter") — a separate, simple radial
    // glow underneath the sparks/arcs, not another particle effect. Same
    // soft-glow texture the hinge/jet effects already use elsewhere,
    // tinted and additively blended so it reads as a gentle backlight
    // rather than a hard-edged circle. Added before the orb so it sits
    // furthest back (glow, then sparks/arcs, then the ball on top).
    this._moonGlow = new PIXI.Sprite(textures.glowParticle);
    this._moonGlow.anchor.set(0.5);
    this._moonGlow.tint = 0x7fd4ff;
    this._moonGlow.blendMode = 'add';
    const moonGlowSize = Physics.displayRadius * 4.5;
    this._moonGlow.width = this._moonGlow.height = moonGlowSize;
    this._moonGlow.visible = false;
    this._moonGlow.alpha = 0;
    this.worldContainer.addChild(this._moonGlow);

    this._moonDischargeSeen = PlayScreen.moonDischargeCount;
    this._moonDischargeGraceT = 0;
    this._moonOrbAlpha = 0;
    this._runStartSeen = PlayScreen.runStartCount;

    this.worldContainer.addChild(this._ballSprite);

    // Dark matter cloud hazards (Rob: drifting clouds that drop the ball
    // through platforms on touch — see physics.js/ui.js for the actual
    // collision/movement). Own container, added after the ball so it draws
    // in front of it (Rob: "it shouldn't be reflected off the edge of the
    // nebula, it should flow into it... it will be behind it") — the ball
    // visually disappears into the cloud rather than the cloud passing
    // behind it. Still pans with the camera like the rest of the world.
    // this._darkMatterVisuals maps each live PlayScreen.darkMatterClouds
    // entry to its own NebulaCloud instance — built/torn down to match
    // that array every frame (see _updateDarkMatterClouds).
    this._darkMatterContainer = new PIXI.Container();
    this.worldContainer.addChild(this._darkMatterContainer);
    this._darkMatterVisuals = new Map();

    // Small trailing wisp of cloud that wraps the ball itself while a drop
    // is in progress (Rob: "as it falls down, it should take a little
    // piece of the nebula... overlaid around the stone as it falls down,
    // so you can see it's being affected by the nebula, and then fades
    // away as it hits one or two platforms down"). Added after the dark
    // matter clouds themselves so it draws in front of everything,
    // including the full-size cloud the ball just sank into. Own small
    // NebulaCloud rather than reusing a big one — see _updateDarkMatterWisp.
    // Brighter/more saturated blue than the full cloud (Rob's follow-up:
    // "it needs to be much more noticeable that the nebula is with it as
    // it falls down, so maybe make it a brighter blue color") plus a
    // straight brightness boost filter and denser gas/embers/lightning —
    // this one needs to read clearly at a glance while the ball's actively
    // falling, not blend into the background the way the big ambient cloud
    // can.
    this._darkMatterWisp = new NebulaCloud({
      width: 190, height: 190, density: 22, emberCount: 55,
      color: 0x4fc3ff, secondColor: null, lightningFrequency: 1.4, turbulence: 1.5,
    });
    const wispBrightness = new PIXI.ColorMatrixFilter();
    wispBrightness.brightness(1.6, false);
    this._darkMatterWisp.view.filters = [wispBrightness];
    this._darkMatterWisp.view.visible = false;
    this._darkMatterWisp.view.alpha = 0;
    this.worldContainer.addChild(this._darkMatterWisp.view);
    this._darkMatterWispAlpha = 0;

    // "Ready" / "Go!" during the pre-drop intro pause (Rob) — screen-fixed
    // (added to `c`, not worldContainer, same reasoning as the HUD: it
    // shouldn't pan with the camera), added after the ball so it draws on
    // top of everything in the world. Demi = Berlin Sans FB Demi Bold, the
    // same font as the "Potion"/"GAME OVER" titles (PotionTitle — BRLNSDB.TTF
    // is that font's actual file), in the same grey used for score/HUD
    // numbers elsewhere (0x9b9b9b) rather than introducing a new color.
    this._introText = new PIXI.Text({
      text: '', style: { fontFamily: 'PotionTitle', fontSize: 110, fill: 0x9b9b9b, align: 'center' },
    });
    this._introText.anchor.set(0.5);
    this._introText.position.set(360, 640);
    this._introText.visible = false;
    c.addChild(this._introText);
  },

  // Builds one platform's full visual bundle (pole if it has one, bar+liquid+
  // glass, hinge glow/particles, jets) and adds it all to worldContainer,
  // storing the pieces refresh() needs on `p._visual`. Mirrors the Phase 1
  // single-platform build() step for step, just parameterized per platform
  // instead of reading the old global `Platform`/`textures` directly.
  _buildPlatformVisual(p, textures) {
    const wc = this.worldContainer;
    const v = {};
    p._visual = v;

    // Pole — only the base platform has one (Rob: the platforms stacked above
    // it are just floating bars, not each mounted on their own post).
    if (p.hasPole) {
      const poleX = p.pivot.x - 25;
      v.poleSprite = new PIXI.Sprite(textures.pole);
      v.poleSprite.position.set(poleX, p.pivot.y);
      v.poleSprite.width = 50; v.poleSprite.height = p.poleHeight;
      wc.addChild(v.poleSprite);

      const poleGrad = new PIXI.FillGradient({
        type: 'linear', x0: 0, y0: p.pivot.y, x1: 0, y1: p.pivot.y + p.poleHeight,
        colorStops: [
          { offset: 0, color: 'rgba(170,100,255,0.9)' },
          { offset: 0.6, color: 'rgba(170,100,255,0.55)' },
          { offset: 1, color: 'rgba(170,100,255,0)' },
        ],
        textureSpace: 'local',
      });
      v.poleGlowBlurred = new PIXI.Graphics()
        .roundRect(poleX, p.pivot.y, 50, p.poleHeight, 10).stroke({ width: 6, fill: poleGrad });
      v.poleGlowBlurred.filters = [new PIXI.BlurFilter({ strength: 8 })];
      v.poleGlowSolid = new PIXI.Graphics()
        .roundRect(poleX, p.pivot.y, 50, p.poleHeight, 10).stroke({ width: 3, fill: poleGrad });
      wc.addChild(v.poleGlowBlurred, v.poleGlowSolid);
    }

    // Platform bar — a Container so the whole assembly (bar sprite, liquid,
    // glass) rotates together around the pivot.
    v.platformContainer = new PIXI.Container();
    v.platformContainer.position.set(p.pivot.x, p.pivot.y);
    v.platformSprite = new PIXI.Sprite(textures.platform);
    v.platformSprite.anchor.set(0.5);
    v.platformSprite.width = p.length; v.platformSprite.height = p.thickness;
    // Rob: "the tubes for potion should be more transparent when not
    // filled with liquid" — this sprite is the tube's own glass casing,
    // drawn under the liquid fill (added below) and under the
    // shadow/highlight glass shading on top. Wherever there's no liquid,
    // this alone is what's on screen, and at full alpha it read as
    // solid/opaque rather than glass. Wherever there IS liquid, the fill's
    // own opaque graphics sit on top of it either way, so dimming this
    // only actually affects the empty portion's look, not the potion
    // itself.
    v.platformSprite.alpha = 0.55;
    v.platformContainer.addChild(v.platformSprite);

    // Liquid — rebuilt from scratch every frame in refresh() (column levels
    // genuinely change every frame), clipped to the tube's own rounded-rect
    // via a Pixi mask.
    const halfL = p._liquidHalfLength(), halfT = p._liquidHalfThickness();
    v.liquidMask = new PIXI.Graphics().roundRect(-halfL, -halfT, halfL * 2, halfT * 2, halfT).fill(0xffffff);
    v.liquidBody = new PIXI.Graphics();
    v.liquidShine = new PIXI.Graphics();
    v.liquidShine.blendMode = 'screen';
    // Bubbles (Rob's liquid polish pass) — a plain particle pool like the
    // jets/hinge ones, but sitting between the fill and the surface shine
    // so the wavy highlight line still reads on top as bubbles rise
    // through it. Inside liquidContainer so the same mask clips them to
    // the tube's rounded shape automatically.
    v.liquidBubbleContainer = new PIXI.Container();
    v.liquidBubblePool = [];
    // Foam flecks (see platform.js's liquidFoam) sit above the shine so
    // the frothy cluster reads clearly right at the crest, not buried
    // under it.
    v.liquidFoamContainer = new PIXI.Container();
    v.liquidFoamPool = [];
    v.liquidContainer = new PIXI.Container();
    v.liquidContainer.addChild(v.liquidBody, v.liquidBubbleContainer, v.liquidShine, v.liquidFoamContainer, v.liquidMask);
    v.liquidContainer.mask = v.liquidMask;
    v.platformContainer.addChild(v.liquidContainer);
    // Reference length this container's own liquid was built/simulated at —
    // a pulsing tube (see platform.js's lengthPulse) rescales this whole
    // container horizontally in _refreshPlatform() to visually match,
    // rather than re-deriving the liquid sim's own column layout every
    // frame (which stays in this original coordinate space untouched).
    v.liquidBaseLength = p.length;
    v._lastLength = p.length;

    // Glass — shadow + highlight sprites drawn in front of the liquid.
    v.tubeShadow = new PIXI.Sprite(textures.tubeShadow);
    v.tubeShadow.anchor.set(0.5);
    v.tubeShadow.width = p.length; v.tubeShadow.height = p.thickness;
    v.tubeShadow.alpha = 0.8;
    v.tubeHighlight = new PIXI.Sprite(textures.tubeHighlight);
    v.tubeHighlight.anchor.set(0.5);
    v.tubeHighlight.width = p.length; v.tubeHighlight.height = p.thickness;
    v.tubeHighlight.alpha = 0.9;
    v.platformContainer.addChild(v.tubeShadow, v.tubeHighlight);

    wc.addChild(v.platformContainer);

    // Hinge — z-order matters a lot here: bubbles behind everything (the
    // sprite's own opaque pixels are what hides them at the dot), then the
    // sprite, then the glow (dot + both rings) so it reads bright in front of
    // the sprite's own flat art, THEN the ball (see _restackBall — it gets
    // re-inserted right before hingeMagicContainer each frame, i.e. right
    // after the glow), so the ball sits in front of the sprite *and* the
    // glow — covering whatever small arc of the ring would otherwise overlap
    // it, without hiding the glow behind the opaque sprite the way an
    // earlier version of this ordering did (Rob: "the glow of the hinge is
    // missing" — that version put the glow behind the sprite too, not just
    // behind the ball).
    v.hingeBubbleContainer = new PIXI.Container();
    wc.addChild(v.hingeBubbleContainer);

    v.hingeSprite = new PIXI.Sprite(textures.hinge);
    v.hingeSprite.anchor.set(0.5);
    v.hingeSprite.width = 112 * p.visualScale; v.hingeSprite.height = 112 * p.visualScale;
    v.hingeSprite.position.set(p.pivot.x, p.pivot.y);
    wc.addChild(v.hingeSprite);

    v.hingeGlowBlurred = new PIXI.Graphics();
    v.hingeGlowBlurred.filters = [new PIXI.BlurFilter({ strength: 4 })];
    v.hingeGlowSolid = new PIXI.Graphics();
    wc.addChild(v.hingeGlowBlurred, v.hingeGlowSolid);

    v.hingeMagicContainer = new PIXI.Container();
    v.hingeMagicContainer.blendMode = 'add';
    wc.addChild(v.hingeMagicContainer);

    v.hingeSparkContainer = new PIXI.Container();
    wc.addChild(v.hingeSparkContainer);

    v.hingeMagicPool = [];
    v.hingeSparkPool = [];
    v.hingeBubblePool = [];

    // Jets — one particle container per jet, each with its own small
    // rebuilt-every-frame nozzle Graphics (aura + pulsing ring + spark rays +
    // core), wrapped in a blurred+additive container. The GPU crash on Rob's
    // phone ("Aw, Snap!") turned out to be a real memory leak in _refreshJets
    // (a fresh PIXI.FillGradient built every frame per active jet, never
    // freed — see that method) — NOT the blur filters themselves, which were
    // removed as a guess along the way and are restored here now that the
    // actual leak is fixed.
    // No nozzle/base-emitter Graphics anymore (Rob: removed — see _refreshJets)
    // — just the particle stream container per jet.
    v.jetContainers = JET_DEFS.map(() => {
      const jc = new PIXI.Container();
      jc.blendMode = 'add';
      wc.addChild(jc);
      return { particleContainer: jc, pool: [] };
    });

    // Plasma jets (handed off from another session — js/plasma_jet.js) —
    // tried on Level 1 first (Rob), then approved and rolled out to every
    // platform/level ("ok the jets look good you can replace all of
    // them"), base platform included. One PlasmaJet per mount (same 4
    // mounts as JET_DEFS), color set live from p.tubeColor in
    // _refreshPlasmaJets so it tracks the tube the same way the old
    // particle jets already did (Rob: "changing the colors to match the
    // tube"). Kept idle (power 0, no live particles) skips virtually all
    // work per plasma_jet.js's own `idle` check, so platforms whose jets
    // aren't currently live cost almost nothing even across a full tower.
    {
      v.plasmaJets = JET_DEFS.map(() => {
        // Rob's retuned settings (plasma_jet_demo.html) — shorter/thinner,
        // dimmer, less blur, the works. Was 380/22/0.85/0/60/8.5/0.85.
        // Rob: "not sending out a steady stream like they used to" — the
        // library's blob emission swells/dips on a slow pulse by design
        // (a "segmented" look), which at pulseRate 0.5 (2s cycle) reads as
        // flickering rather than flowing once every jet on every platform
        // is doing it non-stop in actual play. Pushed blobRate up and
        // pulseRate way up so the pulse cycles fast enough (5/sec) that it
        // blends into a continuous stream instead of visible on/off waves.
        const jet = new PlasmaJet({
          height: 170, width: 16, speed: 470, intensity: 0.65,
          blobRate: 85, pulseRate: 5, sparkCount: 45, sparkBlur: 3.5,
          arcFrequency: 0, wobble: 2.1, blur: 7, beamOpacity: 0.45,
          color: 0xff40e0, secondColor: 0xb04dff,
        });
        jet.on = false;
        // Explicitly hidden — its own update() (which normally sets this
        // every frame off idle/live-particle state) isn't being called
        // right now (see refresh()'s own comment on trying the old jets
        // instead), so nothing would otherwise ever set this and it'd sit
        // at PIXI's default (visible) showing whatever blank initial state
        // its sprites start at.
        jet.view.visible = false;
        // Rob: "still visually detached." The gameplay jet.x/jet.y this
        // used to be positioned from (see difficulty.js) were only ever a
        // rough WORLD-space approximation — along the bar via its dir
        // vector, then a flat "-22" nudge that's the same regardless of
        // how far the platform is tilted, never actually projected onto
        // the bar's own rotated surface via its normal. That slop was
        // invisible on the old system's small, fast-flying particles, but
        // a persistent glow sitting right at the nozzle shows it clearly.
        // Added as a child of platformContainer instead — the same
        // container liquidContainer already lives in, which rotates
        // exactly with p.angleRad (_refreshPlatform) — so its LOCAL
        // position is pixel-locked to the tilting bar automatically, no
        // approximation possible. See _refreshPlasmaJets for the local
        // coordinates.
        v.platformContainer.addChild(jet.view);
        return jet;
      });
      // Rob: "let's try the old jets and see if that fixes the problem" —
      // switched back to showing the old particle streams instead of the
      // new PlasmaJet visuals (see refresh()'s own comment, right below
      // where _refreshPlasmaJets is skipped now) to compare feel. Plasma
      // jets are still built/wired above so flipping back is just as easy
      // — nothing here is torn down, only which one actually draws.
    }
  },

  // One platform's whole visual bundle is a flat set of siblings directly
  // under worldContainer (see _buildPlatformVisual above), not one single
  // wrapper container — ball z-stacking (_restackBall) needs to insert the
  // ball at a specific position in that flat sibling list, which a single
  // per-platform wrapper would break. So hiding a platform (Rob: platforms
  // above the current level's goal line) means toggling every one of these
  // pieces individually instead of just one container.
  _drawDashedEllipse(g, cx, cy, rx, ry, dashLen, gapLen, color, alpha) {
    drawDashedEllipseImpl(g, cx, cy, rx, ry, dashLen, gapLen, color, alpha);
  },
  _drawDashedLine(g, x0, x1, y, dashLen, gapLen, color, alpha) {
    drawDashedLineImpl(g, x0, x1, y, dashLen, gapLen, color, alpha);
  },

  _setPlatformVisualVisible(p, visible) {
    const v = p._visual;
    if (v.poleSprite) v.poleSprite.visible = visible;
    if (v.poleGlowBlurred) v.poleGlowBlurred.visible = visible;
    if (v.poleGlowSolid) v.poleGlowSolid.visible = visible;
    v.platformContainer.visible = visible;
    // Flat planks have no hinge (Rob: "just have a tube by itself") — hide
    // the hinge pieces for them even while the tube itself is visible.
    const hingeVisible = visible && !p.isFlatPlank;
    v.hingeBubbleContainer.visible = hingeVisible;
    v.hingeSprite.visible = hingeVisible;
    v.hingeGlowBlurred.visible = hingeVisible;
    v.hingeGlowSolid.visible = hingeVisible;
    v.hingeMagicContainer.visible = hingeVisible;
    v.hingeSparkContainer.visible = hingeVisible;
    // Back to toggling with everything else now that the old particle
    // jets are the ones actually drawing again (see build()/refresh()'s
    // own comments on trying them instead of the new PlasmaJet beams).
    for (const jc of v.jetContainers) jc.particleContainer.visible = visible;
  },

  // Delegates to the OLD ui.js's PlayScreen.update() — the real single entry
  // point; it calls every platform's/Physics's/Fog's/Difficulty's updates
  // internally, this just delegates to it whole (see the Phase 1 bug this
  // fixed: calling the sub-updates directly here skipped PlayScreen's own
  // score/blast-charge/game-over logic entirely).
  update(dt, tiltX) {
    PlayScreen.update(dt, tiltX);
    this._dt = dt;
  },

  // Vignette base color, normally the game's own dark purple-black
  // (10,4,16). Extracted so build()/setRenderWidth()/_applyBackgroundAccent
  // all build the exact same gradient shape from whatever base color is
  // current, instead of three copies of the same color stops to keep in
  // sync by hand.
  _vignetteGrad(width, height, base) {
    const rgb = base.join(',');
    return new PIXI.FillGradient({
      type: 'linear', x0: 0, y0: 0, x1: 0, y1: height,
      colorStops: [
        { offset: 0, color: `rgba(${rgb},1)` },
        { offset: 0.55, color: `rgba(${rgb},1)` },
        { offset: 0.68, color: `rgba(${rgb},0.78)` },
        { offset: 0.82, color: `rgba(${rgb},0.6)` },
        { offset: 1, color: `rgba(${rgb},0.45)` },
      ],
      textureSpace: 'local',
    });
  },

  // Background accent (Rob: "are you thinking we make some adjustments in
  // the background too?") — warms the fog layers and the vignette's own
  // base color to match the current level's identity color (see ui.js's
  // levelAccentColor); null on every level without one restores exactly
  // how it's always looked. Kept subtle (fog tinted only 35% toward the
  // accent, vignette base only 25%) — this is atmosphere behind the real
  // action, not a full recolor.
  _applyBackgroundAccent(accent) {
    const mix = (base, target, t) => target
      ? [0, 1, 2].map((i) => Math.round(base[i] + (target[i] - base[i]) * t))
      : base;
    // Rob: "I still want that dark feel in the background. It's too much
    // warm green in the back" — mixing white toward a saturated accent
    // whose own green channel is already maxed (Level 6's [56,255,0])
    // never actually dims that channel no matter how small the mix
    // percentage — R/B drop but G stays pinned at 255, so the fog stayed
    // bright/green-heavy regardless. Mixing toward a pre-DARKENED copy of
    // the accent instead (scaled to 55% brightness first) means every
    // channel, including a maxed one, genuinely comes down.
    const dimAccent = accent ? accent.map((c) => c * 0.55) : null;
    const fogTint = accent ? rgbToHex(...mix([255, 255, 255], dimAccent, 0.3)) : 0xffffff;
    // The fog art itself is a bright, painted nebula texture — tinting it
    // alone still reads as lit up no matter the hue, since it's the fog's
    // own brightness carrying the scene, not the tint color. Dimming its
    // opacity too (only when a level has its own accent; every other
    // level's fog stays exactly as bright as it's always been) lets the
    // vignette's real darkness actually come through underneath it.
    const fogAlpha = accent ? 0.55 : 1;
    for (const f of this._fogSprites) {
      f.sprite.tint = fogTint;
      f.spriteFlip.tint = fogTint;
      f.sprite.alpha = fogAlpha;
      f.spriteFlip.alpha = fogAlpha;
    }
    const base = [10, 4, 16];
    const darkAccent = accent ? accent.map((c) => c * 0.35) : null;
    // Stored (not just applied) so setRenderWidth() — called on every
    // landscape/orientation resize — can rebuild the vignette at its new
    // width using the CURRENT accent's base color instead of silently
    // reverting to the default purple until the next level switch.
    this._vignetteBase = darkAccent
      ? [0, 1, 2].map((i) => Math.round(base[i] + (darkAccent[i] - base[i]) * 0.35))
      : base;
    this._vignette.clear();
    this._vignette.rect(0, 0, this.renderWidth, CONFIG.HEIGHT)
      .fill(this._vignetteGrad(this.renderWidth, CONFIG.HEIGHT, this._vignetteBase));
    // Cliff layer tint, same 35%-toward-accent blend as the fog above —
    // stays a fixed part of the same background system instead of a
    // one-off unlinked layer.
    if (this._cliffSprite) {
      this._cliffSprite.tint = fogTint;
      this._cliffSpriteB.tint = fogTint;
    }
    this._setupMysticalSky(accent);
  },

  // Rob: "the background is a little boring... need like a mystical sky"
  // -> "could use... more smaller dots to look like it's more 3d space.
  // it looks really flat." One size/speed of star read flat regardless of
  // count — real depth needs distinct layers: tiny/dim/slow stars far
  // away, a mid layer, and a handful of bigger/brighter/faster wisps up
  // close, the classic multi-layer parallax depth cue (near = bigger,
  // brighter, faster; far = smaller, dimmer, slower). Scattered once per
  // level entry across the full screen-fixed background (behind
  // worldContainer, so platforms/ball always read on top). Tinted toward
  // the level's own accent color when it has one (see levelAccentColor);
  // a soft cool lavender-white by default so every level gets the
  // mystical-sky treatment, not just the ones with a color identity.
  _setupMysticalSky(accent) {
    const base = accent ? accent : [200, 180, 255];
    const tint = rgbToHex(
      200 + (base[0] - 200) * 0.6, 180 + (base[1] - 180) * 0.6, 255 + (base[2] - 255) * 0.6,
    );
    const w = this.renderWidth;
    this._embers = [];
    // Three depth bands, far to near. Counts weighted toward the far
    // layer (Rob: "more smaller dots") since a real starfield reads as
    // mostly tiny distant points with only a few things big and close.
    const bands = [
      { count: 55, size: [0.8, 1.8], alpha: [0.2, 0.4], twinkle: [0.4, 1.2], drift: [-0.15, -0.35] }, // far
      { count: 24, size: [1.8, 3.2], alpha: [0.35, 0.6], twinkle: [0.6, 1.8], drift: [-0.4, -0.8] },  // mid
      { count: 6, size: [18, 34], alpha: [0.10, 0.20], twinkle: [0.3, 0.6], drift: [-2, -5] },        // near wisps
    ];
    for (const band of bands) {
      for (let i = 0; i < band.count; i++) {
        const near = band === bands[2];
        this._embers.push({
          x: Math.random() * w,
          y: Math.random() * 1280,
          size: band.size[0] + Math.random() * (band.size[1] - band.size[0]),
          baseAlpha: band.alpha[0] + Math.random() * (band.alpha[1] - band.alpha[0]),
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: band.twinkle[0] + Math.random() * (band.twinkle[1] - band.twinkle[0]),
          driftY: band.drift[0] + Math.random() * (band.drift[1] - band.drift[0]),
          driftX: near ? (Math.random() * 2 - 1) * 2 : 0,
          tint,
        });
      }
    }
  },

  // Advances the mystical-sky twinkle/drift and keeps the sprite pool in
  // sync — called every frame from refresh(), same spirit as the other
  // background layers (fog/vignette) it sits alongside.
  _updateMysticalSky(dt) {
    const w = this.renderWidth;
    while (this._emberPool.length < this._embers.length) {
      const s = new PIXI.Sprite(textures.glowParticle);
      s.anchor.set(0.5);
      this._emberContainer.addChild(s);
      this._emberPool.push(s);
    }
    while (this._emberPool.length > this._embers.length) {
      this._emberContainer.removeChild(this._emberPool.pop());
    }
    for (let i = 0; i < this._embers.length; i++) {
      const e = this._embers[i];
      e.twinklePhase += e.twinkleSpeed * dt;
      e.y += e.driftY * dt;
      e.x += e.driftX * dt;
      // Wrap around every edge so the field reads as endless, not a
      // fixed set that eventually drifts off and vanishes.
      if (e.y < -20) e.y = 1300;
      if (e.x < -20) e.x = w + 20;
      if (e.x > w + 20) e.x = -20;
      const s = this._emberPool[i];
      s.position.set(e.x, e.y);
      s.width = s.height = e.size;
      s.tint = e.tint;
      s.alpha = e.baseAlpha * (0.55 + 0.45 * Math.sin(e.twinklePhase));
    }
  },

  refresh() {
    // Rob: "before the game starts... some puffs come out of the jet"
    // during the "Ready... Go!" pause — PlayScreenPixi.build() makes one
    // real PlasmaJet per mount ONCE at boot for every platform across
    // every tower (not rebuilt on each run/level entry — see build()'s own
    // comment on why), so any blobs/sparks/pulses still mid-flight from
    // the PREVIOUS run just kept drifting and fading on their own right
    // through the new run's frozen intro (refresh() runs every frame
    // regardless of PlayScreen.introT). Hard-clears every platform's
    // plasma jets the instant a new run starts, same runStartCount marker
    // _updateMoonOrb already watches for the same "leftover from last run"
    // problem on the moon orb.
    if (PlayScreen.runStartCount !== this._plasmaRunStartSeen) {
      this._plasmaRunStartSeen = PlayScreen.runStartCount;
      for (const p of PlayScreen.allPlatforms) {
        if (p._visual.plasmaJets) for (const jet of p._visual.plasmaJets) jet.hardReset();
      }
    }
    // See _applyBackgroundAccent's own comment — only rebuilt when the
    // accent actually changes (level switch), not every frame; the
    // vignette is a real GPU gradient texture, and rebuilding that every
    // frame is the same kind of leak that once crashed a phone (see
    // _refreshLiquid's own comment on that).
    if (PlayScreen.levelAccentColor !== this._lastAccentColor) {
      this._lastAccentColor = PlayScreen.levelAccentColor;
      this._applyBackgroundAccent(PlayScreen.levelAccentColor);
    }
    this._updateMysticalSky(this._dt);
    for (const f of this._fogSprites) {
      const l = Fog.layers.find((x) => x.key === f.key);
      f.sprite.y = l.y1;
      f.spriteFlip.y = l.y2;
    }
    // Cliff layer scroll — same two-stacked-copies wrap the fog layers
    // use, just against this layer's own real scaled height (a tall
    // 369x2000 strip, not fog's fixed 1280).
    {
      const cl = this._cliffLayer;
      cl.y1 += cl.speed * this._dt;
      cl.y2 += cl.speed * this._dt;
      if (cl.y1 < -this._cliffScaledHeight) cl.y1 = cl.y2 + this._cliffScaledHeight;
      if (cl.y2 < -this._cliffScaledHeight) cl.y2 = cl.y1 + this._cliffScaledHeight;
      this._cliffSprite.y = cl.y1;
      this._cliffSpriteB.y = cl.y2;
    }

    // Every platform across every tower (Levels 1-4's own short ones, plus
    // the shared one Level 5-10/Free Play still use — see ui.js's
    // _buildTowers) got a Pixi visual up front at boot, but only the
    // CURRENTLY active tower (PlayScreen.platforms) should ever be on
    // screen — hide anything belonging to one of the others first.
    const activeSet = PlayScreen._activePlatformSet || (PlayScreen._activePlatformSet = new Set());
    if (activeSet.size !== PlayScreen.platforms.length || !PlayScreen.platforms.every((p) => activeSet.has(p))) {
      activeSet.clear();
      for (const p of PlayScreen.platforms) activeSet.add(p);
    }
    for (const p of PlayScreen.allPlatforms) {
      if (!activeSet.has(p)) this._setPlatformVisualVisible(p, false);
    }

    // Platforms above the current level's own goal line stay hidden within
    // the active tower too (Rob: "the platforms above the completion line
    // were not showing... this keeps the game clean") — mainly matters for
    // Level 5-10, which still climb the one shared tower (so plenty above
    // any given level's own line belong to a later one); Levels 1-4's own
    // short towers rarely have anything left above their line at all. Free
    // Play has no goal line (levelNum null), so nothing's ever hidden here.
    // Only the Pixi visuals are touched — physics/collision stays exactly
    // as it always was for every platform, hidden or not, so nothing about
    // landing/falling changes underneath.
    const levelNum = PlayScreen._levelNumber();
    const thresholdY = levelNum !== null ? PlayScreen._levelThresholdY(levelNum) : null;
    for (const p of PlayScreen.platforms) {
      // A goal platform (see ui.js's _appendGoalPlatform) is real, solid
      // Physics geometry with no Pixi visual of its own — the goal-line
      // art's own painted line already reads as its surface, so it never
      // gets a bar sprite shown, regardless of the threshold math below
      // (its own pivot sits just below that threshold, which would
      // otherwise read as "not above the goal" and show it like any other
      // platform).
      if (p.isGoal) { this._setPlatformVisualVisible(p, false); continue; }
      // Rob: "I saw a platform up where the PNG finish line is... there
      // shouldn't be any platforms above the finish line or even close to
      // it." Levels 5-10's goal line sits TOWER_SPACING (300) above the
      // topmost climbable platform (see _levelThresholdY) - the exact
      // same spacing every real platform in the shared tower already
      // uses between each other, so the very NEXT real platform up always
      // lands exactly at that same height, not above it. `<` let that one
      // through as "not above the goal" (equal isn't less-than) and left
      // it sitting visible right at the goal line's own position; `<=`
      // catches it too. Levels 1-4's own appended goal platform sits
      // further away than this (its own real geometry, not shared-tower
      // math), so this never affects them.
      const aboveGoal = thresholdY !== null && p.pivot.y <= thresholdY;
      this._setPlatformVisualVisible(p, !aboveGoal);
      if (!aboveGoal) this._refreshPlatform(p);
    }

    // Used to hide on levelComplete (the win screen took over instead) —
    // now stays up through it on purpose: Rob's cauldron boil-over finale
    // (the moon stone "flies up and drops in the cauldron, then it can do
    // the explosion") needs the art, and the effect riding on it, still on
    // screen for the win screen to actually show.
    this._goalLineGroup.visible = levelNum !== null;
    // Rob: "maybe only the first couple levels need a line" — once a player
    // has seen it on Level 1-2, the goal height's established; later levels
    // go back to just the art's own baked-in line.
    this._goalTargetLine.visible = levelNum === 1 || levelNum === 2;
    if (levelNum !== null && levelNum !== this._goalLineLevelNum) {
      this._goalLineLevelNum = levelNum;
      // _levelThresholdY is the ball's CENTER position when resting there
      // (it already bakes in one displayRadius so the win-check compares
      // apples to apples with Physics.y — see ui.js), but the art's pink
      // line is meant to read as the physical surface the ball's bottom
      // rests ON, same as every other platform in the tower. Positioning
      // the art at the threshold itself put the line straight through the
      // ball's middle instead of under it (Rob: "move the line... so it
      // lines up with that pink line"). Nudging the art down by one radius
      // puts the drawn line at the ball's actual resting bottom edge,
      // without touching the win condition itself.
      //
      // +15 more on top of that (Rob's follow-up: "it comes to a roll on
      // the bottom of the tube... needs to be a few pixels higher so that
      // it rests on the top of the tube") — the glowing rail itself has
      // real visible thickness, and one radius alone put the ball's bottom
      // edge at the rail's vertical middle rather than clearly on its top
      // surface.
      this._goalLineGroup.position.y = PlayScreen._levelThresholdY(levelNum) + Physics.displayRadius + 15;
      this._goalLabel.text = `LEVEL ${levelNum} GOAL`;
    }
    if (levelNum !== null) {
      // Rob: "change the colors to match the base platform color for each
      // level" — read live off the base tube's own lerping color (same
      // field the liquid/jets already read), so the potion tracks a level's
      // Cool/Warm/Fire heat shifts (and the 6-10 green/teal/blue theme)
      // instead of a fixed color. Glow ~45% toward white, steam ~85%.
      const [br, bg, bb] = PlayScreen.platforms[0].tubeColor;
      this._potionCauldron.potionColor = rgbToHex(br, bg, bb);
      this._potionCauldron.glowColor = mixTowardWhiteHex(br, bg, bb, 0.45);
      this._potionCauldron.steamColor = mixTowardWhiteHex(br, bg, bb, 0.85);
      // Fresh run (a new level started) — reset the one-shot brew trigger
      // and snap straight back to resting, not mid-finale from last time.
      if (PlayScreen.runStartCount !== this._potionRunStartSeen) {
        this._potionRunStartSeen = PlayScreen.runStartCount;
        this._potionBrewSeen = false;
        this._potionCauldron.rest();
      }
      // Rob: "when the level is complete, half the ball flies up and drops
      // in the cauldron, and then it can do the explosion" — one-shot per
      // run, fires the instant levelComplete flips true (ui.js's own
      // MIN_ROLL_DELAY/hasLanded gate already makes that the moment the
      // stone settles into the cauldron, not the instant it merely crosses
      // the line).
      if (PlayScreen.levelComplete && !this._potionBrewSeen) {
        this._potionBrewSeen = true;
        this._potionCauldron.brewOver();
      }
      this._potionCauldron.update(this._dt);
    }

    // Rob: "when the moon stone lands in the cauldron it sticks to the
    // potion... bobbing up and down while half in the potion" — once the
    // run is actually won, the ball sprite stops following Physics.x/y
    // (which already froze at the goal platform) and instead snaps to the
    // cauldron's own potion-surface point (same local point the
    // PotionCauldron effect itself is anchored to — see build() above),
    // centered exactly ON the surface with a slow vertical bob — the mask
    // below (not a position offset) is what actually hides the bottom half.
    if (PlayScreen.levelComplete) {
      if (!this._cauldronStickT) this._cauldronStickT = 0;
      this._cauldronStickT += this._dt;
      const stickWorld = this.worldContainer.toLocal(this._potionCauldron.view.getGlobalPosition());
      const bob = Math.sin(this._cauldronStickT * 2.2) * 7;
      const surfaceY = stickWorld.y + bob;
      this._ballSprite.position.set(stickWorld.x, surfaceY);
      const r = Physics.displayRadius;
      this._cauldronMask.clear().rect(stickWorld.x - r * 1.5, surfaceY - r * 2, r * 3, r * 2).fill(0xffffff);
      this._ballSprite.mask = this._cauldronMask;
    } else {
      this._cauldronStickT = 0;
      this._ballSprite.mask = null;
      this._ballSprite.position.set(Physics.x, Physics.y);
      this._ballSprite.rotation = Physics.rotation;
    }
    this._restackBall();
    this._updateMoonOrb();
    this._updateDots();
    this._updateDarkMatterClouds();
    this._updatePlasmaStorms();
    this._updateDarkMatterWisp();
    this._updateCamera();
    this._updateIntroText();
  },

  // The small "piece of the nebula" that wraps the ball while a drop is in
  // progress (Rob — see the wisp's own build()-time comment for the full
  // quote). Reads Physics.darkMatterSkipsRemaining directly (same as other
  // Physics fields this file already reads straight off Physics elsewhere,
  // e.g. Physics.x/y/airborne) rather than routing through a PlayScreen
  // marker — there's nothing to miss/debounce here, just "is a drop
  // currently happening", so a direct read is simplest. Eases in/out same
  // shape as the moon orb's own charged glow, so it fades rather than
  // popping (Rob: "fades away as it hits one or two platforms down").
  _updateDarkMatterWisp() {
    const wisp = this._darkMatterWisp;
    const target = Physics.darkMatterSkipsRemaining !== null ? 1 : 0;
    this._darkMatterWispAlpha += (target - this._darkMatterWispAlpha) * Math.min(1, this._dt / 0.35);
    wisp.view.position.set(Physics.x, Physics.y);
    wisp.view.alpha = this._darkMatterWispAlpha;
    wisp.view.visible = this._darkMatterWispAlpha > 0.002;
    if (wisp.view.visible) wisp.update(this._dt);
  },

  // Keeps this._darkMatterVisuals in sync with PlayScreen.darkMatterClouds
  // — creates a NebulaCloud for any new entry, destroys one for any that's
  // gone (a level change swaps in a whole new array), and otherwise just
  // syncs position/size and calls update(dt) every frame. Empty for every
  // level right now (see ui.js's _buildDarkMatterClouds), so this is a
  // no-op in practice until Rob decides which levels get them — built and
  // ready for that rather than left half-wired.
  _updateDarkMatterClouds() {
    const live = new Set(PlayScreen.darkMatterClouds);
    for (const [cloud, visual] of this._darkMatterVisuals) {
      if (!live.has(cloud)) {
        visual.destroy();
        this._darkMatterVisuals.delete(cloud);
      }
    }
    for (const cloud of PlayScreen.darkMatterClouds) {
      let visual = this._darkMatterVisuals.get(cloud);
      if (!visual) {
        // Rob's test-page values, and a single blue instead of the
        // original red/orange (secondColor: null = one color, no second
        // tone blended in).
        visual = new NebulaCloud({
          width: cloud.width, height: cloud.height, density: 44, emberCount: 180,
          color: 0x1a71ff, secondColor: null, lightningFrequency: 1.25, turbulence: 1,
        });
        this._darkMatterContainer.addChild(visual.view);
        this._darkMatterVisuals.set(cloud, visual);
      }
      visual.view.position.set(cloud.x, cloud.y);
      visual.update(this._dt);
    }
  },

  // Keeps this._plasmaStormVisuals in sync with PlayScreen.plasmaStorms
  // (built/destroyed to match, like _updateDarkMatterClouds). Each storm's
  // alpha follows its own visibility; while it's fully hidden the visual
  // is switched off and not updated at all, so a storm costs nothing
  // during its "gone" stretch — it's the heaviest effect in the game.
  _updatePlasmaStorms() {
    const live = new Set(PlayScreen.plasmaStorms);
    for (const [storm, visual] of this._plasmaStormVisuals) {
      if (!live.has(storm)) {
        visual.destroy();
        this._plasmaStormVisuals.delete(storm);
      }
    }
    for (const storm of PlayScreen.plasmaStorms) {
      let visual = this._plasmaStormVisuals.get(storm);
      if (!visual) {
        // Rob's test-page settings (plasma_storm_demo.html).
        visual = new PlasmaStorm({
          width: storm.width, height: storm.height,
          flowSpeed: 100, intensity: 0.45, density: 32,
          lineCount: 11, particleCount: 270, particleOpacity: 0.24,
          waveFrequency: 0, lineBlur: 8, lineOpacity: 0.08, turbulence: 2.2,
          color: 0xff4fb8, secondColor: 0x3aa8ff,
        });
        this._plasmaStormContainer.addChild(visual.view);
        this._plasmaStormVisuals.set(storm, visual);
      }
      visual.view.position.set(storm.x, storm.y);
      visual.view.alpha = storm.visibility;
      visual.view.visible = storm.visibility > 0.002;
      if (visual.view.visible) visual.update(this._dt);
    }
  },

  // Moon charge glow — visible exactly while a charge is banked (Rob: the
  // moon reads as charged or not, no in-between idle glow), tracks the ball
  // 1:1 like the sprite it wraps, and fires a spark-burst the instant a
  // charge is actually spent on a big jump. ui.js can't reach this Pixi
  // object directly (see PlayScreen.moonDischargeCount's own comment), so
  // this just watches that counter for changes instead.
  //
  // blastCharges is already back to 0 by the time this sees a discharge
  // (fireBlast() decrements it before applying the jump) — hiding the orb
  // on that same frame would cut its release burst off before it's even
  // drawn. _moonDischargeGraceT keeps it visible/animating for a brief
  // window after a discharge regardless of charge state, so the burst
  // actually gets to play out.
  //
  // Eases in/out (Rob: "make sure the effect is easing in and easing out
  // rather than the quick on and off") instead of the instant visible
  // toggle it had before — same lerp-toward-target-alpha shape ui.js's own
  // blastButtonsT pop-in/out already uses elsewhere in this file.
  _updateMoonOrb() {
    const orb = this._moonOrb;
    // A fresh run (Rob: "when the game ends with the ball charged up,
    // sometimes that carries over to the start of the next game") snaps
    // the glow straight to off instead of just letting it ease there like
    // normal — a run that ended charged, or mid-fade from a discharge,
    // would otherwise still show a visible flash of leftover glow for a
    // moment at the very start of the next one even though blastCharges
    // itself was already correctly reset.
    if (PlayScreen.runStartCount !== this._runStartSeen) {
      this._runStartSeen = PlayScreen.runStartCount;
      this._moonOrbAlpha = 0;
      this._moonDischargeGraceT = 0;
      this._moonDischargeSeen = PlayScreen.moonDischargeCount;
      this._blastLaunchSeen = PlayScreen.blastLaunchCount;
    }
    // Follows the ball sprite's own rendered position (not raw Physics.x/y
    // directly) so it tracks the cauldron-stick point once a level's won —
    // _ballSprite is already repositioned there earlier this same refresh().
    orb.view.position.set(this._ballSprite.x, this._ballSprite.y);
    if (PlayScreen.moonDischargeCount !== this._moonDischargeSeen) {
      this._moonDischargeSeen = PlayScreen.moonDischargeCount;
      this._moonDischargeGraceT = 0.6;
      orb.discharge(3);
    }
    // Rob: "we used to show a short on then off for every jump but then
    // removed it. I want to add that back every time we do a normal tap
    // jump on the plasma jet" — a smaller, quicker burst than the full
    // charged-jump discharge above, and only for a normal (not big) jump
    // that actually connected with a jet (lastBlastWasOnJet) — a plain
    // uncharged jump with no jet involved still gets nothing, same as Rob's
    // earlier "don't show it on every ordinary jump" ask.
    if (PlayScreen.blastLaunchCount !== this._blastLaunchSeen) {
      this._blastLaunchSeen = PlayScreen.blastLaunchCount;
      if (!PlayScreen.lastBlastWasBig && PlayScreen.lastBlastWasOnJet) {
        this._moonDischargeGraceT = Math.max(this._moonDischargeGraceT, 0.35);
        orb.discharge(1);
      }
    }
    if (this._moonDischargeGraceT > 0) this._moonDischargeGraceT -= this._dt;
    // Rob: "when the moon falls in the potion it should have the emitter
    // surrounding it on" — the swirl/glow stays lit the whole time it's
    // sitting sunk in the cauldron, same as while a charge is banked.
    const target = (PlayScreen.blastCharges > 0 || this._moonDischargeGraceT > 0 || PlayScreen.levelComplete) ? 1 : 0;
    this._moonOrbAlpha += (target - this._moonOrbAlpha) * Math.min(1, this._dt / 0.35);
    orb.view.alpha = this._moonOrbAlpha;
    orb.view.visible = this._moonOrbAlpha > 0.002;
    if (orb.view.visible) orb.update(this._dt);

    // Ambient light-blue backlight — same charged/not-charged visibility
    // and ease as the orb itself, just a plain glow with nothing of its
    // own to update() every frame.
    this._moonGlow.position.set(this._ballSprite.x, this._ballSprite.y);
    this._moonGlow.alpha = this._moonOrbAlpha * 0.85;
    this._moonGlow.visible = this._moonOrbAlpha > 0.002;
  },

  // Level 12 dot test bed — visible only while PlayScreen.dots is actually
  // the active run's list (every other level/mode leaves it empty, see
  // ui.js's enter()), so these just sit hidden the rest of the time.
  _updateDots() {
    const active = PlayScreen.dots.length > 0;
    for (const d of PlayScreen.towerDots.level12) {
      const g = d._visual;
      g.visible = active && !d.collected;
      if (g.visible) {
        const pos = PlayScreen._dotWorldPos(d);
        g.position.set(pos.x, pos.y);
      }
    }
  },

  // "Ready" for the first half of the intro pause, "Go!" for the second
  // half, each popping in with a quick overshoot (easeOutBack — same
  // function Game Over's board pop-in already uses) and fading out just
  // before the next one takes over — Rob: "as ready disappears, go pops
  // out then the ball drops". INTRO_DURATION must match PlayScreen.enter()'s
  // starting introT value (ui.js) — they're kept as separate constants
  // rather than one shared one since these files don't have a module system
  // to import between them.
  _updateIntroText() {
    const INTRO_DURATION = 2;
    const t = PlayScreen.introT;
    if (!(t > 0)) { this._introText.visible = false; return; }

    const phaseDuration = INTRO_DURATION / 2;
    const elapsed = INTRO_DURATION - t; // 0 -> INTRO_DURATION as the pause plays out
    const inReady = elapsed < phaseDuration;
    const phaseElapsed = inReady ? elapsed : elapsed - phaseDuration;

    const POP_IN = 0.2, FADE_OUT = 0.2;
    let scale = 1, alpha = 1;
    if (phaseElapsed < POP_IN) {
      const p = phaseElapsed / POP_IN;
      scale = easeOutBack(p);
      alpha = Math.min(1, p * 2);
    } else if (phaseElapsed > phaseDuration - FADE_OUT) {
      alpha = Math.max(0, (phaseDuration - phaseElapsed) / FADE_OUT);
    }

    this._introText.text = inReady ? 'Ready' : 'Go!';
    this._introText.position.x = this.renderWidth / 2;
    this._introText.scale.set(Math.max(0, scale));
    this._introText.alpha = alpha;
    this._introText.visible = true;
  },

  // Re-inserts the ball sprite right after whichever platform's hinge sprite
  // it currently belongs to (Physics.currentPlatform — the platform it's
  // resting on, or last rested on while mid-flight) — i.e. in front of that
  // platform's flat sprite art, but behind its glow (dot + rings) and
  // HingeMagic/HingeSparks (Rob: ball in front of the plain hinge sprite,
  // but behind the glow ring itself — the ring is meant to frame the ball
  // from in front, like a target).
  //
  // Explicitly removes the ball before computing the target index — calling
  // addChildAt on a child that's already elsewhere in the same container
  // reorders it, but the index has to be computed on the list *without* the
  // ball already in it. An earlier version computed the index first (with
  // the ball still present), which meant the removal-then-insert could land
  // the ball one slot off from where the index was measured, alternating
  // which side of the target ended up on frame to frame — Rob caught this
  // as the ball visibly flickering in and out of place.
  _restackBall() {
    const p = Physics.currentPlatform || PlayScreen.platforms[0];
    const v = p._visual;
    this.worldContainer.removeChild(this._ballSprite);
    const idx = this.worldContainer.getChildIndex(v.hingeGlowBlurred);
    this.worldContainer.addChildAt(this._ballSprite, idx);
  },

  // Camera — pans worldContainer.x/y so the ball stays roughly at the same
  // screen-space position the single-platform version always kept it at
  // (Rob: camera follows the ball, rather than showing the whole tower at
  // once), smoothed rather than snapping frame to frame, and clamped so it
  // never scrolls past the tower's actual extent in either direction.
  //
  // Horizontal panning (Rob: wants platforms placed off to the left/right of
  // the visible area, "expand the width of the game" without actually
  // changing the game's real portrait canvas — the phone display stays
  // exactly as it is) mirrors the vertical logic exactly, just computed from
  // the tower's leftmost/rightmost pivot X instead of its lowest/highest
  // pivot Y — see _updateCameraAxis for the shared math.
  //
  // X tracks the CURRENT PLATFORM's pivot rather than the ball's exact live
  // x while resting (Rob: with the wider landscape view, chasing every
  // wobble of the ball rolling back and forth under tilt read as the camera
  // "moving around too much" — it should hold still while the ball's on one
  // platform). But while airborne mid-Potion-Blast (Physics.airborne — see
  // physics.js), it switches to following the ball's actual x instead, so
  // the camera pans left/right to track the jump in flight rather than
  // sitting locked on the platform just left behind, then settles back onto
  // the landing platform's hinge automatically once Physics.airborne clears
  // on touchdown (Rob: "move the camera left and right until it lands then
  // back to the hinge"). Y still tracks the ball's exact position always —
  // that's the intentional "camera follows the ball up the tower" behavior,
  // unaffected by any of this.
  _updateCamera() {
    const pivotYs = PlayScreen.platforms.map((p) => p.pivot.y);
    const pivotXs = PlayScreen.platforms.map((p) => p.pivot.x);
    const currentPlatform = Physics.currentPlatform || PlayScreen.platforms[0];
    const camTargetX = Physics.airborne ? Physics.x : currentPlatform.pivot.x;

    // Y: base platform (largest Y) gives the *lower* clamp bound, the
    // highest platform (smallest Y, plus headroom) gives the *upper* one —
    // an earlier version had these two swapped, which pinned the camera at
    // one bound permanently since min > max made the clamp always pick the
    // min. Same care applies to X below.
    //
    // Levels 5-10 share one tall tower (see _buildTowers) that reaches well
    // above any given level's own goal — platforms belonging to later
    // levels, hidden but still present in PlayScreen.platforms. Using the
    // tower's actual topmost pivot as the upper bound let the camera pan up
    // past the current level's own goal-line art into that empty space
    // above it, revealing plain background past the top of the image (Rob:
    // "the image at the top creates black space"). In level mode, clamp to
    // this level's own goal line instead — nothing meaningful exists above
    // it anyway (see the "platforms above goal stay hidden" logic below).
    // Free Play has no goal line (levelNum null) so it keeps the old
    // tower-extent behavior, which is correct there.
    //
    // The bound itself has to account for the 760 screen-anchor offset
    // _updateCameraAxis below aims for, not just "however far above the
    // goal the art extends" — at the clamp, world Y = upperBoundSource maps
    // to screen Y 760 (not screen Y 0), so screen Y 0 lands on world Y
    // (upperBoundSource - 760). That has to still be at or below the art's
    // actual top edge, or the top of the screen shows past it. A flat -260
    // headroom (fine for a bare platform, which has no art above it to run
    // out of) let the camera pan much further up than that, well past the
    // art's real extent, and was the actual cause of the gap.
    const levelNum = PlayScreen._levelNumber();
    const GOAL_LINE_TOP_SAFETY_MARGIN = 20; // stay just inside the art's real top edge, not flush with it
    const upperBoundSource = levelNum !== null
      ? (PlayScreen._levelThresholdY(levelNum) + Physics.displayRadius - this._goalLineTopOffset) + 760 + GOAL_LINE_TOP_SAFETY_MARGIN
      : Math.min(...pivotYs) - 260;
    this._camY = this._updateCameraAxis(this._camY, 760, Physics.y, Math.max(...pivotYs), upperBoundSource);
    this.worldContainer.y = this._camY;

    this._camX = this._updateCameraAxis(this._camX, this.renderWidth / 2, camTargetX, Math.max(...pivotXs) + 260, Math.min(...pivotXs) - 260);
    this.worldContainer.x = this._camX;
  },

  // Called by game.js's fitGameWrap() whenever the landscape background gets
  // wider/narrower — resizes the screen-fixed background/fog/vignette to
  // match (they aren't part of worldContainer, so nothing else touches them)
  // and updates the camera's horizontal anchor so the ball still centers in
  // the new width instead of staying pinned to the old 360 (half of 720).
  setRenderWidth(width) {
    if (this.renderWidth === width || !this._bg) return;
    this.renderWidth = width;
    this._bg.clear().rect(0, 0, width, CONFIG.HEIGHT).fill(0x0a0410);
    this._vignette.clear();
    // Rebuilds at the CURRENT accent's base color (see
    // _applyBackgroundAccent), not a hardcoded default — a resize mid-
    // level (e.g. rotating to landscape) shouldn't silently drop Level 1's
    // warmed vignette back to plain purple.
    this._vignette.rect(0, 0, width, CONFIG.HEIGHT)
      .fill(this._vignetteGrad(width, CONFIG.HEIGHT, this._vignetteBase || [10, 4, 16]));
    for (const f of this._fogSprites) {
      f.sprite.width = width;
      f.spriteFlip.width = width;
    }
    // Cliff layer keeps its own aspect ratio (it's a tall 369x2000 strip,
    // not a 720x1280 tile like the fog layers), so its height has to be
    // recomputed from the new width rather than just re-set.
    if (this._cliffSprite) {
      const cliffAspect = this._cliffSprite.texture.height / this._cliffSprite.texture.width;
      this._cliffScaledHeight = width * cliffAspect;
      this._cliffSprite.width = this._cliffSpriteB.width = width;
      this._cliffSprite.height = this._cliffSpriteB.height = this._cliffScaledHeight;
      this._cliffLayer.y2 = this._cliffLayer.y1 - this._cliffScaledHeight;
    }
  },

  // Shared camera-axis math: pans by (screenAnchor - target), clamped so the
  // pan never reveals past `worldAtLowerBound`/`worldAtUpperBound` (world
  // positions, not camera values — this computes the correct camera-space
  // clamp direction from them), smoothed toward the new value rather than
  // snapping frame to frame.
  _updateCameraAxis(current, screenAnchor, target, worldAtLowerBound, worldAtUpperBound) {
    const targetCam = screenAnchor - target;
    const camAtLower = screenAnchor - worldAtLowerBound;
    const camAtUpper = screenAnchor - worldAtUpperBound;
    const clamped = Math.max(camAtLower, Math.min(camAtUpper, targetCam));
    const lerp = Math.min(1, this._dt * 6);
    return current + (clamped - current) * lerp;
  },

  // Syncs a pool of reusable Sprites to however many particles are currently
  // alive, calling styleFn(particle, t) for each to get its {x, y, size,
  // alpha, tint, additive}. Recolors via `.tint`, a free GPU operation — no
  // per-particle repainting the way the old Canvas 2D version needed.
  _syncParticlePool(pool, container, particles, texture, styleFn) {
    while (pool.length < particles.length) {
      const s = new PIXI.Sprite(texture);
      s.anchor.set(0.5);
      container.addChild(s);
      pool.push(s);
    }
    while (pool.length > particles.length) {
      container.removeChild(pool.pop());
    }
    for (let i = 0; i < particles.length; i++) {
      const t = particles[i].life / particles[i].maxLife;
      const st = styleFn(particles[i], t);
      const s = pool[i];
      s.position.set(st.x, st.y);
      s.width = s.height = Math.max(0, st.size);
      s.tint = st.tint;
      s.alpha = Math.max(0, Math.min(1, st.alpha));
      s.blendMode = st.additive ? 'add' : 'normal';
    }
  },

  // One platform's full per-frame refresh — rotation, liquid, glass parallax,
  // hinge glow/particles, jets. Mirrors the Phase 1 single-platform
  // refresh()/_refreshHinge()/_refreshJets(), just operating on `p`/`p._visual`
  // instead of the old global Platform/Difficulty.jets/HingeBubbles.
  _refreshPlatform(p) {
    const v = p._visual;
    v.platformContainer.rotation = p.angleRad;
    // A pulsing tube's length (Rob: tubes that breathe large to small and
    // back — see platform.js's lengthPulse) changes every frame; everything
    // here was only ever sized once at build time otherwise, so this is a
    // no-op (one cheap comparison) for every non-pulsing platform.
    if (p.length !== v._lastLength) {
      v._lastLength = p.length;
      v.platformSprite.width = p.length;
      v.tubeShadow.width = p.length;
      v.tubeHighlight.width = p.length;
      // Rescales the liquid's already-simulated shape to match rather than
      // re-deriving its own column layout (see build()'s liquidBaseLength).
      v.liquidContainer.scale.x = p.length / v.liquidBaseLength;
    }
    this._refreshLiquid(p);
    this._refreshLiquidBubbles(p);
    v.tubeHighlight.x = -p.angle * 3;
    this._refreshHinge(p);
    this._refreshJets(p);
    // Rob: "let's try the old jets and see if that fixes the problem" —
    // _refreshPlasmaJets skipped for now so the new PlasmaJet visuals stay
    // idle/invisible (their own `idle` check keeps this basically free)
    // while _refreshJets above (always run, never touched) draws the old
    // particle streams instead. One-line flip back once there's a verdict.
    // if (p._visual.plasmaJets) this._refreshPlasmaJets(p);
  },

  // Drives this platform's plasma-jet mounts (see build()'s isLevel1Extra
  // block) — one real PlasmaJet per JET_DEFS mount, only actually "on"
  // when BOTH the mount is currently the game's active jet (p.jetSystem's
  // own toggle logic, untouched) AND Rob's new condition: "only have the
  // jets going on when the liquid has flowed to that side of the jet".
  // Headspace at the mount's own x (same helper the bubbles use) small
  // means the surface has risen close to the glass there — that side is
  // currently the "wetter"/downhill one as the tube rocks, same physical
  // read as the bubble flow's own current. A mount whose side hasn't
  // pooled that way yet just stays dark even while the game logic itself
  // has it armed.
  _refreshPlasmaJets(p) {
    const scale = p.length / (620 * p.visualScale);
    // Rob: "there's too much color that is the same... rotate the jets one
    // step forward" — a Cool tube's jets now flare in the Warm color, a
    // Warm tube's jets flare Fire, and a Fire tube's jets wrap back to
    // Cool, instead of always matching the tube they're mounted on. Reads
    // whatever override this run's stageColorOverride set (same source
    // _applyTubeStage uses), falling back to the stage's own default.
    const STAGE_ORDER = ['Cool', 'Warm', 'Fire'];
    const nextStage = STAGE_ORDER[(STAGE_ORDER.indexOf(p.tubeStage) + 1) % STAGE_ORDER.length];
    const nextOverride = p.stageColorOverride && p.stageColorOverride[nextStage];
    const [tr, tg, tb] = nextOverride || TUBE_STAGE_PARAMS[nextStage].color;
    const accent = rgbToHex(
      tr + (255 - tr) * 0.35,
      tg + (255 - tg) * 0.35,
      tb + (255 - tb) * 0.35,
    );
    for (let i = 0; i < p.jetSystem.jets.length; i++) {
      const gameJet = p.jetSystem.jets[i];
      const visual = p._visual.plasmaJets[i];
      const mountX = JET_DEFS[i].activeDistance * scale;
      // Rob: "let's change it so the jets are on between 2 and 4 seconds"
      // — gameJet.wet is difficulty.js's own 2-4s held wetness window (see
      // its own comment), computed once there and read here so the visual
      // and the actual launch-eligibility check always agree, instead of
      // each recomputing their own separate reading of the liquid that
      // could drift out of sync with each other.
      visual.on = gameJet.active && gameJet.wet;
      visual.color = rgbToHex(tr, tg, tb);
      visual.secondColor = accent;
      // Local platform-space coordinates (view.position is relative to
      // platformContainer, which already carries p.angleRad — see build's
      // own comment) — mountX is the same along-the-bar offset difficulty.js
      // keys this mount's own wetness off, and -(thickness/2) sits right on
      // the tube's own top surface regardless of tilt, no approximation.
      visual.view.position.set(mountX, -(p.thickness / 2 + 2));
      // The NOZZLE should track the tilting bar (just set above), but the
      // BEAM itself still needs to shoot straight up in world space, same
      // as the old particle jets and basic physics (buoyancy doesn't tilt
      // with the platform) — counter-rotate the view by the platform's
      // own angle so its local "up" always renders as true world-up
      // regardless of tilt.
      visual.view.rotation = -p.angleRad;
      // Rob: "when it turns off, it continues to let out a couple of
      // extra pops" — a real ball catch (justFired, from the actual
      // gameplay bump — untouched here) used to always flare the visual
      // with surge(), even on a mount that's currently OFF (not wet/not
      // its turn), so a catch landing right as/after the ambient stream
      // goes quiet still popped off its own separate burst. Only surging
      // when the jet is actually on now — the ball's bump itself always
      // still happens either way, this is purely the visual flare.
      if (gameJet.justFired) { if (visual.on) visual.surge(); gameJet.justFired = false; }
      visual.update(this._dt);
    }
  },

  // Rob's liquid polish pass — draws p.liquidBubbles (see platform.js's
  // _updateLiquidBubbles). Not run through _syncParticlePool since bubbles
  // don't share that helper's life/maxLife shape (they're either rising,
  // in which case t=0 means "not popping yet", or popping, where t is pop
  // progress 0..1 and drives a quick grow-and-fade rather than a fade
  // alone) — small enough to just pool directly here.
  _refreshLiquidBubbles(p) {
    const bubbles = p.liquidBubbles;
    const pool = p._visual.liquidBubblePool;
    const container = p._visual.liquidBubbleContainer;
    while (pool.length < bubbles.length) {
      const s = new PIXI.Sprite(textures.hingeBubbleParticle);
      s.anchor.set(0.5);
      container.addChild(s);
      pool.push(s);
    }
    while (pool.length > bubbles.length) container.removeChild(pool.pop());

    // Rob: "make them match the color more pink as they're starting at
    // the bottom... lower the transparency and make them appear more as
    // they get to the top" — riseT (0 at spawn, 1 once they've climbed to
    // roughly the tube's own top wall) drives both a tint blend from the
    // tube's own live color up to white, and an alpha ramp from faint to
    // fully punchy, so each bubble visibly brightens and clears the
    // tube's own tint on its way up instead of looking the same the whole
    // trip.
    const halfT = p._liquidHalfThickness();
    const [tr, tg, tb] = p.tubeColor;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const s = pool[i];
      s.position.set(b.x, b.y);
      const t = b.popping ? b.popT / 0.18 : 0;
      // Pop reads as a quick soft flash — briefly bigger and brighter,
      // then gone, rather than just blinking out.
      s.width = s.height = (b.r * 2) * (1 + t * 1.8);
      const riseT = Math.max(0, Math.min(1, (b.startY - b.y) / (b.startY - (-halfT))));
      // Rob: "add a lot more bubbles with contrast because I can't see
      // them so small" — alpha roughly doubled and switched to additive
      // blending so each bubble reads as a bright highlight punching
      // through the tube's own tint instead of a faint pale circle
      // sitting on top of it, the same trick the jets' own particles
      // already use for visibility against the tube color. Ramped by
      // riseT on top of that per Rob's follow-up (faint near the bottom,
      // fully visible by the time it nears the surface).
      const baseAlpha = 0.35 + 0.4 * riseT;
      s.alpha = b.popping ? 0.7 * (1 - t) : baseAlpha;
      s.tint = rgbToHex(
        tr + (255 - tr) * riseT,
        tg + (255 - tg) * riseT,
        tb + (255 - tb) * riseT,
      );
      s.blendMode = 'add';
    }

    // Foam flecks (see platform.js's liquidFoam) — tiny, sit right at the
    // live surface level under their own x (not a stored y, so they track
    // the wave as it keeps moving under them for however briefly they
    // live), fading out over their short lifetime.
    const foam = p.liquidFoam;
    const foamPool = p._visual.liquidFoamPool;
    const foamContainer = p._visual.liquidFoamContainer;
    while (foamPool.length < foam.length) {
      const s = new PIXI.Sprite(textures.hingeBubbleParticle);
      s.anchor.set(0.5);
      foamContainer.addChild(s);
      foamPool.push(s);
    }
    while (foamPool.length > foam.length) foamContainer.removeChild(foamPool.pop());

    for (let i = 0; i < foam.length; i++) {
      const f = foam[i];
      const s = foamPool[i];
      const t = f.life / f.maxLife;
      s.position.set(f.x, p._liquidLevelAt(f.x));
      s.width = s.height = f.r * 2;
      s.alpha = 0.8 * (1 - t); // contrast pass alongside the bubbles above
      s.tint = 0xffffff;
      s.blendMode = 'normal';
    }
  },

  _refreshHinge(p) {
    const v = p._visual;
    const { x, y } = p.pivot;
    const g = p.hingeGlow;
    const c = [
      Math.round(140 + (175 - 140) * g),
      Math.round(70 + (85 - 70) * g),
      Math.round(230 + (255 - 230) * g),
    ];
    const rgb = `rgb(${c.join(',')})`;

    // Rob: "when you change the potion color you should also change the
    // bubble color" — these used to be a fixed pink→blue gradient
    // regardless of what the tube actually is right now (Level 1's amber
    // test still showed plain pink bubbles here). Blends from this
    // platform's own live tubeColor (near the hinge) toward white (as
    // they rise and fade), same spirit as the in-liquid bubbles already
    // do, so every level/color identity carries all the way through.
    const [htr, htg, htb] = p.chargeSpent ? [60, 60, 66] : p.tubeColor;
    this._syncParticlePool(v.hingeBubblePool, v.hingeBubbleContainer, p.hingeBubbles.bubbles, textures.hingeBubbleParticle, (bp, t) => ({
      x: bp.x + Math.sin(bp.wobblePhase) * bp.wobbleAmp, y: bp.y,
      size: bp.maxSize * (1 - t), alpha: 1 - t,
      tint: rgbToHex(htr + (255 - htr) * t, htg + (255 - htg) * t, htb + (255 - htb) * t),
      additive: false,
    }));

    const blurred = v.hingeGlowBlurred, solid = v.hingeGlowSolid;
    blurred.clear();
    solid.clear();
    v.hingeGlowBlurred.filters[0].strength = 4;
    const dotR = 17 * p.visualScale;
    blurred.circle(x, y, dotR).stroke({ width: 5 * p.visualScale, color: rgb, alpha: 0.4 + g * 0.6 });
    solid.circle(x, y, dotR).stroke({ width: 3 * p.visualScale, color: rgb, alpha: 0.5 + g * 0.5 });

    this._syncParticlePool(v.hingeMagicPool, v.hingeMagicContainer, p.hingeMagicParticles, textures.smokeParticle, (mp, t) => ({
      x: mp.x, y: mp.y,
      size: mp.maxSize * t, alpha: (150 / 255) * (1 - t),
      tint: rgbToHex(74 + (119 - 74) * t, 144 + (0 - 144) * t, 226 + (255 - 226) * t),
      additive: true,
    }));

    for (const r of [47 * p.visualScale, p.hingeRingRadius]) {
      blurred.circle(x, y, r).stroke({ width: 5 * p.visualScale, color: rgb, alpha: 0.4 + g * 0.6 });
      solid.circle(x, y, r).stroke({ width: 3 * p.visualScale, color: rgb, alpha: 0.5 + g * 0.5 });
    }

    this._syncParticlePool(v.hingeSparkPool, v.hingeSparkContainer, p.hingeSparkParticles, textures.glowParticle, (sp, t) => ({
      x: sp.x, y: sp.y,
      size: 15 * (1 - t), alpha: (70 / 255) * (1 - t),
      tint: rgbToHex(255, 255 + (33 - 255) * t, 255),
      additive: false,
    }));
  },

  // The nozzle "base emitter" (aura + pulsing ring + spark rays + core, drawn
  // at the jet's origin point) was removed entirely (Rob: something read wrong
  // about it, simpler to just drop it) — the particle stream itself is the
  // jet's whole visual now.
  // Experiment (Rob: "make them the same color as the potion in the tube
  // ... if the tube changes from pink to light blue, then the plasma would
  // change to be that same color" — not committed to keeping this yet,
  // just seeing what it looks like). Reads p.tubeColor directly, the same
  // live-lerping [r,g,b] platform.js already animates for the tube's own
  // liquid fill (see _refreshLiquid), so the jets track it automatically
  // as it shifts through Cool/Warm/Fire.
  //
  // First pass just tinted every particle one flat color — Rob: "too
  // blobby, all the same color... they need to have darks and lights to
  // create some 3D form, like the original jets had" (the old fixed
  // (40,80,160)→(64,0,128) gradient did exactly that, just tied to a
  // color that never matched the tube). Restored that same idea — a
  // lighter, near-white highlight near the nozzle easing toward a
  // darker, shadowed version of the same hue toward the tail — but
  // mixed from the tube's own live color instead of a fixed pair, so the
  // 3D shading effect survives the color now shifting with the tube.
  _refreshJets(p) {
    const [tr, tg, tb] = p.tubeColor;
    // mix() blends tubeColor toward white (highlight) or black (shadow) by
    // `amt` — same "closer to nozzle = brighter/whiter, further along =
    // darker" read the original two-stop gradient had.
    const mix = (target, amt) => [
      tr + (target - tr) * amt,
      tg + (target - tg) * amt,
      tb + (target - tb) * amt,
    ];
    // Rob: "too much white... going a little too far" — pulled back from
    // 0.55 toward white (55% of the way to pure white read as washed-out)
    // down to a much lighter tint of the tube's own color instead of
    // nearly replacing it.
    const highlight = mix(255, 0.2); // lightly brightened, close to the nozzle
    // Rob's follow-up: "still need a little more contrast... let's start
    // adding in some for the light blue... add in some darker colors
    // there to get some contrast." Light blue (Warm's [126,190,252]) is a
    // pale, high-brightness color to start with, so the same 0.45-toward-
    // black mix that read as clearly darker on pink barely dented it —
    // pushed to 0.7 so every tube color, pastel or not, reaches a real
    // shadow tone instead of just a slightly dimmer version of itself.
    const shadow = mix(0, 0.7); // darker, toward the tail
    for (let i = 0; i < p.jetSystem.jets.length; i++) {
      const jet = p.jetSystem.jets[i];
      const { particleContainer, pool } = p._visual.jetContainers[i];
      this._syncParticlePool(pool, particleContainer, jet.particles, textures.jetParticle, (jp, t) => ({
        x: jp.x, y: jp.y,
        size: (60 + (20 - 60) * t) * 0.85,
        // Rob: "maybe for all of them add a little transparency. I think
        // that's the problem" — capped below fully opaque (was a flat
        // 1 - t) so overlapping particles read as translucent streams
        // with real depth instead of solid, opaque blobs stacking on
        // top of each other. Rob's follow-up: "make these jets a little
        // transparent" — pulled back further, 0.8 -> 0.55.
        alpha: (1 - t) * 0.55,
        tint: rgbToHex(
          highlight[0] + (shadow[0] - highlight[0]) * t,
          highlight[1] + (shadow[1] - highlight[1]) * t,
          highlight[2] + (shadow[2] - highlight[2]) * t,
        ),
        additive: true,
      }));
    }
  },

  // Rebuilds one platform's liquid fill + shine Graphics from its own
  // liquidColumns — has to run every frame since the column levels genuinely
  // change every frame (spring physics).
  _refreshLiquid(p) {
    const v = p._visual;
    const halfT = p._liquidHalfThickness();
    const cols = p.liquidColumns;
    if (!cols.length) return;

    // Meniscus (Rob: liquid polish pass) — a real fluid climbs slightly up
    // a glass wall from surface tension, regardless of which way the tube
    // is tilted. Purely a render-time bias on top of the physics columns
    // (not written back into them) so it doesn't feed into the spring sim
    // at all — just the last few columns at each edge nudged upward,
    // easing back to the real simulated level within a short span so it
    // reads as a curve hugging the walls, not a kink.
    const n = cols.length;
    const meniscusSpan = Math.max(2, Math.floor(n * 0.12));
    const meniscusLift = 5; // px risen at the very edge
    const levelAt = (i) => {
      const edgeDist = Math.min(i, n - 1 - i);
      if (edgeDist >= meniscusSpan) return cols[i].level;
      const f = 1 - edgeDist / meniscusSpan;
      return cols[i].level - meniscusLift * f * f; // negative = up
    };

    const body = v.liquidBody;
    body.clear();
    body.moveTo(cols[0].x, halfT);
    body.lineTo(cols[0].x, levelAt(0));
    for (let i = 1; i < cols.length - 1; i++) {
      const midX = (cols[i].x + cols[i + 1].x) / 2;
      const midY = (levelAt(i) + levelAt(i + 1)) / 2;
      body.quadraticCurveTo(cols[i].x, levelAt(i), midX, midY);
    }
    const last = cols[cols.length - 1];
    body.lineTo(last.x, levelAt(cols.length - 1));
    body.lineTo(last.x, halfT);
    body.closePath();

    // Rebuilding a FillGradient bakes a new GPU texture — tubeColor lerps by
    // tiny fractions every frame (see platform.js), so comparing for exact
    // equality would still rebuild on essentially every frame, one leaking
    // texture per platform per frame, continuously, for as long as the game
    // runs. That's the same "new PIXI.FillGradient() every frame" pattern
    // that caused a real GPU crash once already (the jet nozzle, fixed
    // earlier) — just far more frequent here, and the likely cause of
    // temporary freeze-then-recover crashes seen on a real phone (GPU
    // memory pressure building up over a play session until the driver has
    // to stall and clean up). Only rebuilding once the color has visibly
    // shifted keeps the transition looking smooth while capping the rebuild
    // rate to something sane instead of every frame forever.
    // Charge-spent platforms go dark grey — still chargeable, just no
    // longer scoring (Rob) — overriding the live tubeColor here instead of
    // in platform.js keeps tubeColor itself intact for anything else that
    // reads it (jets, hinge bubbles use their own override below).
    const [tr, tg, tb] = p.chargeSpent ? [60, 60, 66] : p.tubeColor;
    const cached = v._liquidGradColor;
    const changed = !cached
      || Math.abs(cached[0] - tr) >= 2 || Math.abs(cached[1] - tg) >= 2 || Math.abs(cached[2] - tb) >= 2;
    if (changed) {
      v._liquidGradColor = [tr, tg, tb];
      v._liquidGradient = new PIXI.FillGradient({
        type: 'linear', x0: 0, y0: -halfT, x1: 0, y1: halfT,
        colorStops: [
          { offset: 0, color: `rgba(${lighten(tr, 90)},${lighten(tg, 90)},${lighten(tb, 20)},0.9)` },
          { offset: 0.35, color: `rgba(${tr | 0},${tg | 0},${tb | 0},0.95)` },
          { offset: 1, color: `rgba(${darken(tr, 0.55)},${darken(tg, 0.55)},${darken(tb, 0.55)},0.92)` },
        ],
        textureSpace: 'local',
      });
    }
    body.fill(v._liquidGradient);

    const shine = v.liquidShine;
    shine.clear();
    const maxDepth = halfT * 2;
    for (let i = 0; i < cols.length - 1; i++) {
      const aLevel = levelAt(i), bLevel = levelAt(i + 1);
      const depthA = halfT - aLevel, depthB = halfT - bLevel;
      const depth = Math.min(depthA, depthB);
      const alpha = smoothstep(0, maxDepth * 0.22, depth) * 0.45;
      if (alpha <= 0.01) continue;
      shine.moveTo(cols[i].x, aLevel).lineTo(cols[i + 1].x, bLevel)
        .stroke({ width: 3, color: `rgba(${lighten(tr, 150)},${lighten(tg, 150)},${lighten(tb, 150)},${alpha.toFixed(3)})` });
    }
  },
};
