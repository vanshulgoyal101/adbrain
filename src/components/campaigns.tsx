"use client";

import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import { useCampaignList } from "@/lib/meta-connect-ui/use-campaign-list";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Sparkles,
  Search,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  TargetingControls,
  defaultTargeting,
  type TargetingValue,
} from "@/components/targeting-controls";
import { CampaignChat } from "@/components/campaign-chat";
import { CampaignLaunchReview } from "@/components/campaign-launch-review";
import { MetaConnectDialog } from "@/components/meta-connect/meta-connect-dialog";
import {
  createMetaConnectClient,
  MetaConnectClientError,
} from "@/lib/meta-connect-ui/client";
import {
  buildActivationPatch,
  buildCreateCampaignRequest,
  canStartCreate,
  isTerminalOperation,
  stableOperationKey,
} from "@/lib/meta-connect-ui/campaign-flow";
import type {
  DraftDTO,
  DraftInput,
  OperationDTO,
  ReviewDTO,
} from "@/lib/campaign/connect-contracts";
import { targetingInputSchema } from "@/lib/campaign/connect-contracts";
import { campaignDestination } from "@/lib/campaign/outcomes";
import { useCampaignPreparation } from "@/lib/meta-connect-ui/use-campaign-preparation";
import { targetingFromEditor, targetingToEditor } from "@/lib/campaign/editor-targeting";
import type { LeadForm } from "@/lib/meta/client";
import type { ConnectIntent, ConnectionDTO } from "@/lib/meta/connect-contracts";
import type { Business, Campaign, CampaignResult, Creative } from "@/lib/types";
import {
  BUDGET_PRESETS,
  campaignNarrative,
  campaignNextAction,
  spendHealth,
} from "@/lib/campaign/budget";
import { effectiveDailyBudget } from "@/lib/campaign/spend";
import { activationConfirmationPayload } from "@/lib/campaign/activation";
import { readCampaignRecovery, recoveryStorageKey, writeCampaignRecovery, type CampaignRecovery } from "@/lib/meta-connect-ui/recovery";
import { cn, formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  paused: "bg-amber-50 text-amber-700",
  active: "bg-blue-50 text-blue-700",
  draft: "bg-slate-100 text-slate-600",
  completed: "bg-slate-100 text-slate-600",
};

const LEAD_FORMS_FRESH_MS = 60_000;

type PrepareReviewState =
  | { status: "checking"; draft: DraftDTO; connection: ConnectionDTO }
  | { status: "ready"; draft: DraftDTO; connection: ConnectionDTO; review: ReviewDTO }
  | { status: "blocked"; draft: DraftDTO; connection: ConnectionDTO; message: string };

async function fetchDraftForms(signal?: AbortSignal): Promise<LeadForm[]> {
  const response = await fetch("/api/campaigns/lead-forms", { cache: "no-store", signal });
  const data = await response.json() as { forms?: LeadForm[]; error?: string };
  if (!response.ok || data.error || !Array.isArray(data.forms)) throw new Error(data.error ?? "Could not load Page forms. Your draft is saved.");
  return data.forms;
}

export function Campaigns({
  business,
  approved,
  initialCampaigns,
  initialNextCursor = null,
  initialResults,
  leadForms,
  leadFormError,
  metaReady,
  adAccountId,
}: {
  business: Business;
  approved: Creative[];
  initialCampaigns: Campaign[];
  initialNextCursor?: string | null;
  initialResults: Record<string, CampaignResult>;
  leadForms: LeadForm[];
  leadFormError: string | null;
  metaReady: boolean;
  adAccountId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState(200);
  const [destination, setDestination] = useState<"instant_form" | "whatsapp">("instant_form");
  const [leadFormId, setLeadFormId] = useState(leadForms[0]?.id ?? "");
  const [availableForms, setAvailableForms] = useState(leadForms);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsError, setFormsError] = useState(leadFormError);
  const [formsRetry, setFormsRetry] = useState(0);
  const formsFreshnessRef = useRef<{ ownerId: string; businessId: string; retry: number; fetchedAt: number } | null>(null);
  const [connectedForDraft, setConnectedForDraft] = useState(metaReady);
  const [name, setName] = useState(`${business.name} — leads`);
  const [targeting, setTargeting] = useState<TargetingValue>(defaultTargeting);
  const [draftGoal, setDraftGoal] = useState("");
  const [includedNames, setIncludedNames] = useState("");
  const [excludedNames, setExcludedNames] = useState("");
  const [abTest, setAbTest] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { campaigns, setCampaigns, results, setResults, campaignQuery, setCampaignQuery, statusFilter, setStatusFilter,
    nextListCursor, listLoading, loadCampaignPage, replaceCampaignPage } = useCampaignList({
    businessId: business.id, initialCampaigns, initialResults, initialNextCursor, onError: setError,
  });
  const [showComposer, setShowComposer] = useState(initialCampaigns.length === 0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectionIntent, setConnectionIntent] = useState<ConnectIntent>({ kind: "setup" });
  const [activationReview, setActivationReview] = useState<Campaign | null>(null);
  const [reviewConnection, setReviewConnection] = useState<ConnectionDTO | null>(null);
  const [activationDigest, setActivationDigest] = useState<string | null>(null);
  const [prepareReview, setPrepareReview] = useState<PrepareReviewState | null>(null);
  const { preparing, preparationStage, beginPreparation, finishPreparation, stopPreparation, setPreparationStage, isPreparing } = useCampaignPreparation(`${business.owner_id}:${business.id}`, timedOut => {
    setPrepareReview(null);
    const message = "Your inputs are preserved. A draft save already sent may still finish; check Saved drafts before retrying. No campaign was created.";
    if (timedOut) setError(`Campaign preparation timed out. ${message}`);
    else setNotice(`Campaign preparation stopped. ${message}`);
  });
  const reviewPanelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!prepareReview || prepareReview.status === "checking") return;
    reviewPanelRef.current?.focus({ preventScroll: true });
    reviewPanelRef.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [prepareReview]);
  const preparedDraftRef = useRef<DraftDTO | null>(null);
  const operationRef = useRef<{ reviewKey: string; idempotencyKey: string } | null>(null);
  const operationControllerRef = useRef<AbortController | null>(null);
  const [operation, setOperation] = useState<OperationDTO | null>(null);
  const [operationChecking, setOperationChecking] = useState(false);
  const router = useRouter();
  const recoveryKey = recoveryStorageKey(business.owner_id, business.id);
  const recoveryRef = useRef<CampaignRecovery | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const destinationRecoveryLocked = recoveryPending || Boolean(operation && !["succeeded", "failed"].includes(operation.state));
  const [savedDrafts, setSavedDrafts] = useState<DraftDTO[]>([]);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [creationMode, setCreationMode] = useState("manual");
  const visibleCampaigns = campaigns.filter(campaign =>
    (statusFilter === "all" || campaign.status === statusFilter) &&
    (campaign.name ?? business.name).toLocaleLowerCase().includes(campaignQuery.trim().toLocaleLowerCase()),
  );
  const totalDailyBudget = effectiveDailyBudget(budget, abTest ? 2 : 1);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const syncCursorRef = useRef<string | null>(null);
  const syncSkippedRef = useRef(0);
  const selectedLeadForm = availableForms.find((form) => form.id === leadFormId);
  const plannedAreas = includedNames.split("\n").map((value) => value.trim()).filter(Boolean);
  const plannedExclusions = excludedNames.split("\n").map((value) => value.trim()).filter(Boolean);
  const audiencePreview =
    plannedAreas.length
      ? `${[...(targeting.locationMode === "manual" ? targeting.included.map((place) => place.name) : []), ...plannedAreas].join(", ")}${plannedExclusions.length ? `; excluding ${plannedExclusions.join(", ")}` : ""}`
      : targeting.locationMode === "manual"
      ? targeting.included.length
        ? targeting.included.map((place) => place.name).join(", ")
        : "Choose an area"
      : business.locations.length
        ? `AdBrain decides from ${business.locations.join(", ")}`
        : "AdBrain decides from your Brand Brain";

  function restoreDraft(draft: DraftDTO) {
    const input = draft.input;
    setName(input.name);
    setSelected(new Set(input.creativeIds));
    setBudget(input.dailyBudgetRupees);
    setLeadFormId(input.leadFormId ?? "");
    setDestination(input.destination ?? "instant_form");
    setAbTest(input.abTest);
    setCreationMode("manual");
    setDraftGoal(input.goal);
    setIncludedNames((input.targeting.location?.includedNames ?? []).join("\n"));
    setExcludedNames((input.targeting.location?.excludedNames ?? []).join("\n"));
    setShowComposer(true);
    setTargeting(targetingToEditor(input.targeting));
  }

  async function refreshDraftForms(signal?: AbortSignal) {
    const forms = await fetchDraftForms(signal);
    if (signal?.aborted) return;
    setAvailableForms(forms);
    setLeadFormId(current => forms.some(form => form.id === current) ? current : "");
  }

  useEffect(() => {
    if (!showComposer || !connectedForDraft || destination === "whatsapp") return;
    const freshness = formsFreshnessRef.current;
    if (freshness?.ownerId === business.owner_id && freshness.businessId === business.id &&
      freshness.retry === formsRetry && Date.now() - freshness.fetchedAt < LEAD_FORMS_FRESH_MS) return;
    formsFreshnessRef.current = null;
    const controller = new AbortController();
    startTransition(() => { setFormsLoading(true); setFormsError(null); });
    void fetchDraftForms(controller.signal).then(forms => {
      if (controller.signal.aborted) return;
      formsFreshnessRef.current = { ownerId: business.owner_id, businessId: business.id, retry: formsRetry, fetchedAt: Date.now() };
      setAvailableForms(forms);
      setLeadFormId(current => forms.some(form => form.id === current) ? current : "");
    }).catch(() => {
      if (!controller.signal.aborted) setFormsError("Page forms are temporarily unavailable.");
    }).finally(() => {
      if (!controller.signal.aborted) setFormsLoading(false);
    });
    return () => controller.abort();
  }, [showComposer, connectedForDraft, business.id, business.owner_id, formsRetry, destination]);

  useEffect(() => {
    const controller = new AbortController();
    void createMetaConnectClient().drafts(business.id, controller.signal).then((drafts) => {
      if (!controller.signal.aborted) setSavedDrafts(drafts);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Saved drafts could not be loaded.");
    });
    return () => controller.abort();
  }, [business.id]);

  useEffect(() => {
    const saved = readCampaignRecovery(window.sessionStorage, recoveryKey, business.id);
    if (!saved) return;
    recoveryRef.current = saved;
    preparedDraftRef.current = saved.draft;
    const controller = new AbortController();
    void (async () => {
      setRecoveryPending(Boolean(saved.request));
      try {
        const client = createMetaConnectClient();
        if (saved.request) {
          const found = await client.operationForRequest(business.id, saved.request.idempotencyKey, controller.signal);
          if (controller.signal.aborted) return;
          setOperation(found);
          setRecoveryPending(!found);
          setRetryAllowed(!found);
          if (found?.state === "succeeded") setNotice("Paused campaign created. Review it before activating spend.");
        }
        const draft = await client.draft(saved.draft.draftId, controller.signal);
        if (controller.signal.aborted) return;
        restoreDraft(draft);
        preparedDraftRef.current = draft;
        const connection = await client.status(business.id, controller.signal);
        if (controller.signal.aborted) return;
        setConnectedForDraft(connection.authorization === "connected" && Boolean(connection.selected));
        if (!saved.request) return;
        const review = await client.preflight(business.id, draft.draftId, draft.version, controller.signal);
        if (!controller.signal.aborted) setPrepareReview({ status: "ready", draft, connection, review });
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Saved campaign recovery is unavailable.");
      }
    })();
    return () => { controller.abort(); operationControllerRef.current?.abort(); };
  }, [business.id, recoveryKey]);

  function saveRecovery(recovery: CampaignRecovery) {
    writeCampaignRecovery(window.sessionStorage, recoveryKey, recovery);
    recoveryRef.current = recovery;
    setSavedDrafts((drafts) => recovery.request
      ? drafts.filter((draft) => draft.draftId !== recovery.draft.draftId)
      : [recovery.draft, ...drafts.filter((draft) => draft.draftId !== recovery.draft.draftId)]);
  }

  async function reopenDraft(draftId: string) {
    if (preparing || creating) return;
    if (unresolvedRecovery()) { setError("Resolve the current campaign operation before opening another draft."); return; }
    setDraftBusy(draftId);
    setError(null);
    try {
      const draft = await createMetaConnectClient().draft(draftId);
      preparedDraftRef.current = draft;
      saveRecovery({ draft, request: null, operationId: null });
      setOperation(null);
      setRecoveryPending(false);
      setPrepareReview(null);
      restoreDraft(draft);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Draft could not be opened."); }
    finally { setDraftBusy(null); }
  }

  async function removeDraft(draft: DraftDTO) {
    if (preparing || creating) return;
    if (!window.confirm(`Remove saved draft "${draft.input.name}"?`)) return;
    setDraftBusy(draft.draftId);
    try {
      await createMetaConnectClient().deleteDraft(draft.draftId, draft.version);
      setSavedDrafts((drafts) => drafts.filter((saved) => saved.draftId !== draft.draftId));
      if (preparedDraftRef.current?.draftId === draft.draftId && !recoveryRef.current?.request) {
        preparedDraftRef.current = null;
        recoveryRef.current = null;
        window.sessionStorage.removeItem(recoveryKey);
        setPrepareReview(null);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Draft could not be removed."); }
    finally { setDraftBusy(null); }
  }

  function toggleComposer() {
    if (preparing || creating) return;
    if (showComposer) { setShowComposer(false); return; }
    if (unresolvedRecovery()) { setError("Resolve the current campaign operation before starting another campaign."); return; }
    preparedDraftRef.current = null;
    recoveryRef.current = null;
    operationRef.current = null;
    window.sessionStorage.removeItem(recoveryKey);
    setOperation(null);
    setRecoveryPending(false);
    setPrepareReview(null);
    setCreationMode("manual");
    setName(`${business.name} - leads`);
    setDraftGoal("");
    setSelected(new Set());
    setBudget(200);
    setAbTest(false);
    setTargeting(defaultTargeting);
    setIncludedNames("");
    setExcludedNames("");
    setLeadFormId("");
    setDestination("instant_form");
    setShowComposer(true);
  }

  function finishDraftConnection(connection: ConnectionDTO) {
    setConnectedForDraft(true);
    setReviewConnection(connection);
    setConnectOpen(false);
    setPrepareReview(null);
    setShowComposer(true);
    setFormsRetry(current => current + 1);
    setNotice(destination === "whatsapp" ? "Meta connected. Review the linked WhatsApp number before continuing." : "Meta connected. Review your lead form before continuing.");
  }

  function acceptOperation(next: OperationDTO) {
    if (recoveryRef.current) saveRecovery({ ...recoveryRef.current, operationId: next.operationId });
    setOperation(next);
    setRecoveryPending(false);
    setRetryAllowed(false);
    if (next.state === "succeeded") {
      setNotice("Paused campaign created. Review it before activating spend.");
      setShowComposer(false);
      router.refresh();
    }
  }

  function unresolvedRecovery() {
    return Boolean(recoveryRef.current?.request && (!operation || !["succeeded", "failed"].includes(operation.state)));
  }

  async function loadPrepareReview(
    draft: DraftDTO,
    connection: ConnectionDTO,
    signal?: AbortSignal,
  ): Promise<void> {
    setPrepareReview({ status: "checking", draft, connection });
    try {
      const review = await createMetaConnectClient().preflight(
        business.id,
        draft.draftId,
        draft.version,
        signal,
      );
      signal?.throwIfAborted();
      setPrepareReview({ status: "ready", draft, connection, review });
    } catch (reason: unknown) {
      if (signal?.aborted) throw reason;
      setPrepareReview({
        status: "blocked",
        draft,
        connection,
        message:
          reason instanceof MetaConnectClientError && reason.code === "CONFLICT"
            ? "This draft changed in another tab. Your local edits are preserved; reload the latest draft or resolve the conflict before continuing."
            : reason instanceof Error
              ? reason.message
              : "Campaign review is temporarily unavailable. Your draft is preserved.",
      });
    }
  }

  async function syncFromMeta(opts: { silent?: boolean } = {}) {
    setSyncing(true);
    if (!opts.silent) setError(null);
    try {
      const cursor = syncCursorRef.current;
      const res = await fetch(`/api/campaigns/sync${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`, { method: "POST" });
      const data = (await res.json()) as {
        campaigns?: Campaign[];
        error?: string;
        nextCursor?: string | null;
        pageCursor?: string | null;
        skipped?: number;
      };
      if (res.ok && Array.isArray(data.campaigns)) {
        replaceCampaignPage(data.campaigns, data.pageCursor ?? null);
        syncSkippedRef.current = (cursor ? syncSkippedRef.current : 0) + (data.skipped ?? 0);
        syncCursorRef.current = data.nextCursor ?? null;
        if (!data.nextCursor) setLastSynced(new Date());
        const skippedNotice = syncSkippedRef.current
          ? ` ${syncSkippedRef.current} campaign(s) could not be imported and were left unchanged.` : "";
        setNotice(`${data.nextCursor ? "More campaigns are available. Sync again to continue." : "Campaign sync completed."}${skippedNotice}`);
      } else if (!opts.silent) {
        setError(data.error ?? "Sync failed. Please try again.");
      }
    } catch {
      if (!opts.silent) setError("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  // Auto-sync from Meta once when the page opens, so campaigns stay fresh.
  const autoSynced = useRef(false);
  const autoSyncFromMeta = useEffectEvent(() => void syncFromMeta({ silent: true }));
  useEffect(() => {
    if (metaReady && !autoSynced.current) {
      autoSynced.current = true;
      autoSyncFromMeta();
    }
  }, [metaReady]);

  function toggle(id: string) {
    if (!unresolvedRecovery()) setPrepareReview(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function manualDraftInput(requireComplete = true): DraftInput {
    if (requireComplete && selected.size === 0) throw new Error("Select at least one creative.");
    if (requireComplete && budget <= 0) throw new Error("Enter a daily budget.");
    return {
      businessId: business.id,
      name,
      goal: draftGoal || name,
      mode: preparedDraftRef.current?.input.mode === "guided" || creationMode === "guided" ? "guided" : "manual",
      creativeIds: [...selected],
      dailyBudgetRupees: Math.max(0, budget),
      leadFormId: destination === "whatsapp" ? null : leadFormId || null,
      destination,
      targeting: targetingFromEditor(targeting, plannedAreas, plannedExclusions),
      abTest,
    };
  }

  async function recommendAudience(input: DraftInput, signal: AbortSignal): Promise<DraftInput> {
    setPreparationStage(signal, "Recommending audience...");
    const response = await fetch("/api/campaigns/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: input.goal, audienceDraft: input }),
      signal,
    });
    const data = await response.json() as { ready?: boolean; targeting?: unknown; error?: string; questions?: { question: string }[] };
    signal.throwIfAborted();
    if (!response.ok || !data.ready) throw new Error(data.error ?? data.questions?.map((question) => question.question).join(" ") ?? "Could not recommend an audience.");
    const recommended = { ...targetingInputSchema.parse(data.targeting), gender: input.targeting.gender ?? "all" as const };
    if (!recommended.audience?.interestNames.length) throw new Error("The detailed targeting recommendation is incomplete. Try again.");
    setTargeting(targetingToEditor(recommended));
    setIncludedNames((recommended.location?.includedNames ?? []).join("\n"));
    setExcludedNames((recommended.location?.excludedNames ?? []).join("\n"));
    setPrepareReview(null);
    return { ...input, targeting: recommended };
  }

  async function requestAudienceRecommendation(field?: "location" | "age") {
    if (unresolvedRecovery() || isPreparing()) return;
    setError(null);
    setNotice(null);
    setPrepareReview(null);
    const signal = beginPreparation();
    try {
      const input = manualDraftInput();
      if (field === "location") {
        input.targeting.location = { ...input.targeting.location, mode: "ai", included: [], includedNames: [] };
      }
      if (field === "age") {
        input.targeting.age = { ...input.targeting.age, mode: "ai" };
        if (input.targeting.location?.included?.length || input.targeting.location?.includedNames?.length) {
          input.targeting.location = { ...input.targeting.location, mode: "manual" };
        }
      }
      await recommendAudience(input, signal);
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : "Could not recommend an audience.");
    } finally {
      finishPreparation(signal);
    }
  }

  async function prepareManualCampaign(reviewAfterSave = true) {
    if (isPreparing()) return;
    if (unresolvedRecovery()) {
      setError("Check the existing campaign operation before preparing another campaign.");
      return;
    }
    setError(null);
    setNotice(null);
    setPrepareReview(null);
    let input: DraftInput;
    try {
      input = manualDraftInput(reviewAfterSave);
      if (reviewAfterSave && connectedForDraft && input.destination !== "whatsapp" && !input.leadFormId) throw new Error("Choose a lead form before preparing campaign review.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Complete the campaign details first.");
      return;
    }
    const signal = beginPreparation();
    try {
      if (reviewAfterSave && (input.targeting.age?.mode === "ai" || !input.targeting.audience?.interestNames.length)) {
        input = await recommendAudience(input, signal);
      }
      signal.throwIfAborted();
      setPreparationStage(signal, "Saving draft...");
      const client = createMetaConnectClient();
      const previous = preparedDraftRef.current;
      const draft = previous && !recoveryRef.current?.request
        ? await client.updateDraft(previous.draftId, previous.version, input, signal)
        : await client.saveDraft(input, signal);
      signal.throwIfAborted();
      saveRecovery({ draft, request: null, operationId: null });
      setOperation(null);
      operationRef.current = null;
      setRecoveryPending(false);
      preparedDraftRef.current = draft;
      if (!reviewAfterSave) { setPrepareReview(null); setNotice("Campaign draft saved."); return; }
      setPreparationStage(signal, "Checking Meta connection...");
      const connection = await client.status(business.id, signal);
      signal.throwIfAborted();
      setConnectedForDraft(connection.authorization === "connected" && Boolean(connection.selected));
      if (connection.authorization !== "connected" || !connection.selected) {
        setConnectionIntent({ kind: "setup" });
        setConnectOpen(true);
        return;
      }
      setPreparationStage(signal, "Checking campaign readiness...");
      await loadPrepareReview(draft, connection, signal);
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : "Could not save the campaign draft.");
    } finally {
      finishPreparation(signal);
    }
  }

  function stableIdempotencyKey(review: ReviewDTO): string {
    const next = stableOperationKey(operationRef.current, review, () => crypto.randomUUID());
    operationRef.current = next;
    return next.idempotencyKey;
  }

  async function pollOperation(operationId: string): Promise<OperationDTO | null> {
    const controller = operationControllerRef.current;
    if (!controller) return null;
    setOperationChecking(true);
    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const next = await createMetaConnectClient().operation(operationId, controller.signal);
        acceptOperation(next);
        if (isTerminalOperation(next)) return next;
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 1000);
          controller.signal.addEventListener("abort", () => {
            window.clearTimeout(timer);
            resolve();
          }, { once: true });
        });
        if (controller.signal.aborted) return null;
      }
      setError("Campaign creation is still processing. Check the operation status before taking another action.");
      return null;
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Campaign operation status is unavailable.");
      }
      return null;
    } finally {
      setOperationChecking(false);
    }
  }

  async function createPreparedCampaign() {
    if (!prepareReview || prepareReview.status !== "ready") return;
    const { draft, review } = prepareReview;
    if (!review.canCreatePaused || !review.planHash || !review.selected || review.blockers.length) {
      setError("Resolve the campaign review blockers before creating.");
      return;
    }
    if (!canStartCreate(operation)) return;
    setError(null);
    setNotice(null);
    setCreating(true);
    operationControllerRef.current?.abort();
    const controller = new AbortController();
    operationControllerRef.current = controller;
    try {
      const request = recoveryRef.current?.request ?? buildCreateCampaignRequest(business.id, draft, review, stableIdempotencyKey(review));
      saveRecovery({ draft: recoveryRef.current?.request ? recoveryRef.current.draft : draft, request, operationId: recoveryRef.current?.operationId ?? null });
      setRecoveryPending(true);
      setRetryAllowed(false);
      const next = await createMetaConnectClient().createCampaign(
        request,
        controller.signal,
      );
      acceptOperation(next);
      if (next.state === "succeeded") {
        setNotice("Paused campaign created. Review it before activating spend.");
        setShowComposer(false);
      } else if (next.state === "needs_reconciliation") {
        setError("Campaign creation needs reconciliation. Do not retry the create operation.");
      } else if (next.state === "pending" || next.state === "running") {
        await pollOperation(next.operationId);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Campaign creation could not be started.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function checkExistingOperation() {
    if (!operation && recoveryRef.current?.request) {
      setOperationChecking(true);
      try {
        const next = await createMetaConnectClient().operationForRequest(business.id, recoveryRef.current.request.idempotencyKey);
        if (next) acceptOperation(next);
        else { setRetryAllowed(true); setNotice("No operation is recorded yet. Retrying will reuse the original request."); }
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Operation status is unavailable."); }
      finally { setOperationChecking(false); }
      return;
    }
    if (!operation || ["succeeded", "failed", "needs_reconciliation"].includes(operation.state)) return;
    operationControllerRef.current?.abort();
    operationControllerRef.current = new AbortController();
    await pollOperation(operation.operationId);
  }

  async function handleGuidedDraft(draft: DraftDTO) {
    if (unresolvedRecovery()) {
      setError("Check the existing campaign operation before preparing another campaign.");
      return;
    }
    saveRecovery({ draft, request: null, operationId: null });
    setRecoveryPending(false);
    preparedDraftRef.current = draft;
    restoreDraft(draft);
    setOperation(null);
    operationRef.current = null;
    setError(null);
    try {
      const connection = await createMetaConnectClient().status(business.id);
      if (connection.authorization !== "connected" || !connection.selected) {
        setConnectionIntent({ kind: "setup" });
        setConnectOpen(true);
        return;
      }
      if (draft.input.destination !== "whatsapp") await refreshDraftForms();
      await loadPrepareReview(draft, connection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open the saved campaign review.");
    }
  }

  async function refresh(id: string) {
    setRefreshingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/refresh`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        result?: CampaignResult;
        summary?: string;
        error?: string;
      };
      if (res.ok) {
        if (data.result) setResults((p) => ({ ...p, [id]: data.result! }));
        if (data.summary) setSummaries((p) => ({ ...p, [id]: data.summary! }));
      } else {
        setError(data.error ?? "Couldn't refresh results.");
      }
    } catch {
      setError("Couldn't refresh results — check your connection.");
    } finally {
      setRefreshingId(null);
    }
  }

  function adsLink(campaign: Campaign) {
    const account = (campaign.meta_ad_account_id ?? adAccountId).replace(/^act_/, "").trim();
    const url = new URL("https://adsmanager.facebook.com/adsmanager/manage/campaigns/");
    if (/^\d+$/.test(account)) {
      url.searchParams.set("act", account);
      if (campaign.meta_campaign_id) url.searchParams.set("selected_campaign_ids", campaign.meta_campaign_id);
    }
    return url.toString();
  }

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);

  async function buildActivationDigest(campaign: Campaign, connection: ConnectionDTO): Promise<string> {
    const payload = activationConfirmationPayload(campaign, connection);
    if (!crypto.subtle) throw new Error("Activation confirmation is unavailable in this browser.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function openActivationReview(campaign: Campaign, connection: ConnectionDTO) {
    try {
      const digest = await buildActivationDigest(campaign, connection);
      setReviewConnection(connection);
      setActivationDigest(digest);
      setActivationReview(campaign);
      setConnectOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Activation review is unavailable.");
    }
  }

  async function setCampaignStatus(c: Campaign, next: "active" | "paused", confirmed = false) {
    if (next === "active" && !confirmed) {
      setConnectionIntent({ kind: "review_activation", campaignId: c.id });
      setConnectOpen(true);
      return;
    }
    if (next === "active" && (!activationDigest || !reviewConnection)) {
      setError("Review the current connection before activating this campaign.");
      return;
    }
    const reviewedDigest = activationDigest;
    const reviewedConnection = reviewConnection;
    setStatusChangingId(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next === "active"
          ? buildActivationPatch(reviewedDigest!, reviewedConnection!.generation)
          : { status: "paused" }),
      });
      if (res.ok) {
        setCampaigns((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, status: next } : x)),
        );
        setNotice(next === "active" ? "Campaign resumed." : "Campaign paused.");
        if (next === "active") {
          setActivationReview(null);
          setActivationDigest(null);
          setReviewConnection(null);
        }
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Couldn't update the campaign.");
      }
    } catch {
      setError("Couldn't update the campaign — check your connection.");
    } finally {
      setStatusChangingId(null);
    }
  }

  async function deleteCampaign(c: Campaign) {
    if (
      !window.confirm(
        `Delete "${c.name ?? "this campaign"}"? This removes it from Meta and can't be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, { method: "DELETE" });
      if (res.ok) {
        setCampaigns((prev) => prev.filter((x) => x.id !== c.id));
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Couldn't delete the campaign.");
      }
    } catch {
      setError("Couldn't delete the campaign — check your connection.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <p className="text-sm text-slate-500">{campaigns.filter(campaign => campaign.status === "active").length} active <span className="mx-2 text-slate-300">/</span> {campaigns.filter(campaign => campaign.status === "paused").length} paused</p>
        <Button variant={showComposer ? "outline" : "primary"} onClick={toggleComposer} aria-expanded={showComposer} aria-controls="campaign-composer"><Plus className="h-4 w-4" aria-hidden="true" />{showComposer ? "Close campaign setup" : "New campaign"}</Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {!connectedForDraft && (
        <div className="space-y-3">
          <Alert variant="warning">
            Meta isn’t connected yet. Connect an existing business to continue, or keep this campaign as a draft.
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => {
              if (unresolvedRecovery()) { setError("Check the existing campaign operation before connecting again."); return; }
              setConnectionIntent({ kind: "setup" });
              setPrepareReview(null);
              setConnectOpen(true);
            }}>
              <Link2 className="h-4 w-4" aria-hidden="true" /> Connect Business
            </Button>
            <Link href="/settings" className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Open Settings
            </Link>
          </div>
        </div>
      )}
      {activationReview && (
        <Alert variant="warning">
          <span className="block">
            Review {activationReview.name ?? "this campaign"} before it can run. Confirming will send the explicit activation request.
          </span>
          {reviewConnection?.selected && (
            <span className="mt-2 block text-sm font-normal text-amber-900">
              Account: {reviewConnection.selected.accountName} ({reviewConnection.selected.adAccountId}) · Page: {reviewConnection.selected.pageName} · Currency: {reviewConnection.selected.currency} · Timezone: {reviewConnection.selected.timezoneName}
              <br />
              Effective daily total: {activationReview.daily_budget == null ? "Unavailable" : formatCurrency(activationReview.daily_budget)}
            </span>
          )}
          <Button
            size="sm"
            className="ml-3"
            disabled={!activationDigest || statusChangingId === activationReview.id}
            onClick={() => void setCampaignStatus(activationReview, "active", true)}
          >
            {statusChangingId === activationReview.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm resume
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setActivationReview(null)}>Cancel</Button>
        </Alert>
      )}
      {recoveryPending && !operation && (
        <Alert variant="warning">
          The previous campaign request has not been confirmed.
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void checkExistingOperation()} disabled={operationChecking || creating}>
              <RefreshCw className="h-4 w-4" />Check status
            </Button>
            {retryAllowed && prepareReview?.status === "ready" && (
              <Button size="sm" onClick={() => void createPreparedCampaign()} disabled={creating}>
                <RefreshCw className="h-4 w-4" />Retry original request
              </Button>
            )}
          </div>
        </Alert>
      )}
      {prepareReview && (
        <section ref={reviewPanelRef} tabIndex={-1} aria-label="Campaign review result" className="scroll-mt-24 outline-none">
        <Alert variant={prepareReview.status === "ready" ? "success" : prepareReview.status === "blocked" ? "error" : "warning"}>
          {prepareReview.status === "checking" && "Checking the saved campaign draft before review."}
          {prepareReview.status === "blocked" && (
            <>
              {prepareReview.message} No campaign create or activation request was sent.
            </>
          )}
          {prepareReview.status === "ready" && (
            <>
              <span className="block font-medium">Campaign review</span>
              <span className="mt-2 block text-sm font-normal">
                Account: {prepareReview.review.selected?.accountName ?? prepareReview.connection.selected?.accountName ?? "Unavailable"} · Page: {prepareReview.review.selected?.pageName ?? prepareReview.connection.selected?.pageName ?? "Unavailable"} · Currency: {prepareReview.review.currency}
                <br />
                Destination: {prepareReview.draft.input.destination === "whatsapp" ? `WhatsApp chat ${prepareReview.review.whatsappNumber ?? "(number not verified)"}` : "Instant lead form"}
                <br />
                Geography: {prepareReview.review.resolvedAreaLabel ?? "Needs review"} · Per ad set: {formatCurrency(prepareReview.review.perAdSetDailyBudgetRupees)} · Effective daily total: {formatCurrency(prepareReview.review.totalDailyBudgetRupees)}
                <br />
                Ages: {prepareReview.draft.input.targeting.age?.min ?? "Unset"}-{prepareReview.draft.input.targeting.age?.max === 65 ? "65+" : prepareReview.draft.input.targeting.age?.max ?? "Unset"} · Gender: {{ all: "All genders", men: "Men", women: "Women" }[prepareReview.draft.input.targeting.gender ?? "all"]} · City coverage: {prepareReview.draft.input.targeting.location?.cityScope === "city_only" ? "City only (no added radius)" : `${prepareReview.draft.input.targeting.location?.radiusKm ?? 25} km radius`}
                <br />
                Interests: {prepareReview.review.audienceInterests?.map((interest) => interest.name).join(", ") || (prepareReview.draft.input.targeting.audience?.interestNames.length ? "Needs resolution" : "No interest narrowing")}
                <br />
                Location includes residents and recent visitors. Interest signals may expand under Meta lead optimization.
              </span>
              {prepareReview.review.blockers.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm font-normal">
                  {prepareReview.review.blockers.map((blocker) => <li key={`${blocker.code}:${blocker.message}`}>{blocker.message}</li>)}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {prepareReview.review.canCreatePaused && prepareReview.review.planHash && !operation && !recoveryPending && (
                  <Button size="sm" onClick={() => void createPreparedCampaign()} disabled={creating}>
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    Send to Meta (paused)
                  </Button>
                )}
                {operation && (operation.state === "pending" || operation.state === "running") && (
                  <>
                    <span className="text-sm font-normal">Campaign operation is processing.</span>
                    <Button size="sm" variant="outline" onClick={() => void checkExistingOperation()} disabled={operationChecking}>
                      {operationChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      Check status
                    </Button>
                  </>
                )}
                {operation?.state === "succeeded" && <span className="text-sm font-normal">Paused campaign created. Review it before activation.</span>}
                {operation?.state === "failed" && <span className="text-sm font-normal">The operation failed before completion. Review the draft and start a new reviewed attempt.</span>}
                {operation?.state === "needs_reconciliation" && <span className="text-sm font-normal">This operation needs reconciliation. Do not retry campaign creation.</span>}
              </div>
            </>
          )}
        </Alert>
        </section>
      )}
      <MetaConnectDialog
        businessId={business.id}
        intent={connectionIntent}
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onBeforeStart={connectionIntent.kind === "setup" ? async () => {
              if (unresolvedRecovery()) throw new Error("Check the existing operation before connecting again.");
              setPrepareReview(null);
              const client = createMetaConnectClient();
              const previous = preparedDraftRef.current;
              const input = manualDraftInput(false);
              const draft = previous && !recoveryRef.current?.request
                ? await client.updateDraft(previous.draftId, previous.version, input)
                : await client.saveDraft(input);
              preparedDraftRef.current = draft;
              saveRecovery({ draft, request: null, operationId: null });
              setOperation(null);
              operationRef.current = null;
              setRecoveryPending(false);
              const prepareIntent = { kind: "prepare_campaign" as const, draftId: draft.draftId, draftVersion: draft.version };
              setConnectionIntent(prepareIntent);
              return prepareIntent;
            } : undefined}
        onConnected={(connection) => {
          if (connectionIntent.kind === "review_activation") {
            const campaign = campaigns.find((item) => item.id === connectionIntent.campaignId);
            if (campaign) void openActivationReview(campaign, connection);
          } else if (preparedDraftRef.current) {
            void finishDraftConnection(connection);
          } else {
            window.location.reload();
          }
        }}
      />

      {savedDrafts.length > 0 && <section aria-label="Saved drafts" className="border-y border-slate-200 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Saved drafts</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {savedDrafts.map((draft) => <li key={draft.draftId} className="flex min-w-0 items-center justify-between gap-3 py-2">
            <button type="button" disabled={draftBusy !== null || creating || operationChecking} onClick={() => void reopenDraft(draft.draftId)} className="min-w-0 flex-1 text-left text-sm font-medium text-slate-800 hover:text-blue-700 disabled:opacity-50">
              <span className="block wrap-break-word">{draft.input.name}</span>
              <span className="mt-0.5 block text-xs font-normal text-slate-500">{formatCurrency(draft.input.dailyBudgetRupees)} per ad set</span>
            </button>
            <Button variant="ghost" size="sm" title={`Remove ${draft.input.name}`} aria-label={`Remove ${draft.input.name}`} disabled={draftBusy !== null || creating} onClick={() => void removeDraft(draft)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
          </li>)}
        </ul>
      </section>}
      <div id="campaign-composer" hidden={!showComposer}>
      {(
        <>
          <section
            aria-label="Launch preflight"
            className="grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-3"
          >
            {[
              ["Creative", approved.length ? `${approved.length} approved` : "Needs approval", Boolean(approved.length)],
              ["Meta connection", connectedForDraft ? "Connected" : "Not connected", connectedForDraft],
              ["Safety", "Created paused", true],
            ].map(([label, value, ready]) => (
              <div key={label as string} className="flex items-start gap-3 py-2">
                <CheckCircle2 className={cn("mt-0.5 h-4 w-4 flex-none", ready ? "text-emerald-600" : "text-amber-600")} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</p>
                </div>
              </div>
            ))}
          </section>
          <fieldset disabled={preparing || creating} className="my-5 flex flex-wrap gap-2">
            <legend className="mb-2 text-xs font-medium text-slate-500">Campaign setup</legend>
            {[["manual", "Choose settings"], ["guided", "Plan with AdBrain"]].map(([value, label]) => <label key={value} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", creationMode === value ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200")}><input type="radio" name="creation-mode" value={value} checked={creationMode === value} onChange={() => setCreationMode(value)} className="accent-blue-600" />{label}</label>)}
          </fieldset>
          <fieldset disabled={preparing || creating || destinationRecoveryLocked} aria-describedby={destinationRecoveryLocked ? "destination-lock-reason" : undefined} className="mb-4 flex flex-wrap gap-2">
            <legend className="mb-2 text-xs font-medium text-slate-500">Destination</legend>
            {([ ["instant_form", "Instant form"], ["whatsapp", "WhatsApp chat"] ] as const).map(([value, label]) => <label key={value} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", destination === value ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200")}><input type="radio" name="campaign-destination" value={value} checked={destination === value} onChange={() => { if (!unresolvedRecovery()) { setDestination(value); setPrepareReview(null); } }} className="accent-blue-600" />{label}</label>)}
          </fieldset>
          {destinationRecoveryLocked && <p id="destination-lock-reason" role="status" className="mb-4 text-sm text-amber-800">Destination is locked until the previous campaign request is resolved.</p>}
          {showComposer && creationMode === "guided" && <CampaignChat
            businessId={business.id}
            destination={destination}
            onDraftReady={(draft) => void handleGuidedDraft(draft)}
          />}
        </>
      )}

      {(
        <Card hidden={creationMode !== "manual"} className="min-w-0 rounded-none border-0 bg-white" onChange={() => { if (!unresolvedRecovery()) setPrepareReview(null); }}>
          <CardHeader className="border-b border-slate-200/80 bg-white/60">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>New campaign</CardTitle>
                <p className="mt-1 text-sm text-slate-500">Choose the approved work, audience, and budget to prepare a paused campaign.</p>
              </div>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Paused by default</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <fieldset disabled={preparing || creating} className="flex min-w-0 flex-col gap-5">
            {approved.length === 0 ? (
              <div className="flex flex-col items-start gap-3 py-2">
                <p className="text-sm text-slate-500">
                  You need at least one approved creative before you can launch.
                  Head to the Creative Studio, generate a few ads, and approve
                  the ones you like.
                </p>
                <Link href="/studio">
                  <Button variant="outline" size="sm">
                    <Sparkles className="h-4 w-4" /> Go to Creative Studio
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                <div>
                  <Label>Choose creatives</Label>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {approved.map((c) => {
                      const isSel = selected.has(c.id);
                      return (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() => toggle(c.id)}
                          aria-pressed={isSel}
                          aria-label={c.headline || "Select creative"}
                          className={cn(
                            "group relative min-w-0 overflow-hidden rounded-md border-2 text-left transition-colors",
                            isSel
                              ? "border-slate-950 shadow-[0_8px_18px_rgba(15,23,42,0.12)]"
                              : "border-slate-200 hover:border-slate-300",
                          )}
                        >
                          <div className="aspect-square bg-slate-100">
                            {c.image_url && (
                              <img
                                src={c.image_url}
                                alt={c.headline || "Ad creative preview"}
                                className="h-full w-full object-contain"
                                loading="lazy"
                              />
                            )}
                          </div>
                          {isSel && (
                            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-white">
                              <CheckCircle2 className="h-4 w-4" />
                            </span>
                          )}
                          <p className="truncate px-2 py-1.5 text-xs font-medium text-slate-700">
                            {c.headline}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="name">Campaign name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="budget">{abTest ? "Daily budget per ad set (₹)" : "Daily budget (₹)"}</Label>
                    <Input
                      id="budget"
                      type="number"
                      min={50}
                      value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                    />
                  </div>
                  {destination === "instant_form" && <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="leadform">Lead form</Label>
                    <select
                      id="leadform"
                      value={leadFormId}
                      onChange={(e) => setLeadFormId(e.target.value)}
                      className="h-10 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">{connectedForDraft ? "Choose a lead form" : "Connect Meta to choose a form"}</option>
                      {availableForms.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>}
                </div>

                <div className="-mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Quick pick:</span>
                  {BUDGET_PRESETS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => { setBudget(amount); if (!unresolvedRecovery()) setPrepareReview(null); }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        budget === amount
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300",
                      )}
                    >
                      ₹{amount}/day
                    </button>
                  ))}
                  <span className="ml-auto text-xs font-medium text-slate-600">
                    Total: {formatCurrency(totalDailyBudget)}/day{abTest ? " across 2 ad sets" : ""}
                  </span>
                </div>

                {destination === "instant_form" && formsLoading && <p role="status" className="text-sm text-slate-500">Loading lead forms...</p>}
                {destination === "instant_form" && formsError && (
                  <Alert variant="warning">
                    Couldn’t load lead forms: {formsError}
                    <Button variant="outline" onClick={() => setFormsRetry(current => current + 1)} disabled={formsLoading}>
                      <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry lead forms
                    </Button>
                  </Alert>
                )}

                <div className="flex flex-col gap-2">
                  <div><Label htmlFor="campaign-goal">Campaign goal</Label><Input id="campaign-goal" value={draftGoal} onChange={(event) => setDraftGoal(event.target.value)} placeholder="Qualified enquiries for the current offer" /></div>
                  <div className="mb-4 grid gap-3 sm:grid-cols-2">
                    <div><Label htmlFor="planned-areas">Planned areas</Label><Textarea id="planned-areas" rows={2} placeholder="One place per line" value={includedNames} onChange={(event) => { setIncludedNames(event.target.value); setTargeting({ ...targeting, locationMode: "manual" }); setPrepareReview(null); }} className="mt-1 rounded-md p-2" /></div>
                    <div><Label htmlFor="planned-exclusions">Excluded areas</Label><Textarea id="planned-exclusions" rows={2} placeholder="One place per line" value={excludedNames} onChange={(event) => { setExcludedNames(event.target.value); setPrepareReview(null); }} className="mt-1 rounded-md p-2" /></div>
                  </div>
                  <Label>Audience &amp; location</Label>
                  <TargetingControls
                    value={targeting}
                    onDecide={(field) => void requestAudienceRecommendation(field)}
                    onChange={(value) => { setTargeting(value.radiusKm !== targeting.radiusKm ? { ...value, locationMode: "manual" } : value); if (!unresolvedRecovery()) setPrepareReview(null); }}
                    brandAreas={business.locations ?? []}
                    plannedAreas={plannedAreas}
                    plannedExclusions={plannedExclusions}
                  />
                  <Button variant="outline" onClick={() => void requestAudienceRecommendation()} disabled={preparing || selected.size === 0 || budget <= 0}>
                    <Sparkles className="h-4 w-4" aria-hidden="true" /> Recommend audience
                  </Button>
                  {targeting.audience && <div className="space-y-3 border-t border-slate-200 pt-3">
                    <p className="text-sm text-slate-700">{targeting.audience.rationale}</p>
                    <div><Label htmlFor="audience-interests">Interests (up to 5, one per line)</Label>
                      <Textarea id="audience-interests" rows={3} value={targeting.audience.interestNames.join("\n")} onChange={(event) => setTargeting({ ...targeting, audience: { ...targeting.audience!, interestNames: event.target.value.split("\n") } })} className="mt-1 rounded-md p-2" />
                    </div>
                    <p className="text-xs text-slate-500">Interest signals are not verified ownership or purchase intent. Meta may expand detailed targeting for lead optimization.</p>
                  </div>}
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={abTest}
                    onChange={(e) => setAbTest(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-slate-800">
                      A/B test the audience by age
                    </span>
                    <span className="block text-xs text-slate-500">
                      Two ad sets, each with the entered daily budget. Total daily budget: {formatCurrency(totalDailyBudget)}.
                    </span>
                  </span>
                </label>

                <div className="border-t border-slate-200 pt-5">
                  <CampaignLaunchReview
                    selectedCount={selected.size}
                    budget={totalDailyBudget}
                    leadFormName={selectedLeadForm?.name}
                    destination={destination}
                    audience={`${audiencePreview}; ${targeting.ageMode === "manual" ? `ages ${targeting.ageMin}-${targeting.ageMax === 65 ? "65+" : targeting.ageMax}` : "age recommendation pending"}; ${{ all: "All genders", men: "Men", women: "Women" }[targeting.gender ?? "all"]}; ${targeting.cityScope === "city_only" ? "city only (no added radius)" : `city radius ${targeting.radiusKm} km`}${targeting.audience?.interestNames.length ? `; interests: ${targeting.audience.interestNames.join(", ")}` : ""}`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={() => void prepareManualCampaign(false)} disabled={preparing || creating}>
                    <Save className="h-4 w-4" aria-hidden="true" /> Save draft
                  </Button>
                  <Button onClick={() => void prepareManualCampaign()} disabled={preparing || selected.size === 0 || budget <= 0}>
                    {preparing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Prepare campaign review
                  </Button>
                </div>
                <details className="border-t border-slate-200 pt-3"><summary className="cursor-pointer text-xs font-medium text-slate-500">After campaign creation</summary><HowItWorks /></details>
              </>
            )}
            </fieldset>
            {preparing && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p role="status" className="text-sm text-slate-600">{preparationStage}</p>
                <Button variant="outline" onClick={() => stopPreparation()}>
                  <X className="h-4 w-4" aria-hidden="true" /> Stop preparation
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Your campaigns{" "}
            <span className="font-normal text-slate-400">
              ({campaigns.length})
            </span>
          </h2>
          {metaReady && (
            <div className="flex flex-wrap items-center gap-2">
              {lastSynced && !syncing && (
                <span className="text-xs text-slate-400">
                  Synced {timeAgo(lastSynced)}
                </span>
              )}
              {campaigns.length > 0 && (
                <a
                  href="/api/campaigns/report"
                  download
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400"
                >
                  <FileText className="h-4 w-4" /> Export report
                </a>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncFromMeta()}
                disabled={syncing}
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {syncing ? "Syncing…" : "Sync from Meta"}
              </Button>
            </div>
          )}
        </div>
        {(campaigns.length > 0 || campaignQuery || statusFilter !== "all") && <div className="mb-5 flex flex-wrap gap-3">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-md border border-slate-300 px-3"><Search size={16} className="shrink-0 text-slate-400" aria-hidden="true" /><input type="search" aria-label="Search campaigns" placeholder="Search campaigns" value={campaignQuery} onChange={event => setCampaignQuery(event.target.value)} className="h-10 w-full min-w-0 bg-transparent text-sm outline-none" /></div>
          <select aria-label="Campaign status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="completed">Completed</option></select>
        </div>}
        {campaigns.length === 0 && !campaignQuery && statusFilter === "all" ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-10 text-center">
              <Rocket className="h-6 w-6 text-slate-300" />
              <p className="font-medium text-slate-600">No campaigns yet</p>
              <p className="max-w-sm text-sm text-slate-400">
                Launch your first one above — with AI, or by picking creatives
                and a budget. It’s created paused, so nothing spends until you
                say so.
              </p>
            </CardContent>
          </Card>
        ) : visibleCampaigns.length === 0 ? <div className="flex flex-col items-center gap-3 border-y border-slate-200 py-12"><Search aria-hidden="true" className="text-slate-400" /><h3 className="font-semibold">No matching campaigns</h3><Button variant="outline" onClick={() => { setCampaignQuery(""); setStatusFilter("all"); }}>Clear filters</Button></div> : (
          <div className="flex flex-col border-t border-slate-200">
            {visibleCampaigns.map((c) => {
              const r = results[c.id];
              const outcome = campaignDestination(c, r);
              return (
                <Card key={c.id} className="rounded-none border-x-0 border-t-0">
                  <CardContent className="flex flex-col gap-3 px-0 py-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="min-w-0 wrap-break-word font-semibold text-slate-900">
                          {c.name ?? `${business.name} — ${c.objective}`}
                        </h3>
                        <Badge
                          className={
                            STATUS_STYLES[c.status] ??
                            "bg-slate-100 text-slate-600"
                          }
                        >
                          {c.status}
                        </Badge>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <span className="text-sm text-slate-500">
                          {c.daily_budget != null
                            ? `${formatCurrency(c.daily_budget)}/day`
                            : c.objective}
                        </span>
                        {c.meta_campaign_id && (
                          <a
                            href={adsLink(c)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                          >
                            Ads Manager <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => refresh(c.id)}
                          disabled={refreshingId === c.id}
                        >
                          {refreshingId === c.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          Refresh results
                        </Button>
                        {c.meta_campaign_id &&
                          (c.status === "active" || c.status === "paused") && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setCampaignStatus(
                                  c,
                                  c.status === "active" ? "paused" : "active",
                                )
                              }
                              disabled={statusChangingId === c.id}
                            >
                              {statusChangingId === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : c.status === "active" ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                              {c.status === "active" ? "Pause" : "Resume"}
                            </Button>
                          )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteCampaign(c)}
                          disabled={deletingId === c.id}
                          aria-label="Delete campaign"
                        >
                          {deletingId === c.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-slate-400" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {r && (
                      <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-4">
                        <Stat label="Impressions" value={formatNumber(r.impressions)} />
                        <Stat label="Clicks" value={formatNumber(r.clicks)} />
                        <Stat label={outcome === "whatsapp" ? "WhatsApp conversations" : outcome === "instant_form" ? "Leads" : "Results unavailable"} value={outcome === "whatsapp" ? (r.conversations != null ? formatNumber(r.conversations) : "—") : outcome === "instant_form" ? formatNumber(r.leads) : "—"} />
                        <Stat
                          label={outcome === "whatsapp" ? "Cost / conversation" : outcome === "instant_form" ? "Cost / lead" : "Cost / result"}
                          value={outcome === "whatsapp" ? (r.conversations != null && r.cost_per_conversation != null ? formatCurrency(r.cost_per_conversation) : "—") : outcome === "instant_form" && r.cpl != null ? formatCurrency(r.cpl) : "—"}
                        />
                      </div>
                    )}
                    {r && outcome === "instant_form" &&
                      (() => {
                        const h = spendHealth(
                          { spend: r.spend, leads: r.leads, cpl: r.cpl },
                          formatCurrency,
                        );
                        const narrative = campaignNarrative(
                          { spend: r.spend, leads: r.leads, cpl: r.cpl },
                          formatCurrency,
                        );
                        const nextAction = campaignNextAction({
                          spend: r.spend,
                          leads: r.leads,
                          cpl: r.cpl,
                        });
                        const tones = {
                          idle: "border-slate-200 bg-slate-50 text-slate-700",
                          good: "border-green-200 bg-green-50 text-green-800",
                          ok: "border-blue-200 bg-blue-50 text-blue-800",
                          warn: "border-amber-200 bg-amber-50 text-amber-800",
                        } as const;
                        return (
                          <div className={cn("rounded-lg border px-3 py-2.5 text-sm", tones[h.tone])}>
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-semibold">{h.label}.</span>
                              <span>{h.detail}</span>
                            </div>
                            <p className="mt-1.5 text-xs/5 text-current/80">{narrative}</p>
                            <p className="mt-1 text-xs font-medium text-current/80">Next step: {nextAction}</p>
                          </div>
                        );
                      })()}
                    {summaries[c.id] && (
                      <p className="text-sm text-slate-600">{summaries[c.id]}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {(nextListCursor || listLoading) && <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={listLoading} onClick={() => void loadCampaignPage(true)}>
            {listLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {listLoading ? "Loading campaigns..." : "Load more campaigns"}
          </Button>
        </div>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

const HOW_IT_WORKS_STEPS = [
  "We create the campaign paused — nothing spends yet.",
  "Open it in Meta Ads Manager to review the ads and audience.",
  "Flip it on when you're happy; leads start coming in.",
  "Come back and hit “Refresh results” to see leads and cost per lead in plain English.",
];

function HowItWorks() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        What happens next
      </p>
      <ol className="mt-2 flex flex-col gap-1.5">
        {HOW_IT_WORKS_STEPS.map((step, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-600">
            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
