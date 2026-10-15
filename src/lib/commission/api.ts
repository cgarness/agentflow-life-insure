import { supabase } from "@/integrations/supabase/client";
import { toCommissionError } from "./errors";
import { parseCalculatorContext, parseCalculatorStatus } from "./schemas";
import type { CalculatorContext, CalculatorStatus } from "./types";

/**
 * Calculator reads. Both RPCs are SECURITY INVOKER and resolve the caller, organization and grid on the
 * server (no client-supplied organization, role or grid). There is no fallback data of any kind.
 */
export async function fetchCalculatorStatus(signal?: AbortSignal): Promise<CalculatorStatus> {
  let request = supabase.rpc("get_commission_calculator_status");
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw toCommissionError(error);
  return parseCalculatorStatus(data);
}

export async function fetchCalculatorContext(signal?: AbortSignal): Promise<CalculatorContext> {
  let request = supabase.rpc("get_commission_calculator_context");
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw toCommissionError(error);
  return parseCalculatorContext(data);
}
