/**
 * Inbound Calling v2 — voicemail playback URL lifetime (corrective pass, defect 7). Signed URLs for the
 * private bucket expire after PLAYBACK_URL_TTL_MS; a URL older than the TTL minus a safety margin must be
 * refreshed BEFORE playback starts, and a media error on an aged URL is retried once with a fresh one.
 */
export const PLAYBACK_URL_TTL_MS = 5 * 60 * 1000;
export const PLAYBACK_URL_REFRESH_MARGIN_MS = 45 * 1000;

export function isPlaybackUrlStale(issuedAtMs: number | null, nowMs: number): boolean {
  if (issuedAtMs === null) return true;
  return nowMs - issuedAtMs >= PLAYBACK_URL_TTL_MS - PLAYBACK_URL_REFRESH_MARGIN_MS;
}
