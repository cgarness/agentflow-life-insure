import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { formatPhoneNumber } from "@/utils/phoneUtils";

interface PhoneInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({ value, onChange, className, ...props }) => {
  const [displayValue, setDisplayValue] = useState("");

  useEffect(() => {
    // When the parent's value changes, update the internal display value
    if (!value) {
      setDisplayValue("");
      return;
    }
    setDisplayValue(formatPhoneNumber(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const digits = rawValue.replace(/\D/g, "");
    
    // Limit to 10 digits for local formatting
    const limitedDigits = digits.slice(0, 10);
    
    // Update internal display value immediately for as-you-type feel
    let formatted = limitedDigits;
    if (limitedDigits.length > 0) {
      if (limitedDigits.length <= 3) {
        formatted = `(${limitedDigits}`;
      } else if (limitedDigits.length <= 6) {
        formatted = `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
      } else {
        formatted = `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
      }
    }
    
    setDisplayValue(formatted);
    
    // Pass the clean digits back to the parent
    // The parent can then decide how to store it (e.g. adding +1)
    onChange(limitedDigits);
  };

  return (
    <Input
      {...props}
      type="text"
      value={displayValue}
      onChange={handleChange}
      className={className}
    />
  );
};
