import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { logRuntimeEvent } from "@/lib/control-center/runtimeEventLogger";

export function useRuntimeErrorCapture(
  userId: string | null,
  organizationId: string | null
) {
  const location = useLocation();
  const currentRouteRef = useRef(location.pathname);
  const userIdRef = useRef(userId);
  const orgIdRef = useRef(organizationId);

  useEffect(() => {
    currentRouteRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    orgIdRef.current = organizationId;
  }, [organizationId]);

  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      const error = event.error || {};
      const title = event.message || error.message || "Unhandled exception";
      const message = error.message || event.message || null;
      const stack = error.stack || null;

      logRuntimeEvent({
        event_type: "frontend_error",
        severity: "high",
        source: "frontend",
        title,
        message,
        stack,
        route: currentRouteRef.current,
        metadata: {
          colno: event.colno,
          lineno: event.lineno,
          filename: event.filename,
          userId: userIdRef.current,
          organizationId: orgIdRef.current,
        },
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason || {};
      const title = reason.message || (typeof reason === "string" ? reason : "Unhandled Promise Rejection");
      const message = reason.message || (typeof reason === "string" ? reason : null);
      const stack = reason.stack || null;

      logRuntimeEvent({
        event_type: "frontend_unhandled_rejection",
        severity: "high",
        source: "frontend",
        title,
        message,
        stack,
        route: currentRouteRef.current,
        metadata: {
          userId: userIdRef.current,
          organizationId: orgIdRef.current,
          reasonStr: typeof reason === "object" ? String(reason) : String(reason),
        },
      });
    };

    window.addEventListener("error", handleGlobalError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);
}
