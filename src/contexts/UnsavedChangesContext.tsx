import React, { createContext, useContext, useRef, useCallback } from "react";

interface UnsavedChangesContextValue {
  registerDirty: (id: string, isDirty: boolean) => void;
  isAnyDirty: () => boolean;
  clearAll: () => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue>({
  registerDirty: () => {},
  isAnyDirty: () => false,
  clearAll: () => {},
});

export const UnsavedChangesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dirtyMap = useRef<Map<string, boolean>>(new Map());

  const registerDirty = useCallback((id: string, isDirty: boolean) => {
    if (isDirty) {
      dirtyMap.current.set(id, true);
    } else {
      dirtyMap.current.delete(id);
    }
  }, []);

  const isAnyDirty = useCallback(() => {
    return dirtyMap.current.size > 0;
  }, []);

  const clearAll = useCallback(() => {
    dirtyMap.current.clear();
  }, []);

  return (
    <UnsavedChangesContext.Provider value={{ registerDirty, isAnyDirty, clearAll }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
};

export const useUnsavedChanges = () => useContext(UnsavedChangesContext);
