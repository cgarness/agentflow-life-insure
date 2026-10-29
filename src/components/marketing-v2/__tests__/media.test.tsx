import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoShell from "../DemoShell";
import type { DemoAsset } from "../media";

const clip: DemoAsset = { label: "Test", description: "Synthetic recording fixture", verifiedRecording: true,
  poster: "/poster.webp", sources: [{ src: "/test.webm", type: "video/webm" }, { src: "/test.mp4", type: "video/mp4" }] };
let reduced = false;
let saveData = false;
let connectionType = "4g";
let motionChange: () => void;
let connectionChange: () => void;
let observers: { notify: (e: IntersectionObserverEntry[]) => void; rootMargin?: string; disconnect: ReturnType<typeof vi.fn> }[];
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();
const load = vi.fn();
const near = () => act(() => observers.find(o => o.rootMargin)?.notify([{ isIntersecting: true }] as IntersectionObserverEntry[]));
const visible = (value = true) => act(() => observers.find(o => !o.rootMargin)?.notify([
  { isIntersecting: value, intersectionRatio: value ? 0.9 : 0 },
] as IntersectionObserverEntry[]));
const video = () => document.querySelector("video")!;

beforeEach(() => {
  reduced = false; saveData = false; connectionType = "4g"; observers = [];
  play.mockReset().mockResolvedValue(undefined); pause.mockClear(); load.mockClear();
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn(); observe = vi.fn();
    constructor(notify: (e: IntersectionObserverEntry[]) => void, options: IntersectionObserverInit) {
      observers.push({ notify, rootMargin: options.rootMargin, disconnect: this.disconnect });
    }
  });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ get matches() { return reduced; },
    addEventListener: (_: string, fn: () => void) => { motionChange = fn; }, removeEventListener: vi.fn() }) });
  Object.defineProperty(navigator, "connection", { configurable: true, value: {
    get saveData() { return saveData; }, get effectiveType() { return connectionType; },
    addEventListener: (_: string, fn: () => void) => { connectionChange = fn; }, removeEventListener: vi.fn(),
  } });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("V2 demo media lifecycle", () => {
  it("makes no video request until near, and plays only while actually visible", () => {
    render(<DemoShell asset={clip} />);
    expect(document.querySelectorAll("source")).toHaveLength(0);
    expect(play).not.toHaveBeenCalled();
    near();
    expect(document.querySelectorAll("source")).toHaveLength(2);
    expect(load).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
    visible(); expect(play).toHaveBeenCalledOnce();
    expect(video().muted).toBe(true);
    expect(video().hasAttribute("playsinline")).toBe(true);
    expect(video().preload).toBe("none");
    expect(video().controls).toBe(false);
  });

  it("pauses offscreen and in a background tab, resuming when visible again", () => {
    render(<DemoShell asset={clip} />); near(); visible();
    fireEvent.playing(video()); pause.mockClear();
    visible(false); expect(pause).toHaveBeenCalled();
    visible(); play.mockClear(); pause.mockClear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange")); expect(pause).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange")); expect(play).toHaveBeenCalled();
  });

  it.each(["motion", "data", "2g"])("requires explicit Play for reduced %s preferences", (preference) => {
    if (preference === "motion") reduced = true;
    else if (preference === "data") saveData = true;
    else connectionType = "2g";
    render(<DemoShell asset={clip} />); near(); visible();
    expect(document.querySelectorAll("source")).toHaveLength(0);
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play Test demonstration" }));
    expect(document.querySelectorAll("source")).toHaveLength(2);
    expect(play).toHaveBeenCalled();
    fireEvent.playing(video());
    expect(screen.getByRole("button", { name: "Pause Test demonstration" })).toBeTruthy();
  });

  it("keeps a user's Pause across scrolling and tab visibility changes", () => {
    render(<DemoShell asset={clip} />); near(); visible(); fireEvent.playing(video());
    fireEvent.click(screen.getByRole("button", { name: "Pause Test demonstration" }));
    fireEvent.pause(video()); play.mockClear(); visible(false); visible();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play Test demonstration" })).toBeTruthy();
  });

  it("recovers rejected autoplay with an actual Play button", async () => {
    play.mockRejectedValueOnce(new Error("NotAllowedError"));
    render(<DemoShell asset={clip} />); near(); visible();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("status").textContent).toContain("Select Play");
    expect(screen.getByRole("button", { name: "Play Test demonstration" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Play Test demonstration" }));
    fireEvent.playing(video());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause Test demonstration" })).toBeTruthy();
  });

  it("reacts to changed preferences and disconnects observers on unmount", () => {
    const view = render(<DemoShell asset={clip} />); near(); visible(); pause.mockClear();
    act(() => { reduced = true; motionChange(); }); expect(pause).toHaveBeenCalled();
    act(() => { reduced = false; saveData = true; connectionChange(); });
    expect(document.querySelectorAll("source")).toHaveLength(0);
    view.unmount(); expect(observers.every(o => o.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("shows the static fallback on a media error, with no dead play control", () => {
    render(<DemoShell asset={clip} />); near(); visible(); fireEvent.error(video());
    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByAltText(clip.description)).toBeTruthy();
    expect(screen.getByText(/Recording unavailable/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never presents unreviewed assets as an authentic recording", () => {
    render(<DemoShell asset={{ ...clip, verifiedRecording: false }} />); near(); visible();
    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByText(/Illustrative preview/)).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
  });

  it("tries the second format and falls back when all individual source loads fail", () => {
    render(<DemoShell asset={clip} />); near(); visible();
    const sources = document.querySelectorAll("source");
    fireEvent.error(sources[0]); expect(document.querySelector("video")).toBeTruthy();
    fireEvent.error(sources[1]); expect(document.querySelector("video")).toBeNull();
    expect(screen.getByText(/Recording unavailable/)).toBeTruthy();
  });

  it("supports explicit playback when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<DemoShell asset={clip} />);
    expect(document.querySelectorAll("source")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Play Test demonstration" }));
    expect(play).toHaveBeenCalled();
  });
});
