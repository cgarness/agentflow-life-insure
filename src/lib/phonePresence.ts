/**
 * Inbound Calling v2 — phone presence with REGISTRATION GENERATIONS (implementation_plan.md rev 3
 * §6.2, D1, P9). Pure core, no Supabase import: the RPC and the keepalive transport are injected so
 * this runs under vitest (src/lib/__tests__/phonePresence.test.ts) and in the browser
 * (src/lib/phonePresenceClient.ts wires the real client).
 *
 * Model: every Twilio Device `registered` event mints a NEW registration id in memory (never
 * persisted — a duplicated tab, a reload or a second browser therefore always gets its own row) and
 * resets `seq` to 0. Every write carries `(registration_id, seq)` with `seq` incremented before the
 * send; the RPC applies a write only when `seq` is greater than the stored one, so a delayed
 * `pagehide` unregister of an OLD registration cannot touch the new one (different id) and a
 * reordered older heartbeat cannot re-open a closed registration (lower seq). The server derives
 * "connected" from `registered AND last_seen_at within 3 minutes`; this module never touches
 * `availability_status` and never triggers Device re-initialisation.
 */

export type PresenceState = "registered" | "unregistered" | "error";

export interface HeartbeatArgs {
  p_registration_id: string;
  p_seq: number;
  p_registered: boolean;
  p_state: PresenceState;
  p_detail: string | null;
}

export type HeartbeatResult = { applied: boolean; reason: string } | null;

export interface PhonePresenceDeps {
  /** heartbeat_phone_registration via the authenticated client (identity = auth.uid(), never a parameter). */
  rpc: (args: HeartbeatArgs) => Promise<HeartbeatResult>;
  /** Fire-and-forget transport that survives page teardown (fetch keepalive); optional in tests. */
  keepalive?: (args: HeartbeatArgs) => void;
  uuid?: () => string;
  now?: () => number;
  /** Heartbeat cadence while registered (P9: 45 s; the server freshness window is 3 minutes). */
  heartbeatMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface PresenceWriteRecord {
  at: number;
  registrationId: string;
  seq: number;
  registered: boolean;
  state: PresenceState;
  detail: string | null;
  result: HeartbeatResult | "error" | "keepalive";
}

export interface RingMeasurement {
  at: number;
  ms: number;
  outcome: "cancel" | "answered" | "rejected";
}

export const PRESENCE_HEARTBEAT_MS = 45_000;
const HISTORY_LIMIT = 20;

function defaultUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 fallback for environments without crypto.randomUUID
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class PhonePresence {
  private registrationId: string | null = null;
  private seq = 0;
  private registered = false;
  private timer: unknown = null;
  private readonly history: PresenceWriteRecord[] = [];
  private readonly rings: RingMeasurement[] = [];
  private readonly deps: Required<Pick<PhonePresenceDeps, "rpc" | "uuid" | "now" | "heartbeatMs" | "setInterval" | "clearInterval" | "log">> &
    Pick<PhonePresenceDeps, "keepalive">;

  constructor(deps: PhonePresenceDeps) {
    this.deps = {
      rpc: deps.rpc,
      keepalive: deps.keepalive,
      uuid: deps.uuid ?? defaultUuid,
      now: deps.now ?? (() => Date.now()),
      heartbeatMs: deps.heartbeatMs ?? PRESENCE_HEARTBEAT_MS,
      setInterval: deps.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>)),
      log: deps.log ?? (() => {}),
    };
  }

  /** Read-only snapshot for diagnostics (ConnectionDiagnostics card). */
  snapshot() {
    return {
      registrationId: this.registrationId,
      seq: this.seq,
      registered: this.registered,
      history: [...this.history],
      rings: [...this.rings],
    };
  }

  /** Device `registered`: a NEW generation. Old ids are never reused. */
  async onRegistered(detail: string | null = null): Promise<HeartbeatResult> {
    this.registrationId = this.deps.uuid();
    this.seq = 0;
    this.registered = true;
    this.startHeartbeat();
    return await this.write(true, "registered", detail);
  }

  /** Device `unregistered` / provider teardown: closes THIS generation only. */
  async onUnregistered(detail: string | null = null): Promise<HeartbeatResult> {
    this.stopHeartbeat();
    if (!this.registrationId) return null;
    this.registered = false;
    return await this.write(false, "unregistered", detail);
  }

  async onError(detail: string | null): Promise<HeartbeatResult> {
    this.stopHeartbeat();
    if (!this.registrationId) return null;
    this.registered = false;
    return await this.write(false, "error", detail);
  }

  /** Periodic / visibility / online refresh — only while this generation is registered. */
  async heartbeat(detail: string | null = null): Promise<HeartbeatResult> {
    if (!this.registrationId || !this.registered) return null;
    return await this.write(true, "registered", detail);
  }

  /**
   * P17 measurement: the agent-perceived ring (Device `incoming` → `cancel`) is recorded in memory
   * and reported on the next presence write as `ring:<ms>` (last_detail) so live calls can be
   * compared with the provider setting without guessing.
   */
  noteRing(ms: number, outcome: RingMeasurement["outcome"]): void {
    const rounded = Math.max(0, Math.round(ms));
    this.rings.push({ at: this.deps.now(), ms: rounded, outcome });
    while (this.rings.length > HISTORY_LIMIT) this.rings.shift();
    if (this.registrationId && this.registered) {
      void this.write(true, "registered", `ring:${rounded}:${outcome}`);
    }
  }

  /**
   * Page teardown / logout: one synchronous keepalive write closing the CURRENT generation with the
   * next seq. A later delayed delivery of an older write cannot undo it (lower seq) and a new tab or
   * reload mints a different id, so nothing here can hide a live registration elsewhere.
   */
  flushUnregisterKeepalive(reason: "pagehide" | "beforeunload" | "logout"): HeartbeatArgs | null {
    if (!this.registrationId) return null;
    this.stopHeartbeat();
    this.registered = false;
    this.seq += 1;
    const args: HeartbeatArgs = {
      p_registration_id: this.registrationId,
      p_seq: this.seq,
      p_registered: false,
      p_state: "unregistered",
      p_detail: reason,
    };
    this.record(args, "keepalive");
    try {
      this.deps.keepalive?.(args);
    } catch (err) {
      this.deps.log("presence keepalive failed", { err: String(err) });
    }
    return args;
  }

  /** Forget the generation entirely (identity change); the row expires server-side within 3 minutes. */
  reset(): void {
    this.stopHeartbeat();
    this.registrationId = null;
    this.seq = 0;
    this.registered = false;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.timer = this.deps.setInterval(() => { void this.heartbeat(); }, this.deps.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.timer !== null) {
      this.deps.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private record(args: HeartbeatArgs, result: PresenceWriteRecord["result"]): void {
    this.history.push({
      at: this.deps.now(), registrationId: args.p_registration_id, seq: args.p_seq,
      registered: args.p_registered, state: args.p_state, detail: args.p_detail, result,
    });
    while (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  private async write(registered: boolean, state: PresenceState, detail: string | null): Promise<HeartbeatResult> {
    if (!this.registrationId) return null;
    this.seq += 1;
    const args: HeartbeatArgs = {
      p_registration_id: this.registrationId,
      p_seq: this.seq,
      p_registered: registered,
      p_state: state,
      p_detail: detail ? detail.slice(0, 64) : null,
    };
    try {
      const result = await this.deps.rpc(args);
      this.record(args, result);
      if (result && result.applied === false) {
        this.deps.log("presence write ignored by the server", { reason: result.reason, seq: args.p_seq });
      }
      return result;
    } catch (err) {
      this.record(args, "error");
      this.deps.log("presence write failed", { err: String(err), seq: args.p_seq });
      return null;
    }
  }
}
