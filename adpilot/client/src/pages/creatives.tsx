import { useEffect, useMemo, useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  Wand2,
  Upload,
  Copy,
  Download,
  History,
  ImagePlus,
  Layers3,
  FlaskConical,
  TriangleAlert,
  Loader2,
  RefreshCcw,
  Plus,
  ChevronRight,
} from "lucide-react";
import { useClient } from "@/lib/client-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type CreativeTone = "luxury" | "premium" | "affordable";
type CreativePlatform = "meta" | "google_display";
type CreativeSectionKey = "headline" | "subtext" | "cta" | "offerSection" | "visualDirection";
type CreativeStatusTag = "winner" | "testing" | "loser";

interface CreativeAsset {
  id: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
  category: "logo" | "render" | "winner";
}

interface CreativeSetup {
  projectName: string;
  logos: CreativeAsset[];
  renders: CreativeAsset[];
  price: string;
  reraNumber: string;
  buildingNumber: string;
  configuration: string;
  location: string;
  sqftRange: string;
  tone: CreativeTone;
  customInstructions: string;
  winningCreatives: CreativeAsset[];
  updatedAt: string;
}

interface CreativePromptInput {
  campaignIdea: string;
  offer: string;
  hook: string;
  platform: CreativePlatform;
  customInstruction?: string;
}

interface CreativeOutput {
  headline: string;
  subtext: string;
  cta: string;
  offerSection: string;
  visualDirection: string;
  primaryText: string;
  platformNotes: string;
  copyVariations: {
    headlines: string[];
    primaryTexts: string[];
    ctaOptions: string[];
  };
  staticAdStructure: {
    topHook: string;
    heroVisualSuggestion: string;
    midMessaging: string;
    ctaBlock: string;
  };
}

interface CreativeGeneratedImage {
  id: string;
  prompt: string;
  requestedSize: "1080x1080" | "1080x1920" | "1200x628" | "960x1200";
  modelSize: "1024x1024" | "1024x1536" | "1536x1024";
  mimeType: string;
  dataUrl: string;
  createdAt: string;
}

interface CreativeVersion {
  id: string;
  createdAt: string;
  sectionRegenerated: CreativeSectionKey | null;
  output: CreativeOutput;
  generatedImages?: CreativeGeneratedImage[];
}

interface CreativeMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface CreativeThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  statusTag: CreativeStatusTag;
  input: CreativePromptInput;
  messages: CreativeMessage[];
  versions: CreativeVersion[];
  activeVersionId: string;
}

interface CreativeHubState {
  clientId: string;
  setup: CreativeSetup | null;
  threads: CreativeThread[];
  updatedAt: string;
}

interface SetupFormState {
  projectName: string;
  logos: CreativeAsset[];
  renders: CreativeAsset[];
  price: string;
  reraNumber: string;
  buildingNumber: string;
  configuration: string;
  location: string;
  sqftRange: string;
  tone: CreativeTone;
  customInstructions: string;
  winningCreatives: CreativeAsset[];
}

const defaultSetupForm: SetupFormState = {
  projectName: "",
  logos: [],
  renders: [],
  price: "",
  reraNumber: "",
  buildingNumber: "",
  configuration: "",
  location: "",
  sqftRange: "",
  tone: "premium",
  customInstructions: "",
  winningCreatives: [],
};

const defaultPromptInput: CreativePromptInput = {
  campaignIdea: "",
  offer: "",
  hook: "",
  platform: "meta",
  customInstruction: "",
};

const imageSizeOptions: Array<CreativeGeneratedImage["requestedSize"]> = [
  "1080x1080",
  "1080x1920",
  "1200x628",
  "960x1200",
];

const sectionLabels: Record<CreativeSectionKey, string> = {
  headline: "Headline",
  subtext: "Subtext",
  cta: "CTA",
  offerSection: "Offer Section",
  visualDirection: "Visual Direction",
};

function formatRelativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatStatusLabel(status: CreativeStatusTag) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function promptHistoryStatusClass(status: CreativeStatusTag) {
  if (status === "winner") return "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400";
  if (status === "loser") return "border-rose-500/25 bg-rose-500/8 text-rose-300";
  return "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-400";
}

async function filesToAssets(files: FileList | null, category: CreativeAsset["category"]) {
  if (!files?.length) return [] as CreativeAsset[];
  const items = Array.from(files);

  return Promise.all(
    items.map(
      (file) =>
        new Promise<CreativeAsset>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              name: file.name,
              type: file.type,
              size: file.size,
              dataUrl: String(reader.result || ""),
              category,
            });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  );
}

function removeAsset(list: CreativeAsset[], assetId: string) {
  return list.filter((asset) => asset.id !== assetId);
}

function composeCreativeBrief(thread: CreativeThread, version: CreativeVersion) {
  const output = version.output;
  return `Creative Brief
Client Prompt: ${thread.input.campaignIdea}
Offer: ${thread.input.offer}
Hook: ${thread.input.hook}
Platform: ${thread.input.platform === "google_display" ? "Google Display" : "Meta"}

Headline
${output.headline}

Subtext
${output.subtext}

CTA
${output.cta}

Offer Section
${output.offerSection}

Visual Direction
${output.visualDirection}

Primary Text
${output.primaryText}

Static Ad Structure
- Top Hook: ${output.staticAdStructure.topHook}
- Hero Visual Suggestion: ${output.staticAdStructure.heroVisualSuggestion}
- Mid Messaging: ${output.staticAdStructure.midMessaging}
- CTA Block: ${output.staticAdStructure.ctaBlock}
`;
}

async function parseJsonApiResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      throw new Error("The API returned an HTML page instead of JSON. Restart the AdPilot server so the new creative image route is loaded.");
    }
    throw new Error("The API returned a non-JSON response.");
  }

  return res.json() as Promise<T>;
}

export default function CreativesPage() {
  const { activeClientId, activeClient, activePlatform } = useClient();
  const { toast } = useToast();
  const [setupForm, setSetupForm] = useState<SetupFormState>(defaultSetupForm);
  const [promptInput, setPromptInput] = useState<CreativePromptInput>({
    ...defaultPromptInput,
    platform: activePlatform === "google" ? "google_display" : "meta",
  });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<CreativeSectionKey | null>(null);
  const [selectedImageSize, setSelectedImageSize] = useState<CreativeGeneratedImage["requestedSize"]>("1080x1080");
  const [isSopVisible, setIsSopVisible] = useState(false);
  const sopRef = useRef<HTMLDivElement>(null);

  const { data: hubData, isLoading } = useQuery<CreativeHubState>({
    queryKey: ["/api/clients", activeClientId, "creative-hub"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClientId}/creative-hub`);
      return res.json();
    },
    enabled: !!activeClientId,
  });

  useEffect(() => {
    if (!hubData?.setup) return;
    setSetupForm({
      projectName: hubData.setup.projectName || "",
      logos: hubData.setup.logos || [],
      renders: hubData.setup.renders || [],
      price: hubData.setup.price || "",
      reraNumber: hubData.setup.reraNumber || "",
      buildingNumber: hubData.setup.buildingNumber || "",
      configuration: hubData.setup.configuration || "",
      location: hubData.setup.location || "",
      sqftRange: hubData.setup.sqftRange || "",
      tone: hubData.setup.tone || "premium",
      customInstructions: hubData.setup.customInstructions || "",
      winningCreatives: hubData.setup.winningCreatives || [],
    });
  }, [hubData?.setup?.updatedAt]);

  useEffect(() => {
    setPromptInput((current) => ({
      ...current,
      platform: activePlatform === "google" ? "google_display" : "meta",
    }));
  }, [activePlatform]);

  useEffect(() => {
    const threads = Array.isArray(hubData?.threads) ? hubData.threads : [];
    if (!threads.length) {
      setSelectedThreadId(null);
      setSelectedVersionId(null);
      return;
    }
    if (!selectedThreadId || !threads.some((thread) => thread?.id === selectedThreadId)) {
      const nextThread = threads[0];
      setSelectedThreadId(nextThread?.id || null);
      setSelectedVersionId(nextThread?.activeVersionId || null);
      setSelectedSection(null);
    }
  }, [hubData?.threads, selectedThreadId]);

  const selectedThread = useMemo(
    () => (Array.isArray(hubData?.threads) ? hubData.threads : []).find((thread) => thread?.id === selectedThreadId) || null,
    [hubData?.threads, selectedThreadId],
  );

  const selectedVersion = useMemo(() => {
    if (!selectedThread) return null;
    const versions = Array.isArray(selectedThread.versions) ? selectedThread.versions : [];
    return (
      versions.find((version) => version.id === (selectedVersionId || selectedThread.activeVersionId)) ||
      versions[0] ||
      null
    );
  }, [selectedThread, selectedVersionId]);

  const syncHubState = (next: CreativeHubState) => {
    queryClient.setQueryData(["/api/clients", activeClientId, "creative-hub"], next);
  };

  const saveSetupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/setup`, setupForm);
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      toast({ title: "Creative SOP saved", description: "This client setup will be reused across all creative generations." });
    },
    onError: (error: any) => {
      toast({ title: "Unable to save SOP", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (payload: CreativePromptInput) => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/generate`, payload);
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      if (next.threads[0]) {
        setSelectedThreadId(next.threads[0].id);
        setSelectedVersionId(next.threads[0].activeVersionId);
        setSelectedSection(null);
      }
      toast({ title: "Creative generated", description: "A new creative concept and variation set is ready." });
    },
    onError: (error: any) => {
      toast({ title: "Generation failed", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (sectionKey: CreativeSectionKey) => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/${selectedThreadId}/regenerate`, {
        sectionKey,
      });
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      const threads = Array.isArray(next?.threads) ? next.threads : [];
      const thread = threads.find((item) => item?.id === selectedThreadId);
      if (thread) setSelectedVersionId(thread.activeVersionId);
      toast({ title: "Section regenerated", description: "Only the selected block changed. The rest stayed intact." });
    },
    onError: (error: any) => {
      toast({ title: "Could not regenerate section", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const generateImageMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${activeClientId}/creative-hub/${selectedThreadId}/generate-image`, {
        versionId: selectedVersionId || selectedThread?.activeVersionId,
        requestedSize: selectedImageSize,
      });
      return parseJsonApiResponse<CreativeHubState>(res);
    },
    onSuccess: (next) => {
      syncHubState(next);
      toast({ title: "Image generated", description: `A ${selectedImageSize} creative image is ready in the preview panel.` });
    },
    onError: (error: any) => {
      toast({ title: "Image generation failed", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const setupComplete = Boolean(
    setupForm.projectName &&
      setupForm.configuration &&
      setupForm.location &&
      setupForm.price &&
      setupForm.customInstructions,
  );

  const handleUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    category: CreativeAsset["category"],
    targetField: "logos" | "renders" | "winningCreatives",
  ) => {
    try {
      const assets = await filesToAssets(event.target.files, category);
      setSetupForm((current) => ({
        ...current,
        [targetField]: [...current[targetField], ...assets],
      }));
      event.target.value = "";
    } catch {
      toast({ title: "Upload failed", description: "One or more files could not be processed.", variant: "destructive" });
    }
  };

  const handleCopyBrief = async () => {
    if (!selectedThread || !selectedVersion) return;
    await navigator.clipboard.writeText(composeCreativeBrief(selectedThread, selectedVersion));
    toast({ title: "Copied to clipboard", description: "Creative brief is ready to paste anywhere." });
  };

  const handleExportBrief = () => {
    if (!selectedThread || !selectedVersion) return;
    const blob = new Blob([composeCreativeBrief(selectedThread, selectedVersion)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedThread.title.replace(/\s+/g, "-").toLowerCase()}-brief.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const latestGeneratedImage = selectedVersion?.generatedImages?.[0] || null;

  const handleDownloadGeneratedImage = () => {
    if (!latestGeneratedImage) return;
    const anchor = document.createElement("a");
    anchor.href = latestGeneratedImage.dataUrl;
    anchor.download = `${(selectedThread?.title || "creative").replace(/\s+/g, "-").toLowerCase()}-${latestGeneratedImage.requestedSize}.png`;
    anchor.click();
  };

  if (isLoading) {
    return (
      <div className="page-shell max-w-[1700px] mx-auto">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-[720px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="page-shell max-w-[1700px] mx-auto">
      <section className="page-zone" aria-labelledby="creative-hub-title">
        <div className="flex items-start justify-between gap-4 flex-wrap rounded-[10px] border border-border/70 bg-card/82 px-5 py-5 shadow-sm">
          <div className="page-subsection">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary/15 text-primary shadow-xs">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 id="creative-hub-title" className="t-page-title text-foreground">Creative Generation</h1>
                <p className="type-base text-muted-foreground">
                  Creative Intelligence + Generation Hub for <span className="font-bold">{activeClient?.name || "this client"}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={(isSopVisible || !setupComplete) ? "secondary" : "outline"}
                onClick={() => {
                  setIsSopVisible(!isSopVisible);
                  // Fixed: Always scroll into view when clicked so user knows it responded
                  setTimeout(() => {
                    sopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 100);
                }}
                className={cn(
                  "gap-2 transition-all duration-300",
                  !setupComplete && "animate-pulse border-primary/40 bg-primary/8 ring-1 ring-primary/20",
                  (isSopVisible || !setupComplete) && "bg-primary/10 border-primary/30"
                )}
              >
                <FlaskConical className={cn("w-4 h-4", (isSopVisible || !setupComplete) && "text-primary")} />
                {setupComplete ? "Configure Client SOP" : "Setup Required SOP"}
              </Button>
              <Button onClick={() => generateMutation.mutate(promptInput)} disabled={!setupComplete || generateMutation.isPending} className="shadow-lg shadow-primary/20">
                {generateMutation.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                New Draft
              </Button>
            </div>
          </div>
        </div>
      </section>

      {!setupComplete && (
        <section aria-labelledby="creative-setup-warning">
          <div className="flex items-start gap-3 rounded-[10px] border border-primary/30 bg-primary/8 px-4 py-3">
            <TriangleAlert className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 id="creative-setup-warning" className="text-base font-semibold text-slate-950 uppercase tracking-wider">Creative SOP setup is required before generation</h2>
              <p className="type-sm text-muted-foreground">
                Fill the onboarding layer once for this client, save it, and the AI will reuse it for every new variation.
              </p>
            </div>
          </div>
        </section>
      )}

      {(isSopVisible || !setupComplete) && (
        <section ref={sopRef} className="page-zone scroll-mt-6" aria-labelledby="creative-sop-title">
          <Card className="border-primary/20 bg-primary/2 shadow-inner">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle id="creative-sop-title" className="text-base font-semibold text-slate-950 uppercase tracking-wider">Creative Client SOP</CardTitle>
                <CardDescription className="t-caption">
                  This setup is reused across all generations to ensure platform-aware context.
                </CardDescription>
              </div>
              {setupComplete && (
                <Button variant="ghost" size="sm" onClick={() => setIsSopVisible(false)}>Close</Button>
              )}
            </CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-2 pt-0">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Project Name</label>
                <Input value={setupForm.projectName} onChange={(e) => setSetupForm((current) => ({ ...current, projectName: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Price</label>
                  <Input value={setupForm.price} onChange={(e) => setSetupForm((current) => ({ ...current, price: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">RERA Number</label>
                  <Input value={setupForm.reraNumber} onChange={(e) => setSetupForm((current) => ({ ...current, reraNumber: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Building Number</label>
                  <Input value={setupForm.buildingNumber} onChange={(e) => setSetupForm((current) => ({ ...current, buildingNumber: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Configuration</label>
                  <Input value={setupForm.configuration} onChange={(e) => setSetupForm((current) => ({ ...current, configuration: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Location</label>
                  <Input value={setupForm.location} onChange={(e) => setSetupForm((current) => ({ ...current, location: e.target.value }))} />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Sqft Range</label>
                  <Input value={setupForm.sqftRange} onChange={(e) => setSetupForm((current) => ({ ...current, sqftRange: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Tone Selector</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["luxury", "premium", "affordable"] as CreativeTone[]).map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      className={cn(
                        "rounded-lg border px-3 py-2 text-base font-semibold capitalize transition-colors",
                        setupForm.tone === tone
                          ? "border-primary/40 bg-primary/14 text-foreground shadow-xs"
                          : "border-border/60 bg-card hover:border-primary/25 hover:bg-accent/70 text-muted-foreground",
                      )}
                      onClick={() => setSetupForm((current) => ({ ...current, tone }))}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Custom Instructions</label>
                <Textarea
                  value={setupForm.customInstructions}
                  onChange={(e) => setSetupForm((current) => ({ ...current, customInstructions: e.target.value }))}
                  placeholder="Avoid cliché language. Focus on aspiration + scarcity. Keep the copy performance-driven."
                />
              </div>
            </div>

            <div className="grid gap-4">
              {[
                { title: "Logos", field: "logos" as const, category: "logo" as const, description: "Upload brand marks used in creative previews." },
                { title: "Renders", field: "renders" as const, category: "render" as const, description: "Optional visual references or property renders." },
                { title: "Past Winning Creatives", field: "winningCreatives" as const, category: "winner" as const, description: "Use strong historical ads as AI reference context." },
              ].map((group) => (
                <Card key={group.title} className="border-border/70 bg-muted/20">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold text-slate-950 uppercase tracking-wider">{group.title}</CardTitle>
                    <CardDescription>{group.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-primary/35 bg-primary/10 px-4 py-3 text-base font-semibold text-foreground hover:bg-primary/15">
                      <Upload className="w-4 h-4" />
                      Upload {group.title}
                      <input
                        type="file"
                        className="hidden"
                        multiple
                        accept="image/*,video/*"
                        onChange={(event) => handleUpload(event, group.category, group.field)}
                      />
                    </label>
                    <div className="grid gap-2">
                      {setupForm[group.field].length === 0 ? (
                        <p className="type-sm text-muted-foreground">No assets uploaded yet.</p>
                      ) : (
                        setupForm[group.field].map((asset) => (
                          <div key={asset.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-base font-semibold text-foreground truncate">{asset.name}</p>
                              <p className="type-sm text-muted-foreground">
                                {asset.type || "asset"}{asset.size ? ` · ${Math.round(asset.size / 1024)} KB` : ""}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setSetupForm((current) => ({
                                  ...current,
                                  [group.field]: removeAsset(current[group.field], asset.id),
                                }))
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              <div className="flex justify-end">
                <Button onClick={() => saveSetupMutation.mutate()} disabled={saveSetupMutation.isPending}>
                  {saveSetupMutation.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Save SOP Setup
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
      )}

      <section
        className="grid grid-cols-1 gap-6 min-h-0 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_350px] items-start"
        aria-labelledby="creative-studio-title"
      >
        {/* -- COLUMN 1: PROMPT HISTORY -- */}
        <aside className="w-full xl:w-[320px] shrink-0 self-start max-h-[85vh] min-h-0 flex flex-col overflow-hidden">
          <Card className="h-full min-h-0 overflow-hidden flex flex-col">
            <CardHeader className="border-b border-border/50 bg-muted/10 pb-4">
              <CardTitle id="creative-studio-title" className="flex items-center gap-2 text-base font-semibold text-slate-950 uppercase tracking-wider">
                <History className="w-4 h-4 text-primary" />
                Prompt History
              </CardTitle>
              <CardDescription>Every generation stays client-scoped and easy to revisit.</CardDescription>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="rounded-[12px] border border-border/50 bg-background/70 px-3 py-2">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Threads</p>
                  <p className="mt-1 text-lg font-semibold text-foreground"><span className="font-bold">{hubData?.threads.length || 0}</span></p>
                </div>
                <div className="rounded-[12px] border border-border/50 bg-background/70 px-3 py-2">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Latest</p>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    <span className="font-bold">{hubData?.threads[0] ? formatRelativeTime(hubData.threads[0].updatedAt) : "None"}</span>
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 overflow-y-auto p-4">
              <div className="grid gap-3">
              {Array.isArray(hubData?.threads) && hubData.threads.length ? (
                hubData.threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={cn(
                      "grid gap-3 rounded-[16px] border px-4 py-4 text-left transition-all duration-200",
                      selectedThreadId === thread.id
                        ? "border-primary/50 bg-primary/10 shadow-sm ring-1 ring-primary/20"
                        : "border-border/60 bg-card hover:border-primary/30 hover:bg-accent/40",
                    )}
                    onClick={() => {
                      setSelectedThreadId(thread.id);
                      setSelectedVersionId(thread.activeVersionId);
                      setSelectedSection(null);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-semibold leading-tight text-foreground line-clamp-2">{thread.title}</p>
                        <p className="mt-1 t-label uppercase tracking-widest text-muted-foreground">
                          {thread.input?.platform === "google_display" ? "Google Display" : "Meta"}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]",
                          promptHistoryStatusClass(thread.statusTag),
                        )}
                      >
                        {formatStatusLabel(thread.statusTag)}
                      </span>
                    </div>

                    <div className="rounded-[12px] bg-muted/35 px-3 py-2.5">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Offer</p>
                      <p className="mt-1 text-base leading-relaxed text-foreground/88 line-clamp-2">
                        {thread.input?.offer || thread.input?.campaignIdea || "No offer added"}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-left">
                      <div className="rounded-[12px] border border-border/50 bg-background/65 px-3 py-2">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Versions</p>
                        <p className="mt-1 text-base font-semibold text-foreground">
                          <span className="font-bold">{Array.isArray(thread.versions) ? thread.versions.length : 0}</span> version{(Array.isArray(thread.versions) ? thread.versions.length : 0) === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="rounded-[12px] border border-border/50 bg-background/65 px-3 py-2">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Updated</p>
                        <p className="mt-1 text-base font-semibold text-foreground"><span className="font-bold">{formatRelativeTime(thread.updatedAt)}</span></p>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-[16px] border border-dashed border-border/70 bg-muted/20 px-5 py-8 text-center">
                  <p className="text-base font-semibold text-foreground">No creative threads yet</p>
                  <p className="mt-1 type-sm text-muted-foreground">Start with the generator and your prompt history will appear here.</p>
                </div>
              )}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* -- COLUMN 2: CONCEPT LAB & CHAT -- */}
        <div className="min-w-0 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950 uppercase tracking-wider">
                <Wand2 className="w-5 h-5 text-primary" />
                Ad Concept Lab
              </CardTitle>
              <CardDescription className="t-micro">
                Phase 1: Input Details → Phase 2: Generate Ad Text → Phase 3: Create Visuals & Variations
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid lg:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Campaign Idea</label>
                  <Input value={promptInput.campaignIdea} onChange={(e) => setPromptInput((current) => ({ ...current, campaignIdea: e.target.value }))} placeholder="Launch the next high-intent lead-gen angle" />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Offer</label>
                  <Input value={promptInput.offer} onChange={(e) => setPromptInput((current) => ({ ...current, offer: e.target.value }))} placeholder="2 & 3 BHK from 99.39L with launch pricing" />
                </div>
              </div>

              <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Hook</label>
                  <Input value={promptInput.hook} onChange={(e) => setPromptInput((current) => ({ ...current, hook: e.target.value }))} placeholder="The address serious buyers shortlist first" />
                </div>
                <div className="grid gap-2">
                  <label className="type-sm font-semibold text-foreground">Platform</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "meta" as CreativePlatform, label: "Meta" },
                      { value: "google_display" as CreativePlatform, label: "Google Display" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={cn(
                          "rounded-lg border px-3 py-2 text-base font-semibold transition-colors",
                          promptInput.platform === option.value
                            ? "border-primary/40 bg-primary/14 text-foreground shadow-xs"
                            : "border-border/60 bg-card hover:border-primary/25 hover:bg-accent/70 text-muted-foreground",
                        )}
                        onClick={() => setPromptInput((current) => ({ ...current, platform: option.value }))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <label className="type-sm font-semibold text-foreground">Add custom instruction for this creative</label>
                <Textarea
                  value={promptInput.customInstruction}
                  onChange={(e) => setPromptInput((current) => ({ ...current, customInstruction: e.target.value }))}
                  placeholder="Push more aspiration, reduce direct pricing, and lean harder into urgency."
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/40">
                <div className="flex flex-col gap-1.5 min-w-[200px]">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Primary Generation</p>
                  <Button
                    size="lg"
                    className="gap-2 px-6 shadow-md shadow-primary/20"
                    onClick={() => generateMutation.mutate(promptInput)}
                    disabled={!setupComplete || generateMutation.isPending}
                  >
                    {generateMutation.isPending ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                    Draft Ad Copy
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Visual Assets</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="lg"
                      className="gap-2 border-primary/25 bg-primary/5 hover:bg-primary/10"
                      onClick={() => generateImageMutation.mutate()}
                      disabled={!selectedThread || !selectedVersion || generateImageMutation.isPending}
                    >
                      {generateImageMutation.isPending ? <Loader2 className="animate-spin w-5 h-5" /> : <ImagePlus className="w-5 h-5" />}
                      Generate AI Image
                    </Button>

                    <div className="h-10 w-px bg-border/50 mx-1 hidden min-[500px]:block" />

                    <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted/30 border border-border/40">
                      {imageSizeOptions.map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={cn(
                            "rounded-md px-2 py-1.5 text-xs font-bold transition-all",
                            selectedImageSize === size
                              ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setSelectedImageSize(size)}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedSection && (
                  <div className="flex flex-col gap-1.5 ml-auto lg:ml-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-500 mb-0.5">Refine Current</p>
                    <Button
                      variant="secondary"
                      size="lg"
                      className="gap-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15 border border-emerald-500/20"
                      onClick={() => regenerateMutation.mutate(selectedSection)}
                      disabled={regenerateMutation.isPending}
                    >
                      {regenerateMutation.isPending ? <Loader2 className="animate-spin w-5 h-5" /> : <RefreshCcw className="w-5 h-5" />}
                      Fix {sectionLabels[selectedSection]}
                    </Button>
                  </div>
                )}
              </div>

              {!selectedThread && (
                <p className="text-xs text-muted-foreground flex items-center gap-2 bg-muted/20 p-2 rounded-md">
                  <TriangleAlert className="w-3.5 h-3.5 text-warning" />
                  Select or generate an ad concept to enable Visual and Refinement tools.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950 uppercase tracking-wider">
                <Layers3 className="w-5 h-5 text-primary" />
                Creative Blueprint
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {!selectedThread || !selectedVersion ? (
                <div className="rounded-[10px] border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center">
                  <p className="text-base font-semibold text-foreground">No active creative selected</p>
                  <p className="type-sm text-muted-foreground">Generate one and the editable output blocks will appear here.</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(Object.keys(sectionLabels) as CreativeSectionKey[]).map((sectionKey) => (
                      <button
                        key={sectionKey}
                        type="button"
                        onClick={() => setSelectedSection(sectionKey)}
                        className={cn(
                          "rounded-[10px] border bg-card px-4 py-4 text-left transition-colors shadow-xs",
                          selectedSection === sectionKey
                            ? "border-primary/45 bg-primary/8"
                            : "border-border/70 hover:border-primary/25 hover:bg-accent/60",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{sectionLabels[sectionKey]}</p>
                            <p className="text-base font-semibold text-foreground mt-1">
                              {selectedVersion.output[sectionKey]}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* -- COLUMN 3: PREVIEW & INTELLIGENCE -- */}
        <aside className="w-full xl:col-span-2 2xl:col-span-1 2xl:w-[350px] flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-950 uppercase tracking-wider">
                <ImagePlus className="w-4 h-4 text-primary" />
                Preview Panel
              </CardTitle>
              <CardDescription>Static layout structure, AI image preview, and export-ready controls.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {selectedThread && selectedVersion ? (
                <>
                  {latestGeneratedImage ? (
                    <div className="rounded-[10px] border border-border/70 bg-card p-3 shadow-xs overflow-hidden">
                      <div className="aspect-square w-full rounded-lg bg-muted/20 relative overflow-hidden group">
                        <img
                          src={latestGeneratedImage.dataUrl}
                          alt={`${selectedThread.title} preview`}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Original Build</p>
                          <p className="text-base font-semibold text-foreground truncate">
                            {latestGeneratedImage.requestedSize} · {latestGeneratedImage.modelSize}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleDownloadGeneratedImage} className="shrink-0 h-8 px-3">
                          <Download className="w-3.5 h-3.5 mr-1.5" />
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[10px] border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
                      <p className="text-base font-semibold text-foreground">No AI image yet</p>
                      <p className="type-sm text-muted-foreground">
                        Pick a size and use Generate Image to create a visual from the current creative version.
                      </p>
                    </div>
                  )}

                  <div className="rounded-[10px] border border-border/70 bg-card px-4 py-4 shadow-xs">
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Top Hook</p>
                    <p className="text-lg font-bold text-foreground mt-2">{selectedVersion.output.staticAdStructure.topHook}</p>
                    <div className="mt-4 grid gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Hero Visual Suggestion</p>
                        <p className="text-base text-foreground mt-1">{selectedVersion.output.staticAdStructure.heroVisualSuggestion}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Mid Messaging</p>
                        <p className="text-base text-foreground mt-1">{selectedVersion.output.staticAdStructure.midMessaging}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">CTA Block</p>
                        <p className="text-base text-foreground mt-1">{selectedVersion.output.staticAdStructure.ctaBlock}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button onClick={handleCopyBrief} className="h-11 gap-2 shadow-xs shadow-primary/10"><Copy className="w-4 h-4" />Copy Summary</Button>
                    <Button variant="outline" onClick={handleExportBrief} className="h-11 gap-2 border-border/70"><Download className="w-4 h-4" />Export .txt</Button>
                  </div>
                </>
              ) : (
                <p className="type-sm text-muted-foreground">Select a creative thread to preview its structure and export options.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}
