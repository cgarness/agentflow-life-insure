import type { useGridEditorDraft } from "@/hooks/useGridEditorDraft";

/** The editor's draft actions, as passed to its sections. */
export type EditorActions = ReturnType<typeof useGridEditorDraft>["actions"];
