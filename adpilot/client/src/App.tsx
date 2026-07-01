import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ClientProvider, useClient } from "@/lib/client-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LogOut, Sparkles, AlertTriangle, User, Settings, Plus } from "lucide-react";
import { AddClientModal } from "@/components/add-client-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { CommandTerminal, CommandTerminalToggle } from "@/components/command-terminal";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import DashboardPage from "@/pages/dashboard";
import CampaignsPage from "@/pages/campaigns";
import CreativesPage from "@/pages/creatives";
import AuditPage from "@/pages/audit";
import RecommendationsPage from "@/pages/recommendations";
import SettingsPage from "@/pages/settings";
import CommandCenterPage from "@/pages/command-center";
import AdsetsPage from "@/pages/adsets";
import ExecutionLogPage from "@/pages/execution-log";
import ManageClientsPage from "@/pages/manage-clients";
import UsersPage from "@/pages/users";
import BenchmarksPage from "@/pages/benchmarks";
import BreakdownsPage from "@/pages/breakdowns";
import GoogleQualityScorePage from "@/pages/google/quality-score";
import GoogleSearchTermsPage from "@/pages/google/search-terms";
import GoogleBiddingPage from "@/pages/google/bidding";
import GoogleAudiencesPage from "@/pages/google/audiences";
import GoogleRestructuringPage from "@/pages/google/restructuring";
import CreativeCalendarPage from "@/pages/creative-calendar";
import MtdDeliverablesPage from "@/pages/mtd-deliverables";
import AnalyticsAdsPage from "@/pages/analytics-ads";
import KeywordsPage from "@/pages/keywords.tsx";
import AudiencesPage from "@/pages/audiences.tsx";
import { timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { useNow } from "@/hooks/use-now";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/campaigns" component={CampaignsPage} />
      <Route path="/adsets" component={AdsetsPage} />
      <Route path="/creative-generation" component={CreativesPage} />
      <Route path="/audit" component={AuditPage} />
      <Route path="/recommendations" component={RecommendationsPage} />
      <Route path="/command-center" component={CommandCenterPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/execution-log" component={ExecutionLogPage} />
      <Route path="/manage-clients" component={ManageClientsPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/benchmarks" component={BenchmarksPage} />
      <Route path="/breakdowns" component={BreakdownsPage} />
      <Route path="/google/quality-score" component={GoogleQualityScorePage} />
      <Route path="/google/search-terms" component={GoogleSearchTermsPage} />
      <Route path="/google/bidding" component={GoogleBiddingPage} />
      <Route path="/google/audiences" component={GoogleAudiencesPage} />
      <Route path="/google/restructuring" component={GoogleRestructuringPage} />
      <Route path="/creative-calendar" component={CreativeCalendarPage} />
      <Route path="/mtd-deliverables" component={MtdDeliverablesPage} />
      <Route path="/analytics/ads" component={AnalyticsAdsPage} />
      <Route path="/keywords" component={KeywordsPage} />
      <Route path="/audiences" component={AudiencesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  useLiveUpdates();
  const { analysisData, activeClient, activePlatformInfo, syncState } = useClient();
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const { setActiveClientId } = useClient();
  useNow();

  const lastSynced = syncState?.last_synced_at ? timeAgo(syncState.last_synced_at) : undefined;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setTerminalOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <aside aria-label="Primary sidebar">
          <AppSidebar syncState={syncState} lastSynced={lastSynced} />
        </aside>
        <div className="flex flex-col flex-1 min-w-0 bg-[linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.55))]">
          <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border/60 shrink-0 bg-background/88 backdrop-blur-xl z-10">
            <nav className="flex items-center gap-3" aria-label="Workspace controls">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="hidden md:grid leading-none gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.1em] text-foreground">
                  {activeClient?.name || "No client selected"}
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  {activePlatformInfo?.enabled ? activePlatformInfo.label : "Platform unavailable"}
                  {analysisData?.period?.primary_7d
                    ? ` · ${analysisData.period.primary_7d.start} — ${analysisData.period.primary_7d.end}`
                    : ""}
                </span>
              </div>
              {analysisData?.cadence && (
                <Badge variant="warning" className="hidden md:inline-flex">
                  {analysisData.cadence.replace(/_/g, " ")}
                </Badge>
              )}
              {analysisData?.agent_version && (
                <span className="text-xs font-medium text-muted-foreground hidden md:inline">
                  {analysisData.agent_version}
                </span>
              )}
            </nav>
            <div className="flex items-center gap-2.5" aria-label="User actions">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="hidden lg:grid text-right leading-none gap-1 px-3 py-1.5 rounded-lg hover:bg-accent/50 transition-colors outline-none group text-left">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-foreground group-hover:text-primary transition-colors">Operator</span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {user?.name} · {user?.role}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px] rounded-xl bg-background/95 backdrop-blur-xl border-border/60 shadow-2xl p-2">
                  <DropdownMenuLabel className="px-2 py-1.5">
                    <div className="flex flex-col">
                      <span className="text-base font-semibold">{user?.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border/40" />
                  <DropdownMenuItem 
                    onClick={() => setShowAddClient(true)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-accent/60 text-muted-foreground"
                  >
                    <Plus className="size-3.5 text-foreground" />
                    <span className="text-[13px]">Register New Client</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setLocation("/settings")}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-accent/60 text-muted-foreground"
                  >
                    <Settings className="size-3.5 text-foreground" />
                    <span className="text-[13px]">Profile Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border/40" />
                  <DropdownMenuItem 
                    onClick={logout}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-accent/60 text-foreground font-medium"
                  >
                    <LogOut className="size-3.5" />
                    <span className="text-[13px]">Log Out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="lg:hidden">
                <Button size="icon" variant="outline" onClick={logout} aria-label="Log out" data-testid="button-logout">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={() => setLocation("/creative-generation")}
                className="gap-1.5 h-8 px-3 text-xs font-bold bg-primary hover:bg-[#f5c723] border-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline uppercase tracking-wider">Creative Generation</span>
              </Button>
              <CommandTerminalToggle onClick={() => setTerminalOpen((o) => !o)} isOpen={terminalOpen} />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto overflow-x-hidden" style={{ overscrollBehavior: "contain" }}>
            <section aria-label="Workspace content">
              <ErrorBoundary>
                <AppRouter />
              </ErrorBoundary>
            </section>
            <aside className="px-6 py-4 border-t border-border/40 bg-background/72 backdrop-blur-sm" aria-label="Attribution">
              <PerplexityAttribution />
            </aside>
          </main>
        </div>
      </div>
      <CommandTerminal isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} />
      {showAddClient && (
        <AddClientModal 
          onClose={() => setShowAddClient(false)} 
          onCreated={(id) => {
            setShowAddClient(false);
            setActiveClientId(id);
            setLocation("/");
          }}
        />
      )}
    </SidebarProvider>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-base text-muted-foreground">
        Checking access...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <ClientProvider>
      <AppLayout />
    </ClientProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <Router hook={useHashLocation}>
              <AuthProvider>
                <AuthGate />
              </AuthProvider>
            </Router>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
