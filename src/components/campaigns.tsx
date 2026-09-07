"use client";

import { startTransition, useEffect, useRef, useState } from "react";
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
  Trash2,
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
import { Input, Label } from "@/components/ui/input";
import {
  TargetingControls,
  defaultTargeting,
  type GeoPick,
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

type PrepareReviewState =
  | { status: "checking"; draft: DraftDTO; connection: ConnectionDTO }
  | { status: "ready"; draft: DraftDTO; connection: ConnectionDTO; review: ReviewDTO }
  | { status: "blocked"; draft: DraftDTO; connection: ConnectionDTO; message: string };

function toDraftLocation(place: GeoPick, radiusKm: number) {
  if (place.type !== "city" && place.type !== "region" && place.type !== "country") {
    return null;
  }
  return {
    key: place.key,
    name: place.name,
    type: place.type,
    radiusKm,
  } as const;
}

export function Campaigns({
  business,
  approved,
  initialCampaigns,
  initialResults,
  leadForms,
  leadFormError,
  metaReady,
  adAccountId,
}: {
  business: Business;
  approved: Creative[];
  initialCampaigns: Campaign[];
  initialResults: Record<string, CampaignResult>;
  leadForms: LeadForm[];
  leadFormError: string | null;
  metaReady: boolean;
  adAccountId: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState(200);
  const [leadFormId, setLeadFormId] = useState(leadForms[0]?.id ?? "");
  const [availableForms, setAvailableForms] = useState(leadForms);
  const [connectedForDraft, setConnectedForDraft] = useState(metaReady);
  const [name, setName] = useState(`${business.name} — leads`);
  const [targeting, setTargeting] = useState<TargetingValue>(defaultTargeting);
  const [abTest, setAbTest] = useState(false);
  const [creating, setCreating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [showComposer, setShowComposer] = useState(initialCampaigns.length === 0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectionIntent, setConnectionIntent] = useState<ConnectIntent>({ kind: "setup" });
  const [activationReview, setActivationReview] = useState<Campaign | null>(null);
  const [reviewConnection, setReviewConnection] = useState<ConnectionDTO | null>(null);
  const [activationDigest, setActivationDigest] = useState<string | null>(null);
  const [prepareReview, setPrepareReview] = useState<PrepareReviewState | null>(null);
  const preparedDraftRef = useRef<DraftDTO | null>(null);
  const operationRef = useRef<{ reviewKey: string; idempotencyKey: string } | null>(null);
  const operationControllerRef = useRef<AbortController | null>(null);
  const [operation, setOperation] = useState<OperationDTO | null>(null);
  const [operationChecking, setOperationChecking] = useState(false);
  const router = useRouter();
  const recoveryKey = recoveryStorageKey(business.owner_id, business.id);
  const recoveryRef = useRef<CampaignRecovery | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [creationMode, setCreationMode] = useState("manual");
  const [campaignQuery, setCampaignQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const visibleCampaigns = campaigns.filter(campaign =>
    (statusFilter === "all" || campaign.status === statusFilter) &&
    (campaign.name ?? business.name).toLocaleLowerCase().includes(campaignQuery.trim().toLocaleLowerCase()),
  );
  const totalDailyBudget = effectiveDailyBudget(budget, abTest ? 2 : 1);
  const [results, setResults] =
    useState<Record<string, CampaignResult>>(initialResults);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const selectedLeadForm = availableForms.find((form) => form.id === leadFormId);
  const audiencePreview =
    targeting.locationMode === "manual"
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
    setAbTest(input.abTest);
    setCreationMode(input.mode);
    setShowComposer(true);
    setTargeting({
      locationMode: input.targeting.location?.mode ?? defaultTargeting.locationMode,
      included: input.targeting.location?.included ?? [], excluded: input.targeting.location?.excluded ?? [],
      radiusKm: input.targeting.location?.radiusKm ?? defaultTargeting.radiusKm,
      ageMode: input.targeting.age?.mode ?? defaultTargeting.ageMode,
      ageMin: input.targeting.age?.min ?? defaultTargeting.ageMin,
      ageMax: input.targeting.age?.max ?? defaultTargeting.ageMax,
    });
  }

  async function refreshDraftForms(signal?: AbortSignal) {
    const response = await fetch("/api/campaigns/lead-forms", { cache: "no-store", signal });
    const data = await response.json() as { forms?: LeadForm[]; error?: string };
    if (signal?.aborted) return;
    if (!response.ok || data.error || !Array.isArray(data.forms)) throw new Error(data.error ?? "Could not load Page forms. Your draft is saved.");
    const forms = data.forms;
    setAvailableForms(forms);
    setLeadFormId(current => forms.some(form => form.id === current) ? current : "");
  }

  useEffect(() => {
    startTransition(() => setCampaigns(initialCampaigns));
  }, [initialCampaigns]);

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
        if (!saved.request) {
          if (connection.authorization === "connected" && connection.selected) await refreshDraftForms(controller.signal);
          return;
        }
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
  }

  async function finishDraftConnection(connection: ConnectionDTO) {
    setConnectedForDraft(true);
    setReviewConnection(connection);
    setConnectOpen(false);
    setPrepareReview(null);
    setShowComposer(true);
    try {
      await refreshDraftForms();
      setNotice("Meta connected. Your draft is ready to finish.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Page forms."); }
  }

  function acceptOperation(next: OperationDTO) {
    if (recoveryRef.current) saveRecovery({ ...recoveryRef.current, operationId: next.operationId });
    setOperation(next);
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
  ): Promise<void> {
    setPrepareReview({ status: "checking", draft, connection });
    try {
      const review = await createMetaConnectClient().preflight(
        business.id,
        draft.draftId,
        draft.version,
      );
      setPrepareReview({ status: "ready", draft, connection, review });
    } catch (reason: unknown) {
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
      const res = await fetch("/api/campaigns/sync", { method: "POST" });
      const data = (await res.json()) as {
        campaigns?: Campaign[];
        error?: string;
      };
      if (res.ok && Array.isArray(data.campaigns)) {
        setCampaigns(data.campaigns);
        setLastSynced(new Date());
      } else if (!res.ok && !opts.silent) {
        setError(data.error ?? "Sync failed.");
      }
    } catch {
      if (!opts.silent) setError("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  // Auto-sync from Meta once when the page opens, so campaigns stay fresh.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (metaReady && !autoSynced.current) {
      autoSynced.current = true;
      void syncFromMeta({ silent: true });
    }
  }, [metaReady]);

  function toggle(id: string) {
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
      goal: name,
      mode: creationMode === "guided" ? "guided" : "manual",
      creativeIds: [...selected],
      dailyBudgetRupees: Math.max(0, budget),
      leadFormId: leadFormId || null,
      targeting: {
        location: {
          mode: targeting.locationMode,
          included: targeting.included
            .map((place) => toDraftLocation(place, targeting.radiusKm))
            .filter((place): place is NonNullable<typeof place> => place !== null),
          excluded: targeting.excluded
            .map((place) => toDraftLocation(place, targeting.radiusKm))
            .filter((place): place is NonNullable<typeof place> => place !== null),
          radiusKm: targeting.radiusKm,
        },
        age: {
          mode: targeting.ageMode,
          min: targeting.ageMin,
          max: targeting.ageMax,
        },
      },
      abTest,
    };
  }

  async function prepareManualCampaign() {
    if (unresolvedRecovery()) {
      setError("Check the existing campaign operation before preparing another campaign.");
      return;
    }
    setError(null);
    setNotice(null);
    setOperation(null);
    operationRef.current = null;
    let input: DraftInput;
    try {
      input = manualDraftInput();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Complete the campaign details first.");
      return;
    }
    setPreparing(true);
    try {
      const client = createMetaConnectClient();
      const previous = preparedDraftRef.current;
      const draft = previous && !recoveryRef.current?.request
        ? await client.updateDraft(previous.draftId, previous.version, input)
        : await client.saveDraft(input);
      saveRecovery({ draft, request: null, operationId: null });
      setRecoveryPending(false);
      preparedDraftRef.current = draft;
      const connection = await client.status(business.id);
      if (connection.authorization !== "connected" || !connection.selected) {
        setConnectionIntent({ kind: "setup" });
        setConnectOpen(true);
        return;
      }
      await loadPrepareReview(draft, connection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the campaign draft.");
    } finally {
      setPreparing(false);
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

  function adsLink(metaId: string) {
    const acct = adAccountId.replace("act_", "");
    return `https://www.facebook.com/adsmanager/manage/campaigns?act=${acct}&selected_campaign_ids=${metaId}`;
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
        <Button variant={showComposer ? "outline" : "primary"} onClick={() => setShowComposer(!showComposer)} aria-expanded={showComposer} aria-controls="campaign-composer"><Plus className="h-4 w-4" aria-hidden="true" />{showComposer ? "Close campaign setup" : "New campaign"}</Button>
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
                Geography: {prepareReview.review.resolvedAreaLabel ?? "Needs review"} · Per ad set: {formatCurrency(prepareReview.review.perAdSetDailyBudgetRupees)} · Effective daily total: {formatCurrency(prepareReview.review.totalDailyBudgetRupees)}
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
                    Create paused campaign
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
      )}
      <MetaConnectDialog
        businessId={business.id}
        intent={connectionIntent}
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onBeforeStart={connectionIntent.kind === "setup" ? async () => {
              if (unresolvedRecovery()) throw new Error("Check the existing operation before connecting again.");
              setOperation(null);
              operationRef.current = null;
              const client = createMetaConnectClient();
              const previous = preparedDraftRef.current;
              const input = creationMode === "guided" && previous ? previous.input : manualDraftInput(false);
              const draft = previous ? await client.updateDraft(previous.draftId, previous.version, input) : await client.saveDraft(input);
              preparedDraftRef.current = draft;
              saveRecovery({ draft, request: null, operationId: null });
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
          <fieldset className="my-5 flex flex-wrap gap-2">
            <legend className="mb-2 text-xs font-medium text-slate-500">Campaign setup</legend>
            {[["manual", "Choose settings"], ["guided", "Plan with AdBrain"]].map(([value, label]) => <label key={value} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", creationMode === value ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200")}><input type="radio" name="creation-mode" value={value} checked={creationMode === value} onChange={() => setCreationMode(value)} className="accent-blue-600" />{label}</label>)}
          </fieldset>
          <div hidden={creationMode !== "guided"}><CampaignChat
            businessId={business.id}
            onDraftReady={(draft) => void handleGuidedDraft(draft)}
          /></div>
        </>
      )}

      {(
        <Card hidden={creationMode !== "manual"} className="min-w-0 rounded-none border-0 bg-white">
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
                  <div className="flex min-w-0 flex-col gap-1.5">
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
                  </div>
                </div>

                <div className="-mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Quick pick:</span>
                  {BUDGET_PRESETS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setBudget(amount)}
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

                {leadFormError && (
                  <Alert variant="warning">
                    Couldn’t load lead forms: {leadFormError}
                  </Alert>
                )}

                <div className="flex flex-col gap-2">
                  <Label>Audience &amp; location</Label>
                  <TargetingControls
                    value={targeting}
                    onChange={setTargeting}
                    brandAreas={business.locations ?? []}
                  />
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
                    audience={audiencePreview}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
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
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/api/campaigns/report";
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400"
                >
                  <FileText className="h-4 w-4" /> Export report
                </button>
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
        {campaigns.length > 0 && <div className="mb-5 flex flex-wrap gap-3">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-md border border-slate-300 px-3"><Search size={16} className="shrink-0 text-slate-400" aria-hidden="true" /><input type="search" aria-label="Search campaigns" placeholder="Search campaigns" value={campaignQuery} onChange={event => setCampaignQuery(event.target.value)} className="h-10 w-full min-w-0 bg-transparent text-sm outline-none" /></div>
          <select aria-label="Campaign status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="completed">Completed</option></select>
        </div>}
        {campaigns.length === 0 ? (
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
                            href={adsLink(c.meta_campaign_id)}
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
                        <Stat label="Leads" value={formatNumber(r.leads)} />
                        <Stat
                          label="Cost / lead"
                          value={r.cpl != null ? formatCurrency(r.cpl) : "—"}
                        />
                      </div>
                    )}
                    {r &&
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
