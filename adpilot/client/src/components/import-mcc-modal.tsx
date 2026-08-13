import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, X, Loader2, CheckCircle, XCircle, Globe, Eye, EyeOff, ArrowLeft,
} from "lucide-react";

interface McsAccount {
  customerId: string;
  name: string;
  isManager: boolean;
  status: string;
  currencyCode: string | null;
  timeZone: string | null;
}

interface ImportResult {
  customerId: string;
  name: string;
  clientId?: string;
  success: boolean;
  error?: string;
}

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

export function ImportMccModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [developerToken, setDeveloperToken] = useState("");
  const [mccId, setMccId] = useState("");

  const [accounts, setAccounts] = useState<McsAccount[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ImportResult[] | null>(null);

  const discoverMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/google/mcc-accounts", {
        oauthClientId, oauthClientSecret, refreshToken, developerToken, mccId,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to discover accounts");
      }
      return res.json();
    },
    onSuccess: (data: { accounts: McsAccount[] }) => {
      const importable = data.accounts.filter((a) => !a.isManager);
      setAccounts(importable);
      setSelected(new Set(importable.map((a) => a.customerId)));
      if (importable.length === 0) {
        toast({ title: "No accounts found", description: "This MCC has no directly managed ad accounts." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Discovery failed", description: err.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const chosen = (accounts || []).filter((a) => selected.has(a.customerId));
      const res = await apiRequest("POST", "/api/clients/bulk-import-google", {
        oauthClientId, oauthClientSecret, refreshToken, developerToken, mccId,
        accounts: chosen.map((a) => ({ customerId: a.customerId, name: a.name })),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data: { results: ImportResult[]; succeeded: number; total: number }) => {
      setResults(data.results);
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: data.succeeded === data.total ? "All accounts imported" : "Partial import",
        description: `${data.succeeded}/${data.total} clients created`,
        variant: data.succeeded === data.total ? "default" : "destructive",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const toggle = (customerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  const credsFilled = oauthClientId && oauthClientSecret && refreshToken && developerToken && mccId;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-xl mx-4 bg-background border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-amber-400" /> Import Clients from Google MCC
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {!accounts ? (
            <>
              <p className="text-xs text-muted-foreground">
                Enter the OAuth credentials for your Google Ads Manager (MCC) account once — every
                account it manages will be discoverable below, so you don't have to add each client
                and paste the same credentials in one at a time.
              </p>
              <Field label="OAuth Client ID" value={oauthClientId} onChange={setOauthClientId} placeholder="....apps.googleusercontent.com" required />
              <Field label="OAuth Client Secret" value={oauthClientSecret} onChange={setOauthClientSecret} type="password" required />
              <Field label="Refresh Token" value={refreshToken} onChange={setRefreshToken} type="password" required />
              <Field label="Developer Token" value={developerToken} onChange={setDeveloperToken} type="password" required />
              <Field label="MCC (Manager) Account ID" value={mccId} onChange={setMccId} placeholder="123-456-7890" required
                helpText="The manager account ID shown in Google Ads — digits only or with dashes." />
            </>
          ) : results ? (
            <div className="space-y-2">
              {results.map((r) => (
                <div key={r.customerId} className="flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-muted/30">
                  {r.success
                    ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className="text-muted-foreground">({r.customerId})</span>
                  {!r.success && <span className="text-red-400 ml-auto truncate">{r.error}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {accounts.length} account{accounts.length !== 1 ? "s" : ""} found under this MCC.
                </p>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelected(
                    selected.size === accounts.length ? new Set() : new Set(accounts.map((a) => a.customerId))
                  )}
                >
                  {selected.size === accounts.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              {accounts.map((a) => (
                <label
                  key={a.customerId}
                  className="flex items-center gap-3 px-3 py-2 rounded-md border border-border/50 bg-muted/20 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox checked={selected.has(a.customerId)} onCheckedChange={() => toggle(a.customerId)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.customerId} · {a.status}{a.currencyCode ? ` · ${a.currencyCode}` : ""}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-border">
          {accounts && !results ? (
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => { setAccounts(null); setSelected(new Set()); }}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {results ? "Close" : "Cancel"}
            </Button>
            {!accounts && (
              <Button
                size="sm"
                onClick={() => discoverMutation.mutate()}
                disabled={!credsFilled || discoverMutation.isPending}
                className="gap-1"
              >
                {discoverMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Discover Accounts
              </Button>
            )}
            {accounts && !results && (
              <Button
                size="sm"
                onClick={() => importMutation.mutate()}
                disabled={selected.size === 0 || importMutation.isPending}
                className="gap-1"
              >
                {importMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Import Selected ({selected.size})
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
