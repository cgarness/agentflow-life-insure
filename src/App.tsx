import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
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
import LandingPageTest1 from "./pages/LandingPageTest1";
import PricingPage from "./pages/PricingPage";
import ContactPage from "./pages/ContactPage";
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import AcceptGroupInvite from "@/pages/AcceptGroupInvite";
import ConfirmationPage from "@/pages/ConfirmationPage";
import AuthCallback from "@/pages/AuthCallback";
import OnboardingPage from "./pages/OnboardingPage";
import OnboardingLoadingState from "@/components/onboarding/OnboardingLoadingState";
import { needsAppOnboardingWizard } from "@/lib/onboarding-wizard";
import { useWelcomeEmailTrigger } from "@/hooks/useWelcomeEmailTrigger";
import { resolvePostAuthDestination } from "@/lib/safe-redirect";
import SuperAdminDashboard from "@/pages/SuperAdminDashboard";
import SuperAdminOrgDetail from "@/pages/SuperAdminOrgDetail";
import SuperAdminRoute from "@/components/auth/SuperAdminRoute";
import PlatformAdminRoute from "@/components/auth/PlatformAdminRoute";
import ControlCenterLayout from "@/components/control-center/ControlCenterLayout";
import ControlCenterOverviewPage from "@/pages/control-center/ControlCenterOverviewPage";
import ControlCenterFeaturesPage from "@/pages/control-center/ControlCenterFeaturesPage";
import ControlCenterIssuesPage from "@/pages/control-center/ControlCenterIssuesPage";
import ControlCenterHealthPage from "@/pages/control-center/ControlCenterHealthPage";
import AITestingPage from "@/pages/AITestingPage";
import ContactDeepLinkPage from "./pages/ContactDeepLinkPage";
import PageGuard from "@/components/PageGuard";

import { AppErrorBoundaryWrapper } from "@/components/error/AppErrorBoundary";
import ControlCenterRuntimePage from "@/pages/control-center/ControlCenterRuntimePage";
import ControlCenterTrackerPage from "@/pages/control-center/ControlCenterTrackerPage";

const queryClient = new QueryClient();

// Route gate for /onboarding. Named `OnboardingRouteGate` so it is not confused
// with the wizard's visual shell (`@/components/onboarding/OnboardingShell`).
const OnboardingRouteGate: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  // Freshly-confirmed signups land here, not in AppLayout, so the one-time
  // welcome trigger must also run from the onboarding shell — otherwise a
  // user who never finishes the wizard never receives a welcome email.
  useWelcomeEmailTrigger();
  if (isLoading) return <OnboardingLoadingState />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!needsAppOnboardingWizard(user)) return <Navigate to="/dashboard" replace />;
  return <OnboardingPage />;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, isBuildingOrganization, user } = useAuth();
  const [searchParams] = useSearchParams();
  if (isLoading || isBuildingOrganization) return null;
  // An already-authenticated visitor is redirected here BEFORE the login page mounts,
  // so the validated `?redirect=` must be honored at this sink too — otherwise the
  // group-invite return path is lost for anyone with a live session.
  if (isAuthenticated) {
    return <Navigate to={resolvePostAuthDestination(user, searchParams.get("redirect"))} replace />;
  }
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
                    <AppErrorBoundaryWrapper>
                      <Routes>
                        
                        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                        <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
                        <Route path="/confirmation" element={<PublicRoute><ConfirmationPage /></PublicRoute>} />
                        <Route path="/accept-invite" element={<PublicRoute><AcceptInvitePage /></PublicRoute>} />
                        <Route path="/accept-group-invite" element={<AcceptGroupInvite />} />
                        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        <Route path="/auth/callback" element={<AuthCallback />} />
                        <Route path="/onboarding" element={<OnboardingRouteGate />} />
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/homepagetest1" element={<LandingPageTest1 />} />
                        {/* Retired comparison route — kept as a redirect so shared links keep working. */}
                        <Route path="/logintest1" element={<Navigate to="/login" replace />} />
                        <Route path="/pricing" element={<PricingPage />} />
                        <Route path="/contact" element={<ContactPage />} />
                        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                          <Route path="/dashboard" element={<PageGuard pageName="Dashboard"><Dashboard /></PageGuard>} />
                          <Route path="/dialer" element={<PageGuard pageName="Dialer"><DialerPage /></PageGuard>} />
                          <Route path="/contacts" element={<PageGuard pageName="Contacts"><Contacts /></PageGuard>} />
                          <Route path="/contacts/import" element={<PageGuard pageName="Contacts" contactsPermission="contacts.leads.import"><ImportLeadsPage /></PageGuard>} />
                          <Route path="/leads/:id" element={<PageGuard pageName="Contacts"><ContactDeepLinkPage contactType="lead" /></PageGuard>} />
                          <Route path="/clients/:id" element={<PageGuard pageName="Contacts"><ContactDeepLinkPage contactType="client" /></PageGuard>} />
                          <Route path="/recruits/:id" element={<PageGuard pageName="Contacts"><ContactDeepLinkPage contactType="recruit" /></PageGuard>} />
                          <Route path="/conversations" element={<PageGuard pageName="Conversations"><Conversations /></PageGuard>} />
                          <Route path="/calendar" element={<PageGuard pageName="Calendar"><CalendarPage /></PageGuard>} />
                          <Route path="/campaigns" element={<PageGuard pageName="Campaigns"><Campaigns /></PageGuard>} />
                          <Route path="/campaigns/:id" element={<PageGuard pageName="Campaigns"><CampaignDetail /></PageGuard>} />
                          <Route path="/leaderboard" element={<PageGuard pageName="Leaderboard"><Leaderboard /></PageGuard>} />
                          <Route path="/reports" element={<PageGuard pageName="Reports"><Reports /></PageGuard>} />
                          <Route path="/ai-agents" element={<PageGuard pageName="AI Agents"><AIAgentsPage /></PageGuard>} />
                          <Route path="/ai-agents/new" element={<PageGuard pageName="AI Agents"><AIAgentCreate /></PageGuard>} />
                          <Route path="/training" element={<PageGuard pageName="Training"><Training /></PageGuard>} />
                          <Route path="/resources" element={<PageGuard pageName="Resources"><Resources /></PageGuard>} />
                          <Route path="/app-link/:linkId" element={<AppLinkEmbedPage />} />
                          <Route path="/settings" element={<SettingsPage />} />
                          <Route path="/agent-profile" element={<AgentProfile />} />
                          <Route path="/ai-testing" element={<SuperAdminRoute><AITestingPage /></SuperAdminRoute>} />
                          <Route path="/super-admin" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
                          <Route path="/super-admin/organizations/:id" element={<SuperAdminRoute><SuperAdminOrgDetail /></SuperAdminRoute>} />
                        </Route>
                        <Route element={<PlatformAdminRoute><ControlCenterLayout /></PlatformAdminRoute>}>
                          <Route path="/control-center" element={<ControlCenterOverviewPage />} />
                          <Route path="/control-center/features" element={<ControlCenterFeaturesPage />} />
                          <Route path="/control-center/issues" element={<ControlCenterIssuesPage />} />
                          <Route path="/control-center/health" element={<ControlCenterHealthPage />} />
                          <Route path="/control-center/runtime" element={<ControlCenterRuntimePage />} />
                          <Route path="/control-center/tracker" element={<ControlCenterTrackerPage />} />
                        </Route>
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </AppErrorBoundaryWrapper>
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
