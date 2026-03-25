import React, { createContext, useContext, useState, useCallback } from "react";
import { User, UserProfile } from "@/lib/types";

interface ViewAsContextType {
  viewingAs: (User & { profile: UserProfile }) | null;
  activateViewAs: (user: User & { profile: UserProfile }) => void;
  exitViewAs: () => void;
  isViewingAs: boolean;
}

const ViewAsContext = createContext<ViewAsContextType>({} as ViewAsContextType);
export const useViewAs = () => useContext(ViewAsContext);

export const ViewAsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [viewingAs, setViewingAs] = useState<(User & { profile: UserProfile }) | null>(null);

  const activateViewAs = useCallback((user: User & { profile: UserProfile }) => {
    setViewingAs(user);
  }, []);

  const exitViewAs = useCallback(() => {
    setViewingAs(null);
  }, []);

  return (
    <ViewAsContext.Provider value={{
      viewingAs,
      activateViewAs,
      exitViewAs,
      isViewingAs: !!viewingAs,
    }}>
      {children}
    </ViewAsContext.Provider>
  );
};
