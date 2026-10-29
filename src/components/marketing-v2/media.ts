export interface DemoAsset {
  label: string;
  description: string;
  poster?: string;
  /** Enabled only after actual-component capture and privacy/output review. */
  sources?: readonly { src: string; type: "video/webm" | "video/mp4" }[];
  verifiedRecording: boolean;
}

function recording(label: string, name: string, description: string): DemoAsset {
  return { label, description, verifiedRecording: true, poster: `/marketing-v2/${name}.webp`, sources: [
    { src: `/marketing-v2/${name}.webm`, type: "video/webm" },
    { src: `/marketing-v2/${name}.mp4`, type: "video/mp4" },
  ] };
}

// Recorded from the shipped, unmodified UI components in an isolated synthetic
// workspace. Activity is simulated; no prospect was called or messaged.
// Provenance, validation and checksums: docs/plans/2026-10-29-private-homepage-v2/.
export const MEDIA = {
  dashboard: recording("Dashboard", "dashboard", "AgentFlow dashboard showing sample day and monthly performance."),
  dialer: recording("Power dialer", "dialer", "AgentFlow dialer showing a simulated call, outcome and next sample lead."),
  leaderboard: recording("AP leaderboard", "leaderboard", "AgentFlow annual premium leaderboard with synthetic agents and a rank change."),
  conversations: recording("Conversations", "conversations", "AgentFlow messaging interface with a synthetic conversation and simulated reply."),
} satisfies Record<string, DemoAsset>;
