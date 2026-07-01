import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { useAuth, type AuthUser } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Settings,
  Wifi,
  WifiOff,
  Calendar,
  Download,
  Play,
  Terminal,
  CheckCircle,
  XCircle,
  Globe,
  Target,
  Clock,
  Info,
  Loader2,
  FileJson,
  FileSpreadsheet,
  BookOpen,
  Users,
  RefreshCw,
  Facebook,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── CSV Export Utility ──────────────────────────────────────────────

function downloadCSV(data: any[], filename: string) {
  if (!data || data.length === 0) return;
  const headers = Object.keys(data[0] || {});
  const csv = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Scheduler Shared ────────────────────────────────────────────────

interface SchedulerStatus {
  lastRun?: string;
  lastRunSuccess?: boolean;
  lastRunDuration?: number;
  lastError?: string;
  nextRun?: string;
  isRunning?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    activeClient,
    activeClientId,
    activePlatform,
    analysisData: data,
    isLoadingAnalysis,
    apiBase,
  } = useClient();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  const [metaStatus, setMetaStatus] = useState<"checking" | "ok" | "error">("checking");
  const [metaApiVersion, setMetaApiVersion] = useState<string>("");
  const [metaTokenExpiry, setMetaTokenExpiry] = useState<string>("");
  const [metaTokenDebug, setMetaTokenDebug] = useState<string>("");
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [learningData, setLearningData] = useState<any[]>([]);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [isVerifyingApi, setIsVerifyingApi] = useState(false);

  // Google API status state (GS-01)
  const [googleStatus, setGoogleStatus] = useState<"checking" | "ok" | "error" | "idle">("idle");
  const [googleCustomerId, setGoogleCustomerId] = useState<string>("");
  const [googleMccId, setGoogleMccId] = useState<string>("");
  const [googleApiVersion, setGoogleApiVersion] = useState<string>("");
  const [isVerifyingGoogleApi, setIsVerifyingGoogleApi] = useState(false);
  const [aiConfig, setAiConfig] = useState({
    openapiApiKey: "",
    geminiModel: "",
    geminiImageModel: "",
    groqApiKey: "",
    groqModel: "",
  });
  const [isSavingAiConfig, setIsSavingAiConfig] = useState(false);

  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [showError, setShowError] = useState(false);

  const { data: schedulerStatus, isLoading: isLoadingScheduler } = useQuery<SchedulerStatus>({
    queryKey: ["/api/scheduler/status"],
    refetchInterval: running ? 3000 : 30000,
  });

  async function runNow() {
    setRunning(true);
    try {
      const res = await apiRequest("POST", "/api/scheduler/run-now");
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Agent triggered", description: "Data fetch started — this may take ~60 seconds." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/scheduler/status"] });
      }, 5000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  const isCurrentlyRunning = schedulerStatus?.isRunning || running;

  const [accessUsers, setAccessUsers] = useState<AuthUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "member" as "admin" | "member",
    status: "active" as "active" | "blocked",
  });

  // Verify Meta API status — actually pings the Meta API
  async function verifyMetaApi() {
    setIsVerifyingApi(true);
    setMetaStatus("checking");
    try {
      const r = await fetch("/api/entity/act_391022327028566/status");
      if (r.ok) {
        setMetaStatus("ok");
        const d = await r.json().catch(() => null);
        if (d) {
          setMetaApiVersion(d.api_version || "v21.0");
          setMetaTokenExpiry(d.token_expires || "");
          setMetaTokenDebug(d.account_id ? `Account: ${d.account_id}` : "");
        }
      } else {
        setMetaStatus("error");
        const errData = await r.json().catch(() => null);
        setMetaTokenDebug(errData?.error || `HTTP ${r.status}`);
      }
    } catch (err: any) {
      setMetaStatus("error");
      setMetaTokenDebug(err.message || "Connection failed");
    }
    setIsVerifyingApi(false);
  }

  // Verify Google API status (GS-01)
  async function verifyGoogleApi() {
    if (!activeClientId) {
      setGoogleStatus("idle");
      return;
    }
    setIsVerifyingGoogleApi(true);
    setGoogleStatus("checking");
    try {
      const r = await fetch(`/api/clients/${activeClientId}/google/status`, {
        credentials: "include",
      });
      if (r.ok) {
        setGoogleStatus("ok");
        const d = await r.json().catch(() => null);
        if (d) {
          setGoogleCustomerId(
            (d as any).customer_id || (d as any).account_id || ""
          );
          setGoogleMccId((d as any).mcc_id || (d as any).manager_id || "");
          setGoogleApiVersion((d as any).api_version || "v17");
        }
      } else {
        setGoogleStatus("error");
      }
    } catch {
      setGoogleStatus("error");
    }
    setIsVerifyingGoogleApi(false);
  }

  // Initial Meta API check
  useEffect(() => {
    verifyMetaApi();
    loadAiConfig();
  }, []);

  async function loadAiConfig() {
    try {
      const r = await fetch("/api/config/ai");
      if (r.ok) {
        const d = await r.json();
        setAiConfig(d);
      }
    } catch {}
  }

  async function handleSaveAiConfig() {
    setIsSavingAiConfig(true);
    try {
      const r = await apiRequest("POST", "/api/config/ai", aiConfig);
      if (r.ok) {
        toast({ title: "AI Config updated", description: "AI engine parameters saved successfully." });
      }
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSavingAiConfig(false);
    }
  }

  // Fetch audit log for exports
  useEffect(() => {
    apiRequest("GET", `${apiBase}/audit-log`)
      .then((r) => r.json())
      .then((d) => setAuditLog(d.entries || d || []))
      .catch(() => {});
  }, [apiBase]);

  // Fetch learning data for exports
  useEffect(() => {
    apiRequest("GET", `${apiBase}/learning-data`)
      .then((r) => r.json())
      .then((d) => setLearningData(d.entries || d || []))
      .catch(() => {});
  }, [apiBase]);

  async function loadAccessUsers() {
    if (!isAdmin) return;
    setIsLoadingUsers(true);
    try {
      const res = await apiRequest("GET", "/api/access/users");
      const users = await res.json();
      setAccessUsers(users);
    } catch {
      setAccessUsers([]);
    } finally {
      setIsLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadAccessUsers();
  }, [isAdmin]);

  async function handleCreateUser() {
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
      toast({ title: "Missing fields", description: "Name, email, and password are required", variant: "destructive" });
      return;
    }
    setIsSavingUser(true);
    try {
      await apiRequest("POST", "/api/access/users", newUser);
      setNewUser({ name: "", email: "", password: "", role: "member", status: "active" });
      await loadAccessUsers();
      toast({ title: "User created", description: `${newUser.email} can now use the app` });
    } catch (err: any) {
      toast({ title: "Create failed", description: err.message || "Could not create user", variant: "destructive" });
    } finally {
      setIsSavingUser(false);
    }
  }

  async function updateUserAccess(target: AuthUser, patch: Partial<Pick<AuthUser, "role" | "status">>) {
    try {
      await apiRequest("PUT", `/api/access/users/${target.id}`, {
        name: target.name,
        email: target.email,
        role: patch.role || target.role,
        status: patch.status || target.status,
      });
      await loadAccessUsers();
      toast({
        title: "Access updated",
        description: `${target.email} is now ${(patch.status || target.status) === "active" ? "allowed to log in" : "blocked from logging in"}`,
      });
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message || "Could not update user", variant: "destructive" });
    }
  }

  // Google sync time from analysis
  const googleLastSync = useMemo(() => {
    if (!data) return null;
    return (
      (data as any).generated_at ||
      (data as any).analysis_date ||
      (data as any).timestamp ||
      null
    );
  }, [data]);

  // Last Agent Run timestamp
  const lastAgentRun = useMemo(() => {
    if (!data) return null;
    return (data as any).generated_at || (data as any).analysis_date || (data as any).timestamp || null;
  }, [data]);

  const targets = activeClient?.targets;
  const targetLocations = (activeClient as any)?.targetLocations || [];

  // Export handlers
  async function handleExport(type: "audit" | "analysis" | "learning") {
    setIsExporting(type);
    try {
      switch (type) {
        case "audit":
          downloadCSV(auditLog, `audit-log-${activeClientId}-${activePlatform}.csv`);
          break;
        case "analysis":
          downloadJSON(data, `analysis-${activeClientId}-${activePlatform}.json`);
          break;
        case "learning":
          downloadCSV(learningData, `learning-data-${activeClientId}-${activePlatform}.csv`);
          break;
      }
      toast({ title: "Export Complete", description: `${type} data downloaded` });
    } catch (err: any) {
      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
    } finally {
      setTimeout(() => setIsExporting(null), 500);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-[1000px]">
      <div>
        <h1 className="t-page-title">
          <Settings className="w-5 h-5" />
          Settings
        </h1>
        <p className="t-label">
          API status, team access, agent schedule, and data exports
        </p>
      </div>

      {/* ─── A) API Status Section ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" />
            API Status
          </CardTitle>
        </CardHeader>
        <CardContent className="card-content-premium">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Meta Status */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="flex items-center gap-2">
                {metaStatus === "checking" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : metaStatus === "ok" ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <div>
                  <p className="t-body font-medium text-foreground">Meta Ads API</p>
                  <p className="t-label">
                    {metaStatus === "checking"
                      ? "Verifying token..."
                      : metaStatus === "ok"
                      ? "Token verified — connected"
                      : "Token invalid or expired"}
                    {metaApiVersion && ` · ${metaApiVersion}`}
                  </p>
                  {metaTokenDebug && (
                    <p className="text-xs text-muted-foreground">{metaTokenDebug}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-xs ${
                    metaStatus === "ok"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : metaStatus === "error"
                      ? "bg-red-500/15 text-red-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {metaStatus === "ok" ? "Active" : metaStatus === "error" ? "Error" : "..."}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={verifyMetaApi}
                  disabled={isVerifyingApi}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingApi ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {/* Google Status (GS-01) */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
              <div className="flex items-center gap-2">
                {googleStatus === "checking" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : googleStatus === "ok" ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : googleStatus === "error" ? (
                  <XCircle className="w-4 h-4 text-red-400" />
                ) : googleLastSync ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <WifiOff className="w-4 h-4 text-muted-foreground" />
                )}
                <div>
                  <p className="t-body font-medium text-foreground">Google Ads API</p>
                  <p className="t-label">
                    {googleStatus === "checking"
                      ? "Verifying connection..."
                      : googleStatus === "ok"
                      ? "Token verified — connected"
                      : googleStatus === "error"
                      ? "Connection failed"
                      : googleLastSync
                      ? `Last sync: ${new Date(googleLastSync).toLocaleDateString()}`
                      : "No data synced yet"}
                    {googleApiVersion && ` · ${googleApiVersion}`}
                  </p>
                  {googleCustomerId && (
                    <p className="text-xs text-muted-foreground">
                      Customer: {googleCustomerId}
                      {googleMccId && ` · MCC: ${googleMccId}`}
                    </p>
                  )}
                  {!googleCustomerId && (data as any)?.customer_id && (
                    <p className="text-xs text-muted-foreground">
                      Customer: {(data as any).customer_id}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-xs ${
                    googleStatus === "ok"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : googleStatus === "error"
                      ? "bg-red-500/15 text-red-400"
                      : googleLastSync
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {googleStatus === "ok"
                    ? "Active"
                    : googleStatus === "error"
                    ? "Error"
                    : googleStatus === "checking"
                    ? "..."
                    : googleLastSync
                    ? "Active"
                    : "Pending"}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={verifyGoogleApi}
                  disabled={isVerifyingGoogleApi}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingGoogleApi ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">OpenAPI Text Engine</p>
              <div className="flex items-center gap-2">
                {aiConfig.openapiApiKey ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                )}
                <span className="text-xs text-foreground font-medium">
                  {aiConfig.openapiApiKey ? "Ready" : "Not Configured"}
                </span>
                <Badge variant="secondary" className="text-xs px-1 py-0">{aiConfig.geminiModel || "gemini-1.5-flash"}</Badge>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">OpenAPI Image Engine</p>
              <div className="flex items-center gap-2">
                {aiConfig.openapiApiKey ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                )}
                <span className="text-xs text-foreground font-medium">
                  {aiConfig.openapiApiKey ? "Ready" : "Not Configured"}
                </span>
                <Badge variant="secondary" className="text-xs px-1 py-0">{aiConfig.geminiImageModel || "gemini-2.0-flash-img"}</Badge>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* ─── AI Engine Configuration ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-foreground">
            <Terminal className="w-4 h-4 text-primary" />
            AI Engine Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="t-label">
            OpenAPI compatible endpoints power all AI in this platform — text generation for creatives and campaign intelligence,
            and native image generation for the Creative Hub.
          </p>

          <div className="space-y-2 p-3 rounded-lg bg-muted/10 border border-border/30">
            <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">OpenAPI</Badge>
              API Key &amp; Models
            </p>
            <div className="grid md:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">API Key</label>
                <Input
                  type="password"
                  placeholder="AIzaSy..."
                  className="h-8 text-xs bg-background mt-1"
                  value={aiConfig.openapiApiKey}
                  onChange={(e) => setAiConfig(prev => ({ ...prev, openapiApiKey: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">Text Model</label>
                <Input
                  placeholder="gemini-1.5-flash"
                  className="h-8 text-xs bg-background mt-1"
                  value={aiConfig.geminiModel}
                  onChange={(e) => setAiConfig(prev => ({ ...prev, geminiModel: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">Image Model</label>
                <Input
                  placeholder="gemini-2.0-flash-preview-image-generation"
                  className="h-8 text-xs bg-background mt-1"
                  value={aiConfig.geminiImageModel}
                  onChange={(e) => setAiConfig(prev => ({ ...prev, geminiImageModel: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={handleSaveAiConfig} disabled={isSavingAiConfig}>
              {isSavingAiConfig ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
              Save AI Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── B) Access Management Section ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" />
            Access Management
            <Badge variant="secondary" className="text-xs">{user?.role || "member"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="card-content-premium">
          <p className="t-label">
            Control which users can log in. Active users can enter the app; blocked users are denied at login.
          </p>
          {isAdmin ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  placeholder="Full name"
                  className="text-base bg-muted/30"
                  value={newUser.name}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, name: e.target.value }))}
                />
                <Input
                  placeholder="email@example.com"
                  className="text-base bg-muted/30"
                  value={newUser.email}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))}
                />
                <Input
                  placeholder="Temporary password"
                  type="password"
                  className="text-base bg-muted/30"
                  value={newUser.password}
                  onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={newUser.role === "member" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewUser((prev) => ({ ...prev, role: "member" }))}
                  >
                    Member
                  </Button>
                  <Button
                    type="button"
                    variant={newUser.role === "admin" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewUser((prev) => ({ ...prev, role: "admin" }))}
                  >
                    Admin
                  </Button>
                </div>
              </div>
              <Button size="sm" onClick={handleCreateUser} disabled={isSavingUser}>
                {isSavingUser ? "Creating..." : "Create user"}
              </Button>

              <div className="space-y-2">
                {isLoadingUsers ? (
                  <p className="text-xs text-muted-foreground ">Loading users...</p>
                ) : accessUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground ">No users found</p>
                ) : (
                  accessUsers.map((accessUser) => (
                    <div key={accessUser.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 p-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-medium">{accessUser.name}</span>
                          <Badge variant="secondary" className="text-xs">{accessUser.role}</Badge>
                          <Badge
                            variant="secondary"
                            className={`text-xs ${accessUser.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}
                          >
                            {accessUser.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{accessUser.email}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateUserAccess(accessUser, { role: accessUser.role === "admin" ? "member" : "admin" })}
                        >
                          Make {accessUser.role === "admin" ? "member" : "admin"}
                        </Button>
                        <Button
                          size="sm"
                          variant={accessUser.status === "active" ? "destructive" : "default"}
                          onClick={() => updateUserAccess(accessUser, { status: accessUser.status === "active" ? "blocked" : "active" })}
                        >
                          {accessUser.status === "active" ? "Block login" : "Allow login"}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground ">Only admins can manage user access.</p>
          )}
        </CardContent>
      </Card>

      {/* ─── C) Client Configuration Section ────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />
            Client Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="t-body font-medium text-foreground">
              {activeClient?.name || "Amara"}
            </span>
            <Badge variant="secondary" className="text-xs">
              {activeClient?.shortName || "Amara"}
            </Badge>
            {activeClient?.location && (
              <span className="t-label">
                📍 {activeClient.location}
              </span>
            )}
          </div>

          {/* Target locations */}
          {targetLocations.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Target Locations
              </p>
              <div className="flex flex-wrap gap-1.5">
                {targetLocations.map((loc: string) => (
                  <Badge key={loc} variant="outline" className="text-xs">
                    {loc}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Targets Table */}
          {targets && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                Monthly Targets
              </p>
              <div className="overflow-x-auto">
                <table className="t-table w-full">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="p-2 text-xs font-medium uppercase tracking-wider text-muted-foreground text-left">
                        Platform
                      </th>
                      <th className="p-2 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                        Budget
                      </th>
                      <th className="p-2 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                        Leads
                      </th>
                      <th className="p-2 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                        CPL
                      </th>
                      <th className="p-2 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                        SVs
                      </th>
                      <th className="p-2 text-xs font-medium uppercase tracking-wider text-muted-foreground text-right">
                        CPSV
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(targets).map(([platform, t]) => (
                      <tr
                        key={platform}
                        className="border-b border-border/30"
                      >
                        <td className="p-2">
                          <Badge
                            variant="secondary"
                            className={`text-xs ${
                              platform === "meta"
                                ? "bg-blue-500/15 text-blue-400"
                                : "bg-amber-500/15 text-amber-400"
                            }`}
                          >
                            {platform === "meta" ? "Meta Ads" : "Google Ads"}
                          </Badge>
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          ₹{t.budget.toLocaleString()}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {t.leads}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          ₹{t.cpl.toLocaleString()}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {t.svs.low}–{t.svs.high}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          ₹{t.cpsv.low.toLocaleString()}–₹{t.cpsv.high.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── D) Agent Schedule Section ──────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Agent Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Primary daily schedule */}
          <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-medium text-primary">Daily Agent Run</p>
                <p className="t-label">
                  Runs every day at 9:00 AM IST — refreshes all data, campaigns, metrics, alerts, and insights
                </p>
              </div>
              <Badge variant="secondary" className="bg-primary/15 text-primary text-xs">
                Active
              </Badge>
            </div>
          </div>

          {/* Last Agent Run */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="t-body font-medium text-foreground">Last Agent Run</p>
                <p className="t-label">
                  {lastAgentRun
                    ? new Date(lastAgentRun).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                    : "No data available"
                  }
                </p>
              </div>
            </div>
            {lastAgentRun && (
              <Badge variant="secondary" className="text-xs">
                {Math.round((Date.now() - new Date(lastAgentRun).getTime()) / 3600000)}h ago
              </Badge>
            )}
          </div>

          {/* Audit cadence schedule */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Audit Cadences</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { cadence: "Twice Weekly", timing: "Monday & Thursday 9 AM", color: "text-blue-400" },
                { cadence: "Weekly", timing: "Wednesday 9 AM", color: "text-emerald-400" },
                { cadence: "Bi-Weekly", timing: "1st & 15th of month", color: "text-amber-400" },
                { cadence: "Monthly", timing: "27th of month", color: "text-purple-400" },
              ].map((s) => (
                <div
                  key={s.cadence}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30"
                >
                  <div>
                    <p className={`text-xs font-medium ${s.color}`}>
                      {s.cadence}
                    </p>
                    <p className="t-label">
                      {s.timing}
                    </p>
                  </div>
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              ))}
            </div>
          </div>

          {/* Run Agent Now */}
          <div className="border-t border-border/30 pt-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">
              Manual Agent Trigger
            </p>
            
            <div className="space-y-4">
              {isLoadingScheduler ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs p-4 bg-muted/20 rounded-lg border border-border/40">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading scheduler status…
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-muted/20 border border-border/40 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        isCurrentlyRunning ? "bg-amber-400 animate-pulse" : (schedulerStatus?.lastRunSuccess ? "bg-emerald-500" : "bg-red-500")
                      )} />
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {isCurrentlyRunning ? "Agent is currently running..." : "Last Run Result"}
                        </p>
                        <p className="t-label">
                          {isCurrentlyRunning 
                            ? "Analyzing campaigns and synthesizing insights..." 
                            : (schedulerStatus?.lastRunSuccess ? "All platforms synced successfully" : "Execution failed — check logs below")}
                        </p>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      className="gap-2 shrink-0 h-9 px-6 bg-primary font-bold shadow-lg shadow-primary/20"
                      onClick={runNow}
                      disabled={isCurrentlyRunning}
                    >
                      {isCurrentlyRunning ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> RUNNING...</>
                      ) : (
                        <><Play className="w-4 h-4" /> RUN DATA AGENT NOW</>
                      )}
                    </Button>
                  </div>

                  {schedulerStatus?.lastRunDuration && (
                    <p className="text-xs text-muted-foreground border-t border-border/20 pt-2">
                       Processing time for last run: <span className="text-foreground font-medium">{schedulerStatus.lastRunDuration < 60000 ? `${Math.round(schedulerStatus.lastRunDuration / 1000)}s` : `${(schedulerStatus.lastRunDuration / 60000).toFixed(1)}m`}</span>
                    </p>
                  )}
                </div>
              )}

              {schedulerStatus?.lastError && (
                <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-xs font-medium text-red-700 dark:text-red-400">Last Execution Error</span>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowError(!showError)}>
                      {showError ? "Hide Details" : "Show Details"}
                    </Button>
                  </div>
                  {showError && (
                    <div className="mt-2 p-2 rounded bg-black/40 border border-white/5 font-mono text-xs text-red-200/70 overflow-auto max-h-40 whitespace-pre">
                      {schedulerStatus.lastError}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/10 border border-border/30 space-y-2">
                  <div className="flex items-center gap-2">
                    <Facebook className="w-3.5 h-3.5 text-blue-400" />
                    <span className="t-body font-medium text-foreground">Meta Ads Agent</span>
                  </div>
                  <code className="block text-xs px-2 py-1.5 rounded bg-background border border-border/50 text-muted-foreground font-mono">
                    python3 ads_agent/meta_ads_agent_v2.py
                  </code>
                </div>
                <div className="p-3 rounded-lg bg-muted/10 border border-border/30 space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-amber-400" />
                    <span className="t-body font-medium text-foreground">Google Ads Agent</span>
                  </div>
                  <code className="block text-xs px-2 py-1.5 rounded bg-background border border-border/50 text-muted-foreground font-mono">
                    python3 ads_agent/google_ads_agent_v2.py
                  </code>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── E) Data Export Section ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4" />
            Data Export
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`grid grid-cols-1 gap-3 ${activePlatform === "google" ? "md:grid-cols-3 lg:grid-cols-6" : "md:grid-cols-3"}`}>
            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
              onClick={() => handleExport("audit")}
              disabled={isExporting === "audit" || auditLog.length === 0}
            >
              {isExporting === "audit" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              )}
              <span>Export Audit Log</span>
              <span className="t-label">
                {auditLog.length} entries · CSV
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
              onClick={() => handleExport("analysis")}
              disabled={isExporting === "analysis" || !data}
            >
              {isExporting === "analysis" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileJson className="w-4 h-4 text-blue-400" />
              )}
              <span>Export Analysis JSON</span>
              <span className="t-label">
                Current analysis · JSON
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
              onClick={() => handleExport("learning")}
              disabled={isExporting === "learning" || learningData.length === 0}
            >
              {isExporting === "learning" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <BookOpen className="w-4 h-4 text-purple-400" />
              )}
              <span>Export Learning Data</span>
              <span className="t-label">
                {learningData.length} entries · CSV
              </span>
            </Button>

            {/* GS-02: Google-specific exports */}
            {activePlatform === "google" && (
              <>
                <Button
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
                  onClick={() => {
                    setIsExporting("search_terms");
                    try {
                      const searchTerms: any[] =
                        (data as any)?.search_terms ||
                        (data as any)?.search_term_analysis ||
                        [];
                      downloadCSV(
                        Array.isArray(searchTerms) ? searchTerms : [searchTerms],
                        `search-terms-${activeClientId}.csv`
                      );
                      toast({ title: "Export Complete", description: "Search terms CSV downloaded" });
                    } catch (err: any) {
                      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
                    } finally {
                      setTimeout(() => setIsExporting(null), 500);
                    }
                  }}
                  disabled={
                    isExporting === "search_terms" ||
                    (!((data as any)?.search_terms) && !((data as any)?.search_term_analysis))
                  }
                >
                  {isExporting === "search_terms" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                  )}
                  <span>Export Search Terms</span>
                  <span className="t-label">Search terms · CSV</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
                  onClick={() => {
                    setIsExporting("quality_scores");
                    try {
                      let qualityScores: any[] =
                        (data as any)?.quality_scores || [];
                      if (!qualityScores.length) {
                        // Derive from campaigns → ad_groups
                        const campaigns: any[] = (data as any)?.campaigns || [];
                        campaigns.forEach((c: any) => {
                          (c.ad_groups || []).forEach((ag: any) => {
                            if (ag.quality_score != null) {
                              qualityScores.push({
                                campaign: c.name || c.campaign_name || c.id,
                                ad_group: ag.name || ag.ad_group_name || ag.id,
                                quality_score: ag.quality_score,
                              });
                            }
                          });
                        });
                      }
                      downloadCSV(qualityScores, `quality-scores-${activeClientId}.csv`);
                      toast({ title: "Export Complete", description: "Quality score CSV downloaded" });
                    } catch (err: any) {
                      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
                    } finally {
                      setTimeout(() => setIsExporting(null), 500);
                    }
                  }}
                  disabled={isExporting === "quality_scores" || !data}
                >
                  {isExporting === "quality_scores" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-blue-400" />
                  )}
                  <span>Export Quality Scores</span>
                  <span className="t-label">Quality score · CSV</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-2 text-xs"
                  onClick={() => {
                    setIsExporting("keyword_performance");
                    try {
                      const keywords: any[] = [];
                      const campaigns: any[] = (data as any)?.campaigns || [];
                      campaigns.forEach((c: any) => {
                        (c.ad_groups || []).forEach((ag: any) => {
                          (ag.keywords || []).forEach((kw: any) => {
                            keywords.push({
                              campaign: c.name || c.campaign_name || c.id,
                              ad_group: ag.name || ag.ad_group_name || ag.id,
                              ...kw,
                            });
                          });
                        });
                      });
                      downloadCSV(keywords, `keyword-performance-${activeClientId}.csv`);
                      toast({ title: "Export Complete", description: "Keyword performance CSV downloaded" });
                    } catch (err: any) {
                      toast({ title: "Export Failed", description: err.message || "Download failed", variant: "destructive" });
                    } finally {
                      setTimeout(() => setIsExporting(null), 500);
                    }
                  }}
                  disabled={isExporting === "keyword_performance" || !data}
                >
                  {isExporting === "keyword_performance" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  )}
                  <span>Export Keyword Perf.</span>
                  <span className="t-label">Keywords · CSV</span>
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── F) About Section ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="w-4 h-4" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-semibold text-foreground">
                Mojo Performance Agent V2
              </p>
              <p className="t-label">
                Powered by Digital Mojo
              </p>
            </div>
            <Badge variant="secondary" className="text-xs">
              v2.0.0
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/30">
            <p>
              Version: 2.0.0 · Build: {new Date().toISOString().split("T")[0]}
            </p>
            <p>
              Multi-platform ad management · Meta + Google Ads · Smart Bidding · Execution Engine
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
