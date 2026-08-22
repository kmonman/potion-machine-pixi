# Potion Machine — "Pinball Expansion" Scoping Doc

Phase 1 (rendering foundation) is underway — see "Phase 1 progress" below. Decided
2026-08-22 during a performance conversation about the current single-platform game (see
CLAUDE.md's Backlog section and progress-log entries #71/#72 for how this came up).

## Phase 1 progress (as of 2026-08-22, first session)

Working in `html5-port-pixi/` (a duplicate of `html5-port/`, git remote deliberately
removed so this can never accidentally get pushed to the live repo — see the top of this
folder's git history). PixiJS added as a local file (`js/vendor/pixi.min.js`, jsdelivr's
pixi.js@8 build). Whole-canvas migration (Rob's call — one rendering system, not two
running side by side).

**Built and verified working, screen by screen:**
- **Home** (`js/pixi_home.js`) — full rebuild: background, logo, both mode buttons
  (interactive via Pixi's own pointer events, not manual hit-testing), instruction text,
  mute toggle (icon swaps correctly), name-warning/motion-permission text. Visually
  matches the live Canvas version.
- **Levels** (`js/pixi_levels.js`) — full rebuild: title, the 10-cell grid with
  correct unlocked/locked styling, Level 1 navigates in, Home navigates back.
- **Gameplay scene, partial** (`js/pixi_playscreen.js`) — fog parallax + vignette, the
  pole (sprite done, glow still too dim — needs a tuning pass), the platform bar
  (rotates correctly around the pivot), the **liquid** (rebuilt every frame from
  `Platform.liquidColumns`, using a Pixi mask for the clipping Canvas 2D did via
  `ctx.clip()`, a gradient fill, and a `screen`-blend shine layer — verified pooling
  correctly on both tilt directions), the glass shadow/highlight overlay, and the ball
  (position/rotation driven by the same unmodified `Physics` object as the live game).

- **Hinge glow + all 3 particle effects, and jet particle streams** (same session,
  second pass) — the dot/ring glow (rebuilt every frame since color/blur animate with
  touch state), HingeMagic, HingeSparks, and HingeBubbles all ported to a shared
  `_syncParticlePool` helper that reuses pooled Sprites and recolors via Pixi's native
  `.tint` instead of the old per-particle offscreen-canvas repaint trick — genuinely
  cheaper on the GPU, not just capped like the live version's fix. Jets' particle stream
  (not yet their base "nozzle" glow effect — aura/core/rays, still Canvas-only) ported
  the same way. Verified together in one scene (touching + a jet firing) with zero
  console errors across repeated update cycles.

- **HUD** (`js/pixi_hud.js`, new file) — score pill, potion-counter pill (with its
  reinforced blur-glow layer), mute button, and both Free Play blast buttons (ring +
  bottle + charge badge, with the pop in/out scale+fade animation). None of the dense
  geometry/oval-matching math got reimplemented — this reads `PlayScreen`'s (old ui.js)
  own already-computed `scorePillBtn`/`potionCounterBtn`/`muteBtn`/`blastLeftBtn`/
  `blastRightBtn` rects and state (`blastCharges`, `blastButtonsT`, `_scoreText()`,
  `_potionsMade()`) directly, since that math doesn't care how things get drawn. Built
  a reusable `buildTabularNumber()` helper (fixed-digit-pitch number display, porting
  ui.js's `drawTabularNumber`) as a pool of Text children instead of per-frame
  `fillText` calls. Verified: score/potion numbers render correctly, mute toggles the
  icon, and `fireBlast()` genuinely consumes a charge and kicks the ball (checked with
  physics frozen to rule out timing noise).

- **Game Over screen** (`js/pixi_gameover.js`, new file) — the board (with its
  transparent-interior glow frame), the "ball fell off" icon, the bubble-up effect
  (masked to a rect that shifts with score width, cropped from `BubblesFinal.png`'s
  sprite sheet via a Pixi sub-rectangle texture frame), the score text, the 3
  potion-fill icons, "GAME OVER" itself (a blurred tinted duplicate underneath for the
  glow, alpha driven by the same two-sine flicker formula as the ctx version — Pixi has
  no direct `shadowBlur` equivalent), and the bottom 3-button pill with real interactive
  hit-zones (Home/Retry/3rd, matching `PlayScreen.hitTest()`'s own third-split logic).
  Verified end to end: triggered a real game-over, confirmed the whole screen renders
  correctly (score, bubbles, 3 filled potions, glowing "GAME OVER", buttons), clicked
  Home and confirmed it navigates cleanly back.

- **Jet nozzle glow + pole brightness, the last two polish items** — the jet's base
  "nozzle" effect (aura, pulsing ring, spark rays, core) ported from
  `Difficulty.drawJets`, rebuilt every frame per jet as a small Graphics object inside
  a blurred+additive container (same pattern as the hinge dot/ring). The pole's glow
  switched from one blurred pass to the same two-pass technique (blurred layer + crisp
  solid layer on top) already working well on the hinge — the earlier single-pass
  version really was just under-tuned, not a wrong technique.

  **Verification detour worth recording:** the nozzle glow initially looked broken —
  a GPU pixel readback (`app.renderer.extract.pixels(app.stage)`) kept finding nothing
  but background color near the jet, even after accounting for the Browser-pane
  screenshot tool's one-action-behind lag (confirmed separately, real and consistent —
  worth remembering for future sessions in this environment). Chased it all the way to
  suspecting the radial `FillGradient` params, the `BlurFilter`, even a plain solid-color
  draw — none of which fixed it. Root cause: `extract.pixels(app.stage)` sizes its
  output to the *content bounds* of everything on stage, not the logical 720×1280
  canvas — so the manual `width/720`/`height/1280` scale factors used to convert a
  canvas coordinate into a pixel index were simply wrong, and every sample landed on
  the wrong spot. Extracting the specific display object directly
  (`extract.pixels(someObject)`, tightly cropped to *its own* bounds) instead of the
  whole stage sidesteps the ambiguity entirely — confirmed the real gradient-based
  glow was painting correctly (630 of 2304 sampled pixels had real alpha) the whole
  time. Nothing in the actual game code was ever broken.

**Phase 1 is feature-complete** — every screen (Home, Levels, gameplay, HUD, Game
Over) and every gameplay system (platform, liquid, ball, hinge glow + all 3 of its
particle effects, jets + their nozzle glow) is built and verified on Pixi, matching the
live Canvas version. Left before calling this done for real: a real side-by-side
comparison pass against the live game, including on Rob's phone, not just the desktop
preview — then decide when to start Phase 2 (the new platform mechanics).

**Two real bugs caught and fixed this session:**
1. The jet particle containers were built once in `build()` by mapping over
   `Difficulty.jets` — but that array starts empty and is only populated by
   `Difficulty.reset()` (called from `PlayScreen.enter()`, i.e. only once a run
   actually starts), which hadn't happened yet at boot time. Fixed by building from
   `JET_DEFS` (the fixed 4-entry source list) instead.
2. Bigger one: `PlayScreenPixi.update()` was calling `Platform.update()`/
   `Physics.update()`/`Fog.update()` directly — but the *real* single entry point is
   `PlayScreen.update()` (old ui.js), which calls all of those internally AND handles
   score accumulation, blast-charge thresholds, elapsed time, game-over detection, the
   blast buttons' pop-animation timer, and `Difficulty.update()` (tube/moon phase
   progression) — none of which had been running at all. Fixed by delegating to
   `PlayScreen.update(dt, tiltX)` wholesale instead of reimplementing its call list.

**Dev tooling note (recurring):** the Browser-pane preview caches by exact URL, same
issue CLAUDE.md already documents for the live project — a plain reload can silently
serve a stale page even after files change. Same fix: navigate to
`http://localhost:8645/?bust=<anything-new>` if a change doesn't seem to have taken
effect before assuming it's a real bug.

**Pattern being followed:** none of the underlying game logic (`physics.js`,
`platform.js`'s update methods, `difficulty.js`, `fog.js`) has been touched — only how
things get *drawn* changed, screen by screen, each one verified in the browser before
moving to the next (same screenshot-driven verification habit as the rest of this
project). `js/ui.js`'s old Canvas 2D draw methods for Home/Levels are now dead code,
left in place rather than deleted mid-rebuild; `PlayScreen`'s non-drawing methods
(`.enter()`, state fields) are still reused as-is since they're just state, not rendering.

## The vision (Rob's words)

More platforms, each with their own emitters/jets/other effects, where you shoot the
ball up higher to reach other levels/platforms — like a pinball machine. Likely shows
several platforms and their effects on screen at once (a pinball table shows the whole
playfield), not one section at a time.

## Why this needs its own foundation, not just a content addition

The current game already showed a real performance ceiling with just **one** platform's
worth of effects (up to ~430 particles alive at once when the hinge + several jets are
active together — see progress-log #71). A pinball table with multiple platforms each
running their own emitters, potentially several visible/active at once, would multiply
that load. The current rendering approach (plain Canvas 2D, with particles hand-tinted
via a slow per-particle offscreen-canvas trick) doesn't have headroom for that — it was
capped down to stay usable for the *current* single-platform game, not designed to scale
past it.

**Decision: build this on PixiJS instead of plain Canvas 2D.** Chosen over hand-rolling
raw WebGL because Rob's stated priority is specifically best performance *and*
best-looking emitters — PixiJS is a mature, GPU-batched 2D renderer built for exactly
this (particle-heavy 2D games), it's the same engine GDevelop's own runtime runs on, and
it already has solid tinting/blend-mode/filter support that would take real time to
hand-build correctly from scratch. The tradeoff (it's a dependency, not code Claude
wrote) is real but secondary to the stated priority.

## Two layers of scope — keep them separate

1. **Rendering foundation swap**: move the game (or at minimum its particle systems) from
   Canvas 2D to PixiJS.
2. **New game mechanics**: multiple platforms, the ball traveling between them, some kind
   of level/progression layout.

**These should not be built at the same time.** Recommended order: get the *rendering
foundation* swapped in first, with the *current single-platform game* as the test case —
i.e., rebuild what already exists (one platform, one hinge, up to 4 jets, the hinge
bubbles) on PixiJS and confirm it looks the same or better and performs well, before
building any new platforms on top of it. Building new mechanics on the old foundation
and then redoing the rendering right after would mean doing real work twice.

## Rough phase breakdown (not a committed plan yet — needs Rob's sign-off before starting)

**Phase 1 — Rendering foundation, no new gameplay:**
- Add PixiJS to the project.
- Decide: does Pixi take over the *whole* canvas (platform, liquid, ball, HUD, buttons,
  everything), or does it run particles-only on a layer stacked over the existing Canvas
  2D game? (Whole-canvas is more consistent long-term; particles-only is a smaller,
  lower-risk first step. Worth deciding explicitly rather than assuming.)
- Rebuild the particle systems (jets, HingeMagic, HingeSparks, HingeBubbles) on Pixi's
  particle/sprite system, matching current look and feel.
- If going whole-canvas: also rebuild the platform, liquid, ball, hinge glow, HUD, and
  Game Over screen on Pixi.
- Side-by-side comparison against the current build (screenshots, live testing) until
  it's confirmed to look right and perform well, including on Rob's actual phone —
  not just the desktop preview, since that's exactly the kind of gap that caused this
  whole investigation.

**Phase 2 — New platform mechanics (not scoped in detail yet):**
Needs real design decisions before implementation starts, e.g.:
- How many platforms, how are they laid out (fixed hand-authored positions vs.
  procedural)?
- How does the ball get from one platform to another — jets only, or a new launch
  mechanic?
- Does the camera stay fixed (see the whole table at once) or move/follow the ball?
- Does each platform need its own hinge-style scoring spot, or is scoring different
  per platform?
- What's the win/progression condition — reach the top platform? Score threshold per
  platform? Something else?
- New art assets needed for additional platform types/decorations.

## Open questions for Rob before Phase 1 starts
1. Whole-canvas Pixi migration, or particles-only to start?
2. Any timeline/priority relative to the current game's remaining backlog (Level 2-10,
   the Firebase leaderboard — see CLAUDE.md Stage 6)?
3. Should this live as a new folder/branch alongside `html5-port/`, or evolve in place?
