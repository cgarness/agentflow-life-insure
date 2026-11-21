// Query-double tests exercise handler boundaries. Real privileges and transactions run in SQL.
export function database(
  seed: Record<string, any[]> = {},
  purchase: unknown = { managed: false },
  legacySender: string | null = null,
) {
  const rows = structuredClone(seed), calls: any[] = [];
  for (const n of rows.phone_numbers ?? []) n.inbounds_only ??= false;
  return {
    rows,
    calls,
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "admin" } }, error: null }) },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "phone_number_setup_managed") return { data: purchase, error: null };
      if (name === "phone_number_setup_legacy_workflow_sender") return { data: legacySender, error: null };
      return { data: true, error: null };
    },
    from(table: string) {
      let action = "select", values: any, single = false, ignore = false;
      const filters: ((r: any) => boolean)[] = [];
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        in: (k: string, values: unknown[]) => {
          filters.push((r) => values.includes(r[k]));
          return q;
        },
        is: (k: string, v: unknown) => {
          filters.push((r) => (r[k] ?? null) === v);
          return q;
        },
        or: () => q,
        lt: (k: string, v: number) => {
          filters.push((r) => r[k] < v);
          return q;
        },
        order: () => q,
        limit: () => q,
        update: (v: any) => {
          action = "update";
          values = v;
          return q;
        },
        insert: (v: any) => {
          action = "insert";
          values = v;
          return q;
        },
        upsert: (v: any, o: any) => {
          action = "insert";
          values = v;
          ignore = o.ignoreDuplicates;
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve().then(() => {
            calls.push({ table, action, values });
            const all = rows[table] ?? (rows[table] = []);
            let selected = all.filter((r) => filters.every((f) => f(r)));
            if (action === "insert") {
              if (table === "a2p_registrations" && all.some((r) => r.organization_id === values.organization_id)) {
                return { data: null, error: { code: "23505" } };
              }
              if (!ignore || !all.some((r) => r.phone_number_id === values.phone_number_id)) {
                all.push({ ...values, version: values.version ?? 1 });
              }
              selected = [all.at(-1)];
            }
            if (action === "update") {
              for (const row of selected) Object.assign(row, values);
            }
            return { data: structuredClone(single ? selected[0] ?? null : selected), error: null };
          }).then(resolve, reject),
      };
      return q;
    },
  };
}
