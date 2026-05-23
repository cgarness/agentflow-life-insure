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

  const agencyName = branding.companyName?.trim() ?? "";
  const hasAgencyLogo = Boolean(branding.logoUrl);
  const hasAgencyIdentity = hasAgencyLogo || agencyName.length > 0;

  if (hasAgencyIdentity) {
    const iconSrc = hasAgencyLogo ? branding.logoUrl! : "/agentflow-icon.png";
    return (
      <div className={cn("flex items-center gap-2.5 min-w-0 shrink-0", className)}>
        {showIcon && (
          <img
            src={iconSrc}
            alt={agencyName || "Agency logo"}
            className={cn("h-8 w-8 shrink-0 object-contain", iconClassName)}
          />
        )}
        {showText && agencyName && (
          <span
            className={cn(
              "font-bold text-lg tracking-tight whitespace-nowrap truncate",
              textClassName ?? "text-foreground",
            )}
          >
            {agencyName}
          </span>
        )}
      </div>
    );
  }

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
