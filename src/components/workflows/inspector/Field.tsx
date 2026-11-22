import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";

interface FieldProps {
  /** ID of the control. The hint and error text use `<id>-hint` and `<id>-error`. */
  id: string;
  label: string;
  /** Controls at the end of the label row, such as Insert field. */
  tools?: ReactNode;
  hint?: ReactNode;
  errors?: string[];
  children: ReactNode;
}

/** A problem in the shared error role, with an icon so colour is never the only signal. */
export function Problem({id, children}: {id?: string; children: ReactNode}) {
  return <p id={id} className="flex items-start gap-1.5 text-sm text-badge-error-text">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true"/>
    <span>{children}</span>
  </p>;
}

/** Persistent label above the control, with its hint and any problem directly below. */
export default function Field({id, label, tools, hint, errors = [], children}: FieldProps) {
  return <div className="space-y-1.5">
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <Label htmlFor={id} id={id + "-label"}>{label}</Label>
      {tools && <div className="flex flex-wrap items-center gap-1">{tools}</div>}
    </div>
    {children}
    {hint && <p id={id + "-hint"} className="text-xs text-muted-foreground">{hint}</p>}
    {errors.length > 0 && <div id={id + "-error"} className="space-y-1">
      {errors.map(message => <Problem key={message}>{message}</Problem>)}
    </div>}
  </div>;
}
