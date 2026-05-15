import React from "react";
import { Input } from "@/components/ui/input";

export const Label: React.FC<React.PropsWithChildren> = ({ children }) => (
  <label className="mb-1.5 block text-sm font-medium text-foreground">{children}</label>
);

export const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}> = ({ label, value, onChange, options, placeholder }) => (
  <div>
    <Label>{label}</Label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

export const NumberField: React.FC<{
  label: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}> = ({ label, value, min, onChange }) => (
  <div>
    <Label>{label}</Label>
    <Input
      type="number"
      min={min}
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        onChange(Number.isFinite(n) ? Math.max(min, n) : min);
      }}
    />
  </div>
);
