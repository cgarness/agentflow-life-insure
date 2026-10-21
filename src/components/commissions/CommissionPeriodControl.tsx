import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { calendarDateToPickerDate, longDateLabel, pickedDayToCalendarDate } from "@/lib/reports-format";
import { PERIOD_LABELS, PERIOD_PRESETS, type CommissionPeriod, type PeriodPreset } from "@/lib/commission/centerFilters";
import { FilterSelect } from "./shared/Bits";

const DatePick = ({ label, value, onChange }: { label: string; value: string | null; onChange: (date: string | null) => void }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" aria-label={label} className="h-9 gap-2 rounded-lg px-3 text-xs font-medium tabular-nums">
        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {value ? longDateLabel(value) : label}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar mode="single" selected={value ? calendarDateToPickerDate(value) : undefined}
        onSelect={(d) => onChange(d ? pickedDayToCalendarDate(d) : null)} className="p-3" />
    </PopoverContent>
  </Popover>
);

/**
 * The period select (existing Reports pattern): presets the server resolves against the agency date, or a custom range
 * of calendar dates. Nothing is requested until a custom range is complete and in order.
 */
export function CommissionPeriodControl({ value, onChange, allowAll, label = "Period" }: {
  value: CommissionPeriod; onChange: (p: CommissionPeriod) => void; allowAll: boolean; label?: string;
}) {
  const presets = PERIOD_PRESETS.filter((p) => allowAll || p !== "all");
  const choose = (preset: PeriodPreset) => onChange(preset === "custom" ? { preset, from: value.from, to: value.to } : { preset, from: null, to: null });
  const reversed = value.preset === "custom" && value.from && value.to && value.to < value.from;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FilterSelect label={label} value={value.preset} options={presets.map((p) => [p, PERIOD_LABELS[p]] as const)} onChange={choose}
        className="w-40" />
      {value.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <DatePick label="Start date" value={value.from} onChange={(from) => onChange({ ...value, from })} />
          <span className="text-xs text-muted-foreground" aria-hidden>to</span>
          <DatePick label="End date" value={value.to} onChange={(to) => onChange({ ...value, to })} />
        </div>
      )}
      {reversed && <p role="alert" className="w-full text-xs text-destructive">End date must be on or after the start date.</p>}
    </div>
  );
}
