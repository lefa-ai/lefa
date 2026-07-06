# Cursor-as-brand research

Deep research (2026-07-05, 20 sources fetched, 25 claims adversarially verified: 19 confirmed / 6 refuted)
into making the cursor Lefa's main personality element and logo motif. Prototypes live in
[`site/cursor-lab.html`](../site/cursor-lab.html).

## Confirmed findings (survived 3-0 adversarial verification)

### Precedents — the move works

- **Cursor (Anysphere)** uses a cursor-inside-a-cube as its actual logomark (originally by Ben Barry,
  refined — not replaced — by Kimera in 2025). Key lesson from Kimera's founder: mathematically perfect
  isometric pointer geometry "is very difficult on screen, especially in small sizes" — they had to
  **round the corners and add a visible gap** between cursor and cube.
  ([The Brand Identity](https://the-brandidentity.com/project/how-kimera-built-cursors-identity-around-a-custom-typeface-system), [cursor.com/brand](https://cursor.com/brand))
- **Coder's 2025 rebrand** (Together, London) is anchored by "Blink", a mascot derived from the blinking
  *caret* — and it's systematized into **behavioral states** (typing in docs, emoji-like reactions,
  welcoming guide) rather than a static mark. Since Blink is a caret, the *mouse-pointer*-as-mascot
  space is less crowded than it looks.
  ([The Brand Identity](https://the-brandidentity.com/project/together-transforms-the-blinking-cursor-into-coders-welcoming-mascot))
- **Figma** frames the multiplayer cursor as a presence and *communication* device — users wave it and
  point with it ("we show the cursor and selection of all active participants because it provides
  important context" — Evan Wallace). Direct precedent for Lefa's "agent's cursor on your machine".
  ([Figma blog](https://www.figma.com/blog/multiplayer-editing-in-figma/))
- **"Matching luggage"**: repeat one brand shape as nav icon + page decoration + cursor
  (Sara Menendez portfolio precedent, archival). ([Wix Studio](https://www.wix.com/studio/blog/custom-cursor-examples))
- Custom cursor craft is formally catalogued: Awwwards' official "Hovers, Cursors and Cute Interactions"
  collection (466 items as of 2026-07-05); studios to study: Jomor Design, fil studio, Ideology, Exo Ape.
  ([Awwwards](https://www.awwwards.com/awwwards/collections/hovers-cursors-and-cute-interactions/))

### Engineering — verified constraints and patterns

- **The CSS `cursor` property is a dead end for the hero cursor**: Firefox/Chromium cap images at
  128×128 (32×32 recommended), silently ignore oversized images, and the spec only *requires*
  non-animated formats. All serious brand cursors are JS-rendered DOM/canvas elements.
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/cursor), [css-ui-4](https://drafts.csswg.org/css-ui-4/#cursor))
- **Performance pattern**: position updates in a `requestAnimationFrame` loop (not per mousemove),
  cache element bounds instead of calling `getBoundingClientRect` per move, early-exit outside
  interaction thresholds. ([100daysofcraft](https://www.100daysofcraft.com/blog/motion-interactions/building-a-magnetic-cursor-effect), [Paul Irish](https://gist.github.com/paulirish/5d52fb081b3570c81e3a))
- **Lerp ~0.15/frame** is the corroborated smoothing sweet spot — but it's frame-rate dependent
  (snappier at 120Hz), so use time-corrected damping. The lab uses
  `damp = 1 - exp(-λ·dt)` with λ ≈ 10 ≙ 0.15 @ 60fps.
- **Hover weight-inversion** (single practitioner source, pattern corroborated; numbers are starting
  points): dot scales ~2.5× and hollows, ring shrinks ~0.4× at 0.3 opacity.
  ([Silvestri](https://javiersilvestri.vercel.app/posts/custom-cursor-animation))
- **Remote/agent cursors need spline interpolation** — direct position updates jump; naive CSS
  transitions stall between inexact intervals. The perfect-cursors technique animates along a spline
  of connected curves (cost: one-update delay).
  ([perfect-cursors](https://github.com/steveruizok/perfect-cursors), [Liveblocks](https://liveblocks.io/blog/how-to-animate-multiplayer-cursors))
- **Gooey/organic deformation needs no WebGL**: SVG filters (feGaussianBlur + feColorMatrix) + blend
  modes, per Codrops' Gooey Cursor (2023). Fullscreen crosshair = the precision archetype (Codrops 2021).
  ([Codrops](https://tympanus.net/codrops/2023/06/07/gooey-cursor-effect/))
- Figma-style remote cursor convention: arrow SVG + name label pill, deterministic per-user color
  applied to both. ([mskelton](https://mskelton.dev/blog/building-figma-multiplayer-cursors))

## Refuted claims (do not build on these)

- ~~"Custom cursors don't render on touch devices"~~ (0-3) — don't design on that assumption.
- ~~"The cursor is the most persistent visual element"~~ (0-3) — nice rationale, unsupported.
- ~~Derived timing math ("0.14 lerp → 99% in 50ms")~~ (0-3), ~~50-80ms service throttle~~ (1-2),
  ~~magnetic strength 0.05–0.18 range~~ (0-3) — all numeric folklore; tune empirically.

## Accessibility notes (from sources; not formally verified — treat as design guidance)

- Custom CSS cursors override OS-level cursor accessibility settings (size/contrast) on Windows;
  macOS scales them. JS cursors that hide the native pointer have the same failure mode — production
  should keep the effect **opt-out-able**, honor `prefers-reduced-motion`, and never hide the native
  cursor before the replacement is visible. ([dbushell](https://dbushell.com/2025/10/27/custom-cursor-accessibility/), [Eric Bailey](https://ericwbailey.website/published/dont-use-custom-css-mouse-cursors/))

## Open questions

- Perceptual latency thresholds for cursor lag (when does smoothing feel "broken"?) — no verified data.
- How Cursor.com / Linear / gaming sites implement their live cursors today — no claims survived.
- Verified color/label/throttle conventions for Google Docs / Liveblocks remote cursors.
- How an *AI agent's* cursor should differ visually from a human collaborator's — unexplored territory
  (opportunity for Lefa to define the convention).

## Prototype mapping (see cursor-lab.html)

| # | Prototype | Personality | Research ingredients |
|---|-----------|-------------|----------------------|
| 1 | Beacon | calm precision | dot+ring, weight-inversion hover, λ-damped trail |
| 2 | Arrow | the mark itself | rounded-corner pointer (Kimera lesson), matching luggage, velocity lean |
| 3 | Reticle | precision instrument | fullscreen crosshair archetype + a11y-inspector element lock (Lefa's own story) |
| 4 | Iris | perception, "eyes" | mascot with behavioral states (Blink template): blink, track, dilate, wink |
| 5 | Caret | terminal culture | caret-derived mark (Coder precedent), idle blink, velocity skew |
| 6 | Plasma | playful energy | SVG-filter goo trail, no WebGL (Codrops) |
| 7 | Ghost | autonomy — the product | second labeled agent cursor, spline-smoothed autopilot, Figma presence conventions |
