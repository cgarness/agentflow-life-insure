import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

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
  const currentTheme = themeOverride || theme || "light";
  const isDark = currentTheme === "dark";

  const showIcon = variant === "full" || variant === "icon";
  const showText = variant === "full" || variant === "text";

  // Use white-on-black images with screen blending for dark mode (makes it look white/transparent)
  // Use original-on-white images with multiply blending for light mode (makes it look colored/transparent)
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
