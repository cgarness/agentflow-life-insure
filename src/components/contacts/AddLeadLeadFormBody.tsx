import React from "react";
import { Lead } from "@/lib/types";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { DateInput } from "@/components/shared/DateInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import { calculateAge } from "@/utils/dateUtils";
import { StateSelector } from "@/components/shared/StateSelector";

interface AddLeadLeadFormBodyProps {
  form: Partial<Lead>;
  setForm: React.Dispatch<React.SetStateAction<Partial<Lead>>>;
  leadSources: string[];
  initial?: Partial<Lead> | null;
}

export const AddLeadLeadFormBody: React.FC<AddLeadLeadFormBodyProps> = ({
  form,
  setForm,
  leadSources,
  initial,
}) => (
  <>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">First Name *</label>
        <input
          required
          value={form.firstName || ""}
          onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
          className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Last Name *</label>
        <input
          required
          value={form.lastName || ""}
          onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
          className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
        />
      </div>
    </div>
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">Phone *</label>
      <PhoneInput
        required
        value={form.phone || ""}
        onChange={(val) => setForm((f) => ({ ...f, phone: normalizePhoneNumber(val) }))}
        className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
        placeholder="(555)123-4567"
      />
    </div>
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
      <input
        type="email"
        value={form.email || ""}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
      />
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">State</label>
        <StateSelector value={form.state || ""} onChange={(val) => setForm((f) => ({ ...f, state: val }))} />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Lead Source</label>
        <select
          value={
            form.leadSource && (leadSources.includes(form.leadSource) || !!initial)
              ? form.leadSource
              : leadSources[0] || ""
          }
          onChange={(e) => setForm((f) => ({ ...f, leadSource: e.target.value }))}
          className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
        >
          {form.leadSource && !leadSources.includes(form.leadSource) ? (
            <option value={form.leadSource}>{form.leadSource}</option>
          ) : null}
          {leadSources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Date of Birth</label>
        <DateInput
          value={form.dateOfBirth || ""}
          onChange={(val) => {
            const calculatedAge = calculateAge(val);
            setForm((f) => ({ ...f, dateOfBirth: val, age: calculatedAge ?? f.age }));
          }}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Age</label>
        <input
          type="number"
          value={form.age || ""}
          onChange={(e) =>
            setForm((f) => ({ ...f, age: e.target.value ? parseInt(e.target.value, 10) : undefined }))
          }
          className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
          placeholder="e.g. 45"
        />
      </div>
    </div>

    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">Best Time to Call</label>
      <select
        value={form.bestTimeToCall || ""}
        onChange={(e) => setForm((f) => ({ ...f, bestTimeToCall: e.target.value }))}
        className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none"
      >
        <option value="">Select...</option>
        {["Morning", "Afternoon", "Evening", "Anytime"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>

    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">Initial Notes</label>
      <textarea
        value={form.notes || ""}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        className="w-full h-20 px-3 py-2 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none"
        placeholder="Add any background context..."
      />
    </div>
  </>
);
