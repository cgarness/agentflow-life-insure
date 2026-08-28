import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { cn } from "@/lib/utils";
import FloatingDialer from "./FloatingDialer";
import ReminderPopup from "./ReminderPopup";
import ImpersonationBanner from "./ImpersonationBanner";
import ViewAsUnsupportedNotice from "./ViewAsUnsupportedNotice";
import { isViewAsSupportedPath } from "@/lib/viewAsSurfaces";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { AgentStatusProvider } from "@/contexts/AgentStatusContext";
import { useAuth } from "@/contexts/AuthContext";
import { useWelcomeEmailTrigger } from "@/hooks/useWelcomeEmailTrigger";

const AppLayout: React.FC = () => {
  const { collapsed } = useSidebarContext();
  const { isImpersonating } = useAuth();
  useWelcomeEmailTrigger();
  const location = useLocation();
  const isFullHeightPage = location.pathname === "/conversations" || location.pathname === "/dialer";
  const isImportPage = location.pathname === "/contacts/import";

  /**
   * THE "View As" ROUTE GUARD, at the layout level on purpose.
   *
   * Every protected route renders through this layout, so one decision here covers direct URLs,
   * sidebar navigation, `navigate()` calls and browser history alike — including the routes that
   * carry no `PageGuard` of their own (`/settings`, `/agent-profile`, `/app-link/:linkId`). Putting
   * it here rather than in `PageGuard` is also what makes the guarantee a MOUNT guarantee: when
   * this is true `<Outlet />` is never rendered, so the route element is never constructed and its
   * effects never run. A guard inside the page could only unmount it after its queries had fired.
   */
  const viewAsBlocked = isImpersonating && !isViewAsSupportedPath(location.pathname);

  return (
    <AgentStatusProvider>
      <>
        <ImpersonationBanner />
        <div className={`min-h-screen bg-background ${isImpersonating ? "pt-12" : ""}`}>
          <Sidebar />
          <TopBar />
          <main className={cn(
            "pt-16 sidebar-transition h-screen flex flex-col",
            collapsed ? "md:ml-16" : "md:ml-60"
          )}>
            <div className={cn(
              "flex-1 min-h-0",
              isImportPage && "px-4 lg:px-6 pt-1 pb-4",
              !isFullHeightPage && !isImportPage && "p-4 lg:p-6",
            )}>
              {viewAsBlocked ? <ViewAsUnsupportedNotice /> : <Outlet />}
            </div>
          </main>
          {/*
            Layout children are page components too, and these two are the reason this is not just
            an `<Outlet />` guard. `FloatingDialer` places calls, writes `calls` rows through
            `saveCall`, and resolves its caller ID from the REAL session's Twilio identity;
            `ReminderPopup` reads the real user's appointments and can dismiss/snooze them. Neither
            has an audited "View As" identity contract, and both mount on every route — so under
            impersonation they would follow the operator onto the two supported pages. They stay
            unmounted for the whole session.
          */}
          {!isImpersonating && <FloatingDialer />}
          {!isImpersonating && <ReminderPopup />}
        </div>
      </>
    </AgentStatusProvider>
  );
};

export default AppLayout;
