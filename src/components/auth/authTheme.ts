/**
 * Shared class vocabulary for the AgentFlow authentication pages.
 *
 * Scoped to auth pages only — not a general design framework. These pages render
 * dark regardless of the app theme (the app's `defaultTheme` is `light`), so the
 * values are explicit palette literals rather than semantic tokens. `AuthShell`
 * additionally sets `.dark` so any shadcn primitive used inside resolves dark.
 *
 * Palette: solid black page, dark navy card (`slate-900` surface), blue accents
 * with restrained violet reserved for the primary-action gradient. Focus-ring
 * offsets are re-based to `slate-900` because every control sits on the card.
 */

/** Input/select surface. Overrides the light defaults baked into shadcn `Input`. */
export const AUTH_FIELD_CLASS =
  "h-12 rounded-xl border-slate-700 bg-slate-950/60 text-slate-100 ring-offset-slate-900 placeholder:text-slate-500 focus-visible:border-blue-500/60 focus-visible:ring-blue-500/60 disabled:opacity-60";

/** Inline text link (forgot password, sign up, back to login). */
export const AUTH_LINK_CLASS =
  "rounded text-blue-400 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900";

/** Field label — small, uppercase, tracked. */
export const AUTH_LABEL_CLASS = "text-xs font-medium uppercase tracking-wider text-slate-400";

/** Page heading (`<h1>`). */
export const AUTH_HEADING_CLASS = "text-3xl font-semibold tracking-tight text-white";

/** Supporting copy under the heading. */
export const AUTH_SUBHEADING_CLASS = "text-sm text-slate-400";

/** Inline field-level validation message. */
export const AUTH_FIELD_ERROR_CLASS = "text-xs text-rose-300";

/** Focus ring for bespoke (non-shadcn) interactive elements on the card surface. */
export const AUTH_FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900";
