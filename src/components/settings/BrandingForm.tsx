import React from "react";
import BrandingUploadField from "./BrandingUploadField";
import { BrandingState, TIMEZONES, TIME_FORMATS, formatPhone } from "./brandingConfig";

interface BrandingFormProps {
  state: BrandingState;
  errors: Partial<Record<keyof BrandingState, string>>;
  canEdit: boolean;
  canEditFavicon: boolean;
  organizationId: string | null;
  update: (patch: Partial<BrandingState>) => void;
}

const INPUT_CLASS =
  "w-full h-10 px-3 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-accent border border-border text-foreground disabled:cursor-not-allowed";

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="text-xs mt-1 text-destructive">{message}</p> : null;

const BrandingForm: React.FC<BrandingFormProps> = ({
  state,
  errors,
  canEdit,
  canEditFavicon,
  organizationId,
  update,
}) => {
  return (
    <div className={`rounded-lg p-6 space-y-6 bg-card border ${!canEdit ? "opacity-50" : ""}`}>
      <div>
        <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Company Name</label>
        <input
          type="text"
          value={state.companyName}
          disabled={!canEdit}
          onChange={e => { if (e.target.value.length <= 100) update({ companyName: e.target.value }); }}
          placeholder="Enter your company name"
          className={INPUT_CLASS}
        />
        <FieldError message={errors.companyName} />
      </div>

      <BrandingUploadField
        kind="logo"
        label="Company Logo"
        url={state.logoUrl}
        name={state.logoName}
        disabled={!canEdit}
        organizationId={organizationId}
        onChange={(url, name) => update({ logoUrl: url, logoName: name })}
      />

      {canEditFavicon && (
        <BrandingUploadField
          kind="favicon"
          label="Favicon"
          subtitle="Shown in the browser tab. Use a square image for best results."
          url={state.faviconUrl}
          name={state.faviconName}
          disabled={!canEdit}
          organizationId={organizationId}
          onChange={(url, name) => update({ faviconUrl: url, faviconName: name })}
        />
      )}

      <div>
        <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Primary Color</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={state.primaryColor}
            disabled={!canEdit}
            onChange={e => update({ primaryColor: e.target.value.toUpperCase() })}
            className="h-10 w-12 rounded-md border border-border bg-accent disabled:cursor-not-allowed"
            aria-label="Primary color picker"
          />
          <input
            type="text"
            value={state.primaryColor}
            disabled={!canEdit}
            onChange={e => update({ primaryColor: e.target.value })}
            placeholder="#3B82F6"
            className={`${INPUT_CLASS} font-mono uppercase`}
            maxLength={7}
          />
        </div>
        <FieldError message={errors.primaryColor} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Timezone</label>
        <select
          value={state.timezone}
          disabled={!canEdit}
          onChange={e => update({ timezone: e.target.value })}
          className={`${INPUT_CLASS} appearance-none`}
        >
          {TIMEZONES.map(g => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        <FieldError message={errors.timezone} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Time Format</label>
        <select
          value={state.timeFormat}
          disabled={!canEdit}
          onChange={e => update({ timeFormat: e.target.value })}
          className={`${INPUT_CLASS} appearance-none`}
        >
          {TIME_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <FieldError message={errors.timeFormat} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Company Phone</label>
        <input
          type="text"
          value={state.companyPhone}
          disabled={!canEdit}
          onChange={e => update({ companyPhone: formatPhone(e.target.value) })}
          placeholder="(555) 555-5555"
          className={INPUT_CLASS}
        />
        <FieldError message={errors.companyPhone} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5 text-muted-foreground">Company Website</label>
        <input
          type="url"
          value={state.websiteUrl}
          disabled={!canEdit}
          onChange={e => update({ websiteUrl: e.target.value })}
          placeholder="https://youragency.com"
          className={INPUT_CLASS}
        />
        <FieldError message={errors.websiteUrl} />
      </div>
    </div>
  );
};

export default BrandingForm;
