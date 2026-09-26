import { useLayoutEffect, useRef, useState } from "react";
import { getLeaderboardAvatarCache, type LeaderboardAvatarCache } from "@/lib/leaderboardAvatarCache";

const EMPTY: ReadonlyMap<string, string | null> = new Map();

/** Photo changes decorate presentation only; numeric snapshots never wait for them. */
export function useLeaderboardAvatars(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  ids: readonly string[],
  roster: readonly string[],
  enabled: boolean,
  successfulAt: number | null,
): ReadonlyMap<string, string | null> {
  const scope = userId && orgId ? `${userId}:${orgId}` : null;
  const owner = useRef({});
  const cache = useRef<LeaderboardAvatarCache | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const [snapshot, setSnapshot] = useState<{ scope: string; urls: ReadonlyMap<string, string | null> } | null>(null);
  const idsKey = [...new Set(ids)].sort().join(",");
  const rosterKey = [...new Set(roster)].sort().join(",");

  useLayoutEffect(() => {
    if (!scope || !userId || !orgId) return;
    const entry = getLeaderboardAvatarCache(userId, orgId);
    cache.current = entry;
    const notify = () => setSnapshot({ scope, urls: entry.read(idsRef.current) });
    const release = entry.subscribe(owner.current, notify);
    notify();
    return () => { release(); cache.current = null; };
  }, [scope, userId, orgId]);

  useLayoutEffect(() => {
    cache.current?.demand(owner.current, idsKey ? idsKey.split(",") : [],
      rosterKey ? rosterKey.split(",") : [], enabled, enabled && successfulAt !== null);
  }, [scope, idsKey, rosterKey, enabled, successfulAt]);

  return scope && snapshot?.scope === scope ? snapshot.urls : EMPTY;
}
