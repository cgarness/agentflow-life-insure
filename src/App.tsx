import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { CalendarProvider } from "@/contexts/CalendarContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import DialerPage from "./pages/DialerPage";
import Contacts from "./pages/Contacts";
import Conversations from "./pages/Conversations";
import CalendarPage from "./pages/CalendarPage";
import Campaigns from "./pages/Campaigns";
import CampaignDetail from "./pages/CampaignDetail";
import Leaderboard from "./pages/Leaderboard";
import Reports from "./pages/Reports";
import AIAgents from "./pages/AIAgents";
import Training from "./pages/Training";
import SettingsPage from "./pages/SettingsPage";
import AgentProfile from "./pages/AgentProfile";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import LandingPage from "./pages/LandingPage";

import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const bypassAuth = import.meta.env.DEV && searchParams.get('bypass_auth') === 'true';

  if (bypassAuth) return <>{children}</>;
  if (isLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" storageKey="agentflow-theme">
      <TooltipProvider>
        <AuthProvider>
          <BrandingProvider>
            <NotificationProvider>
              <CalendarProvider>
                <SidebarProvider>
                  <Toaster />
                  <Sonner />
                  <BrowserRouter>
                    <ErrorBoundary>
                      <Routes>
                        
                        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                        <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
                        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        <Route path="/landing" element={<LandingPage />} />
                        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                          <Route path="/" element={<Dashboard />} />
                          <Route path="/dialer" element={<DialerPage />} />
                          <Route path="/contacts" element={<Contacts />} />
                          <Route path="/conversations" element={<Conversations />} />
                          <Route path="/calendar" element={<CalendarPage />} />
                          <Route path="/campaigns" element={<Campaigns />} />
                          <Route path="/campaigns/:id" element={<CampaignDetail />} />
                          <Route path="/leaderboard" element={<Leaderboard />} />
                          <Route path="/reports" element={<Reports />} />
                          <Route path="/ai-agents" element={<AIAgents />} />
                          <Route path="/training" element={<Training />} />
                          <Route path="/settings" element={<SettingsPage />} />
                          <Route path="/agent-profile" element={<AgentProfile />} />
                        </Route>
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </ErrorBoundary>
                  </BrowserRouter>
                </SidebarProvider>
              </CalendarProvider>
            </NotificationProvider>
          </BrandingProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
