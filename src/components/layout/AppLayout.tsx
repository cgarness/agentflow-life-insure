import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import FloatingDialer from "./FloatingDialer";
import FloatingChat from "@/components/chat/FloatingChat";
import WinCelebration from "@/components/WinCelebration";
import ReminderPopup from "./ReminderPopup";
import { useSidebarContext } from "@/contexts/SidebarContext";
import { AgentStatusProvider } from "@/contexts/AgentStatusContext";

const AppLayout: React.FC = () => {
  const { collapsed } = useSidebarContext();

  return (
    <AgentStatusProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <TopBar />
        <main className={`pt-16 sidebar-transition ${collapsed ? "md:ml-16" : "md:ml-60"}`}>
          <div className="p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
        <FloatingDialer />
        <FloatingChat />
        <WinCelebration />
        <ReminderPopup />
      </div>
    </AgentStatusProvider>
  );
};

export default AppLayout;
