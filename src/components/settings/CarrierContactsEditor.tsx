import React from "react";
import { Plus, Trash2, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LabeledContact } from "./carrierContactUtils";

interface CarrierContactsEditorProps {
  phones: LabeledContact[];
  emails: LabeledContact[];
  onPhonesChange: (rows: LabeledContact[]) => void;
  onEmailsChange: (rows: LabeledContact[]) => void;
  emailErrors: Record<number, boolean>;
}

const CarrierContactsEditor: React.FC<CarrierContactsEditorProps> = ({
  phones,
  emails,
  onPhonesChange,
  onEmailsChange,
  emailErrors,
}) => {
  const updatePhone = (index: number, field: keyof LabeledContact, v: string) => {
    onPhonesChange(phones.map((row, i) => (i === index ? { ...row, [field]: v } : row)));
  };

  const updateEmail = (index: number, field: keyof LabeledContact, v: string) => {
    onEmailsChange(emails.map((row, i) => (i === index ? { ...row, [field]: v } : row)));
  };

  return (
    <div className="space-y-6 border-t border-border pt-4 mt-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Phone className="w-4 h-4 text-muted-foreground" />
            Phone numbers
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => onPhonesChange([...phones, { label: "", value: "" }])}>
            <Plus className="w-3.5 h-3.5" />
            Add phone
          </Button>
        </div>
        {phones.length === 0 ? (
          <p className="text-xs text-muted-foreground">No phone numbers yet. Use Add phone for lines such as new business or agent support.</p>
        ) : (
          <div className="space-y-2">
            {phones.map((row, i) => (
              <div key={`p-${i}`} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <Input
                  value={row.label}
                  onChange={(e) => updatePhone(i, "label", e.target.value)}
                  placeholder="Label (e.g. New business)"
                  className="sm:flex-1 min-w-0"
                />
                <Input
                  value={row.value}
                  onChange={(e) => updatePhone(i, "value", e.target.value)}
                  placeholder="Phone number"
                  className="sm:flex-1 min-w-0"
                  type="tel"
                />
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onPhonesChange(phones.filter((_, j) => j !== i))} aria-label="Remove phone row">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Mail className="w-4 h-4 text-muted-foreground" />
            Email addresses
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => onEmailsChange([...emails, { label: "", value: "" }])}>
            <Plus className="w-3.5 h-3.5" />
            Add email
          </Button>
        </div>
        {emails.length === 0 ? (
          <p className="text-xs text-muted-foreground">No emails yet. Use Add email for contracting, underwriting, or GA contacts.</p>
        ) : (
          <div className="space-y-2">
            {emails.map((row, i) => (
              <div key={`e-${i}`} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <Input
                  value={row.label}
                  onChange={(e) => updateEmail(i, "label", e.target.value)}
                  placeholder="Label (e.g. Contracting)"
                  className="sm:flex-1 min-w-0"
                />
                <div className="sm:flex-1 min-w-0 space-y-0.5">
                  <Input
                    value={row.value}
                    onChange={(e) => updateEmail(i, "value", e.target.value)}
                    placeholder="email@carrier.com"
                    className={emailErrors[i] ? "border-destructive focus-visible:ring-destructive" : ""}
                    type="email"
                    autoComplete="off"
                  />
                  {emailErrors[i] && <p className="text-xs text-destructive px-0.5">Enter a valid email or clear this field.</p>}
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onEmailsChange(emails.filter((_, j) => j !== i))} aria-label="Remove email row">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CarrierContactsEditor;
