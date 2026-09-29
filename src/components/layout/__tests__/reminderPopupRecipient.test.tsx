/**
 * ReminderPopup — who receives a personal appointment reminder, and for which appointments.
 *
 * Brief (implementation plan §5, §11 "Reminders", traceability Own-3 / Own-4 / Own-8):
 *   - recipient = the RESPONSIBLE user only (`user_id`; `created_by` only when `user_id` IS NULL — AGENT_RULES #22).
 *     An Admin's CalendarContext list is org-wide and also carries rows the Admin booked for others, so the
 *     scheduler must NOT get the assignee's reminder;
 *   - open appointments only (Scheduled / Confirmed), judged on the RAW database status — the calendar mapper
 *     coerces an unknown value such as a lowercase `cancelled` to "Scheduled" for display;
 *   - a queued or on-screen reminder is dropped/closed once a refreshed list shows it reassigned away,
 *     cancelled or gone;
 *   - a silent `fetchAppointments({ silent: true })` every 5 minutes while the tab is visible.
 *
 * "No reminder" is asserted as NO dialog ever mounted (a MutationObserver log) and NO chime (a counting
 * AudioContext stub) — not merely "no dialog at the end". Queue revalidation would otherwise close a dialog the
 * selection wrongly queued within the same act() and hide a missing status gate, while the user still sees a
 * flash and hears the chime.
 *
 * Most cases mock `useCalendar`; the "real CalendarProvider" block renders the real provider (mocked Supabase
 * client returning RAW rows) so raw row → mapper → reminder is covered end to end.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarAppointment } from "@/contexts/CalendarContext";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORG = "11111111-1111-4111-8111-111111111111";
const CONTACT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const NOW = Date.parse("2026-09-28T21:00:00.000Z");
const MIN = 60 * 1000;

type RawRow = Record<string, unknown>;

const h = vi.hoisted(() => ({
  userId: null as string | null,
  /** Mocked-context mode: the list `useCalendar()` returns. */
  appointments: [] as unknown[],
  fetchAppointments: vi.fn((_opts?: { silent?: boolean }) => Promise.resolve()),
  /** true → `useCalendar` is the REAL hook reading the REAL CalendarProvider. */
  useRealCalendar: false,
  /** Real-provider mode: raw `appointments` rows the mocked client returns. */
  rawRows: [] as Record<string, unknown>[],
  queries: [] as { table: string; eq: Record<string, unknown> }[],
  navigate: vi.fn(),
  /** Times the reminder chime tried to play (AudioContext constructed). */
  chimes: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec = { table, eq: {} as Record<string, unknown> };
    h.queries.push(rec);
    const result = () =>
      table === "appointments" ? { data: h.rawRows.map((r) => ({ ...r })), error: null } : { data: [], error: null };
    const b: Record<string, unknown> = {
      select() { return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      gte() { return b; }, lte() { return b; }, order() { return b; },
      insert() { return b; }, update() { return b; }, delete() { return b; },
      single() { return Promise.resolve({ data: { phone: "+15555550100" }, error: null }); },
      // user_preferences: no saved settings → default 10-minute lead time.
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return b;
  }
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      channel: () => channel,
      removeChannel: () => {},
      auth: {},
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => {
    const profile = h.userId
      ? { id: h.userId, organization_id: "11111111-1111-4111-8111-111111111111", role: h.userId.startsWith("a") ? "Admin" : "Agent" }
      : null;
    return {
      user: h.userId ? { id: h.userId } : null,
      profile,
      realProfile: profile,
      isImpersonating: false,
    };
  },
}));

vi.mock("@/contexts/CalendarContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/CalendarContext")>();
  return {
    ...actual,
    // `h.useRealCalendar` is fixed for a test's lifetime, so the hook order never changes between renders.
    useCalendar: () =>
      h.useRealCalendar
        ? actual.useCalendar()
        : {
            appointments: h.appointments,
            loading: false,
            addAppointment: vi.fn(),
            updateAppointment: vi.fn(),
            deleteAppointment: vi.fn(),
            fetchAppointments: h.fetchAppointments,
            todayCount: 0,
          },
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => h.navigate };
});

import ReminderPopup from "@/components/layout/ReminderPopup";
import { CalendarProvider, useCalendar } from "@/contexts/CalendarContext";

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

/** A mapped CalendarAppointment as the context exposes it: Agent A's, booked by the Admin, starting in 5 min. */
function appt(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  const start = new Date(NOW + 5 * MIN);
  return {
    id: "appt-for-a",
    title: "Policy review with Jordan",
    type: "Policy Review",
    status: "Scheduled",
    date: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
    startTime: "2:05 PM",
    endTime: "2:35 PM",
    contactName: "Jordan Kay",
    contactId: CONTACT,
    agent: "",
    notes: "",
    start_time: start.toISOString(),
    end_time: iso(35 * MIN),
    user_id: AGENT_A,
    created_by: ADMIN,
    raw_status: "Scheduled",
    ...overrides,
  };
}

/** Same row with a stored status that the mapper recognises (mapped status === raw status). */
const withStatus = (status: CalendarAppointment["status"], overrides: Partial<CalendarAppointment> = {}) =>
  appt({ status, raw_status: status, ...overrides });

/** A RAW `appointments` row as PostgREST returns it. */
function rawRow(overrides: RawRow = {}): RawRow {
  return {
    id: "raw-for-a",
    organization_id: ORG,
    title: "Discovery call with Riley",
    type: "Sales Call",
    status: "Scheduled",
    start_time: iso(5 * MIN),
    end_time: iso(35 * MIN),
    user_id: AGENT_A,
    created_by: ADMIN,
    contact_id: CONTACT,
    contact_name: "Riley Stone",
    notes: null,
    ...overrides,
  };
}

const dialog = () => screen.queryByRole("dialog");
const showsReminderFor = (title: string) => {
  expect(dialog()).not.toBeNull();
  expect(screen.getByText("Appointment Reminder")).toBeInTheDocument();
  expect(screen.getByText(title)).toBeInTheDocument();
};

// Every reminder dialog ever mounted, even one unmounted again within the same act().
let dialogObserver: MutationObserver | null = null;
let mountedDialogs: string[] = [];
function logDialogs(records: MutationRecord[]) {
  for (const r of records) {
    for (const node of Array.from(r.addedNodes)) {
      if (!(node instanceof Element)) continue;
      const found = node.matches('[role="dialog"]') ? [node] : Array.from(node.querySelectorAll('[role="dialog"]'));
      for (const d of found) mountedDialogs.push(d.textContent ?? "");
    }
  }
}
const everMountedDialogs = () => {
  if (dialogObserver) logDialogs(dialogObserver.takeRecords());
  return mountedDialogs;
};
/** No dialog was ever mounted and no chime was ever attempted. */
const expectNeverAlerted = () => {
  expect(everMountedDialogs(), "a reminder dialog was mounted").toEqual([]);
  expect(h.chimes, "the reminder chime played").toBe(0);
};

/** jsdom has no Web Audio: count the attempt, then fail like an unsupported browser (the popup catches it). */
class CountingAudioContext {
  constructor() {
    h.chimes += 1;
    throw new Error("Web Audio is not available in jsdom");
  }
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Mocked-context render; `update` swaps the list the context returns and re-renders (a "refresh"). */
function renderPopup(list: CalendarAppointment[]) {
  h.appointments = list;
  const utils = render(<ReminderPopup />);
  return {
    ...utils,
    update(next: CalendarAppointment[]) {
      h.appointments = next;
      utils.rerender(<ReminderPopup />);
    },
  };
}

let visibility: "visible" | "hidden" = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  h.userId = null;
  h.appointments = [];
  h.useRealCalendar = false;
  h.rawRows = [];
  h.queries = [];
  h.fetchAppointments.mockClear();
  h.navigate.mockClear();
  h.chimes = 0;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: CountingAudioContext });
  // The chime's catch logs "Audio not supported".
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mountedDialogs = [];
  dialogObserver = new MutationObserver(logDialogs);
  dialogObserver.observe(document.body, { childList: true, subtree: true });
});

afterEach(() => {
  cleanup();
  dialogObserver?.disconnect();
  dialogObserver = null;
  Reflect.deleteProperty(window, "AudioContext");
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "onLine");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── recipient ─────────────────────────────────────────────────────────────────────────────────────

describe("ReminderPopup recipient = the assigned user only", () => {
  it("an Admin viewer gets NO dialog for Agent A's appointment that the Admin booked (user_id = A, created_by = Admin)", async () => {
    h.userId = ADMIN;
    renderPopup([appt()]);
    expect(dialog()).toBeNull();

    // Still nothing across several 30-second checks inside the reminder window.
    await advance(2 * MIN);
    expect(dialog()).toBeNull();
    expectNeverAlerted();
  });

  it("an Admin viewer DOES get the dialog for their own appointment — and never for Agent A's in the same list", async () => {
    h.userId = ADMIN;
    const own = appt({ id: "appt-admin-own", title: "Admin's own renewal call", user_id: ADMIN, created_by: ADMIN });
    renderPopup([appt(), own]);
    showsReminderFor("Admin's own renewal call");
    expect(screen.queryByText("Policy review with Jordan")).toBeNull();

    // Nothing was queued behind it: dismissing leaves no dialog.
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await advance(1 * MIN);
    expect(dialog()).toBeNull();
    expect(screen.queryByText("Policy review with Jordan")).toBeNull();
    expect(everMountedDialogs().some((t) => t.includes("Policy review with Jordan"))).toBe(false);
    expect(h.chimes).toBe(1);
  });

  it("Agent A viewer gets the dialog for the row the Admin booked for them (user_id = A, created_by = Admin)", () => {
    h.userId = AGENT_A;
    renderPopup([appt()]);
    showsReminderFor("Policy review with Jordan");
    expect(screen.getByText("Jordan Kay")).toBeInTheDocument();
    expect(h.chimes).toBe(1);
  });

  it("an unrelated org-visible row (another agent's own appointment) never reminds the Admin", async () => {
    h.userId = ADMIN;
    renderPopup([appt({ user_id: AGENT_B, created_by: AGENT_B })]);
    await advance(1 * MIN);
    expectNeverAlerted();
  });

  it("created_by never rescues a row whose user_id is someone else (scheduler Agent A, assignee Agent B)", async () => {
    h.userId = AGENT_A;
    renderPopup([appt({ user_id: AGENT_B, created_by: AGENT_A })]);
    await advance(1 * MIN);
    expectNeverAlerted();
  });
});

// ── status gate ───────────────────────────────────────────────────────────────────────────────────

describe("ReminderPopup reminds only for open appointments (raw status)", () => {
  it.each(["Cancelled", "Completed", "No Show"] as const)("%s → no dialog for the assignee", async (status) => {
    h.userId = AGENT_A;
    renderPopup([withStatus(status)]);
    expect(dialog()).toBeNull();
    await advance(2 * MIN);
    expect(dialog()).toBeNull();
    expectNeverAlerted();
  });

  it("Confirmed → dialog", () => {
    h.userId = AGENT_A;
    renderPopup([withStatus("Confirmed")]);
    showsReminderFor("Policy review with Jordan");
    expect(h.chimes).toBe(1);
  });

  it("Scheduled → dialog (positive control for the status cases)", () => {
    h.userId = AGENT_A;
    renderPopup([withStatus("Scheduled")]);
    showsReminderFor("Policy review with Jordan");
    expect(everMountedDialogs()).toHaveLength(1);
    expect(h.chimes).toBe(1);
  });

  it.each(["cancelled", "canceled", "no_show", " CANCELLED "])(
    "a raw %j stored status gives no dialog even though the mapped status reads 'Scheduled'",
    async (raw) => {
      h.userId = AGENT_A;
      renderPopup([appt({ status: "Scheduled", raw_status: raw })]);
      expect(dialog()).toBeNull();
      await advance(2 * MIN);
      expect(dialog()).toBeNull();
      expectNeverAlerted();
    },
  );
});

// ── queue revalidation ────────────────────────────────────────────────────────────────────────────

describe("ReminderPopup revalidates queued and on-screen reminders when the list refreshes", () => {
  it("a SHOWING reminder closes when the refreshed list shows it reassigned away (A → B)", () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt()]);
    showsReminderFor("Policy review with Jordan");

    update([appt({ user_id: AGENT_B })]);
    expect(dialog()).toBeNull();
    expect(screen.queryByText("Policy review with Jordan")).toBeNull();
  });

  it("a SHOWING reminder closes when the refreshed list shows it cancelled", () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt()]);
    showsReminderFor("Policy review with Jordan");

    update([withStatus("Cancelled")]);
    expect(dialog()).toBeNull();
  });

  it("a SHOWING reminder closes when the refreshed list shows a raw lowercase 'cancelled' (mapped 'Scheduled')", () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt()]);
    showsReminderFor("Policy review with Jordan");

    update([appt({ status: "Scheduled", raw_status: "cancelled" })]);
    expect(dialog()).toBeNull();
  });

  it("a SHOWING reminder closes when the row is gone from the refreshed list", () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt()]);
    showsReminderFor("Policy review with Jordan");

    update([]);
    expect(dialog()).toBeNull();
  });

  it("a still-eligible SHOWING reminder stays open across a refresh (the row is a new object)", () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt()]);
    showsReminderFor("Policy review with Jordan");

    update([appt({ notes: "Bring the illustration" })]);
    showsReminderFor("Policy review with Jordan");
  });

  it("positive control: a second due reminder is QUEUED and shows after the first is dismissed", async () => {
    h.userId = AGENT_A;
    const second = appt({ id: "appt-for-a-2", title: "Beneficiary update with Casey", start_time: iso(6 * MIN) });
    renderPopup([appt(), second]);
    showsReminderFor("Policy review with Jordan");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await advance(250);
    showsReminderFor("Beneficiary update with Casey");
  });

  it("a QUEUED reminder is dropped when the refreshed list shows it reassigned away", async () => {
    h.userId = AGENT_A;
    const second = appt({ id: "appt-for-a-2", title: "Beneficiary update with Casey", start_time: iso(6 * MIN) });
    const { update } = renderPopup([appt(), second]);
    showsReminderFor("Policy review with Jordan");

    update([appt(), { ...second, user_id: AGENT_B }]);
    showsReminderFor("Policy review with Jordan"); // the on-screen one is still Agent A's

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await advance(1 * MIN);
    expect(dialog()).toBeNull();
    expect(screen.queryByText("Beneficiary update with Casey")).toBeNull();
  });

  it("a QUEUED reminder is dropped when the refreshed list shows it cancelled", async () => {
    h.userId = AGENT_A;
    const second = appt({ id: "appt-for-a-2", title: "Beneficiary update with Casey", start_time: iso(6 * MIN) });
    const { update } = renderPopup([appt(), second]);
    showsReminderFor("Policy review with Jordan");

    update([appt(), { ...second, status: "Cancelled", raw_status: "Cancelled" }]);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await advance(1 * MIN);
    expect(dialog()).toBeNull();
    expect(screen.queryByText("Beneficiary update with Casey")).toBeNull();
  });
});

describe("ReminderPopup queue races (review findings)", () => {
  const second = () => appt({ id: "appt-for-a-2", title: "Beneficiary update with Casey", start_time: iso(6 * MIN) });
  const third = () => appt({ id: "appt-for-a-3", title: "Annual review with Morgan", start_time: iso(7 * MIN) });

  it("a late Dismiss aimed at a reminder that revalidation already closed never wipes the next one", async () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt(), second()]);
    showsReminderFor("Policy review with Jordan");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    // Within the 200 ms close animation the refresh shows the first one cancelled.
    update([withStatus("Cancelled"), second()]);
    showsReminderFor("Beneficiary update with Casey");

    await advance(250);
    showsReminderFor("Beneficiary update with Casey");
    await advance(1 * MIN);
    showsReminderFor("Beneficiary update with Casey");
  });

  it("a Call Now whose lead lookup resolves after its reminder was replaced does not close the new one", async () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt(), second()]);
    showsReminderFor("Policy review with Jordan");

    fireEvent.click(screen.getByRole("button", { name: /call now/i }));
    // The phone lookup is still pending when the refresh reassigns the first reminder away.
    update([appt({ user_id: AGENT_B }), second()]);
    showsReminderFor("Beneficiary update with Casey");

    await flush();
    await advance(250);
    showsReminderFor("Beneficiary update with Casey");
  });

  it("a dismiss timer and a refresh landing in one batch show the next ELIGIBLE reminder and lose none", async () => {
    h.userId = AGENT_A;
    const { rerender } = renderPopup([appt(), second(), third()]);
    showsReminderFor("Policy review with Jordan");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    act(() => {
      h.appointments = [appt(), { ...second(), status: "Cancelled", raw_status: "Cancelled" }, third()];
      rerender(<ReminderPopup />);
      vi.advanceTimersByTime(250);
    });
    await flush();
    showsReminderFor("Annual review with Morgan");
    expect(screen.queryByText("Beneficiary update with Casey")).toBeNull();
  });

  it("a queued reminder dropped by revalidation fires again once the appointment is eligible again", async () => {
    h.userId = AGENT_A;
    const { update } = renderPopup([appt(), second()]);
    showsReminderFor("Policy review with Jordan");

    update([appt(), { ...second(), user_id: AGENT_B }]); // dropped from the queue, never displayed
    update([appt(), second()]); // an Admin reassigns it back to Agent A

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await advance(250);
    showsReminderFor("Beneficiary update with Casey");
  });
});

// ── silent refresh wiring ─────────────────────────────────────────────────────────────────────────

describe("ReminderPopup keeps the list fresh while the tab is visible", () => {
  it("calls fetchAppointments({ silent: true }) after 5 minutes while visible, and not before", async () => {
    h.userId = AGENT_A;
    renderPopup([]);
    expect(h.fetchAppointments).not.toHaveBeenCalled();

    await advance(5 * MIN - 1);
    expect(h.fetchAppointments).not.toHaveBeenCalled();
    await advance(1);
    expect(h.fetchAppointments).toHaveBeenCalledTimes(1);
    expect(h.fetchAppointments).toHaveBeenCalledWith({ silent: true });

    await advance(5 * MIN);
    expect(h.fetchAppointments).toHaveBeenCalledTimes(2);
    expect(h.fetchAppointments.mock.calls.every(([opts]) => opts?.silent === true)).toBe(true);
  });

  it("does not refresh while the tab is hidden", async () => {
    h.userId = AGENT_A;
    renderPopup([]);
    visibility = "hidden";
    await advance(20 * MIN);
    expect(h.fetchAppointments).not.toHaveBeenCalled();
  });

  it("does not refresh without a signed-in user", async () => {
    h.userId = null;
    renderPopup([]);
    await advance(20 * MIN);
    expect(h.fetchAppointments).not.toHaveBeenCalled();
  });
});

// ── end to end under the REAL CalendarProvider ────────────────────────────────────────────────────

describe("ReminderPopup under the real CalendarProvider (raw row → mapper → reminder)", () => {
  /** Exposes what the real provider mapped, so a "no dialog" result is never vacuous. */
  const Probe: React.FC = () => {
    const { appointments } = useCalendar();
    return (
      <ul data-testid="probe">
        {appointments.map((a) => (
          <li key={a.id}>{`${a.id}|${a.status}|${a.raw_status}|${a.user_id ?? "null"}|${a.created_by ?? "null"}`}</li>
        ))}
      </ul>
    );
  };

  const renderReal = async () => {
    h.useRealCalendar = true;
    const utils = render(
      <CalendarProvider>
        <ReminderPopup />
        <Probe />
      </CalendarProvider>,
    );
    await flush();
    return utils;
  };
  const probeRows = () => Array.from(screen.getByTestId("probe").querySelectorAll("li")).map((li) => li.textContent);
  const apptQueries = () => h.queries.filter((q) => q.table === "appointments");

  it("Agent A gets the reminder for a raw row the Admin booked for them; the read is org-scoped", async () => {
    h.userId = AGENT_A;
    h.rawRows = [rawRow()];
    await renderReal();

    expect(probeRows()).toEqual([`raw-for-a|Scheduled|Scheduled|${AGENT_A}|${ADMIN}`]);
    showsReminderFor("Discovery call with Riley");
    expect(apptQueries().length).toBeGreaterThan(0);
    for (const q of apptQueries()) expect(q.eq.organization_id).toBe(ORG);
  });

  it("the Admin who booked that same raw row gets none, although the row is in their list", async () => {
    h.userId = ADMIN;
    h.rawRows = [rawRow()];
    await renderReal();

    expect(probeRows()).toEqual([`raw-for-a|Scheduled|Scheduled|${AGENT_A}|${ADMIN}`]);
    expect(dialog()).toBeNull();
    await advance(2 * MIN);
    expect(dialog()).toBeNull();
    expectNeverAlerted();
  });

  it("a raw lowercase 'cancelled' row maps to status 'Scheduled' but keeps raw_status, and never reminds", async () => {
    h.userId = AGENT_A;
    h.rawRows = [rawRow({ status: "cancelled" })];
    await renderReal();

    expect(probeRows()).toEqual([`raw-for-a|Scheduled|cancelled|${AGENT_A}|${ADMIN}`]);
    expect(dialog()).toBeNull();
    await advance(2 * MIN);
    expect(dialog()).toBeNull();
    expectNeverAlerted();
  });

  it("invariant #22: a NULL user_id raw row reminds its creator (created_by survives the mapper)", async () => {
    h.userId = AGENT_A;
    h.rawRows = [rawRow({ id: "raw-quick-call", title: "Callback", user_id: null, created_by: AGENT_A })];
    await renderReal();

    expect(probeRows()).toEqual([`raw-quick-call|Scheduled|Scheduled|null|${AGENT_A}`]);
    showsReminderFor("Callback");
  });

  it("an appointment booked for Agent A AFTER load reaches A through the 5-minute silent refresh", async () => {
    h.userId = AGENT_A;
    h.rawRows = [];
    await renderReal();
    expect(probeRows()).toEqual([]);
    expectNeverAlerted();

    // The Admin books A at 2:00 for 2:12 from another browser; `appointments` has no realtime delivery.
    h.rawRows = [rawRow({ start_time: iso(12 * MIN), end_time: iso(42 * MIN) })];
    await advance(5 * MIN);
    await flush();

    expect(probeRows()).toEqual([`raw-for-a|Scheduled|Scheduled|${AGENT_A}|${ADMIN}`]);
    showsReminderFor("Discovery call with Riley");
  });

  it("an on-screen reminder closes once the silent refresh shows the row reassigned to Agent B", async () => {
    h.userId = AGENT_A;
    h.rawRows = [rawRow({ start_time: iso(8 * MIN), end_time: iso(38 * MIN) })];
    await renderReal();
    showsReminderFor("Discovery call with Riley");

    h.rawRows = [rawRow({ start_time: iso(8 * MIN), end_time: iso(38 * MIN), user_id: AGENT_B })];
    await advance(5 * MIN);
    await flush();

    expect(probeRows()).toEqual([`raw-for-a|Scheduled|Scheduled|${AGENT_B}|${ADMIN}`]);
    expect(dialog()).toBeNull();
  });
});
