/**
 * Stable `aria-describedby` wiring for onboarding fields.
 *
 * `OnboardingField` renders helper text as `${id}-helper` and the validation
 * message as `${id}-error`; controls point at whichever of those exist, in that
 * order, so a screen reader hears the guidance before the failure.
 */
export function describedBy(id: string, opts: { helper?: boolean; error?: boolean }): string | undefined {
  const ids = [opts.helper ? `${id}-helper` : null, opts.error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
