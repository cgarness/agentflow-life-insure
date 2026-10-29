import { useEffect } from "react";

export function usePreviewMetadata() {
  useEffect(() => {
    const title = document.title;
    document.title = "AgentFlow | Private Homepage V2 Preview";
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previous = existing?.getAttribute("content");
    const robots = existing || document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow, noarchive";
    if (!existing) document.head.appendChild(robots);
    return () => {
      document.title = title;
      if (!existing) robots.remove();
      else if (previous == null) robots.removeAttribute("content");
      else robots.content = previous;
    };
  }, []);
}
