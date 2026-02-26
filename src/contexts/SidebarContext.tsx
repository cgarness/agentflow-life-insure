import React, { createContext, useContext, useState, useEffect } from "react";

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});

export const useSidebarContext = () => useContext(SidebarContext);

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("agentflow-sidebar-collapsed");
    return saved === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("agentflow-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  const toggle = () => setCollapsed((c) => !c);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
};
