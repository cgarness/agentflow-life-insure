import React, { useMemo, useState } from "react";
import { formatModeValue, modeValue, stateName, type RegionalMode, type StateRow } from "@/lib/reports-regional";
import type { ReportStateBreakdownV3 } from "@/lib/reports-v3-schemas";
import { UNMAPPED_REASON_LABELS } from "@/lib/reports-v3-text";
import ReportTableFrame from "../ReportTableFrame";
import { TD, TD_FIRST, TF, TF_FIRST, TH, TH_FIRST, TR } from "../reportTableStyles";

type SortKey = "state" | "calls_made" | "contacted_calls" | "policies_sold" | "ap";
const COLS: [SortKey, string][] = [["calls_made", "Calls made"], ["contacted_calls", "Contacted calls"], ["policies_sold", "Policies sold"], ["ap", "AP"]];

/** The accessible state table: sortable (aria-sort), with Mapped total, Unmapped and Total footer rows that never move. */
const StateTable: React.FC<{ data: ReportStateBreakdownV3 }> = ({ data }) => {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "calls_made", desc: true });
  const rows = useMemo(() => [...data.jurisdictions].sort((a, b) => {
    const d = sort.key === "state" ? stateName(a.state).localeCompare(stateName(b.state)) : (modeValue(a, sort.key as RegionalMode) ?? -1) - (modeValue(b, sort.key as RegionalMode) ?? -1);
    return (sort.desc ? -d : d) || stateName(a.state).localeCompare(stateName(b.state));
  }), [data.jurisdictions, sort]);
  type Sums = { calls_made: number; contacted_calls: number; policies_sold: number; missing: number };
  const mapped = data.jurisdictions.reduce<Sums>((acc, j) => ({ calls_made: acc.calls_made + j.calls_made, contacted_calls: acc.contacted_calls + j.contacted_calls,
    policies_sold: acc.policies_sold + j.policies_sold, missing: acc.missing + j.premium.missing_count }), { calls_made: 0, contacted_calls: 0, policies_sold: 0, missing: 0 });
  const header = (key: SortKey, label: string, first = false) => (
    <th scope="col" className={first ? TH_FIRST : TH} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== "state" }))}
        className="rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</button>
    </th>
  );
  const valueCells = (r: Pick<StateRow, "calls_made" | "contacted_calls" | "policies_sold" | "premium">) => (
    <>{COLS.map(([k]) => <td key={k} className={TD}>{formatModeValue(modeValue(r, k as RegionalMode), k as RegionalMode)}</td>)}<td className={TD}>{r.premium.missing_count + r.premium.invalid_count || ""}</td></>
  );
  return (
    <ReportTableFrame label="Regional performance table" tableClassName="min-w-[40rem]">
        <thead><tr>{header("state", "State", true)}{COLS.map(([k, l]) => header(k, l))}<th scope="col" className={TH}>Missing premium</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.state} className={TR}><th scope="row" className={TD_FIRST}>{stateName(r.state)}</th>{valueCells(r)}</tr>)}</tbody>
        <tfoot>
          <tr><th scope="row" className={TF_FIRST}>Mapped total</th>
            <td className={TF}>{mapped.calls_made.toLocaleString("en-US")}</td><td className={TF}>{mapped.contacted_calls.toLocaleString("en-US")}</td>
            <td className={TF}>{mapped.policies_sold.toLocaleString("en-US")}</td><td className={TF} /><td className={TF}>{mapped.missing || ""}</td></tr>
          <tr><th scope="row" className={TF_FIRST}>
            <details><summary className="cursor-pointer">Unmapped</summary>
              <ul className="mt-1 space-y-0.5 text-[11px] font-normal text-muted-foreground">
                {data.unmapped.reasons.map(r => <li key={r.reason}>{UNMAPPED_REASON_LABELS[r.reason]}: {r.calls_made.toLocaleString("en-US")} calls, {r.policies_sold} policies</li>)}
              </ul></details></th>{valueCells(data.unmapped)}</tr>
          <tr><th scope="row" className={TF_FIRST}>Total</th>{valueCells(data.totals)}</tr>
        </tfoot>
    </ReportTableFrame>
  );
};

export default StateTable;
