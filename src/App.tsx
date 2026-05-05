import { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProfileSetupModal from "@/components/onboarding/ProfileSetupModal";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { CalendarProvider } from "@/contexts/CalendarContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { TwilioProvider } from "@/contexts/TwilioContext";
import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import DialerPage from "./pages/DialerPage";
import Contacts from "./pages/Contacts";
import ImportLeadsPage from "./pages/ImportLeadsPage";
import Conversations from "./pages/Conversations";
import CalendarPage from "./pages/CalendarPage";

import Campaigns from "./pages/Campaigns";

import CampaignDetail from "./pages/CampaignDetail";
import Leaderboard from "./pages/Leaderboard";
import Reports from "./pages/Reports";
import AIAgentsPage from "./pages/AIAgentsPage";
import AIAgentCreate from "./pages/AIAgentCreate";
import Training from "./pages/Training";
import Resources from "./pages/Resources";
import AppLinkEmbedPage from "./pages/AppLinkEmbedPage";
import SettingsPage from "./pages/SettingsPage";
import AgentProfile from "./pages/AgentProfile";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import LandingPage from "./pages/LandingPage";
import PricingPage from "./pages/PricingPage";
import ContactPage from "./pages/ContactPage";
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import ConfirmationPage from "@/pages/ConfirmationPage";
import AuthCallback from "@/pages/AuthCallback";
import OnboardingPage from "./pages/OnboardingPage";
import { needsAppOnboardingWizard, resolvePostAuthPath } from "@/lib/onboarding-wizard";
import SuperAdminDashboard from "@/pages/SuperAdminDashboard";
import SuperAdminOrgDetail from "@/pages/SuperAdminOrgDetail";
import SuperAdminRoute from "@/components/auth/SuperAdminRoute";

import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

const OnboardingShell: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!needsAppOnboardingWizard(user)) return <Navigate to="/dashboard" replace />;
  return <OnboardingPage />;
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, user, checkProfileSetupNeeded, markProfileSetupSeen } = useAuth();
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const location = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const bypassAuth = import.meta.env.DEV && searchParams.get('bypass_auth') === 'true';

  useEffect(() => {
    if (isAuthenticated && user) {
      if (checkProfileSetupNeeded()) setShowProfileSetup(true);
    }
  }, [isAuthenticated, user, checkProfileSetupNeeded]);

  if (bypassAuth) return <>{children}</>;
  if (isLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user && needsAppOnboardingWizard(user)) {
    return <Navigate to="/onboarding" replace state={{ from: location.pathname }} />;
  }
  return (
    <>
      {children}
      <ProfileSetupModal
        open={showProfileSetup}
        onClose={() => {
          markProfileSetupSeen(true);
          setShowProfileSetup(false);
        }}
        onComplete={() => {
          markProfileSetupSeen(false);
          setShowProfileSetup(false);
        }}
      />
    </>
  );
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to={resolvePostAuthPath(user)} replace />;
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
                <TwilioProvider>
                <SidebarProvider>
                  <Toaster />
                  <Sonner />
                  <BrowserRouter>
                    <ErrorBoundary>
                      <Routes>
                        
                        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                        <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
                        <Route path="/confirmation" element={<PublicRoute><ConfirmationPage /></PublicRoute>} />
                        <Route path="/accept-invite" element={<PublicRoute><AcceptInvitePage /></PublicRoute>} />
                        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        <Route path="/auth/callback" element={<AuthCallback />} />
                        <Route path="/onboarding" element={<OnboardingShell />} />
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/pricing" element={<PricingPage />} />
                        <Route path="/contact" element={<ContactPage />} />
                        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                          <Route path="/dashboard" element={<Dashboard />} />
                          <Route path="/dialer" element={<DialerPage />} />
                          <Route path="/contacts" element={<Contacts />} />
                          <Route path="/contacts/import" element={<ImportLeadsPage />} />
                          <Route path="/conversations" element={<Conversations />} />
                          <Route path="/calendar" element={<CalendarPage />} />


                          <Route path="/campaigns" element={<Campaigns />} />
                          <Route path="/campaigns/:id" element={<CampaignDetail />} />
                          <Route path="/leaderboard" element={<Leaderboard />} />
                          <Route path="/reports" element={<Reports />} />
                          <Route path="/ai-agents" element={<AIAgentsPage />} />
                          <Route path="/ai-agents/new" element={<AIAgentCreate />} />
                          <Route path="/training" element={<Training />} />
                          <Route path="/resources" element={<Resources />} />
                          <Route path="/app-link/:linkId" element={<AppLinkEmbedPage />} />
                          <Route path="/settings" element={<SettingsPage />} />
                          <Route path="/agent-profile" element={<AgentProfile />} />
                          <Route path="/super-admin" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
                          <Route path="/super-admin/organizations/:id" element={<SuperAdminRoute><SuperAdminOrgDetail /></SuperAdminRoute>} />
                        </Route>
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </ErrorBoundary>
                  </BrowserRouter>
                </SidebarProvider>
                </TwilioProvider>
              </CalendarProvider>
            </NotificationProvider>
          </BrandingProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
