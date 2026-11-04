import {
  authorize,
  credentials,
  type NumberDependencies,
  runtimeDependencies,
} from "../_shared/phoneNumbers/auth.ts";
import {
  failure,
  parseSearch,
  preflight,
  reply,
  requestBody,
} from "../_shared/phoneNumbers/contracts.ts";
import { searchInventory } from "../_shared/phoneNumbers/inventory.ts";
import { rentalPrice } from "../_shared/phoneNumbers/pricing.ts";
import { createQuote } from "../_shared/phoneNumbers/purchase.ts";

export function createNumberSearchHandler(
  injected?: NumberDependencies,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const early = preflight(req);
    if (early) return early;
    try {
      const input = parseSearch(await requestBody(req));
      const deps = injected ?? runtimeDependencies();
      const actor = await authorize(req, input, deps);
      if (input.action === "quote") {
        return reply(await createQuote(deps, actor, input));
      }
      const master = credentials(deps.masterCredentials());
      // Local inventory keeps its existing subaccount behavior. Review and every purchase use master.
      const inventoryAccount = input.number_type === "local"
        ? credentials(await deps.localCredentials(actor.organizationId))
        : master;
      const [numbers, price] = await Promise.all([
        searchInventory(inventoryAccount, input, deps.fetchImpl),
        rentalPrice(master, input.number_type, deps.fetchImpl),
      ]);
      return reply({
        numbers: numbers.map((number) => ({ ...number, ...price })),
      });
    } catch (error) {
      return failure(error);
    }
  };
}

if (import.meta.main) Deno.serve(createNumberSearchHandler());
