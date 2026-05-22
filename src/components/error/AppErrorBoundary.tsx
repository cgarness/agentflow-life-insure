import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "react-router-dom";
import { useRuntimeErrorCapture } from "@/hooks/useRuntimeErrorCapture";
import { logRuntimeEvent } from "@/lib/control-center/runtimeEventLogger";
import { AlertOctagon, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClassProps {
  children: React.ReactNode;
  userId: string | null;
  organizationId: string | null;
  route: string;
}

interface ClassState {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<ClassProps, ClassState> {
  constructor(props: ClassProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log component render crash with critical severity
    logRuntimeEvent({
      event_type: "frontend_error",
      severity: "critical",
      source: "frontend",
      title: error.name || "React Component Crash",
      message: error.message,
      stack: error.stack,
      route: this.props.route,
      component_name: "AppErrorBoundary",
      metadata: {
        componentStack: errorInfo.componentStack,
        userId: this.props.userId,
        organizationId: this.props.organizationId,
      },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-slate-100 font-sans">
          <div className="max-w-md w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-8 backdrop-blur-xl shadow-2xl space-y-6 relative overflow-hidden">
            {/* Ambient background glow */}
            <div className="absolute -top-12 -left-12 w-32 h-32 bg-red-500/10 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 animate-pulse">
                <AlertOctagon className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
                  Application Error
                </h1>
                <p className="text-sm text-slate-400 max-w-sm">
                  An unexpected error crashed this view. The platform team has been notified.
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 overflow-x-auto max-h-48 text-xs font-mono text-red-400/90 leading-relaxed custom-scrollbar">
                <span className="font-semibold text-slate-300 select-none">Error: </span>
                {this.state.error.message}
                {this.state.error.stack && (
                  <div className="mt-2 text-slate-500/90 whitespace-pre">
                    {this.state.error.stack}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                variant="outline"
                className="w-full bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                onClick={() => {
                  window.location.href = "/";
                }}
              >
                <Home className="w-4 h-4 mr-2" />
                Go Home
              </Button>
              <Button
                className="w-full bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export const AppErrorBoundaryWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const location = useLocation();

  const userId = profile?.id || null;
  const organizationId = profile?.organization_id || null;
  const route = location.pathname;

  // Mount the global window error and promise rejection listeners here
  useRuntimeErrorCapture(userId, organizationId);

  return (
    <AppErrorBoundary
      userId={userId}
      organizationId={organizationId}
      route={route}
    >
      {children}
    </AppErrorBoundary>
  );
};
