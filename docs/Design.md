# Design

Kleopolis is a minimalist real-time strategy game built around precision,
clarity and competitive depth. Every element on screen has a purpose.

## Product principles

| Principle             | In practice                                                           |
| --------------------- | --------------------------------------------------------------------- |
| Minimalism            | No unnecessary overlays, popups, currencies, animations or clutter    |
| Determinism           | Combat and economy follow transparent, testable rules                 |
| Precision             | Commands do exactly what the player expects, with clear feedback      |
| Competitive integrity | Consistent tick simulation, fair matchmaking, minimal randomness      |
| Performance           | Fast loading, fluid map rendering, responsive controls at high counts |

We do not prioritise battle passes, many game modes, cosmetic economies or
progression systems. A mechanic stays only if it adds strategic depth worth
its complexity. The bar: easy to learn, hard to master, never confusing
because of the software.

## Design system

One system for menus, modals, notifications and the in-game HUD. The look
takes its cues from Google Workspace (Gmail, Drive): flat tonal surfaces,
quiet hairlines, one accent, generous but fixed spacing.

### Tokens

Tokens live in `src/client/styles/menu-experience.css` (`--field-*`,
`--space-*`) and in the Tailwind `@theme` of `src/client/styles.css`. The
Tailwind scales are remapped onto the same steps, so a plain Tailwind class
always lands on a token.

| Group   | Steps                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface | `--field-ink` < `--field-surface` < `--field-raised` < `--field-hover` (night-blue tonal, gray-950 ... gray-700)                                                      |
| Text    | `--field-paper` (primary), `--field-muted` (secondary), `--field-faint` (disabled)                                                                                    |
| Accent  | `--field-accent` (#4b8bf5), `--field-accent-hover`, `--field-accent-soft`                                                                                             |
| Status  | `--field-danger`, `--field-success`, `--field-warning`, each with a `-soft` fill                                                                                      |
| Space   | 4px grid: 4, 8, 12, 16, 24, 32 (`--space-1..8`, Tailwind `1 2 3 4 6 8`)                                                                                               |
| Radius  | 6px chips (`rounded-sm`), 8px buttons and inputs (`rounded-md`), 12px cards and modals (`rounded-lg`), 16px sheets (`rounded-xl`)                                     |
| Type    | Google Sans Flex, fallback Inter, then system sans. 12 / 14 / 16 / 18 / 22 / 28px (`text-xs` ... `text-2xl`). Body is 14px. Weights 400 and 500 only, 600 for titles. |

### Rules

- **No glows, no drop shadows.** All Tailwind shadow, drop-shadow and
  text-shadow tokens are `none`. Never write `box-shadow`, `text-shadow`
  or `filter: drop-shadow` with a blur. Focus uses a 2px accent outline.
- **Separation by surface and space, not borders.** A hairline
  (`--field-line`, 1px) only separates a header, a footer or list rows.
  Cards and panels have no border; they sit on a surface one step up.
- **Status is a flat soft fill plus coloured text or icon.** A notice is
  `--field-*-soft` background, primary text, and a status icon. Never a
  coloured border, a coloured glow or a whole paragraph in a status colour.
- **One primary action per view.** Primary = accent fill, white text, 8px
  radius, 36px tall, sentence case. Secondary = `--field-raised` fill.
  Tertiary = text button in accent colour. No pill or uppercase buttons.
- **Selected states are filled, not tinted.** A selected segment is an
  accent fill with white text; a selected card gets a 2px accent outline.
- **Spacing:** 8px between a label and its control, 16px between controls
  in a group, 24px between groups, 24px modal padding. Text never touches a
  control: helper text sits 8px above or below.
- **Layout:** controls of the same kind share a row on desktop (for
  example two sliders side by side) and stack below 640px.
- **Icons:** Lucide only (`lucide-static`, via `menuIcon()`/`uiIcon()`),
  1.75px stroke, 16px inline, 20px in toolbars. No pixel-art or raster
  icons in the DOM.
- **Text:** sentence case, no uppercase labels, tabular figures for
  numbers.
- **Motion:** 150ms colour and opacity transitions only.

## In-game rendering

- Territory fills and borders follow smooth curves through the tile grid
  when zoomed in (`shaders/shared/smooth-owner.glsl`, toggled by
  `mapOverlay.smoothEdges`). Far out they fall back to whole tiles.
- Terrain uses a muted palette (`terrain.*` in `render-settings.json`) so
  player colours carry the information.
- Tailwind's gray and slate scales are remapped to the night-blue tonal
  scale in `styles.css`, so the HUD and the menus share one set of surfaces.
