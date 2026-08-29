// Core loop, screen/state switching, asset loading, resize handling. Ties together
// input.js (tilt), storage.js (save data), leaderboard.js (stub for now) and ui.js
// (drawing). Physics/platform/difficulty gameplay itself arrives in later stages —
// this stage proves the skeleton (screens, navigation, tilt input) works end to end.

const CONFIG = {
  WIDTH: 720,
  HEIGHT: 1280,
};

const ASSET_PATHS = {
  sky: 'assets/Background 1.png',
  logo: 'assets/Potion Logo 7.11.png',
  liveGame: 'assets/Home Page Landscape-8.png',
  freePlayButton: 'assets/FreePlay.png',
  levelModeButton: 'assets/LevelsButton.png',
  motionButton: 'assets/MotionButton.png',
  muteUnmuted: 'assets/Mute P.png',
  muteMuted: 'assets/Mute P1.png',
  potionCounter: 'assets/Potion Counter-8.png',
  glowParticle: 'assets/Glow.png',
  smokeParticle: 'assets/DarkMagicSmoke.png',
  jetParticle: 'assets/LightGlow.png',
  hingeBubbleParticle: 'assets/Bubble.png',
  pole: 'assets/NewSprite.png',
  platform: 'assets/Tube4.png',
  hinge: 'assets/Hinge.png',
  ball: 'assets/Ball.png',
  tubeShadow: 'assets/TubeShadow.png',
  tubeHighlight: 'assets/TubeHighlight3.png',
  moonWarm: 'assets/Moon Warm.png',
  moonHot: 'assets/Moon Hot.png',
  moonFire: 'assets/Moon Fire.png',
  gameOverText: 'assets/GameOverText3.png',
  gameOverBoard: 'assets/GameOver11.png',
  gameOverBallOff: 'assets/Ball Off.png',
  bubblesFinal: 'assets/BubblesFinal.png',
  potionFilled: 'assets/Pink Potion Final_1.png',
  potionEmpty: 'assets/Pink Potion Empty.png',
  bubbleScore: 'assets/bubblescore3.png',
  fogBack: 'assets/FogBack3.png',
  fogBackFlip: 'assets/FogBack3Flip.png',
  fogMid: 'assets/FogMid3.png',
  fogMidFlip: 'assets/FogMid3Flip.png',
  fogFront: 'assets/FogFront3.png',
  fogFrontFlip: 'assets/FogFront3Flip.png',
  potionBlast: 'assets/Blast2.png',
  blastRing: 'assets/Blast.png',
  // Game Over's row of 3 round buttons — one combined pill image (icons + dividers
  // baked in, tap zones split into thirds) rather than 3 separate button sprites.
  // Two variants matching the original: Free Play's 3rd icon is a leaderboard
  // shortcut, Level 1's is a levels-grid shortcut.
  bottomButtonsFreeplay: 'assets/Bottom Buttons.png',
  bottomButtonsLevels: 'assets/Bottom Buttons Levels.png',
  // Levels screen's per-level tile art (Rob) — bright/glowing purple border
  // for an unlocked, playable level, a dulled grey-bordered version for a
  // locked one. Same square art either way, just swapped by state.
  levelButton: 'assets/Level Button.png',
  levelButtonDull: 'assets/Level Button Dull.png',
  // Levels screen's own Home button (Rob) — a glowing circular icon,
  // matching the game's other round icon buttons, instead of the old
  // plain rect+text placeholder.
  levelsHomeButton: 'assets/HomeCircleButton.png',
  levelsText: 'assets/LevelsText.png',
};

const canvas = document.getElementById('gameCanvas');
const gameWrap = document.getElementById('gameWrap');
const nameInput = document.getElementById('nameInput');

// Fullscreen toggle (Rob: playing through a browser tab means dealing with
// the address bar/chrome eating into the screen — "Add to Home Screen"
// avoids it but asks every player to do that themselves first; a real
// button using the browser's actual Fullscreen API doesn't). Requests
// fullscreen on the whole <html> element rather than just #gameWrap so the
// fullscreenBtn itself (fixed to the viewport, not gameWrap) stays visible
// and tappable to exit again. Guarded with the vendor-prefixed fallbacks
// still needed on some browsers (Safari in particular never adopted the
// unprefixed API).
const fullscreenBtn = document.getElementById('fullscreenBtn');
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function toggleFullscreen() {
  if (isFullscreen()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
}
fullscreenBtn.addEventListener('click', toggleFullscreen);
// Swap the glyph so the button always reflects reality — e.g. after the
// user exits fullscreen with their own device back/gesture rather than
// this button.
function updateFullscreenBtn() {
  fullscreenBtn.textContent = isFullscreen() ? '⤢' : '⛶';
}
document.addEventListener('fullscreenchange', updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);

// Mute — a single persistent button (see index.html's comment for why this
// replaced three separate per-screen Pixi mute buttons). toggleMute and
// state are defined further down/right here respectively, but function
// declarations and this const are hoisted, so referencing them in a
// listener that only actually runs later (on click / on the muted-state
// check below) is safe regardless of textual order.
const muteBtn = document.getElementById('muteBtn');
const muteBtnImg = document.getElementById('muteBtnImg');
muteBtn.addEventListener('click', () => { toggleMute(); updateMuteBtn(); });
// Rob: keep the game's own original mute-on/mute-off art (the same two
// images every screen's mute button always used) instead of a generic
// glyph — this button just swaps between them now, on this one shared
// element, instead of three separate Pixi sprites each doing their own swap.
function updateMuteBtn() {
  muteBtnImg.src = state.muted ? 'assets/Mute P1.png' : 'assets/Mute P.png';
}

// A handful of PlayScreen's (old ui.js) own methods do real text-layout math
// with a Canvas 2D context — not drawing, just using ctx.font/measureText to
// figure out where things go (e.g. _goScoreLayout() sizing the Game Over
// bubble mask around however wide the score text is). That's legitimate
// logic, not rendering, so instead of reimplementing it, this `ctx` stays
// around as a detached, never-drawn-to context purely for measurement — it's
// not attached to the visible canvas at all (Pixi owns that entirely).
const ctx = document.createElement('canvas').getContext('2d');

// Pixi Application — the GPU rendering foundation for this rebuild (see
// PINBALL_EXPANSION_PLAN.md). Reuses the existing <canvas> element (rather
// than letting Pixi create its own) so gameWrap's CSS sizing/scaling and the
// nameInput DOM overlay positioned on top of it don't need to change at all.
// `app` isn't usable until `app.init()` resolves (Pixi v8's init is async) —
// see main() below.
const app = new PIXI.Application();

// True for any Level's play screen ('level1', 'level2', ...) or Free Play —
// the two non-menu screens that both run PlayScreenPixi. Centralized here
// (used by the Space-bar shortcut and the main tick loop below) instead of
// hand-listing every level string at each call site, so a new level added
// in pixi_levels.js/ui.js doesn't need this file touched too.
function isPlayScreenName(screen) {
  return screen === 'freeplay' || /^level\d+$/.test(screen);
}

const state = {
  screen: 'home', // 'home' | 'levels' | 'level<N>' | 'freeplay'
  playerName: Storage.getPlayerName(),
  gameMode: '',
  highestLevelUnlocked: Storage.getHighestLevelUnlocked(),
  muted: Storage.getMuted(),
  showNameWarning: false,
  requestingMotion: false,
  motionDenied: false,
};

// ---------- Background music ----------
// Original plays "Moonlit Drift.mp3" on a continuous loop from boot, across every
// screen (there's no per-scene music, just one persistent track). Mobile/desktop
// browsers block audio autoplay-with-sound until the page has seen at least one
// real user gesture, so the element is created immediately but .play() is only
// attempted starting with the first tap/keypress — and retried on every one after
// that until it actually succeeds (a single blocked attempt shouldn't give up for good).
const Music = {
  el: new Audio('assets/Moonlit Drift.mp3'),
  started: false,
  tryStart() {
    if (this.started) return;
    this.el.play().then(() => { this.started = true; }).catch(() => {});
  },
};
Music.el.loop = true;
Music.el.volume = 1;
Music.el.muted = state.muted;
window.addEventListener('pointerdown', () => Music.tryStart());
window.addEventListener('keydown', () => Music.tryStart());

// Desktop testing convenience (Rob) — Input.js already has arrow-key tilt as a
// fallback for testing without a phone; the other half of playing without a
// mouse is firing a Potion Blast, which was mouse/touch-only (the HUD button).
// Space does that now, but only during actual gameplay — guarding on screen
// avoids stealing the space bar from the name field on Home, where typing a
// literal space in your name should still just work normally.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && isPlayScreenName(state.screen)) {
    e.preventDefault(); // stop the page itself from scrolling on spacebar
    PlayScreen.fireBlast();
  }
});

const images = {}; // raw HTMLImageElement per key — kept around for any code
// not yet migrated off direct pixel access; being phased out screen by screen.
const textures = {}; // PIXI.Texture per key — what Pixi Sprites actually draw from.

// Retries on failure — matters on real phones with flaky mobile connections,
// not just for local dev testing. Unchanged from the Canvas 2D version: this
// part has nothing to do with rendering, just fetching image files, so it
// carries over as-is.
function loadImage(src, attemptsLeft = 3) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (attemptsLeft > 1) {
        setTimeout(() => loadImage(src, attemptsLeft - 1).then(resolve, reject), 300);
      } else {
        reject(new Error(`Failed to load image: ${src}`));
      }
    };
    img.src = src;
  });
}

// Loaded a few at a time rather than all at once — large batches of simultaneous
// image requests were unreliable in local dev testing, and this is gentler on
// mobile connections in production too.
async function loadAssets() {
  const entries = Object.entries(ASSET_PATHS);
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const i = cursor++;
      const [key, path] = entries[i];
      const img = await loadImage(path);
      images[key] = img;
      // PIXI.Texture.from() accepts an already-loaded HTMLImageElement
      // directly and uploads it to the GPU — no separate Pixi-side loading
      // step needed on top of the existing retry logic above.
      textures[key] = PIXI.Texture.from(img);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (document.fonts) {
    await Promise.all([
      document.fonts.load('20px PotionTitle'),
      document.fonts.load('20px PotionBody'),
    ]).catch(() => {}); // fonts still render with fallback if this fails
  }
}

// ---------- Screen navigation ----------
function goHome() {
  state.screen = 'home';
  nameInput.style.display = '';
  nameInput.value = state.playerName;
  state.showNameWarning = false;
  state.requestingMotion = false;
  state.motionDenied = false;
}

async function tryEnterGame(mode) {
  const name = nameInput.value.trim();
  if (!name) {
    state.showNameWarning = true;
    return;
  }
  state.playerName = name;
  Storage.setPlayerName(name);
  state.gameMode = mode;
  state.showNameWarning = false;
  state.requestingMotion = true;
  nameInput.style.display = 'none';

  const granted = await Input.requestPermission();
  state.requestingMotion = false;

  if (!granted) {
    state.motionDenied = true;
    return;
  }
  if (mode === 'FreePlay') enterPlayScreen('freeplay');
  else state.screen = 'levels';
}

function enterPlayScreen(screen) {
  state.screen = screen;
  PlayScreen.enter(screen);
}

function toggleMute() {
  state.muted = !state.muted;
  Storage.setMuted(state.muted);
  Music.el.muted = state.muted;
}

// ---------- Screens (Pixi containers, one per screen, toggled visible/hidden
// rather than redrawn from scratch every frame — see pixi_home.js's header
// comment for why this replaces the old ctx-based draw()/hitTest() pattern). ----------
// Only Home is really rebuilt so far (see PINBALL_EXPANSION_PLAN.md — this is
// the first proven slice, not the whole game). Levels/PlayScreen are simple
// placeholders for now so the app is fully navigable without crashing while
// the rest of the rebuild is still in progress.
const screenContainers = {};

function buildPlaceholderScreen(label) {
  const c = new PIXI.Container();
  const bg = new PIXI.Graphics().rect(0, 0, 720, 1280).fill(0x0a0410);
  c.addChild(bg);
  const text = new PIXI.Text({
    text: label,
    style: { fontFamily: 'PotionTitle', fontSize: 36, fill: 0xffffff, align: 'center', wordWrap: true, wordWrapWidth: 600 },
  });
  text.anchor.set(0.5);
  text.position.set(360, 500);
  c.addChild(text);

  const homeBtn = new PIXI.Graphics().rect(0, 0, 160, 60).stroke({ width: 2, color: 0x9013fe });
  const homeBtnText = new PIXI.Text({ text: 'Home', style: { fontFamily: 'PotionBody', fontSize: 22, fill: 0x9013fe } });
  homeBtnText.anchor.set(0.5);
  homeBtnText.position.set(80, 30);
  homeBtn.addChild(homeBtnText);
  homeBtn.position.set(280, 600);
  homeBtn.eventMode = 'static';
  homeBtn.cursor = 'pointer';
  homeBtn.on('pointertap', () => goHome());
  c.addChild(homeBtn);

  return c;
}

// level1/freeplay share one container (both use PlayScreenPixi), so this
// compares by container identity rather than by key — comparing by key alone
// would have two keys fighting over the same object's .visible flag.
function showScreen(name) {
  const target = screenContainers[name];
  const seen = new Set();
  for (const key in screenContainers) {
    const container = screenContainers[key];
    if (seen.has(container)) continue;
    seen.add(container);
    container.visible = container === target;
  }
  // The name entry field only belongs on Home — centralized here (runs on
  // every screen change, from every path: tryEnterGame, Levels -> Level 1,
  // and Retry on Game Over) rather than only in tryEnterGame(), which retry
  // bypasses entirely. Rob caught it showing on Game Over on his phone.
  nameInput.style.display = name === 'home' ? '' : 'none';
}

// ---------- Resize (keeps the fixed 720x1280 internal coordinate space; only
// the CSS box around it scales — matches the approach used in Halloween-Platformer) ----------
// Landscape (Rob, 2026-08-23) — tried rotating the whole game 90° to fill a
// landscape screen, but that spun the art/text/HUD along with it (e.g. "GAME
// OVER" rendering sideways), which was confusing to read. Rob's call: don't
// rotate anything — the game should stay upright and zoom in to mostly fill
// a wide screen, cropping the top/bottom of the tower rather than shrinking
// to fit with side margins. Portrait keeps the original shrink-to-fit
// (Math.min) since phones are already close to the design aspect ratio there
// and letterboxing is barely noticeable.
//
// Landscape's vertical zoom level is still the same Math.max(...) *
// LANDSCAPE_ZOOM_OUT as before, but width is no longer clamped to a fixed
// 720 with CSS filling the leftover sides — that looked like a visibly
// cropped box floating over a mismatched background (flat color inside the
// canvas, static image outside it). Instead `renderWidth` grows to exactly
// however much world-space is visible at that scale, and the actual Pixi
// canvas/renderer resizes to match — so the game's own animated fog
// background genuinely extends into that space (see
// PlayScreenPixi.setRenderWidth), not a fake CSS approximation of it.
// CONFIG.WIDTH itself stays 720 throughout — that's still the "design
// width" every gameplay object/HUD position is authored against; only the
// screen-fixed background and the camera's horizontal anchor know about the
// wider render target.
const LANDSCAPE_ZOOM_OUT = 0.4; // Rob: zoom out another 20% from 0.5 to see even more of the tower
let renderWidth = CONFIG.WIDTH;
// Guards the GPU-touching work below (renderer.resize + the gradient
// rebuilds inside setRenderWidth) so it only actually runs when the render
// target genuinely changed size — not on every fitGameWrap() call. Mobile
// browsers (Android Chrome especially) fire native 'resize' events
// spuriously and repeatedly — the address bar hiding/showing, minor
// viewport-chrome changes — with no actual size change involved. Before
// this guard, every one of those redundant firings still called
// app.renderer.resize() and reconstructed FillGradient textures
// unconditionally, real GPU work on every firing. Rob saw the game
// temporarily freeze (audio kept playing, so it wasn't a full crash — more
// like the GPU/render thread stalling) then come back with the ball fallen
// off; a burst of this from spurious resize events is the leading suspect,
// given it's the same "reallocating GPU resources every frame" pattern that
// caused an actual GPU crash earlier in this project (see the jet nozzle
// gradient leak writeup in PINBALL_EXPANSION_PLAN.md).
let _lastAppliedRenderWidth = null;
let _lastAppliedIsLandscape = null;
// Caps how wide the Pixi canvas/renderer is ever asked to be — a safety net
// against a real bug found once (very wide *desktop browser windows*,
// 1200px+, produced a genuinely broken layout: content mispositioned,
// background not fully drawn — pointed at a GPU/canvas-size limitation, not
// a math bug). Raised from 1100 to 1800 (Rob: the earlier cap was quietly
// overriding every "zoom out more" request on a real phone, since
// LANDSCAPE_ZOOM_OUT (0.4) wants 720/0.4=1800 and 1100 was always smaller
// than that, so the cap — not the zoom setting — was the actual binding
// constraint the whole time). 1800 matches what 0.4 already wants, so this
// is now a no-op for every realistic phone/tablet width (all well under
// 1200px) and only still protects the actual bug case: a browser window
// wider than any real device gets.
const MAX_RENDER_WIDTH = 1800;
function fitGameWrap() {
  const isLandscape = window.innerWidth > window.innerHeight;
  let scale = isLandscape
    ? Math.max(window.innerWidth / CONFIG.WIDTH, window.innerHeight / CONFIG.HEIGHT) * LANDSCAPE_ZOOM_OUT
    : Math.min(window.innerWidth / CONFIG.WIDTH, window.innerHeight / CONFIG.HEIGHT);
  if (isLandscape) scale = Math.max(scale, window.innerWidth / MAX_RENDER_WIDTH);
  renderWidth = isLandscape ? Math.round(window.innerWidth / scale) : CONFIG.WIDTH;

  canvas.style.width = `${renderWidth}px`;
  canvas.style.height = `${CONFIG.HEIGHT}px`;
  gameWrap.style.width = `${renderWidth}px`;

  // Gated on app.renderer existing, not just on width/isLandscape having
  // changed — the very first fitGameWrap() call (top of main(), before
  // app.init() resolves) would otherwise mark this width as "already
  // applied" despite the renderer.resize() below being skipped (no renderer
  // to resize yet), permanently starving every later call of ever actually
  // resizing it. Caught before shipping: the canvas's CSS box was growing to
  // fit a wide landscape screen while the renderer stayed at its original
  // 720x1280 resolution underneath, stretching every rendered pixel ~2x
  // horizontally instead of showing more of the game at the right scale.
  if (app.renderer && (renderWidth !== _lastAppliedRenderWidth || isLandscape !== _lastAppliedIsLandscape)) {
    _lastAppliedRenderWidth = renderWidth;
    _lastAppliedIsLandscape = isLandscape;
    app.renderer.resize(renderWidth, CONFIG.HEIGHT);
    if (typeof PlayScreenPixi !== 'undefined') PlayScreenPixi.setRenderWidth(renderWidth);
    if (typeof HudPixi !== 'undefined') HudPixi.setLandscapeMode(isLandscape, renderWidth);

    // Home and Game Over both get the true, full renderWidth — same as
    // gameplay/HUD above — but scale their own content up proportionally to
    // HOME_GAMEOVER_REFERENCE_WIDTH internally (see each file's own
    // setRenderWidth/setLandscapeMode) so a wider canvas makes their content
    // bigger to fill it, rather than either spreading the same-size content
    // further apart (too spread out) or keeping it small and centered with
    // empty margins on both sides (too small for the screen — what an
    // earlier attempt at this did).
    if (typeof GameOverPixi !== 'undefined') GameOverPixi.setRenderWidth(renderWidth, isLandscape);
    if (typeof HomeScreenPixi !== 'undefined') {
      // Bottom edge of the visible landscape crop, in canvas/world
      // coordinates — the crop is always vertically centered on y=640 (see
      // the left/top math below), so its bottom is just 640 plus half the
      // viewport height converted back into world units via the same scale.
      const visibleBottomY = isLandscape ? 640 + (window.innerHeight / 2) / scale : CONFIG.HEIGHT;
      HomeScreenPixi.setLandscapeMode(isLandscape, renderWidth, visibleBottomY);
    }
  }

  const wrapLeft = (window.innerWidth - renderWidth * scale) / 2;
  const wrapTop = (window.innerHeight - CONFIG.HEIGHT * scale) / 2;
  gameWrap.style.transform = `scale(${scale})`;
  gameWrap.style.left = `${wrapLeft}px`;
  gameWrap.style.top = `${wrapTop}px`;
  gameWrap.style.position = 'absolute';

  updateBodyBackground(isLandscape);
}

// Fills whatever the game canvas itself doesn't cover — landscape's side
// margins (untouched, still the tiled fog fix from before) and portrait's
// top/bottom margins, which show up whenever the real screen is taller than
// the 720x1280 (9:16) design ratio (Rob: most noticeable in fullscreen,
// where the browser's own chrome no longer eats into that extra height —
// Math.min-based fit-to-width leaves it empty above/below the canvas). Was
// a flat, visibly disconnected cutoff there before.
//
// First attempt aligned the exact sky image (Background 1.png) the canvas's
// Home/Game Over screens draw, at the same scale/position — looked great
// there, but broke on two counts Rob caught: (1) that image only overscans
// ~17px past the canvas's own edges, so any margin taller than that fell
// through to a flat fallback color that didn't match the image it was
// supposed to be extending, a visible seam of its own; (2) the actual
// gameplay screen doesn't draw that sky image at all (flat fill + Fog
// layers instead — see pixi_playscreen.js), so aligning it there was just
// the wrong background regardless of margin size. A plain vertical
// gradient between the game's own near-universal dark tones sidesteps both:
// nothing screen-specific to be wrong about, and (unlike a fixed-size
// image) no natural edge to run out at — it always covers however tall the
// margin actually is.
function updateBodyBackground(isLandscape) {
  if (isLandscape) {
    document.body.style.backgroundImage = "url('assets/FogBack3.png')";
    document.body.style.backgroundRepeat = 'repeat';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundColor = '';
  } else {
    document.body.style.backgroundImage = 'linear-gradient(to bottom, #171731, #0a0410)';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundSize = '100% 100%';
    document.body.style.backgroundPosition = '0 0';
    document.body.style.backgroundColor = '#0a0410';
  }
}

// Debounced — collapses a burst of native resize events (common on mobile,
// see above) into a single fitGameWrap() call instead of one per event.
let _resizeDebounceTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeDebounceTimer);
  _resizeDebounceTimer = setTimeout(fitGameWrap, 150);
});

// iOS Safari has a well-documented quirk: right after a rotation,
// window.innerWidth/innerHeight can briefly still report the *pre-rotation*
// size before settling on the real one a moment later — since isLandscape
// is decided purely by comparing those two numbers, reading them at the
// wrong instant flips portrait/landscape backwards (Rob: confirmed on a
// real iPhone; Android reports correctly right away, this never showed up
// there). orientationchange only exists to catch exactly this, so rechecking
// a few times as things settle is a safety net, not a replacement for the
// resize listener above — on Android these are just harmless repeat calls
// confirming the same already-correct numbers (fitGameWrap is cheap to call
// redundantly; the GPU-touching work inside it only runs when something
// actually changed).
window.addEventListener('orientationchange', () => {
  clearTimeout(_resizeDebounceTimer);
  setTimeout(fitGameWrap, 50);
  setTimeout(fitGameWrap, 300);
  setTimeout(fitGameWrap, 600);
});

// ---------- Main loop ----------
// Driven by Pixi's own ticker (app.ticker) instead of a hand-rolled
// requestAnimationFrame loop — Pixi already renders every tick on its own, so
// this only needs to run game *logic* (input, physics) and screen switching,
// not manually trigger drawing the way the Canvas 2D version had to.
const MAX_DT = 1 / 20; // clamp so a stalled tab doesn't cause a huge physics jump on return
let lastScreen = null;

function tick(ticker) {
  const dt = Math.min(MAX_DT, ticker.deltaMS / 1000);
  Input.update();

  if (state.screen !== lastScreen) {
    showScreen(state.screen);
    lastScreen = state.screen;
  }
  if (state.screen === 'home') {
    HomeScreenPixi.refresh(textures, state);
  } else if (state.screen === 'levels') {
    LevelsScreenPixi.refresh(state);
  } else if (isPlayScreenName(state.screen)) {
    PlayScreenPixi.update(dt, Input.tiltX);
    PlayScreenPixi.refresh();
    HudPixi.refresh();
    GameOverPixi.refresh();
  }
}

// ---------- Boot ----------
async function main() {
  fitGameWrap();
  nameInput.value = state.playerName;
  updateMuteBtn(); // reflect the muted state already loaded from Storage

  // Pixi v8's init is async — resizeTo keeps its internal render resolution
  // matched to the canvas's own backing size, and reuses the existing
  // #gameCanvas element rather than inserting a second one.
  await app.init({ canvas, width: CONFIG.WIDTH, height: CONFIG.HEIGHT, backgroundColor: 0x0a0410, antialias: true });

  await loadAssets();

  HomeScreenPixi.build(textures, state);
  screenContainers.home = HomeScreenPixi.container;
  LevelsScreenPixi.build(textures, state);
  screenContainers.levels = LevelsScreenPixi.container;
  // PlayScreenPixi.build() needs PlayScreen.platforms to exist (it builds one
  // Pixi visual bundle per platform) — but PlayScreen.enter() only runs once
  // the player actually navigates into a run, same ordering issue Phase 1 hit
  // with JET_DEFS vs Difficulty.jets. Seed the tower structure now so build()
  // has something to construct visuals for; enter() rebuilds/resets it for real
  // every time a run actually starts.
  PlayScreen.platforms = PlayScreen._buildTower();
  PlayScreenPixi.build(textures);
  HudPixi.build(textures);
  GameOverPixi.build(textures);
  // Both show/hide together with the play screen automatically by riding
  // along as its children — GameOverPixi added after HudPixi so it draws on
  // top (matches PlayScreen.draw()'s own order: HUD, then Game Over overlay).
  PlayScreenPixi.container.addChild(HudPixi.container, GameOverPixi.container);
  // Pre-registered for every level 1-10 up front (not just the ones actually
  // built yet — see pixi_levels.js's BUILT_LEVELS) so wiring up a new level
  // there never needs a matching edit here too; they all share this one
  // PlayScreenPixi container just like freeplay does.
  for (let n = 1; n <= 10; n++) screenContainers['level' + n] = PlayScreenPixi.container;
  screenContainers.freeplay = PlayScreenPixi.container;
  for (const key in screenContainers) app.stage.addChild(screenContainers[key]);
  showScreen(state.screen);
  lastScreen = state.screen;

  // The very first fitGameWrap() call (top of main()) ran before app.renderer
  // and PlayScreenPixi existed, so if the page loaded already in landscape,
  // that call skipped the renderer resize/background widening entirely. Redo
  // it now that both exist, so landscape is correct from the first frame
  // instead of only fixing itself on the next window resize.
  fitGameWrap();

  // Forces one real frame to paint immediately, rather than only queuing
  // Home's content and waiting for the ticker's next scheduled tick to
  // actually composite it (Rob: on a real iPhone, Home didn't visibly
  // appear until the screen was touched — nothing in this file's logic
  // gates it behind a touch, so this reads like iOS Safari not promptly
  // running the first rAF-driven frame for a canvas that was only just
  // populated with content, with the touch itself being what nudges it
  // to actually paint). Cheap and harmless if this isn't the real cause.
  HomeScreenPixi.refresh(textures, state);
  app.renderer.render(app.stage);

  app.ticker.add(tick);
}

main();
