// Online leaderboard — thin Potion-specific wrapper around the shared kit in
// leaderboard/lb-kit.js (Firebase: spooky-maze project, anonymous players,
// three-word names from a picker, weekly boards reset Sunday midnight Pacific,
// plus Last Week's Top 3 and Monthly Winners). The kit's master copy lives in
// C:\Users\Rob\Trend_Engine\leaderboard — edit it there and copy it over.
//
// Naming: no typing and never required to play. First-time visitors get the
// name picker on the Home screen; if they skip it ("Not now"), they're offered
// it again when a Free Play run ends. The Home name box shows the chosen name,
// and tapping it opens the picker to change it.
//
// Only Free Play scores go on the leaderboard. If Firebase can't load (offline,
// blocked), every call here quietly does nothing and the game plays on.
const Leaderboard = {
  _ready: false,
  _picking: false,

  init() {
    if (typeof LB === 'undefined' || typeof firebase === 'undefined') return;
    try { LB.init('potion'); this._ready = true; } catch (e) { console.warn('[leaderboard] init failed', e); }
  },

  _showName(name) {
    state.playerName = name || '';
    nameInput.value = state.playerName;
  },

  // Opens the picker (one at a time); resolves the new name or null.
  async _openPicker(title) {
    if (!this._ready || this._picking) return null;
    this._picking = true;
    try {
      const name = await LB.showPicker(title ? { title } : {});
      if (name) this._showName(name);
      return name;
    } finally {
      this._picking = false;
    }
  },

  // On game start: show the saved name, or greet first-timers with the picker.
  async loadName() {
    if (!this._ready) return;
    try {
      const me = await LB.getPlayer();
      if (me.name) { this._showName(me.name); return; }
      if (state.screen === 'home') await this._openPicker('Pick your spooky name!');
    } catch (e) {
      console.warn('[leaderboard] loadName failed', e);
    }
  },

  // Tapping the Home name box.
  pickName() {
    this._openPicker(state.playerName ? 'Pick a new spooky name!' : 'Pick your spooky name!');
  },

  // Called once when a Free Play run ends. Players who skipped naming get the
  // picker again (after the game-over screen has popped in); then the score is
  // sent. "Not now" just skips it — the next run will offer the picker again.
  async submitFreePlayScore(score) {
    if (!this._ready || !(score > 0)) return;
    try {
      const me = await LB.getPlayer();
      if (!me.name) {
        await new Promise((r) => setTimeout(r, 1200));
        if (!(await this._openPicker('Get on the leaderboard!'))) return;
      }
      await LB.submitScore(score);
    } catch (e) {
      console.warn('[leaderboard] submit failed', e);
    }
  },

  // The Free Play game-over screen's leaderboard icon.
  showBoard() {
    if (!this._ready) return false;
    LB.showBoard();
    return true;
  },
};

Leaderboard.init();
