import React, { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, MailX, XCircle } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import AuthStatusState from "@/components/auth/AuthStatusState";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import { submitUnsubscribe, unsubscribeTokenSchema } from "@/lib/emailSubscriptions";

type PageState = "ready" | "submitting" | "done" | "invalid" | "error";

/**
 * `/email/unsubscribe?token=…` — public confirm page for the onboarding tips footer link.
 *
 * Opening the page never unsubscribes anyone: link scanners and previews fetch URLs, so the
 * opt-out happens only on the button press (one POST). The token is validated for shape here and
 * verified by the `email-unsubscribe` function. Only onboarding tips stop; account and security
 * email is unaffected.
 */
const EmailUnsubscribePage: React.FC = () => {
  const [params] = useSearchParams();
  const token = unsubscribeTokenSchema.safeParse(params.get("token") ?? "");
  const [state, setState] = useState<PageState>(token.success ? "ready" : "invalid");
  const inFlight = useRef(false);

  const confirm = async () => {
    if (!token.success || inFlight.current) return;
    inFlight.current = true;
    setState("submitting");
    const result = await submitUnsubscribe(token.data);
    setState(result === "unsubscribed" ? "done" : result);
    inFlight.current = false;
  };

  if (state === "done") {
    return (
      <AuthShell>
        <AuthStatusState
          icon={CheckCircle2}
          tone="success"
          live
          title="You're unsubscribed"
          description="You won't get more AgentFlow onboarding tips."
        >
          <AuthPrimaryButton asChild>
            <Link to="/login">Go to AgentFlow</Link>
          </AuthPrimaryButton>
        </AuthStatusState>
      </AuthShell>
    );
  }

  if (state === "invalid") {
    return (
      <AuthShell>
        <AuthStatusState
          icon={AlertTriangle}
          tone="warning"
          live
          title="This link isn't valid"
          description="Sign in and turn off onboarding tips in Settings → My Profile → Preferences."
        >
          <AuthPrimaryButton asChild>
            <Link to="/login">Sign in</Link>
          </AuthPrimaryButton>
        </AuthStatusState>
      </AuthShell>
    );
  }

  const failed = state === "error";
  return (
    <AuthShell>
      <AuthStatusState
        icon={failed ? XCircle : MailX}
        tone={failed ? "error" : "neutral"}
        live={failed}
        title={failed ? "Something went wrong" : "Unsubscribe from onboarding tips"}
        description={
          failed
            ? "We couldn't update your preference. Try again."
            : "You'll stop getting AgentFlow onboarding tips by email. Account and security emails aren't affected."
        }
      >
        <AuthPrimaryButton
          type="button"
          onClick={confirm}
          loading={state === "submitting"}
          loadingLabel="Unsubscribing…"
        >
          {failed ? "Try again" : "Unsubscribe"}
        </AuthPrimaryButton>
      </AuthStatusState>
    </AuthShell>
  );
};

export default EmailUnsubscribePage;
