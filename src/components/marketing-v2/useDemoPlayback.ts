import { useEffect, useRef, useState } from "react";
import { useMediaPreferences } from "./useMediaPreferences";

export function useDemoPlayback() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeTab, setActiveTab] = useState(() => document.visibilityState !== "hidden");
  const [choice, setChoice] = useState<"auto" | "play" | "pause">("auto");
  const [requested, setRequested] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const allowAutoplay = useMediaPreferences();
  const attempt = useRef(0);
  const observed = typeof IntersectionObserver !== "undefined";
  const attachSources = !failed && (requested || (near && allowAutoplay && observed));
  const shouldPlay = attachSources && activeTab && visible && choice !== "pause" &&
    (choice === "play" || (choice === "auto" && allowAutoplay && observed));

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!observed) { setVisible(true); return; }
    // A separate prefetch observer avoids mistaking "near" for actually visible.
    const preload = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNear(true); preload.disconnect(); }
    }, { rootMargin: "200px 0px", threshold: 0 });
    const playback = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.45);
    }, { threshold: [0, 0.45, 1] });
    preload.observe(root);
    playback.observe(root);
    return () => { preload.disconnect(); playback.disconnect(); };
  }, [observed]);

  useEffect(() => {
    const update = () => setActiveTab(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    // Browsers do not consistently select dynamically inserted <source>s until
    // load() runs; preload remains none until this near-viewport attachment.
    if (attachSources) videoRef.current?.load();
  }, [attachSources]);

  useEffect(() => {
    const video = videoRef.current;
    const id = ++attempt.current;
    let active = true;
    if (!video) return;
    if (!shouldPlay) video.pause();
    else {
      video.muted = true;
      void video.play()?.catch(() => {
        if (active && attempt.current === id) { setBlocked(true); setPlaying(false); }
      });
    }
    return () => { active = false; video.pause(); };
  }, [shouldPlay]);

  const toggle = () => {
    setRequested(true);
    if (playing) { setChoice("pause"); videoRef.current?.pause(); }
    else {
      setChoice("play");
      setBlocked(false);
      // Retry in the click's activation when a browser denied the automatic play.
      if (attachSources && videoRef.current) {
        void videoRef.current.play()?.catch(() => { setBlocked(true); setPlaying(false); });
      }
    }
  };

  return { rootRef, videoRef, attachSources, playing, blocked, failed, toggle,
    onPlaying: () => { setPlaying(true); setBlocked(false); },
    onPause: () => setPlaying(false),
    onError: () => { attempt.current++; setFailed(true); setPlaying(false); },
  };
}
