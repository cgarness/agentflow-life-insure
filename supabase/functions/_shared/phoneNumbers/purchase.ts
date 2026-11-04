import { canonicalNumberConfig } from "../twilioNumberConfig.ts";
import { authorize, credentials, type NumberDependencies } from "./auth.ts";
import {
  ACCOUNT_SID,
  type Actor,
  type Credentials,
  isNumberOfType,
  NUMBER_SID,
  NumberError,
  object,
  type Operation,
  OPERATION_STATES,
  type PurchaseInput,
  type QuoteInput,
  readJson,
} from "./contracts.ts";
import {
  exactInventory,
  friendlyName,
  providerOwnsNumber,
  providerRead,
} from "./inventory.ts";
import { currentPrice, quotePrice, samePrice } from "./pricing.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ledgerMessages: Record<string, [string, string]> = {
  admin_required: ["FORBIDDEN", "An active agency administrator is required."],
  telephony_unavailable: [
    "TELEPHONY_SUSPENDED",
    "Agency telephony is unavailable.",
  ],
  operation_not_found: [
    "OPERATION_NOT_FOUND",
    "The purchase could not be found in your agency context.",
  ],
  quote_expired: [
    "QUOTE_EXPIRED",
    "This quote expired. Review current pricing again.",
  ],
  request_conflict: [
    "REQUEST_CONFLICT",
    "This purchase is already bound to another request. Check its status.",
  ],
  number_unavailable: [
    "NUMBER_UNAVAILABLE",
    "This number is unavailable or already has a purchase in progress.",
  ],
  receipt_mismatch: ["PURCHASE_REVIEW", "This purchase needs support review."],
  receipt_conflict: ["PURCHASE_REVIEW", "This purchase needs support review."],
  invalid_operation_state: [
    "PURCHASE_REVIEW",
    "Check this purchase's status before taking another action.",
  ],
};

function operation(
  value: unknown,
  actor: Actor,
  id?: string,
  request?: string,
): Operation {
  const row = object(value);
  if (
    !row || typeof row.id !== "string" || !UUID.test(row.id) ||
    (id && row.id !== id) ||
    row.organization_id !== actor.organizationId || row.actor_id !== actor.id ||
    typeof row.account_sid !== "string" || !ACCOUNT_SID.test(row.account_sid) ||
    (row.number_type !== "local" && row.number_type !== "toll_free") ||
    !isNumberOfType(row.phone_number, row.number_type) ||
    typeof row.friendly_name !== "string" || row.friendly_name.length > 64 ||
    typeof row.expires_at !== "string" ||
    !Number.isFinite(Date.parse(row.expires_at)) ||
    !OPERATION_STATES.includes(row.state as Operation["state"]) ||
    (row.request_id != null &&
      (typeof row.request_id !== "string" || !UUID.test(row.request_id) ||
        (request && row.request_id !== request))) ||
    (row.provider_sid != null &&
      (typeof row.provider_sid !== "string" ||
        !NUMBER_SID.test(row.provider_sid))) ||
    (row.phone_number_id != null &&
      (typeof row.phone_number_id !== "string" ||
        !UUID.test(row.phone_number_id)))
  ) {
    throw new NumberError(
      "LEDGER_UNAVAILABLE",
      "Purchase status could not be verified. Do not purchase this number again.",
      503,
    );
  }
  const result = {
    ...row,
    quote: quotePrice(row.quote),
    request_id: row.request_id ?? null,
    provider_sid: row.provider_sid ?? null,
    phone_number_id: row.phone_number_id ?? null,
  } as Operation;
  if (
    (result.state === "purchased_pending_save" && !result.provider_sid) ||
    (result.state === "completed" &&
      (!result.provider_sid || !result.phone_number_id))
  ) {
    throw new NumberError(
      "LEDGER_UNAVAILABLE",
      "Purchase receipt could not be verified. Do not purchase again.",
      503,
    );
  }
  return result;
}
async function rpc(
  deps: NumberDependencies,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<Operation> {
  const { data, error } = await deps.db.rpc(`phone_number_purchase_${name}`, {
    p_actor: actor.id,
    p_org: actor.organizationId,
    ...args,
  });
  if (error) {
    const status = /^PT(?:400|403|404|409)$/.test(error.code ?? "")
      ? Number(error.code.slice(2))
      : 503;
    const [code, message] = ledgerMessages[error.message] ??
      [
        "LEDGER_UNAVAILABLE",
        "Purchase status could not be verified. Check its status before trying again.",
      ];
    throw new NumberError(code, message, status);
  }
  return operation(
    data,
    actor,
    typeof args.p_quote === "string" ? args.p_quote : undefined,
    typeof args.p_request === "string" ? args.p_request : undefined,
  );
}
const binding = (input: PurchaseInput) => ({
  p_quote: input.quote_id,
  p_request: input.request_id,
});

function publicOperation(
  op: Operation,
  replayed = false,
  errorCode?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    operation: {
      id: op.id,
      state: op.state,
      phone_number: op.phone_number,
      ...(op.phone_number_id ? { phone_number_id: op.phone_number_id } : {}),
      ...((errorCode || op.error_code)
        ? { error_code: errorCode || op.error_code }
        : {}),
    },
    replayed,
  };
  if (op.state === "completed" && op.row) {
    if (
      op.row.id !== op.phone_number_id ||
      op.row.organization_id !== op.organization_id ||
      op.row.phone_number !== op.phone_number
    ) {
      throw new NumberError(
        "LEDGER_UNAVAILABLE",
        "The saved number could not be verified. Check purchase status.",
        503,
      );
    }
    result.row = op.row;
  }
  return result;
}
async function unowned(
  deps: NumberDependencies,
  creds: Credentials,
  phone: string,
): Promise<void> {
  const { data, error } = await deps.db.from("phone_numbers").select("id").eq(
    "phone_number",
    phone,
  ).maybeSingle();
  if (error) {
    throw new NumberError(
      "PRECHECK_FAILED",
      "Number ownership could not be verified.",
      503,
    );
  }
  if (data || await providerOwnsNumber(creds, phone, deps.fetchImpl)) {
    throw new NumberError(
      "NUMBER_UNAVAILABLE",
      "This number is already owned or unavailable. Select another number.",
      409,
    );
  }
}

export async function createQuote(
  deps: NumberDependencies,
  actor: Actor,
  input: QuoteInput,
): Promise<Record<string, unknown>> {
  const creds = credentials(deps.masterCredentials());
  const [number, price] = await Promise.all([
    exactInventory(
      creds,
      input.phone_number,
      input.number_type,
      deps.fetchImpl,
    ),
    currentPrice(creds, input.phone_number, input.number_type, deps.fetchImpl),
    unowned(deps, creds, input.phone_number),
  ]);
  const op = await rpc(deps, actor, "quote", {
    p_account: creds.accountSid,
    p_number: input.phone_number,
    p_type: input.number_type,
    p_friendly_name: friendlyName(number),
    p_quote: price,
  });
  if (
    op.state !== "quoted" || op.phone_number !== input.phone_number ||
    op.number_type !== input.number_type ||
    op.account_sid !== creds.accountSid || !samePrice(op.quote, price) ||
    Date.parse(op.expires_at) <= deps.now()
  ) {
    throw new NumberError(
      "LEDGER_UNAVAILABLE",
      "A current purchase quote could not be created.",
      503,
    );
  }
  return {
    quote: {
      id: op.id,
      phone_number: op.phone_number,
      number_type: op.number_type,
      friendly_name: op.friendly_name,
      ...op.quote,
      expires_at: op.expires_at,
    },
  };
}

async function review(
  deps: NumberDependencies,
  actor: Actor,
  input: PurchaseInput,
  op: Operation,
  code: string,
): Promise<Operation> {
  try {
    return await rpc(deps, actor, "review", {
      ...binding(input),
      p_code: code,
    });
  } catch {
    // The durable attempted barrier remains even when recording this explanation fails.
    return { ...op, error_code: code };
  }
}
function matchesReceipt(
  receipt: Record<string, unknown>,
  op: Operation,
): boolean {
  return typeof receipt.sid === "string" && NUMBER_SID.test(receipt.sid) &&
    (!op.provider_sid || receipt.sid === op.provider_sid) &&
    receipt.account_sid === op.account_sid &&
    receipt.phone_number === op.phone_number &&
    object(receipt.capabilities)?.voice === true;
}
async function complete(
  deps: NumberDependencies,
  actor: Actor,
  input: PurchaseInput,
  op: Operation,
  replayed: boolean,
): Promise<Record<string, unknown>> {
  try {
    return publicOperation(
      await rpc(deps, actor, "complete", binding(input)),
      replayed,
    );
  } catch {
    return publicOperation(op, replayed, "SAVE_PENDING");
  }
}
async function reauthorize(
  req: Request,
  input: PurchaseInput,
  deps: NumberDependencies,
  actor: Actor,
): Promise<void> {
  const current = await authorize(req, input, deps);
  if (
    current.id !== actor.id || current.organizationId !== actor.organizationId
  ) {
    throw new NumberError(
      "SCOPE_CHANGED",
      "Your agency context changed. Refresh and try again.",
      403,
    );
  }
}
async function reconcile(
  deps: NumberDependencies,
  req: Request,
  actor: Actor,
  input: PurchaseInput,
  op: Operation,
): Promise<Record<string, unknown>> {
  const creds = credentials(deps.masterCredentials());
  if (creds.accountSid !== op.account_sid) {
    return publicOperation(
      await review(deps, actor, input, op, "ACCOUNT_CHANGED"),
      true,
      "ACCOUNT_CHANGED",
    );
  }
  try {
    // Only the durably recorded PN SID proves provenance. Never adopt inventory by E.164.
    const receipt = await providerRead(
      `https://api.twilio.com/2010-04-01/Accounts/${op.account_sid}/IncomingPhoneNumbers/${op.provider_sid}.json`,
      creds,
      deps.fetchImpl,
    );
    if (!matchesReceipt(receipt, op)) throw new Error("Receipt does not match");
  } catch {
    return publicOperation(
      await review(deps, actor, input, op, "RECEIPT_VERIFICATION_FAILED"),
      true,
      "RECEIPT_VERIFICATION_FAILED",
    );
  }
  await reauthorize(req, input, deps, actor);
  return await complete(deps, actor, input, op, true);
}

export async function purchaseOrStatus(
  deps: NumberDependencies,
  req: Request,
  actor: Actor,
  input: PurchaseInput,
): Promise<Record<string, unknown>> {
  // Read before availability/pricing: a number disappearing from inventory can mean this operation bought it.
  let op = await rpc(deps, actor, "get", binding(input));
  if (op.state === "purchased_pending_save") {
    return await reconcile(deps, req, actor, input, op);
  }
  if (op.state === "quoted" && Date.parse(op.expires_at) <= deps.now()) {
    return publicOperation(
      await review(deps, actor, input, op, "QUOTE_EXPIRED"),
    );
  }
  if (op.state !== "quoted" || input.action === "status") {
    return publicOperation(op, true);
  }
  const creds = credentials(deps.masterCredentials());
  if (creds.accountSid !== op.account_sid) {
    return publicOperation(
      await review(deps, actor, input, op, "ACCOUNT_CHANGED"),
    );
  }

  const config = canonicalNumberConfig(deps.supabaseUrl);
  const form = new URLSearchParams({
    PhoneNumber: op.phone_number,
    FriendlyName: op.friendly_name,
    VoiceUrl: config.voiceUrl,
    VoiceMethod: config.voiceMethod,
    SmsUrl: config.smsUrl,
    SmsMethod: config.smsMethod,
    StatusCallback: config.statusCallback,
    StatusCallbackMethod: config.statusCallbackMethod,
  });
  try {
    const [, price] = await Promise.all([
      exactInventory(creds, op.phone_number, op.number_type, deps.fetchImpl),
      currentPrice(creds, op.phone_number, op.number_type, deps.fetchImpl),
      unowned(deps, creds, op.phone_number),
    ]);
    if (!samePrice(op.quote, price)) {
      return publicOperation(
        await review(deps, actor, input, op, "PRICE_CHANGED"),
      );
    }
  } catch (error) {
    const code =
      error instanceof NumberError && error.code === "NUMBER_UNAVAILABLE"
        ? "NUMBER_UNAVAILABLE"
        : "PRECHECK_FAILED";
    return publicOperation(await review(deps, actor, input, op, code));
  }
  await reauthorize(req, input, deps, actor);
  op = await rpc(deps, actor, "claim", binding(input));
  if (op.claimed !== true) return publicOperation(op, true);
  if (op.state !== "purchasing") {
    throw new NumberError(
      "LEDGER_UNAVAILABLE",
      "Purchase claim could not be verified.",
      503,
    );
  }

  let receipt: Record<string, unknown>;
  try {
    // Exactly one attempt per atomic claim. No provider retry or idempotency-header assumption.
    const response = await deps.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${op.account_sid}/IncomingPhoneNumbers.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${
            btoa(`${creds.accountSid}:${creds.authToken}`)
          }`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Provider purchase not confirmed");
    }
    const parsed = object(await readJson(response, 131_072));
    if (!parsed) throw new Error("Missing purchase receipt");
    receipt = parsed;
  } catch {
    return publicOperation(
      await review(deps, actor, input, op, "PURCHASE_OUTCOME_UNKNOWN"),
    );
  }
  if (!matchesReceipt(receipt, op)) {
    return publicOperation(
      await review(deps, actor, input, op, "PROVIDER_RECEIPT_MISMATCH"),
    );
  }
  try {
    op = await rpc(deps, actor, "record", {
      ...binding(input),
      p_sid: receipt.sid,
      p_provider_account: receipt.account_sid,
      p_provider_number: receipt.phone_number,
    });
  } catch {
    return publicOperation(
      await review(deps, actor, input, op, "RECEIPT_NOT_RECORDED"),
    );
  }
  return await complete(deps, actor, input, op, false);
}
