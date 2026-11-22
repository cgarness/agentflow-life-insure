import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Issue } from "@/lib/automation-api";
import Field from "./Field";
import InsertFieldMenu from "./InsertFieldMenu";
import { describedBy, fieldIssues } from "./stepConfig";
import { useInsertAtCursor } from "./useInsertAtCursor";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The workflow's trigger type, which decides the fields on offer. */
  trigger: string | undefined;
  issues: Issue[];
  maxLength: number;
  multiline?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  /** Controls shown before Insert field, such as Use saved message. */
  tools?: ReactNode;
  className?: string;
}

/** A text field that supports personalization: every one carries its own Insert field menu. */
export default function PersonalizedField({label, value, onChange, trigger, issues, maxLength, multiline, placeholder, hint, tools, className}: Props) {
  const id = useId();
  const {ref, insert, focus, bind} = useInsertAtCursor(value, onChange);
  const errors = fieldIssues(issues, label);
  const control = {
    id, ref, value, maxLength, placeholder, className, ...bind,
    "aria-invalid": errors.length > 0 || undefined,
    "aria-describedby": describedBy(id, hint, errors),
  };
  return <Field id={id} label={label} hint={hint} errors={errors}
    tools={<>{tools}<InsertFieldMenu trigger={trigger} describedBy={id + "-label"} onInsert={insert} onInserted={focus}/></>}>
    {multiline
      ? <Textarea {...control} onChange={event => onChange(event.target.value)}/>
      : <Input {...control} onChange={event => onChange(event.target.value)}/>}
  </Field>;
}
