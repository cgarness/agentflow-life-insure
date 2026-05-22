import React, { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { cn } from "@/lib/utils";

interface OdometerValueProps {
  value: number;
  format: (n: number) => string;
  className?: string;
  tv?: boolean;
}

const OdometerValue: React.FC<OdometerValueProps> = ({ value, format, className, tv }) => {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current === value) return;
    const controls = animate(prevRef.current, value, {
      duration: tv ? 0.65 : 0.48,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prevRef.current = value;
    return () => controls.stop();
  }, [value, tv]);

  return (
    <span className={cn("tabular-nums inline-block", className)}>
      {format(display)}
    </span>
  );
};

export default OdometerValue;
