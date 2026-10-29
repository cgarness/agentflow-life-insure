// Isolated, offline capture of unmodified shipped UI components. Not a CRM route.
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardScene from "./DashboardScene";
import DialerScene from "./DialerScene";
import LeaderboardScene from "./LeaderboardScene";
import MessagingScene from "./MessagingScene";
import { recordSurface } from "./recorder";
import "@/index.css";

const SCENES = { dashboard: DashboardScene, dialer: DialerScene, leaderboard: LeaderboardScene, conversations: MessagingScene };
type Scene = keyof typeof SCENES;
const TITLES: Record<Scene, string> = { dashboard: "Dashboard", dialer: "Power Dialer", leaderboard: "Annual Premium Leaderboard", conversations: "Conversations" };

export function Capture() {
  const [scene, setScene] = useState<Scene>("leaderboard"), [epoch, setEpoch] = useState(0);
  const [status, setStatus] = useState("Ready — actual UI components, entirely synthetic data");
  const [busy, setBusy] = useState(false), [url, setUrl] = useState("");
  const surface = useRef<HTMLDivElement>(null);
  const SceneComponent = SCENES[scene];
  async function record() {
    setBusy(true); setStatus("Recording 6 seconds…");
    if (url) URL.revokeObjectURL(url); setUrl("");
    try {
      const result = await recordSurface(surface.current!, () => setEpoch(value => value + 1));
      const capturedUrl = URL.createObjectURL(result.blob);
      setUrl(capturedUrl);
      setStatus(`Capture complete: ${result.frames} frames, ${(result.elapsed / 1000).toFixed(2)} seconds, ${(result.blob.size / 1024).toFixed(0)} KB, average draw ${(result.drawMilliseconds / result.frames).toFixed(0)} ms. No network actions.`);
      const download = document.createElement("a");
      download.href = capturedUrl; download.download = `agentflow-${scene}-synthetic-capture.webm`;
      document.body.appendChild(download); download.click(); download.remove();
    } catch (error) { setStatus(`Capture failed: ${String(error)}`); }
    finally { setBusy(false); }
  }
  return <>
    <div id="capture-tools">
      <label htmlFor="capture-scene">Scene</label><select id="capture-scene" value={scene} disabled={busy} onChange={event => { setScene(event.target.value as Scene); setEpoch(0); setUrl(""); }}>
        {Object.keys(SCENES).map(key => <option key={key} value={key}>{TITLES[key as Scene]}</option>)}
      </select>
      <button disabled={busy} onClick={record}>Record 6 seconds</button>
      {url && <a href={url} download={`agentflow-${scene}-synthetic-capture.webm`}>Download capture</a>}
    </div>
    <p id="capture-status" role="status">{status}</p>
    <div id="capture-surface" ref={surface} className="dark flex flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <img src="/agentflow-logo-full-on-dark.png" alt="AgentFlow" width="130" height="20" className="h-5 w-auto" />
        <span className="text-sm font-bold text-foreground">{TITLES[scene]}</span>
        <span className="rounded-full border border-border px-3 py-1 text-[10px] text-muted-foreground">Demo workspace</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden"><SceneComponent epoch={epoch} /></div>
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border px-6 text-[10px] text-muted-foreground">
        <span>Actual AgentFlow UI · Synthetic sample data</span><span>{scene === "dialer" ? "Simulated call · no connection" : scene === "conversations" ? "Simulated SMS · no messages sent" : "Demonstration values"}</span>
      </div>
    </div>
    {url && <video id="capture-preview" src={url} controls muted playsInline />}
  </>;
}

createRoot(document.getElementById("root")!).render(<MemoryRouter><TooltipProvider><Capture /></TooltipProvider></MemoryRouter>);
