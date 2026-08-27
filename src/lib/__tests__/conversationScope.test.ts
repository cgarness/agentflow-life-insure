/**
 * conversationScope + effectiveViewer — pure unit tests, no React and no Supabase.
 *
 * These pin the three rules the Conversations sidebar depends on:
 *   1. SMS/email event timestamps decide recency (never the row's insert time).
 *   2. One row per contact, newest first, with unparseable timestamps DROPPED not ranked.
 *   3. The organization-wide branch is decided by the EFFECTIVE role — so a Super Admin
 *      impersonating an Agent cannot widen the result.
 */

import { describe, it, expect } from "vitest";
import {
  emailEventAt,
  isValidContactId,
  pickNewestPerContact,
  resolveConversationScope,
  smsEventAt,
} from "@/lib/conversationScope";
import {
  buildEffectiveViewer,
  effectiveViewerKey,
  isEffectiveSuperAdmin,
  isOrganizationWideViewer,
  type EffectiveViewer,
} from "@/lib/effectiveViewer";

const ORG = "11111111-1111-4111-8111-111111111111";

function viewer(role: string, isImpersonating = false): EffectiveViewer {
  return { viewerId: "22222222-2222-4222-8222-222222222222", role, organizationId: ORG, isImpersonating };
}

describe("smsEventAt — sent_at, with created_at only as a legacy fallback", () => {
  it("prefers sent_at", () => {
    expect(smsEventAt({ sent_at: "2026-08-01T10:00:00Z", created_at: "2026-08-20T10:00:00Z" }))
      .toBe("2026-08-01T10:00:00Z");
  });

  it("falls back to created_at when sent_at is null", () => {
    expect(smsEventAt({ sent_at: null, created_at: "2026-08-20T10:00:00Z" }))
      .toBe("2026-08-20T10:00:00Z");
  });

  it("returns null when both are missing — never undefined, never NaN", () => {
    expect(smsEventAt({ sent_at: null, created_at: null })).toBeNull();
    expect(smsEventAt({})).toBeNull();
    expect(smsEventAt(null)).toBeNull();
  });

  it("rejects an unparseable timestamp rather than passing it through", () => {
    expect(smsEventAt({ sent_at: "not-a-date", created_at: "2026-08-20T10:00:00Z" }))
      .toBe("2026-08-20T10:00:00Z");
  });
});

describe("emailEventAt — the real event time for the row's direction", () => {
  it("inbound ranks by received_at", () => {
    expect(emailEventAt({
      direction: "inbound",
      received_at: "2026-08-01T10:00:00Z",
      sent_at: "2026-07-01T10:00:00Z",
      created_at: "2026-08-25T10:00:00Z",
    })).toBe("2026-08-01T10:00:00Z");
  });

  it("outbound ranks by sent_at", () => {
    expect(emailEventAt({
      direction: "outbound",
      received_at: "2026-08-01T10:00:00Z",
      sent_at: "2026-07-01T10:00:00Z",
      created_at: "2026-08-25T10:00:00Z",
    })).toBe("2026-07-01T10:00:00Z");
  });

  it("falls back to created_at per direction", () => {
    expect(emailEventAt({ direction: "inbound", received_at: null, created_at: "2026-08-25T10:00:00Z" }))
      .toBe("2026-08-25T10:00:00Z");
    expect(emailEventAt({ direction: "outbound", sent_at: null, created_at: "2026-08-25T10:00:00Z" }))
      .toBe("2026-08-25T10:00:00Z");
  });

  it("never ranks a backfilled email by its sync-insert time", () => {
    // received months ago, synced today — it must NOT outrank today's traffic.
    const backfilled = emailEventAt({
      direction: "inbound",
      received_at: "2026-01-05T09:00:00Z",
      created_at: "2026-08-27T09:00:00Z",
    });
    expect(backfilled).toBe("2026-01-05T09:00:00Z");
  });
});

describe("pickNewestPerContact", () => {
  it("returns exactly one row per contact, newest first", () => {
    const out = pickNewestPerContact([
      { contact_id: "a", event_at: "2026-08-01T00:00:00Z" },
      { contact_id: "b", event_at: "2026-08-03T00:00:00Z" },
      { contact_id: "a", event_at: "2026-08-05T00:00:00Z" },
    ]);
    expect(out.map((r) => r.contact_id)).toEqual(["a", "b"]);
    expect(out[0].event_at).toBe("2026-08-05T00:00:00Z");
  });

  it("DROPS rows with an unusable timestamp instead of ranking them as NaN", () => {
    const out = pickNewestPerContact([
      { contact_id: "bad", event_at: null },
      { contact_id: "worse", event_at: "not-a-date" },
      { contact_id: "good", event_at: "2026-08-05T00:00:00Z" },
    ]);
    expect(out.map((r) => r.contact_id)).toEqual(["good"]);
    // Nothing that reaches the renderer can produce `Invalid time value`.
    for (const row of out) expect(Number.isNaN(Date.parse(row.event_at as string))).toBe(false);
  });

  it("is deterministic on ties", () => {
    const rows = [
      { contact_id: "b", event_at: "2026-08-05T00:00:00Z" },
      { contact_id: "a", event_at: "2026-08-05T00:00:00Z" },
    ];
    expect(pickNewestPerContact(rows).map((r) => r.contact_id)).toEqual(["a", "b"]);
    expect(pickNewestPerContact([...rows].reverse()).map((r) => r.contact_id)).toEqual(["a", "b"]);
  });

  it("tolerates an empty or malformed input", () => {
    expect(pickNewestPerContact([])).toEqual([]);
    expect(pickNewestPerContact([{ contact_id: "", event_at: "2026-08-05T00:00:00Z" }])).toEqual([]);
  });
});

describe("isOrganizationWideViewer — the anti-widening predicate", () => {
  it("Admin is organization-wide", () => {
    expect(isOrganizationWideViewer(viewer("Admin"))).toBe(true);
  });

  it("a non-impersonating Super Admin is organization-wide (home org)", () => {
    expect(isOrganizationWideViewer(viewer("Super Admin", false))).toBe(true);
  });

  it("a Super Admin VIEWING AS an Agent is NOT organization-wide", () => {
    // The effective role while impersonating is the viewed profile's role.
    expect(isOrganizationWideViewer(viewer("Agent", true))).toBe(false);
  });

  it("a Super Admin viewing as another Super Admin is still not org-wide (impersonating)", () => {
    expect(isOrganizationWideViewer(viewer("Super Admin", true))).toBe(false);
  });

  it("Team Leader and Agent are never organization-wide", () => {
    expect(isOrganizationWideViewer(viewer("Team Leader"))).toBe(false);
    expect(isOrganizationWideViewer(viewer("Agent"))).toBe(false);
  });

  it("an unresolved viewer is never organization-wide", () => {
    expect(isOrganizationWideViewer(null)).toBe(false);
    expect(isOrganizationWideViewer(undefined)).toBe(false);
  });

  it("isEffectiveSuperAdmin excludes an impersonating Super Admin", () => {
    expect(isEffectiveSuperAdmin(viewer("Super Admin", false))).toBe(true);
    expect(isEffectiveSuperAdmin(viewer("Super Admin", true))).toBe(false);
    expect(isEffectiveSuperAdmin(viewer("Agent", true))).toBe(false);
    expect(isEffectiveSuperAdmin(null)).toBe(false);
  });
});

describe("buildEffectiveViewer — fails closed on an incomplete identity", () => {
  it("requires id, role and organization", () => {
    expect(buildEffectiveViewer({ viewerId: "x", role: "Agent", organizationId: ORG })).not.toBeNull();
    expect(buildEffectiveViewer({ viewerId: "", role: "Agent", organizationId: ORG })).toBeNull();
    expect(buildEffectiveViewer({ viewerId: "x", role: "", organizationId: ORG })).toBeNull();
    expect(buildEffectiveViewer({ viewerId: "x", role: "Agent", organizationId: "" })).toBeNull();
  });

  it("rejects the undefined fields a broken View As payload produces", () => {
    // This is exactly the shape the legacy `as unknown as Profile` cast yielded.
    expect(buildEffectiveViewer({ viewerId: undefined, role: undefined, organizationId: undefined })).toBeNull();
  });

  it("keys change when any part of the identity changes", () => {
    const a = effectiveViewerKey(viewer("Agent"));
    const b = effectiveViewerKey(viewer("Team Leader"));
    const c = effectiveViewerKey(viewer("Agent", true));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(effectiveViewerKey(null)).toBeNull();
  });
});

describe("resolveConversationScope — fails closed", () => {
  it("org-wide viewers get an org scope and need no id set", () => {
    expect(resolveConversationScope(viewer("Admin"), null)).toEqual({ kind: "org", organizationId: ORG });
  });

  it("everyone else gets an explicit agent id set", () => {
    expect(resolveConversationScope(viewer("Team Leader"), ["a", "b"]))
      .toEqual({ kind: "agents", organizationId: ORG, agentIds: ["a", "b"] });
  });

  it("an EMPTY id set resolves to null — never an organization-wide fallback", () => {
    expect(resolveConversationScope(viewer("Agent"), [])).toBeNull();
    expect(resolveConversationScope(viewer("Agent"), null)).toBeNull();
  });

  it("an unresolved viewer resolves to null", () => {
    expect(resolveConversationScope(null, ["a"])).toBeNull();
  });
});

describe("isValidContactId — deep-link guard", () => {
  it("accepts a UUID", () => {
    expect(isValidContactId("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rejects anything that could rewrite a PostgREST filter tree", () => {
    expect(isValidContactId("abc,or(organization_id.not.is.null)")).toBe(false);
    expect(isValidContactId("")).toBe(false);
    expect(isValidContactId(null)).toBe(false);
    expect(isValidContactId(undefined)).toBe(false);
    expect(isValidContactId(123)).toBe(false);
  });
});
