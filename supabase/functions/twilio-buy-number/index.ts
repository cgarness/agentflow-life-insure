import {
  authorize,
  type NumberDependencies,
  runtimeDependencies,
} from "../_shared/phoneNumbers/auth.ts";
import {
  failure,
  parsePurchase,
  preflight,
  reply,
  requestBody,
} from "../_shared/phoneNumbers/contracts.ts";
import { purchaseOrStatus } from "../_shared/phoneNumbers/purchase.ts";

export function createNumberPurchaseHandler(
  injected?: NumberDependencies,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const early = preflight(req);
    if (early) return early;
    try {
      // Legacy phone_number requests cannot bypass review, and new requests cannot buy on the old handler.
      const input = parsePurchase(await requestBody(req));
      const deps = injected ?? runtimeDependencies();
      const actor = await authorize(req, input, deps);
      return reply(await purchaseOrStatus(deps, req, actor, input));
    } catch (error) {
      return failure(error);
    }
  };
}

if (import.meta.main) Deno.serve(createNumberPurchaseHandler());
