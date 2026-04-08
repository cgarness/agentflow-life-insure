import React, { createContext, useContext, useState } from "react";

type DialerOverride = "in-session" | "on-call" | null;

interface AgentStatusContextType {
  dialerOverride: DialerOverride;
  setDialerOverride: (s: DialerOverride) => void;
}

const AgentStatusContext = createContext<AgentStatusContextType>({
  dialerOverride: null,
  setDialerOverride: () => {},
});

export const useAgentStatus = () => useContext(AgentStatusContext);

export const AgentStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialerOverride, setDialerOverride] = useState<DialerOverride>(null);

  return (
    <AgentStatusContext.Provider value={{ dialerOverride, setDialerOverride }}>
      {children}
    </AgentStatusContext.Provider>
  );
};
