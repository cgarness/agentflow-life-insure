import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAutomationAccess } from "@/lib/automation-api";

function AuthorizedLink({author, children}: {author?: boolean; children: ReactNode}) {
  const access = useAutomationAccess();
  return access.data?.visible && (!author || access.data.can_author) ? <>{children}</> : null;
}

export function AutomationAccessGate({author, children}: {author?: boolean; children: ReactNode}) {
  const {isImpersonating, automationSessionRevision} = useAuth();
  if ((author && isImpersonating) || automationSessionRevision == null) return null;
  return <AuthorizedLink author={author}>{children}</AuthorizedLink>;
}
