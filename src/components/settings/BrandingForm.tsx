import React from "react";
import BrandingUploadField from "./BrandingUploadField";
import { BrandingState, TIMEZONES, TIME_FORMATS, formatPhone } from "./brandingConfig";

interface BrandingFormProps {
  state: BrandingState;
  nameError: boolean;
  canEdit: boolean;
  canEditFavicon: boolean;
  update: (patch: Partial<BrandingState>) => void;
}

const INPUT_CLASS =
  "w-full h-10 px-3 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-accent border border-border text-foreground disabled:cursor-not-allowed";

const BrandingForm: React.FC<BrandingFormProps> = ({ state, nameError, canEdit, canEditFavicon, update }) => {
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
        {nameError && <p className="text-xs mt-1 text-destructive">Company name is required</p>}
      </div>

      <BrandingUploadField
        kind="logo"
        label="Company Logo"
        url={state.logoUrl}
        name={state.logoName}
        disabled={!canEdit}
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
          onChange={(url, name) => update({ faviconUrl: url, faviconName: name })}
        />
      )}

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
      </div>
    </div>
  );
};

export default BrandingForm;
