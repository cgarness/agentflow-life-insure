/**
 * Browser-side call recording: mix agent mic + remote party audio via Web Audio API,
 * record with MediaRecorder, upload to Supabase Storage.
 *
 * Falls back across Twilio Voice.js stream APIs and the SDK's remote <audio> element.
 */

import { supabase } from "@/integrations/supabase/client";

export type BrowserRecordingMedia = {
  twilioCall: unknown;
  /** Twilio SDK remote playback element (see TwilioContext `remoteAudioRef`). */
  remoteAudioElement?: HTMLAudioElement | null;
  /** Prefer the Twilio Device mic stream to avoid a second getUserMedia when possible. */
  agentMicStream?: MediaStream | null;
};

let activeRecorder: MediaRecorder | null = null;
let activeAudioCtx: AudioContext | null = null;
let recordingChunks: Blob[] = [];
let acquiredLocalStream: MediaStream | null = null;

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function pickRemoteStream(call: unknown, remoteEl?: HTMLAudioElement | null): MediaStream | null {
  const c = call as {
    getRemoteStream?: () => MediaStream | undefined;
    remoteStream?: MediaStream;
  } | null;
  if (!c) return null;
  try {
    if (typeof c.getRemoteStream === "function") {
      const s = c.getRemoteStream();
      if (s && s.getAudioTracks().length > 0) return s;
    }
  } catch {
    /* ignore */
  }
  if (c.remoteStream && c.remoteStream.getAudioTracks().length > 0) return c.remoteStream;

  const el = remoteEl;
  if (el?.srcObject instanceof MediaStream) {
    const s = el.srcObject as MediaStream;
    if (s.getAudioTracks().length > 0) return s;
  }

  const cap = el && typeof (el as HTMLAudioElement & { captureStream?: (fps?: number) => MediaStream }).captureStream === "function"
    ? (el as HTMLAudioElement & { captureStream: (fps?: number) => MediaStream }).captureStream.bind(el)
    : null;
  if (cap) {
    try {
      const s = cap();
      if (s && s.getAudioTracks().length > 0) return s;
    } catch {
      /* captureStream may throw if restricted */
    }
  }

  return null;
}

async function pickLocalStream(preferred?: MediaStream | null): Promise<MediaStream | null> {
  if (preferred?.getAudioTracks().length) return preferred;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    acquiredLocalStream = s;
    return s;
  } catch {
    return null;
  }
}

function stopAcquiredLocal(): void {
  if (acquiredLocalStream) {
    try {
      acquiredLocalStream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    acquiredLocalStream = null;
  }
}

/**
 * Start mixing + recording. Pass Twilio call + optional remote audio element and mic stream.
 */
export async function startRecording(
  _callId: string,
  _orgId: string,
  media: BrowserRecordingMedia | null,
): Promise<void> {
  void _callId;
  void _orgId;
  stopRecording();

  if (!media?.twilioCall || typeof window === "undefined") return;

  const remote = pickRemoteStream(media.twilioCall, media.remoteAudioElement ?? null);
  const local = await pickLocalStream(media.agentMicStream ?? null);

  if (!remote) {
    console.warn("[Recording] No remote stream available — skipping browser recording.");
    stopAcquiredLocal();
    return;
  }

  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      console.warn("[Recording] AudioContext not supported — skipping browser recording.");
      stopAcquiredLocal();
      return;
    }
    const ctx = new AC();
    activeAudioCtx = ctx;
    const dest = ctx.createMediaStreamDestination();

    const remoteSrc = ctx.createMediaStreamSource(remote);
    remoteSrc.connect(dest);

    if (local && local.getAudioTracks().length > 0) {
      const localSrc = ctx.createMediaStreamSource(local);
      localSrc.connect(dest);
    }

    recordingChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };
    recorder.start(1000);
    activeRecorder = recorder;
    console.log("[Recording] Browser recording started:", mimeType);
  } catch (err) {
    console.warn("[Recording] Failed to start browser recording:", err);
    stopAcquiredLocal();
    if (activeAudioCtx) {
      try {
        await activeAudioCtx.close();
      } catch {
        /* ignore */
      }
      activeAudioCtx = null;
    }
  }
}

/** Stop recording and return a single audio Blob (or null if nothing captured). */
export function stopRecording(): Blob | null {
  const recorder = activeRecorder;
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      /* may already be stopped */
    }
  }
  activeRecorder = null;

  if (activeAudioCtx) {
    try {
      void activeAudioCtx.close();
    } catch {
      /* ignore */
    }
    activeAudioCtx = null;
  }

  stopAcquiredLocal();

  const chunks = recordingChunks;
  recordingChunks = [];
  if (chunks.length === 0) return null;
  const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
  console.log("[Recording] Browser recording stopped. Size:", (blob.size / 1024).toFixed(1), "KB");
  return blob;
}

/**
 * Upload WebM to `call-recordings` at `{orgId}/{YYYYMMDD}/{callId}.webm` and patch `calls`.
 */
export async function uploadCallRecording(callId: string, orgId: string, blob: Blob): Promise<void> {
  const safeOrg = orgId || "unknown";
  const path = `${safeOrg}/${yyyymmdd(new Date())}/${callId}.webm`;

  console.log("[Recording] Uploading to storage:", path);
  const { error: uploadErr } = await supabase.storage
    .from("call-recordings")
    .upload(path, blob, { contentType: blob.type || "audio/webm", upsert: true });

  if (uploadErr) {
    console.error("[Recording] Upload failed:", uploadErr);
    return;
  }

  const storageToken = `storage:call-recordings/${path}`;
  const { error: updateErr } = await supabase
    .from("calls")
    .update({
      recording_storage_path: path,
      recording_url: storageToken,
    } as Record<string, unknown>)
    .eq("id", callId);

  if (updateErr) {
    console.error("[Recording] Failed to update calls row:", updateErr);
    return;
  }
  console.log("[Recording] Uploaded and saved:", path);
}
