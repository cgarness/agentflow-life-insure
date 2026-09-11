import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Voicemail } from "lucide-react";
import {
  fetchVoicemail,
  formatVoicemailDuration,
  getVoicemailPlaybackUrl,
  markVoicemailListened,
  type VoicemailRow,
} from "@/lib/voicemails";
import { PLAYBACK_URL_TTL_MS, isPlaybackUrlStale } from "@/lib/voicemailPlayback";

interface VoicemailPlayerProps {
  voicemailId: string;
  compact?: boolean;
  className?: string;
  /** Called after listened_at is stamped (first successful playback start). */
  onListened?: () => void;
}

/** Automatic URL refreshes after media errors, per mount — never reset by a transient `playing`. */
export const MAX_AUTO_REFRESHES_AFTER_ERROR = 2;

/**
 * Inbound Calling v2 — inline playback of an AgentFlow voicemail (private bucket, signed URL).
 * Works for unlinked callers too: it needs only the voicemail id carried in the notification metadata
 * or the call row, never a contact record.
 *
 * Corrective pass (defect 7): the signed URL is refreshed when it is about to expire — before a play
 * that would otherwise fail, and (bounded) after a media error — WITHOUT losing playback: the position
 * is restored once the new source has metadata, and audio resumes only if it was playing or the user
 * asked to play. A refresh that fails while the current URL is still valid keeps the player. `listened_at`
 * is stamped only when the browser reports that playback actually started (`playing`), never on intent.
 */
export const VoicemailPlayer: React.FC<VoicemailPlayerProps> = ({ voicemailId, compact = false, className = "", onListened }) => {
  const [row, setRow] = useState<VoicemailRow | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const issuedAtRef = useRef<number | null>(null);
  const listenedRef = useRef(false);
  const autoRefreshesRef = useRef(0);
  const refreshingRef = useRef(false);
  /** Playback state captured before a refresh, restored on the new source's `loadedmetadata`. */
  const pendingRestoreRef = useRef<{ position: number; play: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    autoRefreshesRef.current = 0;
    pendingRestoreRef.current = null;
    (async () => {
      try {
        const vm = await fetchVoicemail(voicemailId);
        if (cancelled) return;
        if (!vm) { setError("This voicemail is no longer available."); return; }
        setRow(vm);
        listenedRef.current = !!vm.listened_at;
        const signed = await getVoicemailPlaybackUrl(vm);
        if (cancelled) return;
        issuedAtRef.current = signed ? Date.now() : null;
        setUrl(signed);
        if (!signed) { setError(vm.status === "purged" ? "This voicemail has expired." : "This voicemail is still being processed."); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the voicemail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [voicemailId]);

  /**
   * Refresh the signed URL, preserving playback: `intent` "play" resumes at the saved position; "error"
   * resumes only if the element was playing (an error while paused never starts audio on its own).
   */
  const refreshUrl = useCallback(async (intent: "play" | "error") => {
    if (!row || refreshingRef.current) return;
    const audio = audioRef.current;
    const position = Number.isFinite(audio?.currentTime) ? (audio!.currentTime as number) : 0;
    const wasPlaying = !!audio && !audio.paused;
    const play = intent === "play" ? true : wasPlaying;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const signed = await getVoicemailPlaybackUrl(row);
      if (!signed) { setError("This voicemail is no longer available."); return; }
      pendingRestoreRef.current = { position, play };
      issuedAtRef.current = Date.now();
      setUrl(signed);
    } catch (e) {
      const stillValid = issuedAtRef.current !== null && Date.now() < issuedAtRef.current + PLAYBACK_URL_TTL_MS;
      if (stillValid && audio) {
        // The current link still works for a while: keep the player and carry on with it.
        console.warn("[VoicemailPlayer] playback link refresh failed — continuing on the current link:", e instanceof Error ? e.message : e);
        if (play) void audio.play?.()?.catch?.(() => { /* autoplay policy: the user can press play again */ });
      } else {
        setError(e instanceof Error ? e.message : "Could not refresh the voicemail.");
      }
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [row]);

  // A new source after a refresh: load it; position and play/paused are restored on `loadedmetadata`.
  useEffect(() => {
    if (!url || !pendingRestoreRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    try { audio.load(); } catch { /* ignore */ }
  }, [url]);

  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const pending = pendingRestoreRef.current;
    if (!pending) return;
    pendingRestoreRef.current = null;
    const audio = e.currentTarget;
    try { if (pending.position > 0) audio.currentTime = pending.position; } catch { /* not seekable yet */ }
    if (pending.play) void audio.play?.()?.catch?.(() => { /* autoplay policy: the user can press play again */ });
  }, []);

  const handlePlay = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    // `play` fires on the intent; if the signed URL is about to expire, pause and refresh first.
    if (isPlaybackUrlStale(issuedAtRef.current, Date.now())) {
      try { e.currentTarget.pause(); } catch { /* ignore */ }
      void refreshUrl("play");
    }
  }, [refreshUrl]);

  const handlePlaying = useCallback(() => {
    // Playback actually started: this is the ONLY place listened_at is stamped.
    if (listenedRef.current) return;
    listenedRef.current = true;
    void markVoicemailListened(voicemailId).then(() => onListened?.()).catch(() => { listenedRef.current = false; });
  }, [voicemailId, onListened]);

  const handleError = useCallback(() => {
    // Bounded recovery: an expired or revoked signed URL is fetched again (at most
    // MAX_AUTO_REFRESHES_AFTER_ERROR times per mount — a stream that keeps failing after `playing`
    // never loops with audible restarts), then the failure is surfaced.
    if (autoRefreshesRef.current >= MAX_AUTO_REFRESHES_AFTER_ERROR) { setError("Playback failed. Reload to try again."); return; }
    autoRefreshesRef.current += 1;
    void refreshUrl("error");
  }, [refreshUrl]);

  if (loading) {
    return (
      <span className={`inline-flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading voicemail…
      </span>
    );
  }
  if (error || !url) {
    return <span className={`text-xs text-muted-foreground ${className}`} data-testid="voicemail-error">{error ?? "Voicemail unavailable."}</span>;
  }
  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="voicemail-player">
      {!compact && <Voicemail className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />}
      <audio
        ref={audioRef}
        controls
        preload="none"
        src={url}
        onPlay={handlePlay}
        onPlaying={handlePlaying}
        onError={handleError}
        onLoadedMetadata={handleLoadedMetadata}
        className={compact ? "h-8 w-full max-w-xs" : "h-9 w-full max-w-sm"}
        aria-label="Voicemail playback"
        data-testid="voicemail-audio"
      />
      {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Refreshing playback link" />}
      {row?.duration_seconds != null && (
        <span className="shrink-0 text-xs text-muted-foreground">{formatVoicemailDuration(row.duration_seconds)}</span>
      )}
    </div>
  );
};

export default VoicemailPlayer;
