// Corrective pass, defect 7 — VoicemailPlayer behaviour: listened_at is stamped only when playback
// actually starts; an aged signed URL is refreshed before playing and once after a media error; an
// unlinked caller needs nothing but the voicemail id.
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYBACK_URL_TTL_MS, isPlaybackUrlStale } from "@/lib/voicemailPlayback";

const lib = vi.hoisted(() => ({
  fetchVoicemail: vi.fn(),
  getVoicemailPlaybackUrl: vi.fn(),
  markVoicemailListened: vi.fn(),
  formatVoicemailDuration: (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
}));
vi.mock("@/lib/voicemails", () => lib);

import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";

const ROW = { id: "vm-1", call_id: "c-1", organization_id: "o-1", recipient_kind: "group", recipient_agent_id: null, storage_bucket: "voicemails", storage_path: "o/x.mp3", duration_seconds: 12, status: "stored", listened_at: null, created_at: "2026-09-11T00:00:00Z" };

let urlCounter = 0;
beforeEach(() => {
  urlCounter = 0;
  lib.fetchVoicemail.mockReset().mockResolvedValue(ROW);
  lib.getVoicemailPlaybackUrl.mockReset().mockImplementation(async () => `https://signed/${++urlCounter}`);
  lib.markVoicemailListened.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: vi.fn() });
  // jsdom has no media pipeline: position and paused state are plain backing fields the tests can set.
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { configurable: true, get() { return (this as { _ct?: number })._ct ?? 0; }, set(v: number) { (this as { _ct?: number })._ct = v; } });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get() { return (this as { _paused?: boolean })._paused ?? true; }, set(v: boolean) { (this as { _paused?: boolean })._paused = v; } });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-11T10:00:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const audioEl = () => screen.getByTestId("voicemail-audio") as HTMLAudioElement;

describe("isPlaybackUrlStale", () => {
  it("is stale with no issue time, fresh right after issue, stale inside the last margin before the 5-minute TTL", () => {
    expect(isPlaybackUrlStale(null, 0)).toBe(true);
    expect(isPlaybackUrlStale(0, 1_000)).toBe(false);
    expect(isPlaybackUrlStale(0, PLAYBACK_URL_TTL_MS - 30_000)).toBe(true);
    expect(isPlaybackUrlStale(0, PLAYBACK_URL_TTL_MS)).toBe(true);
  });
});

describe("VoicemailPlayer", () => {
  it("renders from the voicemail id alone (no contact) and stamps listened only when playback actually starts", async () => {
    render(<VoicemailPlayer voicemailId="vm-1" />);
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/1"));
    fireEvent.play(audioEl());
    expect(lib.markVoicemailListened).not.toHaveBeenCalled();      // intent is not playback
    fireEvent.playing(audioEl());
    await waitFor(() => expect(lib.markVoicemailListened).toHaveBeenCalledTimes(1));
    fireEvent.playing(audioEl());
    expect(lib.markVoicemailListened).toHaveBeenCalledTimes(1);     // stamped once
  });

  it("an aged signed URL is refreshed BEFORE playing (pause → new URL → resume), not after a failure", async () => {
    render(<VoicemailPlayer voicemailId="vm-1" compact />);
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/1"));
    act(() => { vi.setSystemTime(new Date("2026-09-11T10:04:40Z")); });   // inside the refresh margin
    fireEvent.play(audioEl());
    await waitFor(() => expect(lib.getVoicemailPlaybackUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/2"));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();   // not before the new source has metadata
    fireEvent.loadedMetadata(audioEl());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(lib.markVoicemailListened).not.toHaveBeenCalled();
  });

  it("media errors refresh the URL a BOUNDED number of times per mount — even with `playing` in between — then surface the failure", async () => {
    render(<VoicemailPlayer voicemailId="vm-1" />);
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/1"));
    fireEvent.error(audioEl());
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/2"));
    fireEvent.playing(audioEl());                                   // a few frames decode, then the stream drops again
    fireEvent.error(audioEl());
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/3"));
    fireEvent.playing(audioEl());
    fireEvent.error(audioEl());
    await waitFor(() => expect(screen.getByTestId("voicemail-error")).toHaveTextContent("Playback failed"));
    expect(lib.getVoicemailPlaybackUrl).toHaveBeenCalledTimes(3);   // initial + MAX_AUTO_REFRESHES_AFTER_ERROR
  });

  it("a refresh restores the playback position; an error while PAUSED never starts audio on its own", async () => {
    render(<VoicemailPlayer voicemailId="vm-1" />);
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/1"));
    audioEl().currentTime = 150;                                    // 2:30 into the message, paused
    fireEvent.error(audioEl());
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/2"));
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    audioEl().currentTime = 0;                                      // the media load algorithm resets the position
    fireEvent.loadedMetadata(audioEl());
    expect(audioEl().currentTime).toBe(150);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("a pre-emptive refresh on play resumes at the saved position", async () => {
    render(<VoicemailPlayer voicemailId="vm-1" />);
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/1"));
    audioEl().currentTime = 90;
    act(() => { vi.setSystemTime(new Date("2026-09-11T10:04:40Z")); });
    fireEvent.play(audioEl());
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/2"));
    audioEl().currentTime = 0;
    fireEvent.loadedMetadata(audioEl());
    expect(audioEl().currentTime).toBe(90);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("a FAILED pre-emptive refresh keeps the still-valid player instead of replacing it with an error", async () => {
    render(<VoicemailPlayer voicemailId="vm-1" />);
    await waitFor(() => expect(audioEl().getAttribute("src")).toBe("https://signed/1"));
    lib.getVoicemailPlaybackUrl.mockRejectedValueOnce(new Error("network"));
    act(() => { vi.setSystemTime(new Date("2026-09-11T10:04:20Z")); });   // inside the margin, link valid for 40 s
    fireEvent.play(audioEl());
    await waitFor(() => expect(lib.getVoicemailPlaybackUrl).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));   // resumed on the current link
    expect(screen.queryByTestId("voicemail-error")).toBeNull();
    expect(audioEl().getAttribute("src")).toBe("https://signed/1");
  });

  it("a purged voicemail and a missing row are reported, never played", async () => {
    lib.getVoicemailPlaybackUrl.mockResolvedValueOnce(null);
    lib.fetchVoicemail.mockResolvedValueOnce({ ...ROW, status: "purged", storage_path: null });
    render(<VoicemailPlayer voicemailId="vm-1" />);
    await waitFor(() => expect(screen.getByTestId("voicemail-error")).toHaveTextContent("expired"));
    lib.fetchVoicemail.mockResolvedValueOnce(null);
    render(<VoicemailPlayer voicemailId="vm-2" />);
    await waitFor(() => expect(screen.getAllByTestId("voicemail-error").length).toBe(2));
  });
});
