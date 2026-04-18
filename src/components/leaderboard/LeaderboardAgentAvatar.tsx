import React from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface LeaderboardAgentAvatarProps {
  avatarUrl?: string | null;
  initials: string;
  alt: string;
  className?: string;
  fallbackClassName?: string;
}

const LeaderboardAgentAvatar: React.FC<LeaderboardAgentAvatarProps> = ({
  avatarUrl,
  initials,
  alt,
  className,
  fallbackClassName,
}) => {
  const url = avatarUrl?.trim() || null;
  return (
  <Avatar className={cn("shrink-0 overflow-hidden rounded-full border border-border/60 shadow-sm bg-muted/20", className)}>
    {url ? <AvatarImage src={url} alt={alt} className="object-cover" /> : null}
    <AvatarFallback className={cn("rounded-full bg-primary/10 text-primary font-bold", fallbackClassName)}>
      {initials}
    </AvatarFallback>
  </Avatar>
  );
};

export default LeaderboardAgentAvatar;
