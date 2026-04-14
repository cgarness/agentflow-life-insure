import { cn } from "@/lib/utils";

type AvatarSize = "sm" | "md" | "lg";

const avatarSizeClasses: Record<AvatarSize, string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-16 h-16",
};

// sm/md avatars are circular (rounded-full); lg uses rounded-2xl to match AgentProfile hero card
const avatarRadiusClasses: Record<AvatarSize, string> = {
  sm: "rounded-full",
  md: "rounded-full",
  lg: "rounded-2xl",
};

export function AvatarSkeleton({
  size = "sm",
  className,
}: {
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-pulse bg-muted shrink-0",
        avatarSizeClasses[size],
        avatarRadiusClasses[size],
        className
      )}
    />
  );
}

// ~80px wide pill — matches a typical first+last name line
export function NameSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse bg-muted rounded-md h-4 w-20", className)}
    />
  );
}

// ~60px wide pill — matches a short role label
export function RoleSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse bg-muted rounded-md h-3 w-16", className)}
    />
  );
}
