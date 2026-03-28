import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format, parse, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBranding } from "@/contexts/BrandingContext";

interface DateInputProps {
  value?: string; // Expects YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
}

export const DateInput: React.FC<DateInputProps> = ({ value, onChange, className, placeholder, required }) => {
  const { branding } = useBranding();
  const [inputValue, setInputValue] = React.useState("");
  
  // Map our settings to date-fns format tokens
  const formatMap: Record<string, string> = {
    "MM/DD/YYYY": "MM/dd/yyyy",
    "DD/MM/YYYY": "dd/MM/yyyy",
    "YYYY-MM-DD": "yyyy-MM-dd",
  };

  const displayFormat = formatMap[branding.dateFormat] || "MM/dd/yyyy";

  // Sync internal input value when prop value changes
  React.useEffect(() => {
    if (value) {
      try {
        const date = new Date(value + "T00:00:00"); // Add time to avoid timezone shifts
        if (isValid(date)) {
          setInputValue(format(date, displayFormat));
        }
      } catch (e) {
        setInputValue("");
      }
    } else {
      setInputValue("");
    }
  }, [value, displayFormat]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    
    // Simple auto-formatting: add slashes/dashes as they type
    // Only if they are moving forward
    if (val.length > inputValue.length) {
      if (branding.dateFormat === "YYYY-MM-DD") {
        if (val.length === 4 || val.length === 7) val += "-";
      } else {
        if (val.length === 2 || val.length === 5) val += "/";
      }
    }
    
    setInputValue(val);

    // If it's a complete valid date, trigger onChange
    if (val.length === displayFormat.length) {
      const parsedDate = parse(val, displayFormat, new Date());
      if (isValid(parsedDate)) {
        onChange(format(parsedDate, "yyyy-MM-dd"));
      }
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const isoDate = format(date, "yyyy-MM-dd");
      onChange(isoDate);
      setInputValue(format(date, displayFormat));
    }
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        placeholder={placeholder || displayFormat.toUpperCase()}
        required={required}
        className="w-full h-9 px-3 pr-10 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none transition-all"
      />
      <div className="absolute right-0 top-0 h-full flex items-center pr-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0 z-[300]" align="end">
            <Calendar
              mode="single"
              selected={value ? new Date(value + "T00:00:00") : undefined}
              onSelect={handleDateSelect}
              initialFocus
              captionLayout="dropdown"
              fromYear={1900}
              toYear={new Date().getFullYear() + 20}
              fixedWeeks
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};
