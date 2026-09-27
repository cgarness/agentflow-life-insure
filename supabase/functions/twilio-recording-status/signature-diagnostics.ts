// twilio-recording-status — B1 Phase 1: FAILURE-ONLY signature diagnostic (2026-09-27).
//
// Agent-mailbox voicemail callbacks are answered 403 "Signature validation failed" while group-mailbox
// callbacks validate. The one structural difference between the two callback URLs is a percent-encoded
// colon (`mailbox=agent%3A<uuid>` vs `mailbox=group`). That is a HYPOTHESIS, not a proven cause. This
// module measures which canonical form of the SAME request the received signature actually matches, so
// the fix is chosen from evidence.
//
// Contract:
//   - It runs only after the normal validation has already failed, and it can never change the outcome:
//     the caller still answers 403, and nothing is read from or written to any store.
//   - It never throws and never rejects; an internal error is logged as `{ diagnostic_error: true }`.
//   - It logs variant NAMES, counts and booleans only. It never logs the signature, the auth token, any
//     header, the URL, a query value or any other form parameter. CallSid / RecordingSid are logged only
//     when well-formed, otherwise as "invalid" (or "absent"), so a forged request cannot write arbitrary
//     text into the logs.
//   - Every variant is always computed and compared in constant time (no early exit).
//   - Its work is bounded: the sorted parameter suffix is built once and the HMAC key imported once, and a
//     request larger than any real Twilio recording callback (DIAGNOSTIC_LIMITS) is logged as
//     "skipped_oversize" without computing any variant, so a forged oversized body costs nothing extra.
//
// Deno-free on purpose: WebCrypto (`crypto.subtle`) exists in Deno and in Node, so the module is
// type-checked and unit-tested by the application toolchain.

/** Canonical forms of the received query string (`search` includes its leading "?", or is ""). */
export type QueryForm =
  | "raw"
  | "colon_decoded"
  | "colon_encoded"
  | "fully_decoded"
  | "form_reencoded"
  | "legacy_reencoded";

export const QUERY_FORMS: readonly QueryForm[] = [
  "raw",
  "colon_decoded",
  "colon_encoded",
  "fully_decoded",
  "form_reencoded",
  "legacy_reencoded",
];

export interface SignatureVariant {
  name: string;
  url: string;
}

export interface SignatureDiagnosticInput {
  /** The received `X-Twilio-Signature` header, or null. */
  signature: string | null;
  authToken: string;
  /** The public function URL without a query, exactly as the validator builds it. */
  baseUrl: string;
  /** The raw request URL; only its query string is used. */
  requestUrl: string;
  /** The parsed form body, exactly as the validator used it. */
  params: Record<string, string>;
}

export interface SignatureDiagnosticResult {
  matched_variant: string;
  match_count: number;
  variants_checked: number;
  query_had_pct3a: boolean;
  query_had_raw_colon: boolean;
  has_signature: boolean;
  call_sid: string;
  recording_sid: string;
}

export const SIGNATURE_DIAGNOSTIC_LOG_TAG = "[twilio-recording-status] signature-diagnostic";

/** A Twilio recording callback carries about a dozen parameters and well under 2 KB; these are generous. */
export const DIAGNOSTIC_LIMITS = { maxParams: 64, maxSigningChars: 16_384 } as const;

const CALL_SID = /^CA[0-9a-fA-F]{32}$/;
const RECORDING_SID = /^RE[0-9a-fA-F]{32}$/;

function safeDecode(component: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}

function pairs(search: string): Array<[string, string]> {
  return [...new URLSearchParams(search).entries()];
}

/** One canonical form of `search`. Returns "" for an empty query. */
export function queryForm(search: string, form: QueryForm): string {
  if (search === "" || search === "?") return "";
  const body = search.startsWith("?") ? search.slice(1) : search;
  switch (form) {
    case "raw":
      return `?${body}`;
    case "colon_decoded":
      return `?${body.replace(/%3A/gi, ":")}`;
    case "colon_encoded":
      return `?${body.replace(/:/g, "%3A")}`;
    case "fully_decoded":
      return `?${body
        .split("&")
        .map((part) => {
          const eq = part.indexOf("=");
          return eq === -1 ? safeDecode(part) : `${safeDecode(part.slice(0, eq))}=${safeDecode(part.slice(eq + 1))}`;
        })
        .join("&")}`;
    case "form_reencoded": {
      const s = new URLSearchParams(pairs(body)).toString();
      return s ? `?${s}` : "";
    }
    case "legacy_reencoded": {
      const s = pairs(body)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      return s ? `?${s}` : "";
    }
  }
}

/** `https://host/path` → `https://host:443/path`; null when not https or a port is already present. */
export function withPort443(baseUrl: string): string | null {
  const m = /^https:\/\/([^/:?#]+)(\/[^?#]*)?$/.exec(baseUrl);
  if (!m) return null;
  return `https://${m[1]}:443${m[2] ?? ""}`;
}

/** Every named URL variant, in a fixed order (the order also decides `matched_variant`). */
export function buildSignatureVariants(baseUrl: string, search: string): SignatureVariant[] {
  const out: SignatureVariant[] = QUERY_FORMS.map((form) => ({ name: form, url: `${baseUrl}${queryForm(search, form)}` }));
  const ported = withPort443(baseUrl);
  if (ported) {
    for (const form of QUERY_FORMS) out.push({ name: `${form}+port443`, url: `${ported}${queryForm(search, form)}` });
  }
  return out;
}

/** Every POST parameter as key+value, keys sorted — the part of Twilio's signing string after the URL. */
export function paramSuffix(params: Record<string, string>): string {
  let s = "";
  for (const k of Object.keys(params).sort()) s += k + params[k];
  return s;
}

/** Twilio's scheme: URL followed by every POST parameter as key+value, keys sorted. */
export function signingString(url: string, params: Record<string, string>): string {
  return url + paramSuffix(params);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function importHmacKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
}

async function signWith(key: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(sig));
}

export async function hmacSha1Base64(key: string, message: string): Promise<string> {
  return signWith(await importHmacKey(key), message);
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function sidOrMarker(value: string | undefined, pattern: RegExp): string {
  if (value === undefined || value === "") return "absent";
  return pattern.test(value) ? value : "invalid";
}

export async function diagnoseSignatureFailure(input: SignatureDiagnosticInput): Promise<SignatureDiagnosticResult> {
  const search = new URL(input.requestUrl).search;
  const base = {
    query_had_pct3a: /%3A/i.test(search),
    query_had_raw_colon: search.includes(":"),
    has_signature: Boolean(input.signature),
    call_sid: sidOrMarker(input.params["CallSid"], CALL_SID),
    recording_sid: sidOrMarker(input.params["RecordingSid"], RECORDING_SID),
  };
  if (!input.signature) {
    return { matched_variant: "none", match_count: 0, variants_checked: 0, ...base };
  }
  const suffix = paramSuffix(input.params);
  if (
    Object.keys(input.params).length > DIAGNOSTIC_LIMITS.maxParams ||
    input.baseUrl.length + search.length + suffix.length > DIAGNOSTIC_LIMITS.maxSigningChars
  ) {
    return { matched_variant: "skipped_oversize", match_count: 0, variants_checked: 0, ...base };
  }
  const key = await importHmacKey(input.authToken);
  const variants = buildSignatureVariants(input.baseUrl, search);
  const matched: string[] = [];
  for (const v of variants) {
    const expected = await signWith(key, v.url + suffix);
    if (constantTimeEqual(expected, input.signature)) matched.push(v.name);
  }
  return {
    matched_variant: matched[0] ?? "none",
    match_count: matched.length,
    variants_checked: variants.length,
    ...base,
  };
}

/** Logs one diagnostic line. Never throws and never rejects. */
export async function logSignatureDiagnostic(
  input: SignatureDiagnosticInput,
  log: (tag: string, fields: Record<string, unknown>) => void = (tag, fields) => console.warn(tag, fields),
): Promise<void> {
  try {
    const result = await diagnoseSignatureFailure(input);
    log(SIGNATURE_DIAGNOSTIC_LOG_TAG, { ...result });
  } catch {
    try {
      log(SIGNATURE_DIAGNOSTIC_LOG_TAG, { diagnostic_error: true });
    } catch {
      // logging itself failed; the caller's 403 is unaffected
    }
  }
}
