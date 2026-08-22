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
  liveGame: 'assets/LiveGame4.png',
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
};

const canvas = document.getElementById('gameCanvas');
const gameWrap = document.getElementById('gameWrap');
const nameInput = document.getElementById('nameInput');

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

const state = {
  screen: 'home', // 'home' | 'levels' | 'level1' | 'freeplay'
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
}

// ---------- Resize (keeps the fixed 720x1280 internal coordinate space; only
// the CSS box around it scales — matches the approach used in Halloween-Platformer) ----------
function fitGameWrap() {
  const scale = Math.min(window.innerWidth / CONFIG.WIDTH, window.innerHeight / CONFIG.HEIGHT);
  gameWrap.style.transform = `scale(${scale})`;
  gameWrap.style.left = `${(window.innerWidth - CONFIG.WIDTH * scale) / 2}px`;
  gameWrap.style.top = `${(window.innerHeight - CONFIG.HEIGHT * scale) / 2}px`;
  gameWrap.style.position = 'absolute';
}
window.addEventListener('resize', fitGameWrap);

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
  } else if (state.screen === 'level1' || state.screen === 'freeplay') {
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

  // Pixi v8's init is async — resizeTo keeps its internal render resolution
  // matched to the canvas's own backing size, and reuses the existing
  // #gameCanvas element rather than inserting a second one.
  await app.init({ canvas, width: CONFIG.WIDTH, height: CONFIG.HEIGHT, backgroundColor: 0x0a0410, antialias: true });

  await loadAssets();

  HomeScreenPixi.build(textures, state);
  screenContainers.home = HomeScreenPixi.container;
  LevelsScreenPixi.build(textures, state);
  screenContainers.levels = LevelsScreenPixi.container;
  PlayScreenPixi.build(textures);
  HudPixi.build(textures);
  GameOverPixi.build(textures);
  // Both show/hide together with the play screen automatically by riding
  // along as its children — GameOverPixi added after HudPixi so it draws on
  // top (matches PlayScreen.draw()'s own order: HUD, then Game Over overlay).
  PlayScreenPixi.container.addChild(HudPixi.container, GameOverPixi.container);
  screenContainers.level1 = PlayScreenPixi.container;
  screenContainers.freeplay = PlayScreenPixi.container;
  for (const key in screenContainers) app.stage.addChild(screenContainers[key]);
  showScreen(state.screen);
  lastScreen = state.screen;

  app.ticker.add(tick);
}

main();
