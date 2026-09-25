import type { LeaderboardFailureKind } from "@/lib/leaderboardRequestGate";

/**
 * What the leaderboard surfaces say when standings are not live. One table so the
 * page, TV mode and the Dashboard widget can never disagree, and so no surface
 * promises an automatic check that is not actually scheduled.
 */

export type StandingsStatusKind = "ok" | "maintenance" | "busy" | "error";

export interface StandingsStatus {
  kind: StandingsStatusKind;
  /** When the standings on screen were loaded (null: nothing loaded for this selection). */
  lastUpdatedAt: number | null;
  /** Next automatic check; null where nothing refreshes automatically (the Dashboard). */
  nextCheckAt: number | null;
  /** Earliest time a manual Retry is accepted. */
  manualAvailableAt: number | null;
  /** The browser reports it is offline. */
  offline: boolean;
}

export type WinsStatusKind = "loading" | "ok" | "error";

export interface WinsStatus {
  kind: WinsStatusKind;
  /** When the wins on screen were loaded (null: nothing loaded for this selection). */
  lastUpdatedAt: number | null;
}

export const STANDINGS_STATUS_OK: StandingsStatus = {
  kind: "ok",
  lastUpdatedAt: null,
  nextCheckAt: null,
  manualAvailableAt: null,
  offline: false,
};

export const WINS_STATUS_LOADING: WinsStatus = { kind: "loading", lastUpdatedAt: null };

/** Headline when the standings on screen are fine but this browser is offline. */
export const OFFLINE_HEADLINE = "Standings are not updating.";

/** Live means loaded, current, and still refreshing — an offline tab is not live. */
export function standingsLive(status: StandingsStatus): boolean {
  return status.kind === "ok" && !status.offline;
}

export function standingsStatusKind(kind: LeaderboardFailureKind): Exclude<StandingsStatusKind, "ok"> {
  if (kind === "maintenance" || kind === "busy") return kind;
  return "error";
}

/** Browser-local clock time, e.g. "3:47 PM". */
export function formatStatusTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

type TimeFormatter = (ms: number) => string;

/** Headline for a surface that is not live; also the hook's `loadError`. */
export function standingsHeadline(
  kind: Exclude<StandingsStatusKind, "ok">,
  hasSnapshot: boolean,
  surface: "page" | "widget" = "page",
): string {
  if (kind === "maintenance") return "Standings are paused for maintenance.";
  if (kind === "busy") return "Standings are busy right now.";
  if (surface === "widget") return hasSnapshot ? "Refresh failed." : "Couldn't load standings";
  return hasSnapshot ? "Couldn't refresh standings." : "Couldn't load the leaderboard.";
}

/** The next automatic check, only when one is actually scheduled in the future. */
function nextCheckCopy(status: StandingsStatus, now: number, format: TimeFormatter): string {
  if (status.offline || status.nextCheckAt === null || status.nextCheckAt <= now) return "";
  const at = format(status.nextCheckAt);
  if (status.kind === "error") return `We'll try again automatically at ${at}.`;
  if (status.kind === "busy") return `Retrying at ${at}.`;
  return `We'll check again automatically at ${at}.`;
}

/** Supporting line under the headline (full panel) or after it (strip over a snapshot). */
export function standingsDetail(
  status: StandingsStatus,
  hasSnapshot: boolean,
  now: number,
  format: TimeFormatter = formatStatusTime,
): string {
  const parts: string[] = [];
  if (hasSnapshot && status.lastUpdatedAt !== null) {
    parts.push(`Showing results from ${format(status.lastUpdatedAt)}.`);
  } else if (!hasSnapshot) {
    // Nothing loaded yet and nothing wrong but the connection. No promise beyond
    // that: a hold may still apply once the connection is back.
    if (status.offline && status.kind === "ok") return "You're offline — standings can't load until you reconnect.";
    parts.push(
      status.kind === "maintenance"
        ? "The leaderboard is temporarily unavailable."
        : status.kind === "busy"
          ? "Another standings refresh is still running."
          : "Standings are unavailable right now.",
    );
  }
  if (status.offline) {
    parts.push("You're offline — standings can't refresh until you reconnect.");
  } else {
    const next = nextCheckCopy(status, now, format);
    if (next) parts.push(next);
  }
  return parts.join(" ");
}

/** Text under a Retry control that is not accepted yet. */
export function retryAvailableCopy(availableAt: number, format: TimeFormatter = formatStatusTime): string {
  return `Retry available at ${format(availableAt)}`;
}

/**
 * TV footer ticker. "No wins yet" only after a successful empty read; otherwise
 * an admin's custom banner, or neutral status copy — never a live-sounding claim.
 */
export function tvTickerText(options: {
  customBanner: string | null;
  winsStatus: WinsStatus;
  winsTicker: string;
  standings: StandingsStatus;
  format?: TimeFormatter;
}): string {
  const { customBanner, winsStatus, winsTicker, standings, format = formatStatusTime } = options;
  if (customBanner?.trim()) return customBanner.trim();
  if (winsStatus.kind === "ok") return winsTicker;
  // Offline: nothing is loading, so never "Loading recent wins…".
  if (standings.offline) return "You're offline — recent wins can't load until you reconnect";
  if (standings.kind === "maintenance") {
    return standings.lastUpdatedAt !== null
      ? `Standings paused — last update ${format(standings.lastUpdatedAt)}`
      : "Standings paused for maintenance";
  }
  if (winsStatus.kind === "loading" && standings.kind !== "ok") {
    // Wins are read only once standings are on screen, so nothing is loading.
    return standings.kind === "busy" ? "Standings are busy" : "Standings unavailable";
  }
  return winsStatus.kind === "loading" ? "Loading recent wins…" : "Recent wins unavailable";
}
