// Leaderboard kit for Potion Machine + Monster Smash.
//
// Shared, self-contained: drop lb-kit.js + lb-kit.css into a game, load the three
// Firebase "compat" scripts before it (app, auth, firestore — see demo.html), then:
//
//   LB.init('potion');                       // or 'monster'
//   const me = await LB.getPlayer();         // { uid, name } — name is null until picked
//   const name = await LB.showPicker();      // spin-a-name overlay; resolves name or null
//   await LB.submitScore(1234);              // keeps only the best score per week/month
//   const boards = await LB.getBoards();     // { thisWeek, lastWeek, monthly, resetsIn }
//
// No logins: Firebase anonymous auth gives each browser an invisible ID (uid).
// The Firestore rules (firestore.rules) only accept names built from the word lists
// below, only let a player write their own rows, and only let scores go UP.
// Weeks run Monday 00:00 → Sunday 23:59 Pacific; months are Pacific calendar months.
(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAYCd20Y8jb6DEgKGWQhce9Ss_B2T6mZXc',
    authDomain: 'spooky-maze-23c05.firebaseapp.com',
    projectId: 'spooky-maze-23c05',
    storageBucket: 'spooky-maze-23c05.firebasestorage.app',
    messagingSenderId: '196581997603',
    appId: '1:196581997603:web:eac267552f853343d98596',
  };

  // Must match firestore.rules exactly (Rob approved these lists 2026-09-26).
  const DESCRIBING = ['Sneaky','Giggly','Spooky','Sleepy','Grumpy','Jolly','Brave','Clever','Silly','Wiggly',
    'Bouncy','Zippy','Sparkly','Fuzzy','Mighty','Tiny','Jumpy','Dizzy','Cheery','Breezy',
    'Lucky','Witty','Swift','Bubbly','Glowing','Dazzling','Cozy','Wacky','Mystic','Cosmic',
    'Magic','Stormy','Merry','Peppy','Fancy','Speedy','Snazzy','Loopy','Curious','Starry'];
  const COLORS = ['Purple','Green','Orange','Silver','Golden','Pink','Teal','Violet','Lime','Ruby',
    'Emerald','Sapphire','Copper','Minty','Rainbow'];
  const CREATURES = ['Goblin','Ghost','Bat','Pumpkin','Spider','Owl','Cat','Wolf','Witch','Wizard',
    'Zombie','Mummy','Skeleton','Vampire','Werewolf','Ghoul','Alien','Phoenix','Gremlin','Dragon',
    'Toad','Unicorn','Raven','Crow','Monster','Phantom','Genie','Scarecrow','Cauldron','Potion',
    'Broom','Candle','Lantern','Moonbeam','Slime','Blob','Yeti','Kraken','Gargoyle','Pixie'];

  // First month with leaderboards — Monthly Winners lists from here to now.
  const FIRST_MONTH = '2026-09';
  const TZ = 'America/Los_Angeles';

  let game = null, db = null, auth = null;
  let userPromise = null;
  let player = null; // { uid, name, nameId }

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const nameIdFor = (name) => name.toLowerCase().replace(/ /g, '-');
  const cacheKey = () => 'lb-' + game + '-name';

  // ---------- Pacific calendar helpers ----------
  function pacificParts(date) {
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    return parts;
  }
  const pad = (n) => String(n).padStart(2, '0');
  // Pure calendar math on a y/m/d (no time zone involved), via UTC.
  function addDays(y, m, d, days) {
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

  // Week id = the Monday it started on ('YYYY-MM-DD'); weeksBack 1 = last week.
  function weekId(weeksBack = 0, now = new Date()) {
    const p = pacificParts(now);
    const mon = addDays(+p.year, +p.month, +p.day, -DOW[p.weekday] - 7 * weeksBack);
    return mon.y + '-' + pad(mon.m) + '-' + pad(mon.d);
  }
  function monthId(now = new Date()) {
    const p = pacificParts(now);
    return p.year + '-' + p.month;
  }
  // Milliseconds until next Monday 00:00 Pacific (close enough across DST changes).
  function msUntilReset(now = new Date()) {
    const p = pacificParts(now);
    const secsIntoWeek = DOW[p.weekday] * 86400 + (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second);
    return (7 * 86400 - secsIntoWeek) * 1000;
  }
  function monthsSinceStart(now = new Date()) {
    const out = [];
    let [y, m] = FIRST_MONTH.split('-').map(Number);
    const [ey, em] = monthId(now).split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      out.push(y + '-' + pad(m));
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  function monthLabel(id) {
    const [y, m] = id.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // ---------- Firebase ----------
  function init(gameId) {
    if (gameId !== 'potion' && gameId !== 'monster') throw new Error('LB.init: unknown game ' + gameId);
    game = gameId;
    if (!window.firebase) { console.warn('[LB] Firebase scripts not loaded — leaderboard disabled'); return; }
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
    db = app.firestore();
    auth = app.auth();
  }
  const ref = (path) => db.doc('lb/' + game + '/' + path);
  const col = (path) => db.collection('lb/' + game + '/' + path);

  // Resolves once Firebase has restored any saved ID (user or null). Signing in
  // before that finishes would mint a brand-new player and orphan their old name.
  let restoredPromise = null;
  function authRestored() {
    if (!auth) return Promise.resolve(null);
    if (!restoredPromise) {
      restoredPromise = new Promise((resolve) => {
        const off = auth.onAuthStateChanged((user) => { off(); resolve(user); });
      });
    }
    return restoredPromise;
  }

  // Signs in anonymously if needed (Firebase remembers the ID in this browser).
  // Always returns auth.currentUser: another page on the same site can swap the
  // shared ID underneath us, so never trust an older cached user object.
  async function ensureUser() {
    if (!auth) throw new Error('Leaderboard unavailable');
    await authRestored();
    if (auth.currentUser) return auth.currentUser;
    if (!userPromise) {
      userPromise = auth.signInAnonymously()
        .then((cred) => cred.user)
        .finally(() => { userPromise = null; });
    }
    await userPromise;
    return auth.currentUser;
  }

  // The current player's ID WITHOUT creating one — for read-only pages like
  // the leaderboard pop-up, which must never sign anyone in.
  async function peekUid() {
    await authRestored();
    return auth && auth.currentUser ? auth.currentUser.uid : null;
  }

  function cachedName() {
    try { return localStorage.getItem(cacheKey()); } catch (e) { return null; }
  }
  function cacheName(name) {
    try { localStorage.setItem(cacheKey(), name); } catch (e) {}
  }

  // The player's name, from Firestore (the real record), falling back to cache offline.
  async function getPlayer() {
    try {
      const user = await ensureUser();
      if (player && player.uid === user.uid) return player;
      const snap = await ref('players/' + user.uid).get();
      player = snap.exists
        ? { uid: user.uid, name: snap.data().name, nameId: snap.data().nameId }
        : { uid: user.uid, name: null, nameId: null };
      if (player.name) cacheName(player.name);
      return player;
    } catch (e) {
      console.warn('[LB] getPlayer failed', e);
      return { uid: null, name: cachedName(), nameId: null };
    }
  }

  // A random name nobody in this game has taken yet.
  async function spinName() {
    for (let tries = 0; tries < 12; tries++) {
      const name = pick(DESCRIBING) + ' ' + pick(COLORS) + ' ' + pick(CREATURES);
      const snap = await ref('names/' + nameIdFor(name)).get();
      if (!snap.exists) return name;
    }
    throw new Error('Could not find a free name');
  }

  // Reserve the name and make it this player's current name, in one step.
  async function claimName(name) {
    const user = await ensureUser();
    const nameId = nameIdFor(name);
    const batch = db.batch();
    batch.set(ref('names/' + nameId), { name, uid: user.uid });
    batch.set(ref('players/' + user.uid), { name, nameId });
    await batch.commit(); // rules reject it if someone grabbed the name first
    player = { uid: user.uid, name, nameId };
    cacheName(name);
    return name;
  }

  // Saves the score to this week's and this month's board — only where it beats
  // the player's existing best there. Resolves { week: bool, month: bool } for "new best!".
  async function submitScore(rawScore) {
    const score = Math.floor(rawScore);
    const result = { week: false, month: false };
    if (!(score > 0)) return result;
    const me = await getPlayer();
    if (!me.uid || !me.name) return result;
    const now = new Date();
    const targets = [
      ['week', ref('weeks/' + weekId(0, now) + '/scores/' + me.uid)],
      ['month', ref('months/' + monthId(now) + '/scores/' + me.uid)],
    ];
    const data = { name: me.name, nameId: me.nameId, score, at: firebase.firestore.FieldValue.serverTimestamp() };
    await Promise.all(targets.map(async ([key, docRef]) => {
      try {
        const snap = await docRef.get();
        if (snap.exists && snap.data().score >= score) return;
        await docRef.set(data);
        result[key] = true;
      } catch (e) { console.warn('[LB] submit ' + key + ' failed', e); }
    }));
    return result;
  }

  async function topOf(collectionPath, n) {
    const snap = await col(collectionPath).orderBy('score', 'desc').limit(n).get();
    return snap.docs.map((d) => ({ uid: d.id, name: d.data().name, score: d.data().score }));
  }

  async function getBoards() {
    const now = new Date();
    const months = monthsSinceStart(now).reverse(); // newest first
    const [thisWeek, lastWeek, monthly] = await Promise.all([
      topOf('weeks/' + weekId(0, now) + '/scores', 10),
      topOf('weeks/' + weekId(1, now) + '/scores', 3),
      Promise.all(months.map(async (m) => {
        const top = await topOf('months/' + m + '/scores', 1);
        return top.length ? { month: m, label: monthLabel(m), current: m === monthId(now), ...top[0] } : null;
      })),
    ]);
    return { thisWeek, lastWeek, monthly: monthly.filter(Boolean), resetsIn: msUntilReset(now) };
  }

  // ---------- Name picker overlay: a three-reel "slot machine" ----------
  // One reel per word list (describing / color / creature). Each reel loops
  // forever: swipe or scroll it (native scroll + snap), tap ▲/▼ to move one
  // word, or long-press ▲/▼ to spin it. New players start with one opening
  // spin to a random free name. The name above the reels live-checks whether
  // it's still available. Resolves the chosen name, or null on "Skip".
  const ROW = 40;     // px per reel row (must match .lb-reel-item height in CSS)
  const COPIES = 5;   // word list repeated 5x; we always sit in the middle copy

  function makeReel(words, label, onSettle) {
    const n = words.length;
    const el = document.createElement('div');
    el.className = 'lb-reel';
    el.innerHTML =
      '<button type="button" class="lb-arrow" aria-label="Previous ' + label + '">▲</button>' +
      '<div class="lb-reel-view" role="listbox" aria-label="' + label + '" tabindex="0"></div>' +
      '<button type="button" class="lb-arrow" aria-label="Next ' + label + '">▼</button>';
    const view = el.querySelector('.lb-reel-view');
    const items = [];
    for (let c = 0; c < COPIES; c++) {
      words.forEach((w) => {
        const d = document.createElement('div');
        d.className = 'lb-reel-item';
        d.textContent = w;
        view.appendChild(d);
        items.push(d);
      });
    }
    let animating = false, animToken = 0, settleTimer = 0, lit = null;

    // Row index of whichever item sits in the middle (highlight) slot.
    const centered = () => Math.round(view.scrollTop / ROW) + 1;
    const scrollFor = (row) => (row - 1) * ROW;

    function light(row) {
      if (lit) lit.classList.remove('on');
      lit = items[row];
      if (lit) lit.classList.add('on');
    }
    // Quietly hop back into the middle copy so the loop never runs out.
    function recenter() {
      const row = centered(), k = ((row % n) + n) % n;
      const mid = 2 * n + k;
      if (row !== mid) view.scrollTop = scrollFor(mid);
      light(mid);
      return k;
    }
    function settled() {
      if (animating) return;
      onSettle(words[recenter()]);
    }
    view.addEventListener('scroll', () => {
      if (animating) return;
      light(centered());
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settled, 130);
    }, { passive: true });

    // Eased scroll to a row (snap off while moving, so it glides like a reel).
    // A newer call takes over from an older one mid-glide (held arrows chain these).
    function animateTo(row, ms, ease = (t) => 1 - Math.pow(1 - t, 3)) {
      const token = ++animToken;
      return new Promise((done) => {
        animating = true;
        view.style.scrollSnapType = 'none';
        const from = view.scrollTop, to = scrollFor(row), t0 = performance.now();
        (function step(now) {
          if (token !== animToken) return done(); // superseded
          const t = Math.min(1, Math.max(0, (now - t0) / ms));
          view.scrollTop = from + (to - from) * ease(t);
          light(centered());
          if (t < 1) { requestAnimationFrame(step); return; }
          view.style.scrollSnapType = '';
          animating = false;
          settled();
          done();
        })(t0);
      });
    }

    // Arrows: tap = move one word; press and hold = keep spinning that way,
    // speeding up the longer it's held, until released.
    let target = 0, holdTimer = 0, holdDelay = 0;
    function nudge(dir, ms, ease) {
      target = (animating ? target : centered()) + dir;
      animateTo(target, ms, ease);
    }
    function startHold(dir) {
      stopHold();
      nudge(dir, 170);
      holdDelay = 140;
      holdTimer = setTimeout(function repeat() {
        nudge(dir, holdDelay, (t) => t); // linear while held, so it reads as a steady spin
        holdDelay = Math.max(55, holdDelay * 0.88);
        holdTimer = setTimeout(repeat, holdDelay);
      }, 380);
    }
    function stopHold() {
      if (!holdTimer) return;
      clearTimeout(holdTimer); holdTimer = 0;
      animateTo(target, 180); // ease into the final word
    }
    const [up, down] = el.querySelectorAll('.lb-arrow');
    [[up, -1], [down, 1]].forEach(([btn, dir]) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        startHold(dir);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => btn.addEventListener(ev, stopHold));
      btn.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menu on phones
    });
    view.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); nudge(-1, 160); }
      if (e.key === 'ArrowDown') { e.preventDefault(); nudge(1, 160); }
    });

    return {
      el,
      word: () => words[((centered() % n) + n) % n],
      // Jump straight to a word (no animation) — used before the first spin.
      set(word) { view.scrollTop = scrollFor(2 * n + Math.max(0, words.indexOf(word))); light(centered()); },
      // Slot-machine spin: at least one full loop, landing on `word`.
      spin(word, ms) {
        const row = centered(), k = ((row % n) + n) % n;
        const delta = (Math.max(0, words.indexOf(word)) - k + n) % n;
        return animateTo(row + n + delta, ms);
      },
    };
  }

  function showPicker(opts = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'lb-picker lb-theme-' + game;
      wrap.innerHTML =
        '<div class="lb-card" role="dialog" aria-modal="true" aria-labelledby="lb-title">' +
          '<h2 id="lb-title">' + (opts.title || 'Pick your spooky name!') + '</h2>' +
          '<p class="lb-sub">Swipe the wheels or hold the arrows to make your name.</p>' +
          '<div class="lb-name" aria-live="polite">…</div>' +
          '<div class="lb-status" aria-live="polite">&nbsp;</div>' +
          '<div class="lb-reels"></div>' +
          '<div class="lb-btns">' +
            '<button type="button" class="lb-later">Skip</button>' +
            '<button type="button" class="lb-keep" disabled>Keep it!</button>' +
          '</div>' +
        '</div>';
      (opts.container || document.body).appendChild(wrap);

      const nameEl = wrap.querySelector('.lb-name');
      const statusEl = wrap.querySelector('.lb-status');
      const keepBtn = wrap.querySelector('.lb-keep');
      let checkId = 0, available = false, claiming = false, spinning = false;

      const setStatus = (text, cls) => { statusEl.textContent = text; statusEl.className = 'lb-status ' + (cls || ''); };
      const close = (value) => { wrap.remove(); resolve(value); };
      const currentName = () => reels.map((r) => r.word()).join(' ');

      // Live availability check for whatever the reels show right now.
      async function check() {
        const name = currentName(), id = ++checkId;
        nameEl.textContent = name;
        available = false; keepBtn.disabled = true;
        setStatus('Checking…');
        try {
          const snap = await ref('names/' + nameIdFor(name)).get();
          if (id !== checkId) return; // reels moved again meanwhile
          if (player && player.nameId === nameIdFor(name)) { setStatus('That’s your name now', 'ok'); return; }
          available = !snap.exists;
          setStatus(available ? '✓ Available!' : 'Taken — change a word', available ? 'ok' : 'bad');
          keepBtn.disabled = !available || claiming || spinning;
        } catch (e) {
          if (id !== checkId) return;
          console.warn('[LB] name check failed', e);
          setStatus('Couldn’t reach the leaderboard. Check your connection.', 'bad');
        }
      }
      let checkTimer = 0;
      const onSettle = () => {
        if (spinning) return;
        clearTimeout(checkTimer);
        checkTimer = setTimeout(check, 60);
      };

      const reels = [
        makeReel(DESCRIBING, 'describing word', onSettle),
        makeReel(COLORS, 'color', onSettle),
        makeReel(CREATURES, 'creature', onSettle),
      ];
      const reelsEl = wrap.querySelector('.lb-reels');
      reels.forEach((r) => reelsEl.appendChild(r.el));

      async function spinAll() {
        spinning = true; keepBtn.disabled = true;
        setStatus('Spinning…');
        let name;
        try { name = await spinName(); } // a random name nobody has yet
        catch (e) { name = pick(DESCRIBING) + ' ' + pick(COLORS) + ' ' + pick(CREATURES); }
        const words = name.split(' ');
        await Promise.all(reels.map((r, i) => r.spin(words[i], 900 + i * 350)));
        spinning = false;
        check();
      }

      keepBtn.addEventListener('click', async () => {
        if (!available) return;
        claiming = true; keepBtn.disabled = true;
        try {
          close(await claimName(currentName()));
        } catch (e) {
          console.warn('[LB] claim failed', e);
          setStatus('Someone just grabbed that one — change a word!', 'bad');
          claiming = false;
        }
      });
      wrap.querySelector('.lb-later').addEventListener('click', () => close(null));

      // Start on the player's current name (if changing it); new players get a spin.
      const start = (player && player.name ? player.name : 'Spooky Purple Ghost').split(' ');
      reels.forEach((r, i) => r.set(start[i]));
      if (player && player.name) check(); else spinAll();
    });
  }

  // ---------- In-game leaderboard overlay ----------
  // Opens leaderboard.html (this game's board) in a pop-over with a close button.
  // boardUrl defaults to leaderboard.html next to lb-kit.js.
  function showBoard(opts = {}) {
    const script = document.querySelector('script[src*="lb-kit.js"]');
    const base = opts.boardUrl || (script ? script.src.replace(/lb-kit\.js.*$/, 'leaderboard.html') : 'leaderboard.html');
    const wrap = document.createElement('div');
    wrap.className = 'lb-board lb-theme-' + game;
    wrap.innerHTML =
      '<div class="lb-board-box">' +
        '<button type="button" class="lb-close" aria-label="Close leaderboard">✕</button>' +
        '<iframe title="Leaderboard" src="' + base + '?game=' + game + '"></iframe>' +
      '</div>';
    const close = () => wrap.remove();
    wrap.querySelector('.lb-close').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
  }

  window.LB = {
    showBoard,
    init, getPlayer, peekUid, spinName, claimName, submitScore, getBoards, showPicker,
    // exposed for the board page / testing
    _weekId: weekId, _monthId: monthId, _msUntilReset: msUntilReset,
  };
})();
