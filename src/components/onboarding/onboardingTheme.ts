/**
 * Shared class vocabulary for the AgentFlow onboarding wizard ("Focused Console").
 *
 * Scoped to `/onboarding` only — deliberately NOT a general design framework and
 * deliberately NOT imported from `src/components/auth/authTheme.ts`. The auth
 * pages are shipped and must not move when onboarding is tuned, so the small
 * amount of visual overlap (the blue → violet primary gradient) is duplicated on
 * purpose rather than shared.
 *
 * The wizard renders dark regardless of the app theme (`defaultTheme` is
 * `light`), so these are explicit palette literals, not semantic tokens.
 * `OnboardingShell` additionally scopes `.dark` so shadcn primitives rendered
 * inside the card resolve their dark values.
 */

/** Card surface: dark navy face, slate border, restrained static shadow. */
export const ONBOARDING_CARD_CLASS =
  "overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900 shadow-[0_10px_40px_rgba(0,0,0,0.65)]";

/** Static top highlight hairline sitting inside the card's top edge. */
export const ONBOARDING_HAIRLINE_CLASS =
  "h-px w-full bg-gradient-to-r from-transparent via-blue-500/40 to-transparent";

/** Step heading (`<h1>`). */
export const ONBOARDING_HEADING_CLASS = "text-2xl font-bold tracking-tight text-white sm:text-[1.75rem]";

/** Supporting copy under the step heading. */
export const ONBOARDING_SUBHEADING_CLASS = "text-sm leading-relaxed text-slate-300";

/** Field label — small, uppercase, tracked. */
export const ONBOARDING_LABEL_CLASS = "text-xs font-medium uppercase tracking-wider text-slate-400";

/** Helper text under a field. */
export const ONBOARDING_HELPER_CLASS = "text-xs leading-relaxed text-slate-400";

/** Inline field-level validation message. */
export const ONBOARDING_ERROR_CLASS = "flex items-start gap-1.5 text-xs text-rose-300";

/** Input / select-trigger surface. Overrides the light defaults baked into shadcn. */
export const ONBOARDING_FIELD_CLASS =
  "h-11 w-full rounded-xl border-slate-600/60 bg-slate-950/80 text-slate-100 ring-offset-slate-900 placeholder:text-slate-500 focus-visible:border-blue-400/70 focus-visible:ring-blue-500/70 focus:border-blue-400/70 focus:ring-blue-500/70 disabled:opacity-60";

/** Applied to a field that failed validation — paired with text, never colour alone. */
export const ONBOARDING_FIELD_INVALID_CLASS = "border-rose-500/70 focus-visible:ring-rose-500/60 focus:ring-rose-500/60";

/**
 * Portal-rendered surfaces (Radix Select / Popover content) mount on `document.body`,
 * outside the shell's `.dark` scope, so they carry their own `dark` class plus
 * explicit slate values.
 */
export const ONBOARDING_POPOVER_CLASS = "dark border-slate-700 bg-slate-900 text-slate-100";

/** Focus ring for bespoke (non-shadcn) interactive elements on the card surface. */
export const ONBOARDING_FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900";

/** Primary call to action — restrained static blue → violet gradient, colour transitions only. */
export const ONBOARDING_PRIMARY_BUTTON_CLASS =
  "h-11 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-sm font-semibold tracking-wide text-white shadow-lg shadow-blue-950/60 ring-offset-slate-900 transition-colors hover:from-blue-500 hover:via-indigo-400 hover:to-violet-400 focus-visible:ring-blue-400 disabled:opacity-60";

/** Secondary / Back button. */
export const ONBOARDING_SECONDARY_BUTTON_CLASS =
  "h-11 rounded-xl border-slate-600/60 bg-transparent text-sm font-medium text-slate-200 ring-offset-slate-900 transition-colors hover:bg-slate-800 hover:text-white focus-visible:ring-blue-400 disabled:opacity-40";

/** Quiet header action (sign out). */
export const ONBOARDING_QUIET_BUTTON_CLASS =
  "h-8 rounded-lg px-2.5 text-xs font-medium text-slate-400 ring-offset-slate-900 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:ring-blue-400 disabled:opacity-40";
