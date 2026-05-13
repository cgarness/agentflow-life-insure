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
  const iconSrc = isDark ? "/icon-dark.png" : "/icon-white.png";
  const textSrc = isDark ? "/logo-text-dark.png" : "/logo-text-white.png";
  const blendMode = isDark ? "screen" : "multiply";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showIcon && (
        <img
          src={iconSrc}
          alt="AgentFlow Icon"
          className={cn("h-8 w-8 object-contain", iconClassName)}
          style={{ mixBlendMode: blendMode as any }}
        />
      )}
      {showText && (
        <img
          src={textSrc}
          alt="AgentFlow"
          className={cn("h-5 object-contain", textClassName)}
          style={{ mixBlendMode: blendMode as any }}
        />
      )}
    </div>
  );
};

export default Logo;
