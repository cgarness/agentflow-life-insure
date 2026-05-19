import React from "react";

interface Props {
  to: string;
  from: string;
  phoneOptions: string[];
  onChangeTo: (v: string) => void;
  onChangeFrom: (v: string) => void;
}

export const AITestingPhoneInputs: React.FC<Props> = ({
  to,
  from,
  phoneOptions,
  onChangeTo,
  onChangeFrom,
}) => (
  <section className="grid sm:grid-cols-2 gap-4">
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">Call your number (To)</label>
      <input
        type="tel"
        value={to}
        onChange={(e) => onChangeTo(e.target.value)}
        placeholder="+1 555 123 4567"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">From (caller ID)</label>
      {phoneOptions.length > 0 ? (
        <select
          value={from}
          onChange={(e) => onChangeFrom(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {phoneOptions.map((n) => (<option key={n} value={n}>{n}</option>))}
        </select>
      ) : (
        <input
          type="tel"
          value={from}
          onChange={(e) => onChangeFrom(e.target.value)}
          placeholder="+1 agency number"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      )}
    </div>
  </section>
);
