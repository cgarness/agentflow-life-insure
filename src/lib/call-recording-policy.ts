/**
 * Org-level "record calls" flag on `phone_settings.recording_enabled`.
 * Matches inbound TwiML (`!== false`) and Phone System settings: null/undefined means ON.
 */
export function isCallRecordingEnabledDb(value: boolean | null | undefined): boolean {
  return value !== false;
}
