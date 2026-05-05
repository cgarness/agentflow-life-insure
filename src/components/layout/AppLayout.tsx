import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { cn } from "@/lib/utils";
import FloatingDialer from "./FloatingDialer";
import FloatingChat from "@/components/chat/FloatingChat";
import WinCelebration from "@/components/WinCelebration";
import ReminderPopup from "./ReminderPopup";
import ImpersonationBanner from "./ImpersonationBanner";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { AgentStatusProvider } from "@/contexts/AgentStatusContext";
import { useAuth } from "@/contexts/AuthContext";

const AppLayout: React.FC = () => {
  const { collapsed } = useSidebarContext();
  const { isImpersonating } = useAuth();
  const location = useLocation();
  const isFullHeightPage = location.pathname === "/conversations" || location.pathname === "/dialer";

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
            <div className={cn("flex-1 min-h-0", !isFullHeightPage && "p-4 lg:p-6")}>
              <Outlet />
            </div>
          </main>
          <FloatingDialer />
          <FloatingChat />
          <WinCelebration />
          <ReminderPopup />
        </div>
      </>
    </AgentStatusProvider>
  );
};

export default AppLayout;
