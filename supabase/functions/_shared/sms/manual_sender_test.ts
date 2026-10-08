import { manualSender } from "./manual.ts";
import type { Policy } from "./consent.ts";
import { SmsError } from "./wire.ts";

type Row = Record<string, unknown>;
class Query
  implements PromiseLike<{ data: Row[] | Row | null; error: unknown }> {
  private filters: ((row: Row) => boolean)[] = [];
  private sorts: { column: string; ascending: boolean }[] = [];
  private single = false;
  constructor(private rows: Row[], private error: unknown = null) {}
  select(_columns: string) {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(column: string, options = { ascending: true }) {
    this.sorts.push({ column, ascending: options.ascending });
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then<
    TResult1 = { data: Row[] | Row | null; error: unknown },
    TResult2 = never,
  >(
    resolve?:
      | ((
        value: { data: Row[] | Row | null; error: unknown },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.rows.filter((row) =>
      this.filters.every((filter) => filter(row))
    );
    rows.sort((a, b) => {
      for (const sort of this.sorts) {
        const av = String(a[sort.column]), bv = String(b[sort.column]);
        if (av !== bv) return av.localeCompare(bv) * (sort.ascending ? 1 : -1);
      }
      return 0;
    });
    return Promise.resolve({
      data: this.single ? rows[0] ?? null : rows,
      error: this.error,
    }).then(resolve, reject);
  }
}
const policy = {
  organization_id: "agency-a",
  selected_phone_ids: ["default", "second", "voice", "other-org", "personal"],
} as Policy;
function fixture() {
  const rows: Record<string, Row[]> = {
    a2p_registrations: [{
      organization_id: "agency-a",
      messaging_service_sid: "service-a",
    }],
    a2p_numbers: [
      ...["default", "second", "personal"].map((id) => ({
        organization_id: "agency-a",
        phone_number_id: id,
        status: "registered",
        messaging_service_sid: "service-a",
      })),
      {
        organization_id: "agency-a",
        phone_number_id: "voice",
        status: "registered",
        messaging_service_sid: "other-service",
      },
      {
        organization_id: "agency-b",
        phone_number_id: "other-org",
        status: "registered",
        messaging_service_sid: "service-a",
      },
    ],
    phone_numbers: [
      {
        id: "voice",
        phone_number: "+19096108403",
        organization_id: "agency-a",
        assignment_type: "agency",
        status: "active",
        is_default: true,
      },
      {
        id: "default",
        phone_number: "+12162706473",
        organization_id: "agency-a",
        assignment_type: "agency",
        status: "active",
        is_default: true,
      },
      {
        id: "second",
        phone_number: "+12136676225",
        organization_id: "agency-a",
        assignment_type: "agency",
        status: "Active",
        is_default: false,
      },
      {
        id: "other-org",
        phone_number: "+19162998778",
        organization_id: "agency-b",
        assignment_type: "agency",
        status: "active",
        is_default: true,
      },
      {
        id: "personal",
        phone_number: "+14632313033",
        organization_id: "agency-a",
        assignment_type: "personal",
        status: "active",
        is_default: true,
      },
    ],
  };
  return {
    rows,
    db: { from: (table: string) => new Query(rows[table] ?? []) },
  };
}
function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}
Deno.test("manual SMS replaces an ineligible voice caller ID with the agency SMS default", async () => {
  equal(
    await manualSender(fixture().db, policy, "+19096108403"),
    "+12162706473",
  );
});
Deno.test("manual SMS retains an eligible chosen sender and normalizes its format", async () => {
  equal(
    await manualSender(fixture().db, policy, "(213) 667-6225"),
    "+12136676225",
  );
});
Deno.test("manual SMS works without a selected voice caller ID", async () => {
  equal(await manualSender(fixture().db, policy, ""), "+12162706473");
});
Deno.test("manual SMS excludes inactive, personal, other-agency and other-service numbers", async () => {
  const f = fixture();
  f.rows.phone_numbers.find((row) => row.id === "default")!.status = "inactive";
  equal(await manualSender(f.db, policy, "+14632313033"), "+12136676225");
});
Deno.test("manual SMS refuses when none of the selected numbers is registered", async () => {
  const f = fixture();
  f.rows.a2p_numbers.forEach((row) => row.status = "pending");
  try {
    await manualSender(f.db, policy, "");
  } catch (error) {
    if (error instanceof SmsError && error.code === "SENDER_NOT_SELECTED") {
      return;
    }
    throw error;
  }
  throw new Error("Missing registered sender was accepted");
});
