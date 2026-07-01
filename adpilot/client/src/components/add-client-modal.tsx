import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus, X, Loader2, CheckCircle, Facebook, Globe
} from "lucide-react";

// --- Field helper ---
function Field({
  label, value, onChange, placeholder, type = "text", helpText, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; helpText?: string; required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {label}{required && <span className="text-red-400">*</span>}
      </label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-base bg-muted/30 border-border/50"
      />
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
    </div>
  );
}

export function AddClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [project, setProject] = useState("");
  const [location, setLocation] = useState("");
  const [targetLocations, setTargetLocations] = useState("");
  const [enableMeta, setEnableMeta] = useState(true);
  const [enableGoogle, setEnableGoogle] = useState(true);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/clients", {
        name, shortName, project, location,
        targetLocations: targetLocations.split(",").map((s) => s.trim()).filter(Boolean),
        enableMeta, enableGoogle,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create client");
      }
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client created", description: `${name} added successfully` });
      onCreated(data.id);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-background border border-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> Add New Client
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Client / Company Name" value={name} onChange={setName} placeholder="e.g. Skyline Realty" required />
            </div>
            <Field label="Short Name" value={shortName} onChange={setShortName} placeholder="e.g. Skyline" helpText="Used in badges & sidebar" />
            <Field label="Project / Property" value={project} onChange={setProject} placeholder="e.g. Skyline Heights" />
            <Field label="City / Location" value={location} onChange={setLocation} placeholder="e.g. Bangalore" />
            <Field label="Target Locations" value={targetLocations} onChange={setTargetLocations} placeholder="Bangalore, Mysore" helpText="Comma-separated" />
          </div>

          {/* Platform toggles */}
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Platforms</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "meta", label: "Meta Ads", icon: Facebook, color: "text-blue-400", enabled: enableMeta, toggle: setEnableMeta },
                { key: "google", label: "Google Ads", icon: Globe, color: "text-amber-400", enabled: enableGoogle, toggle: setEnableGoogle },
              ].map(({ key, label, icon: Icon, color, enabled, toggle }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(!enabled)}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-all ${
                    enabled ? "border-primary/40 bg-primary/5" : "border-border/30 bg-muted/20 opacity-50"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${color}`} />
                  <div>
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{enabled ? "Enabled" : "Disabled"}</p>
                  </div>
                  {enabled && <CheckCircle className="w-3.5 h-3.5 text-emerald-400 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground pt-1">
            After creating the client, add API credentials from the Manage Clients registry (Admins only).
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending} className="gap-1">
            {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create Client
          </Button>
        </div>
      </div>
    </div>
  );
}
