// Small wrapper around localStorage — replaces the original GDevelop project's
// "PotionGameSave" file storage (EcrireFichierTxt / ReadStringFromStorage).
const Storage = {
  KEY: 'potionMachineSave',

  _read() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  },

  _write(data) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(data));
    } catch (e) {
      // Storage unavailable (private browsing, quota, etc.) — fail silently,
      // the game still works, it just won't remember progress next visit.
    }
  },

  getHighestLevelUnlocked() {
    return this._read().highestLevelUnlocked || 1;
  },

  setHighestLevelUnlocked(level) {
    const data = this._read();
    data.highestLevelUnlocked = Math.max(data.highestLevelUnlocked || 1, level);
    this._write(data);
  },

  getMuted() {
    return !!this._read().muted;
  },

  setMuted(muted) {
    const data = this._read();
    data.muted = muted;
    this._write(data);
  },

  // Rob: "all of a sudden the ball is moving in reverse left when it
  // should go right and vice versa" (portrait mode) — deviceorientation's
  // gamma sign can genuinely read backwards on some phones/OS versions,
  // and there's no reliable way to auto-detect that from here (nothing in
  // this codebase changed to cause it — it's the sensor's own report).
  // A manual toggle is the one fix guaranteed to work regardless of the
  // actual cause, and persists per-device like mute does.
  getTiltInverted() {
    return !!this._read().tiltInverted;
  },

  setTiltInverted(inverted) {
    const data = this._read();
    data.tiltInverted = inverted;
    this._write(data);
  },
};
