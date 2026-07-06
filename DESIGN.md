# Lefa design system

Dark-only, terminal-native, built on the shadcn token model with Tailwind palette values.
Chosen 2026-07-06 in the design lab (`site/design/`) — the lab pages remain the living,
clickable reference; this file is the source of truth for the decisions.

## The system in one line

**Lime-400 on zinc, Geist everywhere, Geist Mono for the terminal voice, 0.5rem radius,
36px controls, 1.25 type scale.**

Lime is the personality bet: every dev tool is blue — lime-400 on near-black owns
"terminal phosphor" energy and is unmistakable in the agent space.

## Tokens — CSS variables

```css
:root {
  /* neutrals — Tailwind zinc */
  --background: #09090b;            /* zinc-950 */
  --foreground: #fafafa;            /* zinc-50 */
  --card: #18181b;                  /* zinc-900 */
  --card-foreground: #fafafa;
  --popover: #18181b;
  --secondary: #27272a;             /* zinc-800 */
  --secondary-foreground: #f4f4f5;  /* zinc-100 */
  --muted: #27272a;
  --muted-foreground: #a1a1aa;      /* zinc-400 */
  --faint: #71717a;                 /* zinc-500 */
  --border: #27272a;                /* zinc-800 */
  --input: #3f3f46;                 /* zinc-700 */

  /* accent — Tailwind lime */
  --primary: #a3e635;               /* lime-400 */
  --primary-foreground: #09090b;    /* lime is bright: dark text, always */
  --primary-hover: #bef264;         /* lime-300 */
  --primary-active: #84cc16;        /* lime-500 */
  --primary-soft: #a3e6351f;        /* 12% lime-400 — soft badges, selection */
  --ring: #84cc16;                  /* lime-500 focus rings */

  /* status */
  --destructive: #ef4444;           /* red-500 */
  --destructive-foreground: #ffffff;
  --success: #22c55e;               /* green-500 */

  /* shape + rhythm */
  --radius: 0.5rem;
  --radius-lg: 0.75rem;             /* cards, dialogs */
  --ctl-h: 36px;                    /* control height (inputs, buttons) */
  --ctl-px: 16px;                   /* control horizontal padding */
  --fs: 14px;                       /* base UI font size */
  --gap: 16px;                      /* default gap */
  --pad: 24px;                      /* card/section padding */

  /* type */
  --font-heading: "Geist", system-ui, sans-serif;
  --font-body: "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
  --scale: 1.25;
}
```

## Color rules

- **Lime always carries dark text** (`--primary-foreground: #09090b`) — never white on lime.
- Lime is for **actions and signals**: primary buttons, focus rings, active states, links,
  "running" badges, the progress of things. Don't flood large surfaces with it; on a
  zinc-950 page a little lime goes a long way.
- Hover brightens (lime-300), press darkens (lime-500). Focus rings use lime-500 at 1px
  offset for contrast against both card and background.
- Destructive is red-500 with white text; success is green-500 — distinct from lime by
  role: lime = the brand acting, green = a state being ok.
- Neutrals are **zinc only**. No slate/gray mixing; the cool cast comes from lime's contrast.

## Typography

- **Geist** (400/500/600/700/800) for headings and body. Headings use `-0.02em` tracking.
- **Geist Mono** (400/500/600) for terminal output, code, keyboard shortcuts, metadata,
  machine names, and section labels — the terminal voice is a core part of the brand.
- Base UI size 14px; long-form body 16px. Type scale **1.25** from a 16px base:
  h4 20 · h3 25 · h2 31.3 · h1 39.1 (px, rounded).
- Mono section labels: 10.5px, uppercase, `0.09em` tracking, muted-foreground.

## Shape & rhythm

- Radius **0.5rem** on controls; **0.75rem** on cards and dialogs; 999px only for
  badges/pills/avatars.
- Controls are **36px** tall with 16px horizontal padding. Small 30px, large 44px.
- Card padding 24px; default gap 16px. Data-dense surfaces may drop to the "compact"
  density (32px controls, 13px text) per-surface, never globally.
- Borders are 1px zinc-800; inputs use zinc-700 to stand off the card.

## Components

Reference implementations live in `site/design/ds.css` and are demoed in
`site/design/components.html` (buttons, badges, forms, switches, tabs, tables, alerts,
dialog, skeleton, progress, tooltip, kbd, code block). Conventions:

- Button variants: primary / secondary / outline / ghost / destructive / link.
- One primary button per view. Secondary for the alternative, ghost for the quiet stuff.
- Alerts and soft badges use `--primary-soft` backgrounds with lime text.
- Code blocks are cards with Geist Mono at 12.5px, lime for highlights, muted for comments.

## Brand mark & cursor

- The mark: thin **pentagon around a dot** — `brand/lefa-mark-white.svg` (dark bg) and
  `brand/lefa-mark-black.svg` (light bg). Geometry is locked; scale, don't redraw.
- The live cursor (see `site/cursor-lab.html`, "Classic"): instant white dot, thin pentagon
  trailing at λ=6, spins 9s, glows, grows 1.35× on hover, shrinks 0.7× on click.
- **Open decision**: the cursor's surround is currently `#4d9fff` (blue), chosen before the
  lime accent. Consider re-tinting the cursor to lime-400 so pointer and UI accent are one
  color — decide when applying this system to the landing page.
