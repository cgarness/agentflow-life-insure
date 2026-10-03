import { useState } from "react";
import { TwilioComplianceEmbed } from "@twilio/twilio-compliance-embed";
import { Button } from "@/components/ui/button";
import type { Session } from "./types";
export default function A2pSession({ session, onClose }: { session: Session; onClose: () => void }) {
  const [error, setError] = useState(false), [submitted, setSubmitted] = useState(false);
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" aria-label="Secure A2P registration">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold">
          {session.stage === "brand" ? "Business and brand registration" : "Messaging campaign registration"}
        </h4>
        <Button variant="outline" onClick={onClose}>Close and refresh status</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Complete the secure form and review all details and fees before its final submission. Your sensitive business
        details stay with the registration provider.
      </p>
      {submitted && (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          Form completed. Close the form to check the provider’s current review status.
        </p>
      )}
      {error
        ? (
          <p role="alert" className="text-sm text-destructive">
            The secure form could not load or its session expired. Close it and resume registration to open a new
            session.
          </p>
        )
        : (
          <div className="min-h-[650px] overflow-hidden rounded-lg bg-white">
            <TwilioComplianceEmbed
              inquiryId={session.sessionId}
              inquirySessionToken={session.sessionToken}
              onInquirySubmitted={() => setSubmitted(true)}
              onCancel={onClose}
              onError={() => setError(true)}
            />
          </div>
        )}
    </section>
  );
}
