/** Persisted room membership never falls back to the regular CRM identity. */
export type RoomRoute = { room: boolean; targets: Array<{ agentId: string; identity: string }> };
export function parseRoomRoute(value: unknown): RoomRoute {
  if (!value || typeof value !== "object") throw new Error("Room route unavailable");
  const r = value as Record<string, unknown>;
  if (typeof r.room !== "boolean" || !Array.isArray(r.targets)) throw new Error("Invalid room route");
  const targets = r.targets.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid room target");
    const t = item as Record<string, unknown>;
    if (typeof t.agentId !== "string" || typeof t.identity !== "string" || !/^ir_[a-f0-9]{32}$/.test(t.identity)) throw new Error("Invalid room identity");
    return { agentId: t.agentId, identity: t.identity };
  });
  return { room: r.room, targets };
}
