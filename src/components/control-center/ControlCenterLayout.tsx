import React from "react";
import { Outlet } from "react-router-dom";
import ControlCenterSidebar from "./ControlCenterSidebar";

/**
 * Standalone shell for /control-center/*. Deliberately does NOT mount the CRM
 * sidebar, TopBar, FloatingDialer, AgentStatusProvider, etc. — Control Center
 * is a separate platform-admin experience.
 */
const ControlCenterLayout: React.FC = () => (
  <div className="min-h-screen bg-slate-950 text-slate-100">
    <ControlCenterSidebar />
    <main className="md:ml-60 min-h-screen flex flex-col">
      <div className="flex-1 px-4 lg:px-8 py-6 lg:py-8 max-w-7xl mx-auto w-full">
        <Outlet />
      </div>
    </main>
  </div>
);

export default ControlCenterLayout;
