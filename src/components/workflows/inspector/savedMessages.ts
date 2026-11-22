import type { SavedMessage } from "@/lib/automation-api";
import { fieldProblems, savedMessageText } from "../../../../supabase/functions/_shared/automations/fields";

/** The wording a step stores when a saved message is chosen. The saved message itself is only read. */
export function savedMessageCopy(message: SavedMessage): {body: string; subject: string} {
  return {body: savedMessageText(message.content), subject: savedMessageText(message.subject ?? "")};
}

/** Why a saved message cannot be used after this trigger, or undefined when every field in it can be filled. */
export function savedMessageBlocker(message: SavedMessage, trigger: string | null | undefined): string | undefined {
  const copy = savedMessageCopy(message);
  const problems = fieldProblems(message.type === "email" ? copy.subject + "\n" + copy.body : copy.body, trigger);
  if (!problems.length) return undefined;
  const labels = problems.map(problem => problem.label).join(", ");
  return problems.some(problem => problem.kind === "unsupported")
    ? "Uses fields automations can't fill: " + labels
    : "Uses fields this trigger doesn't provide: " + labels;
}
