import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient, type ClientInfo } from "@/lib/client-context";
import { useAuth } from "@/lib/auth-context";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users, Plus, Trash2, Edit2, ChevronDown, ChevronRight,
  KeyRound, Eye, EyeOff, CheckCircle, AlertCircle, Loader2,
  Facebook, Globe, X, Save, ShieldCheck, Play, RefreshCw, Clock, XCircle,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface CredentialStatus {
  hasMeta: boolean;
  hasGoogle: boolean;
  metaSource?: "client" | "default" | "missing";
  googleSource?: "client" | "default" | "missing";
  meta?: { accessToken: string; adAccountId: string };
  google?: {
    clientId: string; clientSecret: string; refreshToken: string;
    developerToken: string; mccId: string; customerId: string;
  };
}

function sourceLabel(source?: CredentialStatus["metaSource"]) {
  if (source === "client") return "Client-specific";
  if (source === "default") return "Using global default";
  return "Not configured";
}

// ─── Field helpers ───────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = "text", helpText, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; helpText?: string; required?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}{required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        <Input
          type={isPassword && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-base bg-muted/30 border-border/50 pr-10"
        />
        {isPassword && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}

import { AddClientModal } from "@/components/add-client-modal";

// ─── Credentials Panel ───────────────────────────────────────────────

function CredentialsPanel({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { toast } = useToast();

  const { data: credStatus, isLoading: loadingCreds } = useQuery<CredentialStatus>({
    queryKey: [`/api/clients/${clientId}/credentials`],
    staleTime: 0,
  });

  // Meta form
  const [metaToken, setMetaToken] = useState("");
  const [metaAccountId, setMetaAccountId] = useState("");
  // Google form
  const [gClientId, setGClientId] = useState("");
  const [gClientSecret, setGClientSecret] = useState("");
  const [gRefreshToken, setGRefreshToken] = useState("");
  const [gDeveloperToken, setGDeveloperToken] = useState("");
  const [gMccId, setGMccId] = useState("");
  const [gCustomerId, setGCustomerId] = useState("");

  const [savingMeta, setSavingMeta] = useState(false);
  const [savingGoogle, setSavingGoogle] = useState(false);

  // Pre-fill known non-secret fields when creds load
  useEffect(() => {
    if (credStatus?.meta) setMetaAccountId(credStatus.meta.adAccountId);
    if (credStatus?.google) {
      setGMccId(credStatus.google.mccId);
      setGCustomerId(credStatus.google.customerId);
    }
  }, [credStatus]);

  async function saveMeta() {
    if (!metaToken.trim() || !metaAccountId.trim()) {
      toast({ title: "Both fields are required", variant: "destructive" }); return;
    }
    setSavingMeta(true);
    try {
      const res = await apiRequest("PUT", `/api/clients/${clientId}/credentials`, {
        meta: { accessToken: metaToken.trim(), adAccountId: metaAccountId.trim() },
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Meta credentials saved ✓" });
      setMetaToken("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSavingMeta(false); }
  }

  async function saveGoogle() {
    if (!gClientId.trim() || !gClientSecret.trim() || !gRefreshToken.trim()) {
      toast({ title: "Client ID, Secret and Refresh Token are required", variant: "destructive" }); return;
    }
    setSavingGoogle(true);
    try {
      const res = await apiRequest("PUT", `/api/clients/${clientId}/credentials`, {
        google: {
          clientId: gClientId.trim(), clientSecret: gClientSecret.trim(),
          refreshToken: gRefreshToken.trim(), developerToken: gDeveloperToken.trim(),
          mccId: gMccId.trim(), customerId: gCustomerId.trim(),
        },
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Google credentials saved ✓" });
      setGClientId(""); setGClientSecret(""); setGRefreshToken("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSavingGoogle(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-background border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-400" /> API Credentials
            <Badge variant="outline" className="text-xs">{clientId}</Badge>
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loadingCreds ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Client-specific credentials are stored server-side. If a client has none, the app falls back to global defaults from `.env`. Tokens are masked in the UI.
              </p>
            </div>

            {/* ── Meta Ads ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Facebook className="w-4 h-4 text-blue-400" />
                <p className="text-base font-medium">Meta Ads</p>
                {credStatus?.hasMeta
                  ? <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Credentials saved</Badge>
                  : <Badge variant="outline" className="text-xs text-muted-foreground">Not configured</Badge>}
                <Badge variant="outline" className="text-xs text-muted-foreground">{sourceLabel(credStatus?.metaSource)}</Badge>
              </div>
              {credStatus?.hasMeta && credStatus.meta && (
                <div className="p-2 rounded-md bg-muted/30 text-xs text-muted-foreground space-y-0.5">
                  <p>Access Token: <span className="font-mono">{credStatus.meta.accessToken}</span></p>
                  <p>Ad Account ID: <span className="font-mono">{credStatus.meta.adAccountId}</span></p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-2">
                <Field label="Meta Access Token" value={metaToken} onChange={setMetaToken} type="password"
                  placeholder="EAAGj..." helpText="System User access token from Meta Business Manager" required />
                <Field label="Meta Ad Account ID" value={metaAccountId} onChange={setMetaAccountId}
                  placeholder="act_391022327028566" helpText="Include the act_ prefix" required />
              </div>
              <Button size="sm" onClick={saveMeta} disabled={savingMeta} className="gap-1 w-full">
                {savingMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Meta Credentials
              </Button>
            </div>

            <div className="border-t border-border/40" />

            {/* ── Google Ads ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-400" />
                <p className="text-base font-medium">Google Ads</p>
                {credStatus?.hasGoogle
                  ? <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Credentials saved</Badge>
                  : <Badge variant="outline" className="text-xs text-muted-foreground">Not configured</Badge>}
                <Badge variant="outline" className="text-xs text-muted-foreground">{sourceLabel(credStatus?.googleSource)}</Badge>
              </div>
              {credStatus?.hasGoogle && credStatus.google && (
                <div className="p-2 rounded-md bg-muted/30 text-xs text-muted-foreground space-y-0.5 font-mono">
                  <p>Client ID: {credStatus.google.clientId}</p>
                  <p>Client Secret: {credStatus.google.clientSecret}</p>
                  <p>Refresh Token: {credStatus.google.refreshToken}</p>
                  <p>Developer Token: {credStatus.google.developerToken}</p>
                  <p>MCC ID: {credStatus.google.mccId} &nbsp;·&nbsp; Customer ID: {credStatus.google.customerId}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="OAuth Client ID" value={gClientId} onChange={setGClientId} type="password"
                  placeholder="9670...apps.googleusercontent.com" required />
                <Field label="OAuth Client Secret" value={gClientSecret} onChange={setGClientSecret}
                  type="password" placeholder="GOCSPX-..." required />
                <div className="col-span-2">
                  <Field label="Refresh Token" value={gRefreshToken} onChange={setGRefreshToken}
                    type="password" placeholder="1//..." required
                    helpText="From OAuth flow — regenerate via Google OAuth Playground" />
                </div>
                <Field label="Developer Token" value={gDeveloperToken} onChange={setGDeveloperToken}
                  placeholder="Your developer token" />
                <Field label="MCC / Manager ID" value={gMccId} onChange={setGMccId} placeholder="7668970885" />
                <Field label="Customer / Client ID" value={gCustomerId} onChange={setGCustomerId} placeholder="3120813693" />
              </div>
              <Button size="sm" onClick={saveGoogle} disabled={savingGoogle} className="gap-1 w-full">
                {savingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Google Credentials
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Client Row ──────────────────────────────────────────────────────

function ClientRow({ client, isDefault }: { client: ClientInfo; isDefault: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { setActiveClientId } = useClient();
  const { isAdmin, user } = useAuth();
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [showCreds, setShowCreds] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: credStatus } = useQuery<CredentialStatus>({
    queryKey: [`/api/clients/${client.id}/credentials`],
    enabled: expanded,
    staleTime: 30000,
  });

  async function deleteClient() {
    if (!confirm(`Remove "${client.name}" from the registry? Data files are preserved.`)) return;
    setDeleting(true);
    try {
      const res = await apiRequest("DELETE", `/api/clients/${client.id}`);
      if (!res.ok) throw new Error((await res.json()).error);
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client removed", description: `${client.name} was removed from the registry` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  }

  const metaEnabled = client.platforms.find((p) => p.id === "meta")?.enabled;
  const googleEnabled = client.platforms.find((p) => p.id === "google")?.enabled;

  return (
    <>
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden transition-all">
        {/* Row header */}
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-medium text-foreground truncate">{client.name}</span>
              {isDefault && <Badge variant="secondary" className="text-xs">Default</Badge>}
              {client.location && (
                <span className="text-xs text-muted-foreground">📍 {client.location}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {metaEnabled && (
                <Badge className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1">
                  <Facebook className="w-2.5 h-2.5" /> Meta
                </Badge>
              )}
              {googleEnabled && (
                <Badge className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20 gap-1">
                  <Globe className="w-2.5 h-2.5" /> Google
                </Badge>
              )}
              {credStatus?.hasMeta && <CheckCircle className="w-3 h-3 text-emerald-400" />}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(isAdmin || client.createdBy === user?.id) && (
              <Button
                size="sm" variant="outline" className="h-7 text-xs gap-1"
                onClick={(e) => { e.stopPropagation(); setShowCreds(true); }}
              >
                <KeyRound className="w-3 h-3" /> Credentials
              </Button>
            )}
            <Button
              size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={(e) => { 
                e.stopPropagation(); 
                setActiveClientId(client.id);
                setLocation("/");
              }}
            >
              <Eye className="w-3 h-3" /> View
            </Button>
            {(isAdmin || client.createdBy === user?.id) && !isDefault && (
              <Button
                size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-400"
                onClick={(e) => { e.stopPropagation(); deleteClient(); }}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </Button>
            )}
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="border-t border-border/30 px-4 py-3 space-y-3 bg-muted/10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Client ID</p>
                <p className="font-mono text-foreground">{client.id}</p>
              </div>
              <div>
                <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Project</p>
                <p className="text-foreground">{client.project}</p>
              </div>
              <div>
                <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Credentials</p>
                <div className="flex items-center gap-2">
                  <span className={credStatus?.hasMeta ? "text-emerald-400" : "text-muted-foreground"}>
                    Meta {credStatus?.hasMeta ? "✓" : "✗"}
                  </span>
                  <span className={credStatus?.hasGoogle ? "text-emerald-400" : "text-muted-foreground"}>
                    Google {credStatus?.hasGoogle ? "✓" : "✗"}
                  </span>
                </div>
              </div>
              {(client as any).targetLocations?.length > 0 && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Target Locations</p>
                  <p className="text-foreground">{(client as any).targetLocations.join(", ")}</p>
                </div>
              )}
            </div>

            {/* Platform paths */}
            <div className="space-y-1.5">
              {client.platforms.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  {p.enabled
                    ? <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                    : <AlertCircle className="w-3 h-3 text-muted-foreground shrink-0" />}
                  <span className="text-foreground font-medium w-16">{p.label}</span>
                  <span className={p.hasData ? "text-emerald-400" : "text-muted-foreground"}>
                    {p.hasData ? "Data available" : "No data yet"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreds && <CredentialsPanel clientId={client.id} onClose={() => setShowCreds(false)} />}
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function ManageClientsPage() {
  const { clients, isLoadingClients } = useClient();
  const { isAdmin, user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-6 max-w-[900px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5" /> Manage Clients
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add clients, configure their Meta &amp; Google Ads credentials, and enable platform integrations.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5 shrink-0">
          <Plus className="w-4 h-4" /> Add Client
        </Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Clients", value: clients.length, color: "text-foreground" },
          {
            label: "Meta Connected",
            value: isLoadingClients ? "—" : "Check individual",
            color: "text-blue-400",
          },
          {
            label: "Google Connected",
            value: isLoadingClients ? "—" : "Check individual",
            color: "text-amber-400",
          },
        ].map(({ label, value, color }) => (
          <Card key={label} className="border-border/50">
            <CardContent className="px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className={`text-lg font-semibold mt-0.5 ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Instructions */}
      <Card className="border-border/50 bg-primary/3">
        <CardContent className="px-4 py-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">How to add a new client</p>
              <ol className="list-decimal list-inside space-y-0.5 pl-1">
                <li>Click <strong>Add Client</strong> and fill in the basic details.</li>
                <li>Click <strong>Credentials</strong> on the new client row to enter Meta &amp; Google API keys.</li>
                <li>Run the data agents to pull live data for this client.</li>
                <li>Click <strong>View</strong> to switch the dashboard to this client.</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client list */}
      {isLoadingClients ? (
        <div className="flex items-center gap-2 text-muted-foreground text-base">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading clients…
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map((c) => (
            <ClientRow key={c.id} client={c} isDefault={false} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddClientModal
          onClose={() => setShowAdd(false)}
          onCreated={(id) => {
            setShowAdd(false);
            setCreatedId(id);
          }}
        />
      )}
    </div>
  );
}
