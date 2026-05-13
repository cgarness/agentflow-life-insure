import React from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  variant?: "full" | "icon" | "text";
  className?: string;
  iconClassName?: string;
  textClassName?: string;
}

const Logo: React.FC<LogoProps> = ({
  variant = "full",
  className,
  iconClassName,
  textClassName,
}) => {
  const showIcon = variant === "full" || variant === "icon";
  const showText = variant === "full" || variant === "text";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showIcon && (
        <img
          src="/icon.png"
          alt="AgentFlow Icon"
          className={cn("h-8 w-8 object-contain", iconClassName)}
        />
      )}
      {showText && (
        <img
          src="/logo-text.png"
          alt="AgentFlow"
          className={cn("h-5 object-contain", textClassName)}
        />
      )}
    </div>
  );
};

export default Logo;
