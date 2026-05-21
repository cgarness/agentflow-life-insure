import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";

interface LogoProps {
  variant?: "full" | "icon" | "text";
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  themeOverride?: "light" | "dark";
}

const Logo: React.FC<LogoProps> = ({
  variant = "full",
  className,
  iconClassName,
  textClassName,
  themeOverride,
}) => {
  const { theme } = useTheme();
  const { branding } = useBranding();
  const currentTheme = themeOverride || theme || "light";
  const isDark = currentTheme === "dark";

  const showIcon = variant === "full" || variant === "icon";
  const showText = variant === "full" || variant === "text";

  // If we have a custom logo, we use it. Otherwise fallback to AgentFlow defaults.
  if (branding.logoUrl) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {showIcon && (
          <img
            src={branding.logoUrl}
            alt={branding.companyName}
            className={cn("h-8 w-8 object-contain", iconClassName)}
          />
        )}
        {showText && (
          <span className={cn("font-bold text-lg tracking-tight text-foreground whitespace-nowrap", textClassName)}>
            {branding.companyName}
          </span>
        )}
      </div>
    );
  }

  // Fallback to original AgentFlow branding
  const iconSrc = "/agentflow-icon.png";
  const textSrc = isDark ? "/agentflow-wordmark-on-dark.png" : "/agentflow-wordmark.png";

  return (
    <div className={cn("flex items-center gap-2.5 shrink-0", className)}>
      {showIcon && (
        <img
          src={iconSrc}
          alt="AgentFlow"
          className={cn("h-8 w-8 shrink-0 object-contain", iconClassName)}
        />
      )}
      {showText && (
        <img
          src={textSrc}
          alt="AgentFlow"
          className={cn("h-5 w-auto max-w-[200px] object-contain object-left", textClassName)}
        />
      )}
    </div>
  );
};

export default Logo;
