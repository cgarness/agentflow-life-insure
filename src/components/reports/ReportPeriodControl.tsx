import React from "react";
import { z } from "zod";
import { AlertCircle, CalendarDays, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PRESET_LABELS, calendarDateToPickerDate, longDateLabel, pickedDayToCalendarDate,
  type RangeProblem, type ReportPreset,
} from "@/lib/reports-format";

/** Every "Report period" option, in display order; a value outside it is never applied. */
const reportPeriodSchema = z.enum(["today", "yesterday", "7d", "30d", "month", "lastMonth", "custom"]);
const PRESETS = reportPeriodSchema.options.filter((p): p is Exclude<ReportPreset, "custom"> => p !== "custom");

/** 40px, the height of the scope tabs beside it (the agent filter uses the same trigger). */
const FILTER_TRIGGER = "h-10 justify-start gap-2 rounded-lg bg-background text-sm";

interface Props {
  preset: ReportPreset;
  onPreset: (preset: ReportPreset) => void;
  customStart: string | null;
  customEnd: string | null;
  onCustomStart: (date: string | null) => void;
  onCustomEnd: (date: string | null) => void;
  rangeProblem: RangeProblem;
  maxRangeDays: number;
  /** True until the report scope (and with it the agency today) has resolved. */
  disabled: boolean;
  /** The agent filter, laid out beside the period; without it the period spans both mobile columns. */
  children?: React.ReactNode;
}

const DatePick: React.FC<{ label: string; value: string | null; disabled: boolean; onChange: (d: string | null) => void }> = ({ label, value, disabled, onChange }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabled} aria-label={label}
        className="h-10 w-full gap-2 rounded-lg px-3 text-xs font-medium tabular-nums sm:w-auto">
        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {value ? longDateLabel(value) : label}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar mode="single" selected={value ? calendarDateToPickerDate(value) : undefined}
        onSelect={(d) => onChange(d ? pickedDayToCalendarDate(d) : null)} className="p-3" />
    </PopoverContent>
  </Popover>
);

const RangeError: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex items-center gap-1.5 text-xs text-foreground">
    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
    {children}
  </p>
);

/**
 * One "Report period" select. Presets resolve against the agency today on the page, never the browser
 * clock; Custom range reveals the Start Date / End Date pickers and explains an invalid range in text.
 * An incomplete range is explained by the page notice, not here.
 */
export default function ReportPeriodControl(p: Props) {
  const choose = (value: string) => {
    const parsed = reportPeriodSchema.safeParse(value);
    if (parsed.success) p.onPreset(parsed.data);
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <Select value={p.preset} onValueChange={choose} disabled={p.disabled}>
          <SelectTrigger aria-label="Report period" className={cn(FILTER_TRIGGER, "sm:w-[176px]", !p.children && "col-span-2")}>
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 text-left"><SelectValue /></span>
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((preset) => <SelectItem key={preset} value={preset}>{PRESET_LABELS[preset]}</SelectItem>)}
            <SelectSeparator />
            <SelectItem value="custom">{PRESET_LABELS.custom}</SelectItem>
          </SelectContent>
        </Select>
        {p.children}
      </div>
      {p.preset === "custom" && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <DatePick label="Start Date" value={p.customStart} disabled={p.disabled} onChange={p.onCustomStart} />
          <span className="hidden text-sm text-muted-foreground sm:inline" aria-hidden="true">to</span>
          <DatePick label="End Date" value={p.customEnd} disabled={p.disabled} onChange={p.onCustomEnd} />
        </div>
      )}
      {p.preset === "custom" && p.rangeProblem === "order" && <RangeError>End date must be on or after the start date.</RangeError>}
      {p.preset === "custom" && p.rangeProblem === "too_long" && <RangeError>Choose a range of up to {p.maxRangeDays} days.</RangeError>}
    </>
  );
}
