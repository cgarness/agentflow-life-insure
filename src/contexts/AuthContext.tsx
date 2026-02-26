import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User, UserProfile } from "@/lib/types";
import { authApi } from "@/lib/mock-api";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (data: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session
  useEffect(() => {
    const stored = localStorage.getItem("agentflow-session");
    if (stored) {
      try {
        const { user: u, profile: p } = JSON.parse(stored);
        setUser(u);
        setProfile(p);
      } catch {}
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u, profile: p } = await authApi.login(email, password);
    setUser(u);
    setProfile(p);
    localStorage.setItem("agentflow-session", JSON.stringify({ user: u, profile: p }));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setProfile(null);
    localStorage.removeItem("agentflow-session");
  }, []);

  const updateUser = useCallback((data: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...data };
      const stored = localStorage.getItem("agentflow-session");
      if (stored) {
        const session = JSON.parse(stored);
        session.user = updated;
        localStorage.setItem("agentflow-session", JSON.stringify(session));
      }
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, isAuthenticated: !!user, isLoading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};
