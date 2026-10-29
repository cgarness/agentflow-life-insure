// Dev-only entry, never imported by the production router or included in dist.
// This renders marketing UI alone; it does not replace CRM auth or mock its APIs.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import LandingPageV2 from "../../../src/pages/LandingPageV2";
import DemoShell from "../../../src/components/marketing-v2/DemoShell";
import "../../../src/index.css";

function PlaybackLab() {
  return <div className="min-h-screen bg-slate-950 p-6 text-white">
    <h1 className="mb-4 text-3xl">Playback test pattern</h1>
    <p className="mb-4">This is a technical test asset, not product footage.</p>
    <a href="#playback" className="text-sky-300">Scroll to test video</a>
    <div className="h-screen" />
    <div id="playback" className="mx-auto max-w-2xl">
      <DemoShell asset={{ label: "Playback test", description: "Color pattern for technical playback checks only",
        verifiedRecording: true, sources: [{ src: "/scripts/tests/homepage-v2/playback-test.mp4", type: "video/mp4" }] }} />
    </div>
    <div className="h-screen" />
    <p>End of playback test</p>
  </div>;
}

createRoot(document.getElementById("root")!).render(<MemoryRouter>
  {new URLSearchParams(window.location.search).has("media-test") ? <PlaybackLab /> : <LandingPageV2 />}
</MemoryRouter>);
