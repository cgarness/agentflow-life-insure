import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { parseNotice } from "./headers.ts";

const ID = "gs1" + "A".repeat(40);
const TOKEN = "t".repeat(43);
const base = () => new Headers({
  "X-Goog-Channel-ID": ID, "X-Goog-Channel-Token": TOKEN, "X-Goog-Resource-ID": "res-ABC_123",
  "X-Goog-Resource-State": "update", "X-Goog-Message-Number": "7", "X-Goog-Changed": "content,Properties",
  "X-Goog-Resource-URI": "https://www.googleapis.com/drive/v3/files/IGNORED?alt=json",
});

Deno.test("headers: a well-formed notification parses (resource URI ignored; changed normalised)", () => {
  const r = parseNotice(base());
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.notice, { channelId: ID, token: TOKEN, resourceId: "res-ABC_123", state: "update", messageNumber: 7, changed: "content,properties" });
  }
});

Deno.test("headers: each malformed field is refused before any lookup", () => {
  const cases: [string, string | null, string][] = [
    ["X-Goog-Channel-ID", null, "channel_id"], ["X-Goog-Channel-ID", "x".repeat(43), "channel_id"],
    ["X-Goog-Channel-ID", ID + "Z", "channel_id"], ["X-Goog-Channel-Token", null, "token"],
    ["X-Goog-Channel-Token", "short", "token"], ["X-Goog-Resource-ID", null, "resource_id"],
    ["X-Goog-Resource-ID", "has space", "resource_id"], ["X-Goog-Resource-ID", "r".repeat(257), "resource_id"],
    ["X-Goog-Resource-State", null, "state"], ["X-Goog-Resource-State", "up-date!", "state"],
    ["X-Goog-Message-Number", null, "message_number"], ["X-Goog-Message-Number", "-1", "message_number"],
    ["X-Goog-Message-Number", "9".repeat(16), "message_number"],
  ];
  for (const [name, value, reason] of cases) {
    const h = base();
    if (value === null) h.delete(name); else h.set(name, value);
    const r = parseNotice(h);
    assertEquals(r.ok ? "ok" : r.reason, reason, `${name}=${value}`);
  }
});

Deno.test("headers: a sync message (number 1, no X-Goog-Changed) parses", () => {
  const h = base();
  h.set("X-Goog-Resource-State", "sync"); h.set("X-Goog-Message-Number", "1"); h.delete("X-Goog-Changed");
  const r = parseNotice(h);
  assertEquals(r.ok && r.notice.state, "sync");
  assertEquals(r.ok && r.notice.changed, "");
});
