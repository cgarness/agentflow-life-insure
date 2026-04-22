import { handlesMatch } from "./phone.ts";
import { INSIGHTS_BASE } from "./constants.ts";

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

export type CreateReportResult =
  | { ok: true; report_id: string; status?: string }
  | { ok: false; status: number; body: string };

export async function createOutboundReport(
  accountSid: string,
  authToken: string,
  startIso: string,
  endIso: string,
): Promise<CreateReportResult> {
  const bodyVariants = [
    { time_range: { start_time: startIso, end_time: endIso }, size: 6000 },
    { time_range: { start_datetime: startIso, end_datetime: endIso }, size: 6000 },
  ];

  for (const jsonBody of bodyVariants) {
    const res = await fetch(INSIGHTS_BASE, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(accountSid, authToken),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(jsonBody),
    });
    const text = await res.text();
    if (!res.ok) {
      if (bodyVariants.indexOf(jsonBody) === bodyVariants.length - 1) {
        return { ok: false, status: res.status, body: text.slice(0, 2000) };
      }
      continue;
    }
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, status: 502, body: "Invalid JSON from Twilio Insights" };
    }
    const report_id = String(data.report_id ?? "");
    if (!report_id) return { ok: false, status: 502, body: "Missing report_id from Twilio" };
    return { ok: true, report_id, status: String(data.status ?? "") };
  }
  return { ok: false, status: 500, body: "Unreachable" };
}

export type ListReportsResult =
  | { ok: true; reports: Record<string, unknown>[]; raw_status?: string }
  | { ok: false; status: number; body: string };

export async function listOutboundReportPage(
  accountSid: string,
  authToken: string,
  reportId: string,
  pageSize: number,
): Promise<ListReportsResult> {
  const url = `${INSIGHTS_BASE}/${encodeURIComponent(reportId)}?PageSize=${pageSize}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: basicAuthHeader(accountSid, authToken),
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 2000) };
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, status: 502, body: "Invalid JSON listing report" };
  }
  const reports = Array.isArray(data.reports) ? (data.reports as Record<string, unknown>[]) : [];
  const raw_status = typeof data.status === "string" ? data.status : undefined;
  return { ok: true, reports, raw_status };
}

export async function pollOutboundReportForHandle(
  accountSid: string,
  authToken: string,
  reportId: string,
  targetPhone: string,
  opts: { maxAttempts: number; delayMs: number },
): Promise<{ row: Record<string, unknown> | null; lastReportsLen: number; raw_status?: string }> {
  let lastLen = 0;
  let lastStatus: string | undefined;
  for (let i = 0; i < opts.maxAttempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, opts.delayMs));
    const page = await listOutboundReportPage(accountSid, authToken, reportId, 1000);
    if (!page.ok) {
      throw new Error(`Twilio Insights list failed (${page.status}): ${page.body}`);
    }
    lastLen = page.reports.length;
    lastStatus = page.raw_status;
    const match = page.reports.find((r) => {
      const h = String(r.handle ?? r.from ?? r.phone_number ?? r.caller_id ?? "");
      return handlesMatch(h, targetPhone);
    });
    if (match) return { row: match, lastReportsLen: lastLen, raw_status: lastStatus };
    if (lastStatus === "completed") {
      break;
    }
  }
  return { row: null, lastReportsLen: lastLen, raw_status: lastStatus };
}
