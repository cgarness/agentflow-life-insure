export interface DemoAsset {
  label: string;
  description: string;
  poster?: string;
  /** Set only after authentic capture and every-frame privacy review. */
  sources?: readonly { src: string; type: "video/webm" | "video/mp4" }[];
  verifiedRecording: boolean;
}

// Deliberately no guessed media URLs or simulated recordings. These reference
// images are concepts, not authenticated footage. See the capture evidence doc.
export const MEDIA = {
  dashboard: {
    label: "Dashboard", poster: "/test1/dashboard.png", verifiedRecording: false,
    description: "Dashboard concept; authentic product recording pending.",
  },
  dialer: {
    label: "Power dialer", poster: "/test1/dialer.png", verifiedRecording: false,
    description: "Dialer concept; authentic product recording pending.",
  },
  leaderboard: {
    label: "AP leaderboard", verifiedRecording: false,
    description: "Illustrative annualized premium rankings using synthetic agents and values.",
  },
  conversations: {
    label: "Conversations", verifiedRecording: false,
    description: "Illustrative SMS conversation using synthetic messages; nothing is sent.",
  },
} satisfies Record<string, DemoAsset>;
