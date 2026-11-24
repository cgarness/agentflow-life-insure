import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** One answer per agency per page load: issuance confirmation belongs to the agency, not to a contact. */
const answers = new Map<string, Promise<boolean>>();

function ask(organizationId: string): Promise<boolean> {
  const known = answers.get(organizationId);
  if (known) return known;
  const answer = (async () => {
    try {
      const { data, error } = await supabase.rpc("policy_issuance_available");
      if (error) throw error;
      return data === true;
    } catch {
      // A failed read counts as not available, and is asked again next time.
      answers.delete(organizationId);
      return false;
    }
  })();
  answers.set(organizationId, answer);
  return answer;
}

/**
 * Whether the signed-in agency confirms policy issuance in AgentFlow, which today means it is in the Automations pilot.
 * False until the server says so, and after any failure.
 */
export function usePolicyIssuanceAvailable(organizationId: string | null | undefined): boolean {
  const [answer, setAnswer] = useState<{ organizationId: string; available: boolean } | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    let live = true;
    void ask(organizationId).then(available => { if (live) setAnswer({ organizationId, available }); });
    return () => { live = false; };
  }, [organizationId]);
  return answer !== null && !!organizationId && answer.organizationId === organizationId && answer.available;
}
