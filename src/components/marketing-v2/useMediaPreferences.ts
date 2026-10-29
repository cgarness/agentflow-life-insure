import { useEffect, useState } from "react";

interface Connection extends EventTarget { saveData?: boolean; effectiveType?: string }

/** Default to no autoplay until browser preferences have been resolved. */
export function useMediaPreferences() {
  const [allowAutoplay, setAllowAutoplay] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const update = () => setAllowAutoplay(!motion.matches && !connection?.saveData &&
      !["slow-2g", "2g"].includes(connection?.effectiveType || ""));
    update();
    motion.addEventListener?.("change", update);
    connection?.addEventListener("change", update);
    return () => {
      motion.removeEventListener?.("change", update);
      connection?.removeEventListener("change", update);
    };
  }, []);
  return allowAutoplay;
}
