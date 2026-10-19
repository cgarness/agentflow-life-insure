import { AlertTriangle, Lock } from "lucide-react";
import type { SaleSubmissionState } from "@/hooks/usePolicySaleSubmission";

/**
 * The state of a sale save inside its modal. Unknown outcomes and conflicts explain why the form is locked;
 * an editable rejection shows the server's (or validation's) message. Never shows submission contents.
 */
export function SaleSubmissionNotice({ submission }: { submission: SaleSubmissionState }) {
  if (!submission.message) return null;
  if (submission.phase === "frozen") {
    return (
      <div role="alert" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <p className="min-w-0 break-words">{submission.message}</p>
      </div>
    );
  }
  if (submission.phase === "conflict") {
    return (
      <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <p className="min-w-0 break-words">{submission.message}</p>
      </div>
    );
  }
  return <p role="alert" className="break-words text-sm text-destructive dark:text-red-400">{submission.message}</p>;
}
