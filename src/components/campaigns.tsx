"use client";

import { startTransition, useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useCampaignList } from "@/lib/meta-connect-ui/use-campaign-list";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Sparkles,
  Search,
  Save,
  MoreHorizontal,
  Trash2,
  Users,
  IndianRupee,
  TriangleAlert,
  X,
} from "lucide-react";
import { WhatsAppReadyChecklist } from "@/components/whatsapp-ready";
import type { WhatsAppLanguage } from "@/lib/campaign/whatsapp-greeting";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { WhatsAppAiCard } from "@/components/whatsapp-ai-card";
import { EditAudienceDialog } from "@/components/edit-audience-dialog";
import { EditBudgetDialog } from "@/components/edit-budget-dialog";
import { applyBudget, budgetFormStart } from "@/lib/campaign/budget-edit-form";
import { EditAdDialog } from "@/components/edit-ad-dialog";
import { OWNER_WORDS } from "@/lib/copy/owner-words";
import { CampaignLaunchReview } from "@/components/campaign-launch-review";
import { WhatsAppEnquiries } from "@/components/whatsapp-enquiries";
import { LivePicture, type PicturePreview } from "@/components/live-picture";
import { CAMPAIGN_STATUS, Status } from "@/components/ui/status";
import { CopyEditNotice, CreativeEditor, UnsavedPreviewBadge, sameAdText, savedAdText, type AdText, type CopyEditNotes } from "@/components/creative-copy-editor";
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
import { reviewBlockerAlternative, reviewBlockerFix } from "@/lib/campaign/review-fix";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { useCampaignPreparation } from "@/lib/meta-connect-ui/use-campaign-preparation";
import { targetingFromEditor, targetingToEditor } from "@/lib/campaign/editor-targeting";
import { parsePhone } from "@/lib/brand/countries";
import type { LeadForm } from "@/lib/meta/client";
import { maskWhatsAppNumber, maskedWhatsAppNumberPattern, parseWhatsAppStatus, type WhatsAppStatus } from "@/lib/meta/whatsapp-status-shared";
import type { ConnectIntent, ConnectionDTO } from "@/lib/meta/connect-contracts";
import type { Business, Campaign, CampaignResult, Creative, Json } from "@/lib/types";
import {
  BUDGET_PRESETS,
  campaignNarrative,
  campaignNextAction,
  spendHealth,
} from "@/lib/campaign/budget";
import { effectiveDailyBudget } from "@/lib/campaign/spend";
import { accountFundingSchema, activationConfirmationPayload, campaignDeliverySnapshotSchema, RESUME_IN_ADS_MANAGER, reviewableCampaign } from "@/lib/campaign/activation";
import { activationWarnings } from "@/lib/campaign/plan-check";
import { campaignAttention } from "@/lib/campaign/health";
import { campaignWhatsAppSummary } from "@/lib/campaign/results-summary";
import { costPerCustomer } from "@/lib/campaign/real-enquiries";
import { describeSkippedCampaigns, type SkippedCampaign } from "@/lib/campaign/sync-skips";
import type { AccountFunding, AdReview, CampaignDeliverySnapshot } from "@/lib/meta/client";
import { readCampaignRecovery, recoveryStorageKey, writeCampaignRecovery, type CampaignRecovery } from "@/lib/meta-connect-ui/recovery";
import { HelpOnWhatsApp } from "@/components/support-link";
import { cn, timeAgo } from "@/lib/utils";
import { formatMoney, formatNumber, formatPerDay } from "@/lib/format";

const exactRupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/** #721: Meta deleted or archived it; Refresh ended the row and kept why in `raw.metaStatus`. */
function goneInMeta(campaign: Campaign): string | null {
  const status = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? (campaign.raw as { metaStatus?: unknown }).metaStatus : null;
  return status === "DELETED" ? "Deleted in Meta" : status === "ARCHIVED" ? "Archived in Meta" : null;
}

/** #741: where the ads won't show, in the owner's words (launch applies the same exclusions). */
function serviceAreaLine(area: NonNullable<ReviewDTO["serviceArea"]>): string {
  const states = `the other ${area.excludedStateCount} states and UTs`;
  const cities = area.excludedCities.length
    ? `${area.excludedCities.join(", ")} (outside your area in ${area.keptStates.join(", ")}) or `
    : "";
  return `Not shown in: ${cities}${states}.`;
}

const LEAD_FORMS_FRESH_MS = 60_000;
const CAMPAIGNS_FRESH_MS = 15 * 60_000;
/** Two rows of three on a phone, so Campaign name and budget are one scroll away (#305). */
const PHONE_PICKER_ADS = 6;

function readCampaignSyncTime(key: string): number {
  try { return Number(localStorage.getItem(key)); } catch { return 0; }
}

function saveCampaignSyncTime(key: string, completedAt: number) {
  try { localStorage.setItem(key, String(completedAt)); } catch { return; }
}

type PrepareReviewState =
  | { status: "checking"; draft: DraftDTO; connection: ConnectionDTO }
  | { status: "ready"; draft: DraftDTO; connection: ConnectionDTO; review: ReviewDTO }
  | { status: "blocked"; draft: DraftDTO; connection: ConnectionDTO; message: string };

async function fetchDraftForms(signal?: AbortSignal, fresh = false): Promise<LeadForm[]> {
  const response = await fetch(`/api/campaigns/lead-forms${fresh ? "?fresh=1" : ""}`, { cache: "no-store", signal });
  const data = await response.json() as { forms?: LeadForm[]; error?: string };
  if (!response.ok || data.error || !Array.isArray(data.forms)) throw new Error(data.error ?? "Could not load Page forms. Your draft is saved.");
  return data.forms;
}

type ComposerSetup = {
  selected: Set<string>;
  budget: number;
  destination: "instant_form" | "whatsapp";
  whatsappNumber: string;
  whatsappLanguage?: WhatsAppLanguage;
  leadFormId: string;
  name: string;
  targeting: TargetingValue;
  draftGoal: string;
  includedNames: string;
  excludedNames: string;
  abTest: boolean;
  creationMode: string;
  showComposer: boolean;
};

type CampaignsProps = {
  business: Business;
  approved: Creative[];
  initialCampaigns: Campaign[];
  initialNextCursor?: string | null;
  initialResults: Record<string, CampaignResult>;
  leadForms: LeadForm[];
  leadFormError: string | null;
  metaReady: boolean;
  adAccountId: string;
  /** Opened from Review: start a new campaign with these ads (non-approved IDs are ignored). */
  newCampaign?: { creativeIds: string[] };
};


type PlanReply = {
  response: Response;
  data: { ready?: boolean; fallback?: boolean; targeting?: unknown; error?: string; questions?: { question: string }[]; handoff?: { message: string } };
};
const BACKGROUND_PLAN_DELAY_MS = 1500;
const MAX_BACKGROUND_PLANS = 3;

async function fetchAudiencePlan(input: DraftInput, signal: AbortSignal): Promise<PlanReply> {
  const response = await fetch("/api/campaigns/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: input.goal, audienceDraft: input }),
    signal,
  });
  return { response, data: await response.json() as PlanReply["data"] };
}

type AudiencePlanInput = Pick<DraftInput, "goal" | "creativeIds" | "targeting" | "destination">;

/** Keep the chosen lead form while the Page still has it; with exactly one form, choose it (#667). */
function keptLeadForm(current: string, forms: { id: string }[]): string {
  if (forms.some(form => form.id === current)) return current;
  return forms.length === 1 ? forms[0].id : "";
}

/** What a finished results refresh tells the owner (#671): new numbers, or none since the last fetch. */
function refreshNotice(previous: CampaignResult | undefined, next: CampaignResult | undefined): string {
  const keys = ["impressions", "clicks", "leads", "spend", "conversations", "whatsapp_opens"] as const;
  if (!next) return "Checked just now: Meta has no results for this campaign yet.";
  if (!previous || keys.some(key => (previous[key] ?? null) !== (next[key] ?? null))) return "Results updated just now.";
  const since = new Date(previous.fetched_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return `Checked just now: no new results since ${since}.`;
}

function needsAudiencePlan(input: AudiencePlanInput): boolean {
  return input.targeting.age?.mode === "ai" || !input.targeting.audience;
}

/**
 * What the audience plan depends on (#366): the owner's goal, the ads, the targeting and the destination.
 * The goal is the Campaign goal field only; a campaign name or budget typed later doesn't re-plan (#504).
 */
function audiencePlanKey(input: AudiencePlanInput): string {
  return JSON.stringify([input.goal, [...input.creativeIds].sort(), input.targeting, input.destination]);
}

export function Campaigns(props: CampaignsProps) {
  const [setups, saveSetup] = useReducer((current: Map<string, ComposerSetup>, [scope, setup]: [string, ComposerSetup]) => {
    const next = new Map(current);
    next.set(scope, setup);
    return next;
  }, new Map<string, ComposerSetup>());
  const scope = `${props.business.owner_id}:${props.business.id}`;
  return <BusinessCampaigns key={scope} {...props} scope={scope} initialSetup={setups.get(scope)} onSetupChange={saveSetup} />;
}

function BusinessCampaigns({
  business,
  approved,
  initialCampaigns,
  initialNextCursor = null,
  initialResults,
  leadForms,
  leadFormError,
  metaReady,
  adAccountId,
  newCampaign,
  scope,
  initialSetup,
  onSetupChange,
}: CampaignsProps & { scope: string; initialSetup?: ComposerSetup; onSetupChange: (value: [string, ComposerSetup]) => void }) {
  const [hadInitialSetup] = useState(Boolean(initialSetup));
  const [fromReview] = useState(Boolean(newCampaign) && !initialSetup);
  const [selected, setSelected] = useState<Set<string>>(() => initialSetup?.selected ?? new Set(
    newCampaign?.creativeIds.filter(id => approved.some(creative => creative.id === id)),
  ));
  // #761: ₹300 a day is the core run (#334); less rarely gets Meta out of learning.
  const [budget, setBudget] = useState(initialSetup?.budget ?? 300);
  const [destination, setDestination] = useState<"instant_form" | "whatsapp">(initialSetup?.destination ?? "instant_form");
  const [whatsappNumber, setWhatsAppNumber] = useState(initialSetup?.whatsappNumber ?? "");
  const [whatsappLanguage, setWhatsAppLanguage] = useState<WhatsAppLanguage>(initialSetup?.whatsappLanguage ?? "ad");
  const [whatsappStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null);
  // #235: an India-based business starts new campaigns on WhatsApp once a number is ready; a choice or a restored draft wins.
  const destinationChosenRef = useRef(Boolean(initialSetup));
  const indiaBased = parsePhone(business.phone).countryCode === "IN";
  const whatsappOptions = whatsappStatus?.state === "ready" ? whatsappStatus.numbers : [];
  const chosenWhatsAppNumber = whatsappOptions.some(({ masked }) => masked === whatsappNumber) ? whatsappNumber : whatsappOptions[0]?.masked ?? whatsappNumber;
  const [leadFormId, setLeadFormId] = useState(initialSetup?.leadFormId ?? leadForms[0]?.id ?? "");
  const [availableForms, setAvailableForms] = useState(leadForms);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsError, setFormsError] = useState(leadFormError);
  const [formsRetry, setFormsRetry] = useState(0);
  const formsFreshnessRef = useRef<{ ownerId: string; businessId: string; retry: number; fetchedAt: number } | null>(null);
  const [connectedForDraft, setConnectedForDraft] = useState(metaReady);
  const [name, setName] = useState(initialSetup?.name ?? `${business.name} — leads`);
  const [targeting, setTargeting] = useState<TargetingValue>(initialSetup?.targeting ?? defaultTargeting);
  const [draftGoal, setDraftGoal] = useState(initialSetup?.draftGoal ?? "");
  const [includedNames, setIncludedNames] = useState(initialSetup?.includedNames ?? "");
  const [excludedNames, setExcludedNames] = useState(initialSetup?.excludedNames ?? "");
  const [abTest, setAbTest] = useState(initialSetup?.abTest ?? false);
  const [creating, setCreating] = useState(false);
  const [sendingNew, setSendingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #667: a composer or review error shows beside the control that needs fixing, not in the page banner far above it.
  const [placedError, setPlacedError] = useState<{ at: "leadform" | "budget" | "ads" | "composer" | "review"; message: string } | null>(null);
  const placedErrorRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    // #772: field errors focus their control; the ads error focuses the first ad.
    const fieldId = placedError?.at === "leadform" || placedError?.at === "budget" ? placedError.at : placedError?.at === "ads" ? "campaign-ad-picker" : null;
    if (fieldId) {
      const target = document.getElementById(fieldId);
      const field = fieldId === "campaign-ad-picker" ? target?.querySelector<HTMLElement>("button") : target;
      field?.scrollIntoView?.({ block: "center" });
      field?.focus();
    } else if (placedError) placedErrorRef.current?.scrollIntoView?.({ block: "center" });
  }, [placedError]);
  function failAt(at: "leadform" | "budget" | "ads" | "composer" | "review", message: string) {
    setError(null);
    setPlacedError({ at, message });
  }
  // #723: a Review blocker's fix opens the composer and jumps to the first of its controls on screen.
  function jumpToFix(targets: string[]) {
    flushSync(() => setShowComposer(true));
    const target = targets.map((id) => document.getElementById(id)).find((element) => element !== null);
    const control = target?.matches("button, input, select, textarea") ? target : target?.querySelector<HTMLElement>("button, input, select, textarea");
    control?.scrollIntoView?.({ block: "center" });
    control?.focus();
  }
  function clearErrors() {
    setError(null);
    setPlacedError(null);
  }
  // #662: a card action's failure shows on that card, where the owner tapped (the page banner is off-screen on a phone).
  // #757: adsManager adds a direct link when AdBrain can't act for the owner (Meta refused its token).
  const [cardError, setCardError] = useState<{ id: string; message: string; adsManager?: boolean } | null>(null);
  // #671: a refresh always answers on the card, even when Meta's numbers didn't move.
  const [cardNotice, setCardNotice] = useState<{ id: string; message: string } | null>(null);
  const activationReviewRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [askConfirm, confirmDialog] = useConfirm();
  const { campaigns, setCampaigns, results, setResults, campaignQuery, setCampaignQuery, statusFilter, setStatusFilter,
    nextListCursor, listLoading, loadCampaignPage, replaceCampaignPage } = useCampaignList({
    ownerId: business.owner_id, businessId: business.id, initialCampaigns, initialResults, initialNextCursor, onError: setError,
  });
  const [showComposer, setShowComposer] = useState(initialSetup?.showComposer ?? (fromReview || initialCampaigns.length === 0));
  const [creationMode, setCreationMode] = useState(initialSetup?.creationMode ?? "manual");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const guidedModeRef = useRef<HTMLInputElement>(null);
  const focusOnOpenRef = useRef(false);
  useEffect(() => {
    if (showComposer && focusOnOpenRef.current) {
      (creationMode === "guided" ? guidedModeRef : nameInputRef).current?.focus();
      focusOnOpenRef.current = false;
    }
  }, [showComposer, creationMode]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectionIntent, setConnectionIntent] = useState<ConnectIntent>({ kind: "setup" });
  const [activationReview, setActivationReview] = useState<Campaign | null>(null);
  // #662: the review opens above the campaign list; each Resume brings it on screen (a phone shows only the tapped card).
  const [reviewOpens, setReviewOpens] = useState(0);
  useEffect(() => {
    if (reviewOpens) activationReviewRef.current?.scrollIntoView?.({ block: "start" });
  }, [reviewOpens]);
  const [reviewConnection, setReviewConnection] = useState<ConnectionDTO | null>(null);
  const [activationDigest, setActivationDigest] = useState<string | null>(null);
  const [activationDelivery, setActivationDelivery] = useState<CampaignDeliverySnapshot | null>(null);
  const [activationFunding, setActivationFunding] = useState<AccountFunding | null>(null);
  // #759: only an operator-funded business must set an account spending limit; an owner's own account needn't.
  const [spendLimitRequired, setSpendLimitRequired] = useState(true);
  const [capDays, setCapDays] = useState(3);
  const [activationLearning, setActivationLearning] = useState<{ costPerResultRupees: number | null; pausedAt: string | null; now: number } | null>(null);
  const deliveryChildren = (delivery: CampaignDeliverySnapshot) => [...delivery.adSets, ...delivery.ads];
  const activationCapped = !!activationDelivery && deliveryChildren(activationDelivery).every(child => child.status === "PAUSED");
  const activationReady = !!activationDelivery && (activationCapped || deliveryChildren(activationDelivery).every(child => child.status === "ACTIVE"));
  const activationCapPaise = Math.round((activationReview?.daily_budget ?? 0) * 100) * capDays;
  // #245/#759: a business funded on Meta runs only capped, within the account's spending limit when it has one.
  const activationFunded = !activationFunding
    || (activationCapped && (activationFunding.spendCapPaise > 0 ? activationFunding.roomPaise >= activationCapPaise : !spendLimitRequired));
  // #419 item 2: edits that restart Meta's learning (a capped run's new ad set, a long pause); never block.
  const learningWarnings = activationReview && activationLearning && activationDelivery
    ? activationWarnings({ capDays: activationCapped ? capDays : null, dailyBudgetRupees: activationReview.daily_budget ?? 0, ...activationLearning })
    : [];
  const [prepareReview, setPrepareReview] = useState<PrepareReviewState | null>(null);
  // Ads edited from the picker (#280); the server reads the saved copy at launch.
  const [editedAds, setEditedAds] = useState<Record<string, Creative>>({});
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [adEditNotes, setAdEditNotes] = useState<{ id: string; notes: CopyEditNotes } | null>(null);
  const [showAllAds, setShowAllAds] = useState(false);
  const [adDraft, setAdDraft] = useState<AdText | null>(null);
  const [adPicture, setAdPicture] = useState<PicturePreview | null>(null);
  const savedPickerAds = approved.map((c) => editedAds[c.id] ?? c);
  const editingAd = savedPickerAds.find((c) => c.id === editingAdId) ?? null;
  const adDraftUnsaved = editingAd !== null && ((adDraft !== null && !sameAdText(adDraft, savedAdText(editingAd))) || adPicture !== null);
  // While editing, the tile previews the unsaved headline (#387).
  const pickerAds = savedPickerAds.map((c) => (c.id === editingAdId && adDraft ? { ...c, headline: adDraft.headline } : c));
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
  const showDestinationLock = destinationRecoveryLocked && !sendingNew;
  const [savedDrafts, setSavedDrafts] = useState<DraftDTO[]>([]);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  useEffect(() => {
    onSetupChange([scope, { selected, budget, destination, whatsappNumber, whatsappLanguage, leadFormId, name, targeting, draftGoal, includedNames, excludedNames, abTest, creationMode, showComposer }]);
  }, [selected, budget, destination, whatsappNumber, whatsappLanguage, leadFormId, name, targeting, draftGoal, includedNames, excludedNames, abTest, creationMode, showComposer, scope, onSetupChange]);
  const visibleCampaigns = campaigns.filter(campaign =>
    (statusFilter === "all" || campaign.status === statusFilter) &&
    (campaign.name ?? business.name).toLocaleLowerCase().includes(campaignQuery.trim().toLocaleLowerCase()),
  );
  const totalDailyBudget = effectiveDailyBudget(budget, abTest ? 2 : 1);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const syncStorageKey = `campaign-sync:${scope}:${adAccountId}`;
  const syncCursorRef = useRef<string | null>(null);
  const syncSkippedRef = useRef<{ count: number; named: SkippedCampaign[] }>({ count: 0, named: [] });
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
        : "AdBrain decides from your business details";

  function restoreDraft(draft: DraftDTO) {
    const input = draft.input;
    setName(input.name);
    setSelected(new Set(input.creativeIds));
    setBudget(input.dailyBudgetRupees);
    setLeadFormId(input.leadFormId ?? "");
    setDestination(input.destination ?? "instant_form");
    // The form names numbers by their mask; a full number from an older draft shows as its mask.
    setWhatsAppNumber(!input.whatsappNumber || maskedWhatsAppNumberPattern.test(input.whatsappNumber) ? input.whatsappNumber ?? "" : maskWhatsAppNumber(input.whatsappNumber));
    setWhatsAppLanguage(input.whatsappLanguage ?? "ad");
    destinationChosenRef.current = true;
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
    setLeadFormId(current => keptLeadForm(current, forms));
  }

  useEffect(() => {
    if (!showComposer || !connectedForDraft || destination === "whatsapp") return;
    const freshness = formsFreshnessRef.current;
    if (freshness?.ownerId === business.owner_id && freshness.businessId === business.id &&
      freshness.retry === formsRetry && Date.now() - freshness.fetchedAt < LEAD_FORMS_FRESH_MS) return;
    formsFreshnessRef.current = null;
    const controller = new AbortController();
    startTransition(() => { setFormsLoading(true); setFormsError(null); });
    // #271: after a retry or reconnect, skip the server's ten-minute form cache.
    void fetchDraftForms(controller.signal, formsRetry > 0).then(forms => {
      if (controller.signal.aborted) return;
      formsFreshnessRef.current = { ownerId: business.owner_id, businessId: business.id, retry: formsRetry, fetchedAt: Date.now() };
      setAvailableForms(forms);
      setLeadFormId(current => keptLeadForm(current, forms));
    }).catch(() => {
      if (!controller.signal.aborted) setFormsError("Page forms are temporarily unavailable.");
    }).finally(() => {
      if (!controller.signal.aborted) setFormsLoading(false);
    });
    return () => controller.abort();
  }, [showComposer, connectedForDraft, business.id, business.owner_id, formsRetry, destination]);

  useEffect(() => {
    if (!showComposer || !connectedForDraft) return;
    const controller = new AbortController();
    void fetch(`/api/meta/whatsapp?businessId=${encodeURIComponent(business.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => parseWhatsAppStatus(response.ok ? await response.json() : null))
      .catch((): WhatsAppStatus => ({ state: "unavailable" }))
      .then((status) => {
        if (controller.signal.aborted) return;
        setWhatsAppStatus(status);
        if (status.state === "ready" && indiaBased && !destinationChosenRef.current) setDestination("whatsapp");
      });
    return () => controller.abort();
  }, [showComposer, connectedForDraft, business.id, indiaBased]);

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
    // A fresh campaign from Review starts clean unless a launch is still in flight; the old draft stays in Saved drafts.
    if (fromReview && !saved.request) return;
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
          if (found?.state === "succeeded") {
            // A finished launch is reported once; replaying it would reopen an already-sent draft.
            window.sessionStorage.removeItem(recoveryKey);
            recoveryRef.current = null;
            preparedDraftRef.current = null;
            operationRef.current = null;
            setRecoveryPending(false);
            setShowComposer(false);
            setNotice("Paused campaign created. Review it before activating spend.");
            return;
          }
          setOperation(found);
          setRecoveryPending(!found);
          setRetryAllowed(!found);
        }
        const draft = await client.draft(saved.draft.draftId, controller.signal);
        if (controller.signal.aborted) return;
        if (!hadInitialSetup || saved.request) restoreDraft(draft);
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
  }, [business.id, recoveryKey, hadInitialSetup, fromReview]);

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
    clearErrors();
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
    if (!(await askConfirm({ title: `Remove saved draft "${draft.input.name}"?`, confirmLabel: "Remove draft", tone: "danger" }))) return;
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
    focusOnOpenRef.current = true;
    setShowComposer(true);
  }

  async function startNewCampaign() {
    if (preparing || creating) return;
    // needs_reconciliation is terminal on the server; a new campaign uses a new request, so only in-flight work stays locked.
    const reconciling = operation?.state === "needs_reconciliation";
    if (unresolvedRecovery() && !reconciling) { setError("Resolve the current campaign operation before starting another campaign."); return; }
    if (!(await askConfirm(reconciling
      ? { title: "Start a new campaign?", description: "Meta only partly created the last campaign. Everything it made is paused, so nothing can spend. Sync brings it into Your campaigns if it has an ad set; an empty campaign shows only in Ads Manager, where you can delete it.", confirmLabel: "Start new campaign" }
      : { title: "Discard this setup?", description: "Start a new campaign instead. Saved drafts stay available.", confirmLabel: "Discard and start new", tone: "danger" }))) return;
    clearErrors();
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
    setDestination(indiaBased && whatsappOptions.length ? "whatsapp" : "instant_form");
    setWhatsAppNumber("");
    setWhatsAppLanguage("ad");
    destinationChosenRef.current = false;
    setShowComposer(true);
    if (creationMode === "guided") focusOnOpenRef.current = true;
    else nameInputRef.current?.focus();
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

  function switchDestination(value: "instant_form" | "whatsapp") {
    if (unresolvedRecovery()) { setError("Check the existing campaign operation before changing the destination."); return; }
    destinationChosenRef.current = true;
    flushSync(() => { setDestination(value); setPrepareReview(null); });
    jumpToFix([`destination-${value}`]);
  }

  function openConnect() {
    if (unresolvedRecovery()) { setError("Check the existing campaign operation before connecting again."); return; }
    setConnectionIntent({ kind: "setup" });
    setPrepareReview(null);
    setConnectOpen(true);
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

  async function syncFromMeta() {
    setSyncing(true);
    clearErrors();
    try {
      const cursor = syncCursorRef.current;
      const res = await fetch(`/api/campaigns/sync${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`, { method: "POST" });
      const data = (await res.json()) as {
        campaigns?: Campaign[];
        error?: string;
        nextCursor?: string | null;
        pageCursor?: string | null;
        skipped?: number;
        skippedCampaigns?: SkippedCampaign[];
      };
      if (res.ok && Array.isArray(data.campaigns)) {
        replaceCampaignPage(data.campaigns, data.pageCursor ?? null);
        const before = cursor ? syncSkippedRef.current : { count: 0, named: [] };
        syncSkippedRef.current = { count: before.count + (data.skipped ?? 0), named: [...before.named, ...(data.skippedCampaigns ?? [])] };
        syncCursorRef.current = data.nextCursor ?? null;
        if (!data.nextCursor) {
          const completedAt = new Date();
          setLastSynced(completedAt);
          saveCampaignSyncTime(syncStorageKey, completedAt.getTime());
        }
        const skippedNotice = syncSkippedRef.current.count
          ? ` ${describeSkippedCampaigns(syncSkippedRef.current.named, syncSkippedRef.current.count)}` : "";
        setNotice(`${data.nextCursor ? "More campaigns are available. Sync again to continue." : "Campaign sync completed."}${skippedNotice}`);
      } else {
        setError(data.error ?? "Couldn't sync from Meta. Your campaigns below are from the last sync; try Sync from Meta again.");
      }
    } catch {
      setError("Couldn't reach Meta. Check your connection, then try Sync from Meta again.");
    } finally {
      setSyncing(false);
    }
  }

  const syncStaleCampaigns = useEffectEvent(() => { void syncFromMeta(); });
  useEffect(() => {
    if (!metaReady) return;
    const completedAt = readCampaignSyncTime(syncStorageKey);
    const age = Date.now() - completedAt;
    if (completedAt > 0 && age >= 0 && age < CAMPAIGNS_FRESH_MS) return;
    const timer = window.setTimeout(syncStaleCampaigns, 0);
    return () => window.clearTimeout(timer);
  }, [metaReady, syncStorageKey]);

  function toggle(id: string) {
    if (!unresolvedRecovery()) setPrepareReview(null);
    if (placedError?.at === "ads") setPlacedError(null);
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
      ...(destination === "whatsapp" && chosenWhatsAppNumber ? { whatsappNumber: chosenWhatsAppNumber } : {}),
      ...(destination === "whatsapp" && whatsappLanguage !== "ad" ? { whatsappLanguage } : {}),
      targeting: targetingFromEditor(targeting, plannedAreas, plannedExclusions),
      abTest,
    };
  }

  // #366: plan the audience in the background once ads are chosen, so Prepare usually doesn't wait for the AI.
  const backgroundPlanRef = useRef<{ key: string; reply: Promise<PlanReply>; controller: AbortController } | null>(null);
  const backgroundPlansRef = useRef(0);
  function backgroundKeyFor(input: DraftInput): string {
    return audiencePlanKey({ ...input, goal: draftGoal });
  }
  const backgroundPlanKey = (() => {
    if (!showComposer || creationMode !== "manual" || selected.size === 0) return null;
    try {
      const planned = { goal: draftGoal, creativeIds: [...selected], targeting: targetingFromEditor(targeting, plannedAreas, plannedExclusions), destination };
      return needsAudiencePlan(planned) ? audiencePlanKey(planned) : null;
    } catch {
      return null;
    }
  })();
  const startBackgroundPlan = useEffectEvent(() => {
    if (isPreparing() || unresolvedRecovery() || backgroundPlansRef.current >= MAX_BACKGROUND_PLANS) return;
    let input: DraftInput;
    try {
      input = manualDraftInput(false);
    } catch {
      return;
    }
    const key = backgroundKeyFor(input);
    if (!needsAudiencePlan(input) || backgroundPlanRef.current?.key === key) return;
    backgroundPlansRef.current += 1;
    backgroundPlanRef.current?.controller.abort();
    const controller = new AbortController();
    const reply = fetchAudiencePlan(input, controller.signal);
    reply.catch(() => {});
    backgroundPlanRef.current = { key, reply, controller };
  });
  useEffect(() => {
    if (!backgroundPlanKey) return;
    const timer = window.setTimeout(startBackgroundPlan, BACKGROUND_PLAN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [backgroundPlanKey]);
  useEffect(() => () => backgroundPlanRef.current?.controller.abort(), []);

  /** The background reply for exactly this input, used once; null if there is none or it failed. */
  function takeBackgroundPlan(input: DraftInput, signal: AbortSignal): Promise<PlanReply | null> | null {
    const planned = backgroundPlanRef.current;
    if (!planned) return null;
    backgroundPlanRef.current = null;
    // A stale plan is stopped quietly; Prepare plans for itself.
    if (planned.key !== backgroundKeyFor(input)) {
      planned.controller.abort();
      return null;
    }
    return Promise.race([
      planned.reply.catch(() => null),
      new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true })),
    ]).then((reply) => (reply?.response.ok ? reply : null));
  }

  async function recommendAudience(input: DraftInput, signal: AbortSignal, reuseBackground = false): Promise<DraftInput> {
    setPreparationStage(signal, "Recommending audience...");
    const background = reuseBackground ? takeBackgroundPlan(input, signal) : null;
    const { response, data } = (background && await background) || await fetchAudiencePlan(input, signal);
    signal.throwIfAborted();
    if (!response.ok || !data.ready) throw new Error(data.error ?? data.handoff?.message ?? (data.questions?.map((question) => question.question).join(" ") || "Could not recommend an audience."));
    const recommended = { ...targetingInputSchema.parse(data.targeting), gender: input.targeting.gender ?? "all" as const };
    if (data.fallback && recommended.audience) setNotice(recommended.audience.rationale);
    else if (!recommended.audience?.interestNames.length) throw new Error("The detailed targeting recommendation is incomplete. Try again.");
    setTargeting(targetingToEditor(recommended));
    setIncludedNames((recommended.location?.includedNames ?? []).join("\n"));
    setExcludedNames((recommended.location?.excludedNames ?? []).join("\n"));
    setPrepareReview(null);
    return { ...input, targeting: recommended };
  }

  async function requestAudienceRecommendation(field?: "location" | "age") {
    if (unresolvedRecovery() || isPreparing()) return;
    clearErrors();
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
      if (!signal.aborted) failAt("composer", reason instanceof Error ? reason.message : "Could not recommend an audience.");
    } finally {
      finishPreparation(signal);
    }
  }

  async function prepareManualCampaign(reviewAfterSave = true) {
    if (isPreparing()) return;
    if (unresolvedRecovery()) {
      failAt("composer", "Check the existing campaign operation before preparing another campaign.");
      return;
    }
    clearErrors();
    setNotice(null);
    setPrepareReview(null);
    if (reviewAfterSave && selected.size === 0) {
      failAt("ads", "Choose at least one ad to send to Meta.");
      return;
    }
    if (reviewAfterSave && budget <= 0) {
      failAt("budget", "Set a daily budget above ₹0.");
      return;
    }
    let input: DraftInput;
    try {
      input = manualDraftInput(reviewAfterSave);
    } catch (reason) {
      failAt("composer", reason instanceof Error ? reason.message : "Complete the campaign details first.");
      return;
    }
    if (reviewAfterSave && connectedForDraft && input.destination !== "whatsapp" && !input.leadFormId) {
      failAt("leadform", "Choose a lead form before preparing campaign review.");
      return;
    }
    const signal = beginPreparation();
    const client = createMetaConnectClient();
    // #366: the connection check doesn't depend on the plan or the draft, so it runs alongside them.
    const connectionCheck = reviewAfterSave ? client.status(business.id, signal) : null;
    connectionCheck?.catch(() => {});
    try {
      if (reviewAfterSave && needsAudiencePlan(input)) {
        input = await recommendAudience(input, signal, true);
      }
      signal.throwIfAborted();
      setPreparationStage(signal, "Saving draft...");
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
      if (!reviewAfterSave || !connectionCheck) { setPrepareReview(null); setNotice("Campaign draft saved."); return; }
      setPreparationStage(signal, "Checking Meta connection...");
      const connection = await connectionCheck;
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
      if (!signal.aborted) failAt("composer", reason instanceof Error ? reason.message : "Could not save the campaign draft.");
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
      failAt("review", "Campaign creation is still processing. Check the operation status before taking another action.");
      return null;
    } catch (reason) {
      if (!controller.signal.aborted) {
        failAt("review", reason instanceof Error ? reason.message : "Campaign operation status is unavailable.");
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
      failAt("review", "Resolve the campaign review blockers before creating.");
      return;
    }
    if (!canStartCreate(operation)) return;
    clearErrors();
    setNotice(null);
    setCreating(true);
    setSendingNew(!recoveryRef.current?.request);
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
        failAt("review", "Campaign creation needs reconciliation. Do not retry the create operation.");
      } else if (next.state === "pending" || next.state === "running") {
        await pollOperation(next.operationId);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        failAt("review", reason instanceof Error ? reason.message : "Campaign creation could not be started.");
      }
    } finally {
      setCreating(false);
      setSendingNew(false);
    }
  }

  async function checkExistingOperation() {
    if (!operation && recoveryRef.current?.request) {
      setOperationChecking(true);
      try {
        const next = await createMetaConnectClient().operationForRequest(business.id, recoveryRef.current.request.idempotencyKey);
        if (next) acceptOperation(next);
        else { setRetryAllowed(true); setNotice("No operation is recorded yet. Retrying will reuse the original request."); }
      } catch (reason) { failAt("review", reason instanceof Error ? reason.message : "Operation status is unavailable."); }
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
    clearErrors();
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
    clearErrors();
    setCardError(null);
    setCardNotice(null);
    const previous = results[id];
    try {
      const res = await fetch(`/api/campaigns/${id}/refresh`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        result?: CampaignResult;
        summary?: string;
        review?: AdReview[] | null;
        error?: string;
        protectionConfirmed?: boolean;
        gone?: string;
        campaign?: Campaign | null;
      };
      if (res.status === 410 && data.gone) {
        if (data.campaign) setCampaigns((list) => list.map((item) => (item.id === id ? data.campaign! : item)));
        setCardNotice({ id, message: data.error ?? "This campaign is no longer in Meta." });
      } else if (res.ok) {
        if (data.result) setResults((p) => ({ ...p, [id]: data.result! }));
        setCardNotice({ id, message: refreshNotice(previous, data.result) });
        if (data.summary) setSummaries((p) => ({ ...p, [id]: data.summary! }));
        if (data.review) setReviews((p) => ({ ...p, [id]: data.review! }));
        if (data.protectionConfirmed === false) setCardError({ id, message: "Results refreshed, but spend protection could not be verified. Check campaign delivery in Meta." });
      } else {
        setCardError({ id, message: data.error ?? "Couldn't refresh results." });
      }
    } catch {
      setCardError({ id, message: "Couldn't refresh results — check your connection." });
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
  // #773: the paused campaign whose audience is being edited.
  const [audienceEdit, setAudienceEdit] = useState<Campaign | null>(null);
  const [budgetEdit, setBudgetEdit] = useState<{ campaign: Campaign; start: NonNullable<ReturnType<typeof budgetFormStart>> } | null>(null);
  const [adEdit, setAdEdit] = useState<Campaign | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, AdReview[]>>({});

  async function buildActivationDigest(campaign: Campaign, connection: ConnectionDTO, delivery: CampaignDeliverySnapshot, days?: number): Promise<string> {
    const payload = activationConfirmationPayload(campaign, connection, delivery, days);
    if (!crypto.subtle) throw new Error("Activation confirmation is unavailable in this browser.");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function openActivationReview(campaign: Campaign, connection: ConnectionDTO, refreshing = false) {
    try {
      const deliveryResponse = await fetch(`/api/campaigns/${campaign.id}`, { cache: "no-store" });
      const review = await deliveryResponse.json() as { delivery?: unknown; funding?: unknown; spendLimitRequired?: unknown; learning?: { costPerResultRupees?: unknown; pausedAt?: unknown }; error?: string };
      if (!deliveryResponse.ok) throw new Error(review.error ?? "Campaign delivery review is unavailable.");
      const delivery = campaignDeliverySnapshotSchema.parse(review.delivery);
      const funding = review.funding === undefined ? null : accountFundingSchema.parse(review.funding);
      // #208: a capped run needs only cap + GST; one day opens the dialog, PATCH enforces the chosen days.
      const capped = deliveryChildren(delivery).every(child => child.status === "PAUSED");
      if (!funding) {
        const response = await fetch(`/api/payments/customer-balance?businessId=${encodeURIComponent(campaign.business_id)}&campaignId=${encodeURIComponent(campaign.id)}${capped ? "&capDays=1" : ""}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Customer advertising funds must be reconciled before activation.");
      }
      const digest = await buildActivationDigest(campaign, connection, delivery);
      setReviewConnection(connection);
      setActivationDigest(digest);
      setActivationDelivery(delivery);
      setActivationFunding(funding);
      setSpendLimitRequired(review.spendLimitRequired !== false);
      setActivationLearning({
        costPerResultRupees: typeof review.learning?.costPerResultRupees === "number" ? review.learning.costPerResultRupees : null,
        pausedAt: typeof review.learning?.pausedAt === "string" ? review.learning.pausedAt : null,
        now: Date.now(),
      });
      setActivationReview(campaign);
      if (!refreshing) setReviewOpens((opens) => opens + 1);
      setConnectOpen(false);
    } catch (reason) {
      setActivationDigest(null);
      setActivationDelivery(null);
      setActivationFunding(null);
      setActivationLearning(null);
      setActivationReview(null);
      const message = reason instanceof Error ? reason.message : "Activation review is unavailable.";
      // Resume was tapped on the card; Refresh review on the panel at the top, next to the page banner.
      if (refreshing) setError(message);
      else setCardError({ id: campaign.id, message });
    }
  }

  async function setCampaignStatus(c: Campaign, next: "active" | "paused", confirmed = false) {
    setCardError(null);
    if (next === "active" && !confirmed) {
      setConnectionIntent({ kind: "review_activation", campaignId: c.id });
      setConnectOpen(true);
      return;
    }
    if (next === "active" && (!activationDigest || !reviewConnection || !activationDelivery || !activationReady)) {
      setError("Review the current connection before activating this campaign.");
      return;
    }
    const reviewedDays = next === "active" && activationCapped ? capDays : undefined;
    const reviewedDigest = reviewedDays ? await buildActivationDigest(c, reviewConnection!, activationDelivery!, reviewedDays) : activationDigest;
    const reviewedConnection = reviewConnection;
    // Activation is confirmed from the review panel at the top; a pause is tapped on the card.
    const fail = (message: string, adsManager = false) => confirmed ? setError(message) : setCardError({ id: c.id, message, adsManager });
    setStatusChangingId(c.id);
    clearErrors();
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next === "active"
          ? buildActivationPatch(reviewedDigest!, reviewedConnection!.generation, reviewedDays)
          : { status: "paused" }),
      });
      if (res.ok) {
        setCampaigns((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, status: next } : x)),
        );
        setNotice(next === "active"
          ? reviewedDays
            ? `Activated with a ${formatMoney((c.daily_budget ?? 0) * reviewedDays)} total limit on Meta for ${reviewedDays} ${reviewedDays === 1 ? "day" : "days"}. Meta reviews the ads before they deliver.`
            : "Activation requested. Check Meta for effective delivery and eligibility."
          : "Campaign paused.");
        if (next === "active") {
          setActivationReview(null);
          setActivationDigest(null);
          setActivationDelivery(null);
          setReviewConnection(null);
        }
      } else {
        const data = (await res.json()) as { error?: string; code?: string };
        fail(data.error ?? "Couldn't update the campaign.", data.code === "META_REAUTH" && Boolean(c.meta_campaign_id));
      }
    } catch {
      fail("Couldn't update the campaign — check your connection.");
    } finally {
      setStatusChangingId(null);
    }
  }

  async function deleteCampaign(c: Campaign) {
    if (!(await askConfirm({ title: `Delete "${c.name ?? "this campaign"}"?`, description: "This removes it from Meta and can't be undone.", confirmLabel: "Delete campaign", tone: "danger" }))) {
      return;
    }
    setDeletingId(c.id);
    clearErrors();
    setCardError(null);
    try {
      const res = await fetch(`/api/campaigns/${c.id}`, { method: "DELETE" });
      if (res.ok) {
        setCampaigns((prev) => prev.filter((x) => x.id !== c.id));
      } else {
        const data = (await res.json()) as { error?: string };
        setCardError({ id: c.id, message: data.error ?? "Couldn't delete the campaign." });
      }
    } catch {
      setCardError({ id: c.id, message: "Couldn't delete the campaign — check your connection." });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      {confirmDialog}
        <p className="text-sm text-slate-500">{campaigns.filter(campaign => campaign.status === "active").length} {OWNER_WORDS.running.toLowerCase()} <span className="mx-2 text-slate-300">/</span> {campaigns.filter(campaign => campaign.status === "paused").length} paused</p>
        <div className="flex flex-wrap items-center gap-2">
          {showComposer && <Button variant="ghost" onClick={startNewCampaign}><Trash2 className="h-4 w-4" aria-hidden="true" />Discard and start new</Button>}
          <Button variant={showComposer ? "outline" : "primary"} onClick={toggleComposer} aria-expanded={showComposer} aria-controls="campaign-composer">{showComposer ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}{showComposer ? "Close campaign setup" : "New campaign"}</Button>
        </div>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {placedError?.at === "review" && !prepareReview && <Alert variant="error">{placedError.message}</Alert>}
      {/* #847: sync and save news is a quiet line, as on Enquiries, not a green box on every visit. */}
      <p aria-live="polite" className={notice ? "text-sm text-slate-600" : "sr-only"}>{notice}</p>
      {!connectedForDraft && (
        <div className="space-y-3">
          <Alert variant="warning">
            Meta isn’t connected yet. Connect an existing business to continue, or keep this campaign as a draft.
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openConnect}>
              <Link2 className="h-4 w-4" aria-hidden="true" /> Connect Business
            </Button>
            <Link href="/settings" className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Open Settings
            </Link>
          </div>
        </div>
      )}
      {activationReview && (
        <div ref={activationReviewRef} className="scroll-mt-4">
        <Alert variant="warning">
          <span className="block">
            Review {activationReview.name ?? "this campaign"} before it can run. {activationCapped
              ? "AdBrain will copy these ads into a new ad set with a fixed total budget and end date, then turn on only that ad set, its ads and the campaign."
              : "AdBrain will request only the parent campaign to become active; it will not change any ad sets or ads."}
          </span>
          {reviewConnection?.selected && (
            <span className="mt-2 block text-sm font-normal text-amber-900">
              Account: {reviewConnection.selected.accountName} ({reviewConnection.selected.adAccountId}) · Page: {reviewConnection.selected.pageName} · Currency: {reviewConnection.selected.currency} · Timezone: {reviewConnection.selected.timezoneName}
              <br />
              Effective daily total: {activationReview.daily_budget == null ? "Unavailable" : formatMoney(activationReview.daily_budget)}
            </span>
          )}
          {activationDelivery && <div className="mt-3 text-sm font-normal text-amber-900">
            <p>Parent: {activationDelivery.campaign.id} · Requested {activationDelivery.campaign.status} · Effective {activationDelivery.campaign.effectiveStatus ?? "unconfirmed"}</p>
            <ul className="mt-2 list-inside list-disc">
              {activationDelivery.adSets.map(adSet => <li key={adSet.id}>
                Ad set {adSet.id}: {adSet.dailyBudgetPaise ? formatPerDay(adSet.dailyBudgetPaise / 100) : "campaign-level budget"}, destination {adSet.destinationType ?? "not reported"}, requested {adSet.status}, effective {adSet.effectiveStatus ?? "unconfirmed"}
                <pre className="ml-4 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">Targeting: {JSON.stringify(adSet.targeting)}</pre>
              </li>)}
              {activationDelivery.ads.map(ad => <li key={ad.id}>Ad {ad.id} (set {ad.adSetId}, creative {ad.creativeId}): requested {ad.status}, effective {ad.effectiveStatus ?? "unconfirmed"}</li>)}
            </ul>
            {activationCapped
              ? <div className="mt-2">
                <label htmlFor="cap-days" className="font-medium">Run for </label>
                <select id="cap-days" value={capDays} onChange={event => setCapDays(Number(event.target.value))} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm">
                  {[1, 2, 3, 4, 5, 6, 7].map(days => <option key={days} value={days}>{days} {days === 1 ? "day" : "days"}</option>)}
                </select>
                <p className="mt-1 font-medium">Total limit on Meta: {formatMoney((activationReview.daily_budget ?? 0) * capDays)} over {capDays} {capDays === 1 ? "day" : "days"}. Meta stops delivery at that amount or the end date, whichever comes first.</p>
                {activationFunding && <p className="mt-1 font-medium">
                  {activationFunding.spendCapPaise > 0
                    ? `Funded on Meta: ${exactRupees.format(activationFunding.roomPaise / 100)} room for a ${exactRupees.format(activationCapPaise / 100)} cap.${activationFunded ? "" : " Add funds on Meta or choose fewer days."}`
                    : spendLimitRequired
                      ? "Funded on Meta: set a spending limit on the Meta ad account first."
                      : "Funded on your Meta ad account: no spending limit set; Meta stops at the total limit above."}
                </p>}
                <p className="mt-1">The ad sets and ads listed above stay paused. Meta reviews the copied ads before they deliver.</p>
              </div>
              : activationFunding
                ? <p className="mt-2">This business is funded on Meta, so it runs only with a total limit. Pause the ad sets and ads listed above in Meta, then refresh this review.</p>
                : activationReady
                  ? <p className="mt-2">These ads are set to run. Meta still decides whether and when they deliver.</p>
                  : <p className="mt-2">Some listed children are on and some are paused. Pause all of them in Meta for a capped run, or turn on all of them, then refresh this review.</p>}
            {learningWarnings.length ? (
              <ul className="mt-2 space-y-1" aria-label="Before you activate">
                {learningWarnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-1.5">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <a href={adsLink(activationReview)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium underline">Open campaign in Meta</a>
            <Button variant="ghost" size="sm" onClick={() => void openActivationReview(activationReview, reviewConnection!, true)}>Refresh review</Button>
          </div>}
          <Button
            size="sm"
            className="ml-3"
            disabled={!activationDigest || !activationReady || !activationFunded
              || statusChangingId === activationReview.id}
            onClick={() => void setCampaignStatus(activationReview, "active", true)}
            data-product-event="campaign.activate"
          >
            {statusChangingId === activationReview.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {activationCapped ? "Approve total and activate" : "Request activation"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setActivationReview(null)}>Cancel</Button>
        </Alert>
        </div>
      )}
      {recoveryPending && !operation && !sendingNew && (
        <Alert variant="warning">
          The previous campaign request has not been confirmed.
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void checkExistingOperation()} disabled={operationChecking || creating}>
              <RefreshCw className="h-4 w-4" />Check status
            </Button>
            {retryAllowed && prepareReview?.status === "ready" && (
              <Button size="sm" data-product-event="campaign.create" onClick={() => void createPreparedCampaign()} disabled={creating}>
                <RefreshCw className="h-4 w-4" />Retry original request
              </Button>
            )}
          </div>
        </Alert>
      )}
      {prepareReview && (
        <section ref={reviewPanelRef} tabIndex={-1} aria-label="Campaign review result" className="scroll-mt-24 outline-none">
        {/* #637: preflight answers 200 with blockers, so a blocked review must not read as success. */}
        <Alert variant={prepareReview.status === "ready" ? (prepareReview.review.canCreatePaused ? "success" : "warning") : prepareReview.status === "blocked" ? "error" : "warning"}>
          {prepareReview.status === "checking" && "Checking the saved campaign draft before review."}
          {prepareReview.status === "blocked" && (
            <>
              {prepareReview.message} No campaign create or activation request was sent.
            </>
          )}
          {prepareReview.status === "ready" && (
            <>
              <span className="block font-medium">
                {prepareReview.review.canCreatePaused ? "Campaign review"
                  : prepareReview.review.blockers.length ? `Fix ${prepareReview.review.blockers.length} ${prepareReview.review.blockers.length === 1 ? "item" : "items"} before sending to Meta`
                  : "This campaign can't be sent to Meta yet"}
              </span>
              {prepareReview.review.blockers.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm font-normal">
                  {prepareReview.review.blockers.map((blocker) => {
                    const fixes = [
                      reviewBlockerFix(blocker.reason) ?? (blocker.action?.kind === "open_brand" ? { kind: "page", label: "Open your business details", href: "/brand" } as const : null),
                      reviewBlockerAlternative(blocker.reason),
                    ].filter((fix) => fix !== null);
                    return <li key={`${blocker.code}:${blocker.message}`} className="mt-1 first:mt-0">
                      {blocker.message}
                      {fixes.length > 0 && <span className="mt-1 flex flex-wrap items-center gap-x-3">
                        {fixes.map((fix) => fix.kind === "page"
                          ? <Link key={fix.label} href={fix.href} className="inline-flex min-h-10 items-center font-medium underline underline-offset-4">{fix.label}</Link>
                          : <button key={fix.label} type="button" onClick={() => fix.kind === "connect" ? openConnect() : fix.kind === "destination" ? switchDestination(fix.destination) : jumpToFix(fix.targets)} className="inline-flex min-h-10 items-center text-left font-medium underline underline-offset-4">{fix.label}</button>)}
                      </span>}
                    </li>;
                  })}
                </ul>
              )}
              {!prepareReview.review.canCreatePaused && (
                <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal">
                  Send to Meta (paused) appears once this is fixed.
                  <Button size="sm" variant="outline" onClick={() => void prepareManualCampaign()} disabled={preparing || creating} aria-disabled={selected.size === 0 || budget <= 0 || undefined}>
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />Check again
                  </Button>
                </span>
              )}
              <span className="mt-2 block text-sm font-normal">
                Account: {prepareReview.review.selected?.accountName ?? prepareReview.connection.selected?.accountName ?? "Unavailable"} · Page: {prepareReview.review.selected?.pageName ?? prepareReview.connection.selected?.pageName ?? "Unavailable"} · Currency: {prepareReview.review.currency}
                <br />
                Destination: {prepareReview.draft.input.destination === "whatsapp" ? `WhatsApp chat ${prepareReview.review.whatsappNumber ?? "(number not verified)"}` : "Instant lead form"}
                <br />
                {/* #906: WhatsApp ads leave Audience Network out. */}
                {prepareReview.draft.input.destination === "whatsapp" && <>Shown on Facebook, Instagram and Messenger<br /></>}
                Geography: {prepareReview.review.resolvedAreaLabel ?? "Needs review"} · Per ad set: {formatMoney(prepareReview.review.perAdSetDailyBudgetRupees)} · Effective daily total: {formatMoney(prepareReview.review.totalDailyBudgetRupees)}
                <br />
                {prepareReview.review.serviceArea && <>{serviceAreaLine(prepareReview.review.serviceArea)}<br /></>}
                Ages: {prepareReview.draft.input.targeting.age?.min ?? "Unset"}-{prepareReview.draft.input.targeting.age?.max === 65 ? "65+" : prepareReview.draft.input.targeting.age?.max ?? "Unset"} · Gender: {{ all: "All genders", men: "Men", women: "Women" }[prepareReview.draft.input.targeting.gender ?? "all"]} · City coverage: {prepareReview.draft.input.targeting.location?.cityScope === "city_only" ? "City only (no added radius)" : `${prepareReview.draft.input.targeting.location?.radiusKm ?? 25} km radius`}
                <br />
                Interests: {prepareReview.review.audienceInterests?.map((interest) => interest.name).join(", ") || (prepareReview.draft.input.targeting.audience?.interestNames.length ? "Needs resolution" : "No interest narrowing")}
                <br />
                Location includes residents and recent visitors. Interest signals may expand under Meta lead optimization.
              </span>
              {/* #419 2(b): Meta's new-advertiser guidance, as plain notes; never blocks the send. */}
              {prepareReview.review.planWarnings?.length ? (
                <ul className="mt-2 space-y-1 text-sm font-normal" aria-label="Before you send">
                  {prepareReview.review.planWarnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-1.5">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {prepareReview.review.canCreatePaused && prepareReview.review.planHash && !operation && (!recoveryPending || sendingNew) && (
                  <Button size="sm" data-product-event="campaign.create" onClick={() => void createPreparedCampaign()} disabled={creating}>
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    {creating ? "Sending to Meta…" : "Send to Meta (paused)"}
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
                {operation?.state === "needs_reconciliation" && (
                  <>
                    <span className="text-sm font-normal">Meta only partly created this campaign. Do not retry it. Everything it made is paused, so nothing can spend. Sync brings it in if it has an ad set; an empty campaign shows only in Ads Manager.</span>
                    <Button size="sm" variant="outline" onClick={startNewCampaign}>Start a new campaign</Button>
                  </>
                )}
              </div>
            </>
          )}
        </Alert>
        {placedError?.at === "review" && <p ref={placedErrorRef} role="alert" className="mt-2 scroll-mt-24 text-sm font-medium text-red-800">{placedError.message}</p>}
        <p className="mt-2"><HelpOnWhatsApp label="Stuck? Help on WhatsApp" /></p>
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
              <span className="mt-0.5 block text-xs font-normal text-slate-500">{formatMoney(draft.input.dailyBudgetRupees)} per ad set</span>
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
              ["Ads", approved.length ? `${approved.length} approved` : "Needs approval", Boolean(approved.length)],
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
          {!connectedForDraft && <p className="-mt-1 mb-2"><HelpOnWhatsApp label="Stuck connecting Meta? Help on WhatsApp" /></p>}
          <fieldset disabled={preparing || creating} className="my-5 flex flex-wrap gap-2">
            <legend className="mb-2 text-xs font-medium text-slate-500">Campaign setup</legend>
            {[["manual", "Choose settings"], ["guided", "Plan with AdBrain"]].map(([value, label]) => <label key={value} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", creationMode === value ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200")}><input ref={value === "guided" ? guidedModeRef : undefined} type="radio" name="creation-mode" value={value} checked={creationMode === value} onChange={() => setCreationMode(value)} className="accent-blue-600" />{label}</label>)}
          </fieldset>
          <fieldset disabled={preparing || creating || destinationRecoveryLocked} aria-describedby={showDestinationLock ? "destination-lock-reason" : undefined} className="mb-4 flex flex-wrap gap-2">
            <legend className="mb-2 text-xs font-medium text-slate-500">Destination</legend>
            {([ ["instant_form", "Instant form"], ["whatsapp", "WhatsApp chat"] ] as const).map(([value, label]) => <label key={value} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", destination === value ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200")}><input id={`destination-${value}`} type="radio" name="campaign-destination" value={value} checked={destination === value} onChange={() => { if (!unresolvedRecovery()) { destinationChosenRef.current = true; setDestination(value); setPrepareReview(null); } }} className="accent-blue-600" />{label}</label>)}
          </fieldset>
          {showDestinationLock && <p id="destination-lock-reason" role="status" className="mb-4 text-sm text-amber-800">Destination is locked until the previous campaign request is resolved.</p>}
          {showComposer && destination === "whatsapp" && <div className="mb-4"><WhatsAppReadyChecklist businessId={business.id} /></div>}
          {showComposer && creationMode === "guided" && <CampaignChat
            businessId={business.id}
            destination={destination}
            whatsappNumber={destination === "whatsapp" && chosenWhatsAppNumber ? chosenWhatsAppNumber : undefined}
            onStarted={() => { destinationChosenRef.current = true; }}
            onDraftReady={(draft) => void handleGuidedDraft(draft)}
            onEditManually={(goal) => {
              if (unresolvedRecovery()) return;
              setDraftGoal(goal);
              setCreationMode("manual");
              setPrepareReview(null);
            }}
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
                  <Label>Choose ads</Label>
                  {/* #724: above the grid, so it shows where focus lands on the first ad. */}
                  {placedError?.at === "ads" && <p id="ads-error" role="alert" className="mt-1 text-sm font-medium text-red-800">{placedError.message}</p>}
                  <div id="campaign-ad-picker" className="mt-2 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4">
                    {pickerAds.map((c, index) => {
                      const isSel = selected.has(c.id);
                      return (
                        // #305: on a phone, ads after the first two rows wait behind "Show all" unless selected.
                        <div key={c.id} className={cn("flex min-w-0 flex-col gap-1.5", !showAllAds && index >= PHONE_PICKER_ADS && !isSel && "max-sm:hidden")}>
                        <button
                          type="button"
                          onClick={() => toggle(c.id)}
                          aria-pressed={isSel}
                          aria-describedby={placedError?.at === "ads" ? "ads-error" : undefined}
                          aria-label={c.headline || "Select ad"}
                          className={cn(
                            "group relative min-w-0 overflow-hidden rounded-md border-2 text-left transition-colors",
                            isSel
                              ? "border-slate-950 shadow-[0_8px_18px_rgba(15,23,42,0.12)]"
                              : "border-slate-200 hover:border-slate-300",
                          )}
                        >
                          <div className="relative aspect-square bg-slate-100">
                            {c.id === editingAdId && adPicture && (
                              <div className="absolute inset-0 z-[1] bg-slate-100">
                                <LivePicture preview={adPicture} />
                              </div>
                            )}
                            {c.image_url && (
                              <img
                                src={creativeThumbnailUrl(c.image_url)}
                                alt={c.headline || "Ad preview"}
                                className="h-full w-full object-contain"
                                loading="lazy"
                                onError={(event) => {
                                  if (c.image_url && event.currentTarget.src !== c.image_url) event.currentTarget.src = c.image_url;
                                }}
                              />
                            )}
                          </div>
                          {isSel && (
                            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-white">
                              <CheckCircle2 className="h-4 w-4" />
                            </span>
                          )}
                          <p className="truncate px-2 py-1.5 text-xs font-medium text-slate-700 max-sm:hidden">
                            {c.headline}
                          </p>
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${c.headline || "ad"}`}
                          aria-expanded={editingAdId === c.id}
                          onClick={() => {
                            setAdEditNotes(null);
                            setEditingAdId(c.id);
                          }}
                          className="h-8 w-full sm:h-9"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        </div>
                      );
                    })}
                  </div>
                  {!showAllAds && pickerAds.length > PHONE_PICKER_ADS && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowAllAds(true)} className="mt-2 w-full sm:hidden">
                      Show all {pickerAds.length} ads
                    </Button>
                  )}
                  {editingAd && (
                    <section aria-label="Edit ad" className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-1 truncate text-sm font-medium text-slate-800">Editing: {adDraft?.headline ?? editingAd.headline}</p>
                      {adDraftUnsaved && <div className="mb-2"><UnsavedPreviewBadge /></div>}
                      <CreativeEditor
                        key={editingAd.id}
                        creative={editingAd}
                        brand={business}
                        onDraft={setAdDraft}
                        onPicturePreview={setAdPicture}
                        onCancel={() => setEditingAdId(null)}
                        onSaved={(next, notes) => {
                          setEditedAds((current) => ({ ...current, [next.id]: next }));
                          setAdEditNotes({ id: next.id, notes });
                          setEditingAdId(null);
                          // A review prepared before the edit would show the old words.
                          if (!unresolvedRecovery()) setPrepareReview(null);
                        }}
                      />
                    </section>
                  )}
                  {adEditNotes && !editingAd && (
                    <div className="mt-3">
                      <p className="mb-1 truncate text-xs font-medium text-slate-700">
                        {pickerAds.find((c) => c.id === adEditNotes.id)?.headline}
                      </p>
                      <CopyEditNotice notes={adEditNotes.notes} />
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="name">Campaign name</Label>
                    <Input
                      id="name"
                      ref={nameInputRef}
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
                      onChange={(e) => { setBudget(Number(e.target.value)); if (placedError?.at === "budget") setPlacedError(null); }}
                      aria-invalid={placedError?.at === "budget" || undefined}
                      aria-describedby={placedError?.at === "budget" ? "budget-error" : undefined}
                    />
                    {placedError?.at === "budget" && <p id="budget-error" role="alert" className="text-sm font-medium text-red-800">{placedError.message}</p>}
                  </div>
                  {destination === "instant_form" && <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="leadform">Lead form</Label>
                    <select
                      id="leadform"
                      value={leadFormId}
                      onChange={(e) => { setLeadFormId(e.target.value); if (placedError?.at === "leadform") setPlacedError(null); }}
                      aria-invalid={placedError?.at === "leadform" || undefined}
                      aria-describedby={placedError?.at === "leadform" ? "leadform-error" : undefined}
                      className="h-10 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none"
                    >
                      <option value="">{connectedForDraft ? "Choose a lead form" : "Connect Meta to choose a form"}</option>
                      {availableForms.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    {placedError?.at === "leadform" && <p id="leadform-error" role="alert" className="text-sm font-medium text-red-800">{placedError.message}</p>}
                  </div>}
                  {destination === "whatsapp" && <div className="flex min-w-0 flex-col gap-1.5">
                    {whatsappOptions.length ? <>
                      <Label htmlFor="whatsapp-number">WhatsApp button number</Label>
                      <select
                        id="whatsapp-number"
                        value={chosenWhatsAppNumber}
                        onChange={(e) => setWhatsAppNumber(e.target.value)}
                        className="h-10 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                      >
                        {whatsappOptions.map(({ masked, source }) => (
                          <option key={masked} value={masked}>
                            {masked} ({source === "page" ? "linked to your Page" : "your WhatsApp Business account"})
                          </option>
                        ))}
                      </select>
                    </> : <p role="status" className="text-sm text-slate-600">
                      {whatsappStatus?.state === "not_linked"
                        ? <>No WhatsApp number is linked yet. <Link href="/brand" className="font-medium text-blue-700 underline">Your business</Link> shows how to link one.</>
                        : connectedForDraft && !whatsappStatus ? "Checking your WhatsApp numbers..." : "AdBrain checks your WhatsApp number when you prepare the review."}
                    </p>}
                  </div>}
                  {destination === "whatsapp" && <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="whatsapp-language">Message language</Label>
                    <select
                      id="whatsapp-language"
                      value={whatsappLanguage}
                      onChange={(e) => { setWhatsAppLanguage(e.target.value as WhatsAppLanguage); if (!unresolvedRecovery()) setPrepareReview(null); }}
                      className="h-11 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="ad">Same as the ad</option>
                      <option value="en">English</option>
                      <option value="hi">Hindi (हिंदी)</option>
                      <option value="hinglish">Hinglish</option>
                      <option value="pa">Punjabi (ਪੰਜਾਬੀ)</option>
                    </select>
                    <p className="text-xs text-slate-500">The short message a customer sends you in one tap.</p>
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
                      {formatPerDay(amount)}
                    </button>
                  ))}
                  <span className="ml-auto text-xs font-medium text-slate-600">
                    Total: {formatPerDay(totalDailyBudget)}{abTest ? " across 2 ad sets" : ""}
                  </span>
                </div>
                {/* #761: what to expect, from AdBrain's own runs (#588 ledger). */}
                <p className="-mt-2 text-xs text-slate-500">
                  What to expect: in AdBrain&apos;s runs so far, a WhatsApp chat has cost about ₹150–180. Meta reviews new ads first, usually within 24 hours, and nothing spends until you activate.
                </p>

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
                  <Label className="mt-4">Audience &amp; location</Label>
                  <TargetingControls
                    value={targeting}
                    onDecide={(field) => void requestAudienceRecommendation(field)}
                    onChange={(value) => { setTargeting(value.radiusKm !== targeting.radiusKm ? { ...value, locationMode: "manual" } : value); if (!unresolvedRecovery()) setPrepareReview(null); }}
                    brandAreas={business.locations ?? []}
                    plannedAreas={plannedAreas}
                    plannedExclusions={plannedExclusions}
                    areaFields={<>
                      <div><Label htmlFor="planned-areas">Planned areas</Label><Textarea id="planned-areas" rows={2} placeholder="One place per line" value={includedNames} onChange={(event) => { setIncludedNames(event.target.value); setPrepareReview(null); }} className="mt-1 rounded-md p-2" /></div>
                      <div><Label htmlFor="planned-exclusions">Excluded areas</Label><Textarea id="planned-exclusions" rows={2} placeholder="One place per line" value={excludedNames} onChange={(event) => { setExcludedNames(event.target.value); setPrepareReview(null); }} className="mt-1 rounded-md p-2" /></div>
                    </>}
                  />
                  <Button id="recommend-audience" variant="outline" onClick={() => void requestAudienceRecommendation()} disabled={preparing || selected.size === 0 || budget <= 0}>
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
                      Two ad sets, each with the entered daily budget. Total daily budget: {formatMoney(totalDailyBudget)}.
                    </span>
                  </span>
                </label>

                <div className="border-t border-slate-200 pt-5">
                  <CampaignLaunchReview
                    selectedCount={selected.size}
                    budget={totalDailyBudget}
                    leadFormName={selectedLeadForm?.name}
                    destination={destination}
                    whatsappNumber={destination === "whatsapp" && chosenWhatsAppNumber ? chosenWhatsAppNumber : undefined}
                    audience={`${audiencePreview}; ${targeting.ageMode === "manual" ? `ages ${targeting.ageMin}-${targeting.ageMax === 65 ? "65+" : targeting.ageMax}` : "ages picked by AdBrain when you check"}; ${{ all: "All genders", men: "Men", women: "Women" }[targeting.gender ?? "all"]}; ${targeting.cityScope === "city_only" ? "city only (no added radius)" : `city radius ${targeting.radiusKm} km`}${targeting.audience?.interestNames.length ? `; interests: ${targeting.audience.interestNames.join(", ")}` : ""}`}
                  />
                </div>

                {placedError?.at === "composer" && <p ref={placedErrorRef} role="alert" className="scroll-mt-24 text-sm font-medium text-red-800">{placedError.message}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={() => void prepareManualCampaign(false)} disabled={preparing || creating}>
                    <Save className="h-4 w-4" aria-hidden="true" /> Save draft
                  </Button>
                  {/* #772: incomplete stays tappable (aria-disabled, so telemetry skips it) and says what's missing beside the control. */}
                  <Button data-product-event="campaign.review" onClick={() => void prepareManualCampaign()} disabled={preparing} aria-disabled={selected.size === 0 || budget <= 0 || undefined}>
                    {preparing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Check my campaign (nothing spends)
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
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
                >
                  <FileText className="h-4 w-4" /> Export report
                </a>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncFromMeta()}
                data-product-event="campaign.sync"
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
        {(() => {
          const ready = !(showComposer && destination === "whatsapp") && campaigns.some((c) => campaignDestination(c, results[c.id]) === "whatsapp");
          // #794: once a WhatsApp campaign is out, point to WhatsApp's own AI reply; #847: as a line under "WhatsApp ready?".
          const ai = campaigns.some(campaign => campaign.meta_campaign_id && campaignDestination(campaign) === "whatsapp");
          return (ready || ai) && <div className="mb-4">{ready && <WhatsAppReadyChecklist businessId={business.id} />}{ai && <WhatsAppAiCard businessId={business.id} />}</div>;
        })()}
        {(campaigns.length > 0 || campaignQuery || statusFilter !== "all") && <div className="mb-5 flex flex-wrap gap-2">
          <div className="flex min-w-0 flex-1 basis-40 items-center gap-2 rounded-md border border-slate-300 px-3"><Search size={16} className="shrink-0 text-slate-400" aria-hidden="true" /><input type="search" aria-label="Search campaigns" placeholder="Search campaigns" value={campaignQuery} onChange={event => setCampaignQuery(event.target.value)} className="h-10 w-full min-w-0 bg-transparent text-sm outline-none" /></div>
          <select aria-label="Campaign status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="all">All statuses</option><option value="active">{OWNER_WORDS.running}</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="completed">Completed</option></select>
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
            {/* #847: said once for the list, not on every row. */}
            {(() => { const waiting = visibleCampaigns.filter((item) => !results[item.id]).length; return waiting ? <p className="pt-3 text-sm text-slate-500">No results yet for {waiting === visibleCampaigns.length ? (waiting === 1 ? "this campaign" : "these campaigns") : `${waiting} of these campaigns`}. Refresh a campaign to get Meta&apos;s latest numbers.</p> : null; })()}
            {audienceEdit && (
              <EditAudienceDialog
                campaignId={audienceEdit.id}
                campaignName={audienceEdit.name ?? `${business.name} — ${audienceEdit.objective}`}
                onClose={() => setAudienceEdit(null)}
                onSaved={(message) => { setCardNotice({ id: audienceEdit.id, message }); setAudienceEdit(null); }}
              />
            )}
            {budgetEdit && (
              <EditBudgetDialog
                campaignId={budgetEdit.campaign.id}
                campaignName={budgetEdit.campaign.name ?? `${business.name} — ${budgetEdit.campaign.objective}`}
                start={budgetEdit.start}
                onClose={() => setBudgetEdit(null)}
                onSaved={(message, after) => {
                  const id = budgetEdit.campaign.id;
                  setCampaigns((list) => list.map((item) => (item.id === id ? applyBudget(item, after) : item)));
                  setCardNotice({ id, message });
                  setBudgetEdit(null);
                }}
              />
            )}
            {adEdit && (
              <EditAdDialog
                campaign={adEdit}
                campaignName={adEdit.name ?? `${business.name} — ${adEdit.objective}`}
                creatives={approved}
                onClose={() => setAdEdit(null)}
                onSaved={(message, { adId, change }) => {
                  // Mirror the server's raw.adWords, so reopening the editor shows the new words.
                  setCampaigns((list) => list.map((item) => {
                    if (item.id !== adEdit.id) return item;
                    const raw = (item.raw && typeof item.raw === "object" && !Array.isArray(item.raw) ? item.raw : {}) as Record<string, Json>;
                    const words = (raw.adWords && typeof raw.adWords === "object" && !Array.isArray(raw.adWords) ? raw.adWords : {}) as Record<string, Json>;
                    const previous = (words[adId] && typeof words[adId] === "object" ? words[adId] : {}) as Record<string, Json>;
                    return { ...item, raw: { ...raw, adWords: { ...words, [adId]: { ...previous, ...change } } } };
                  }));
                  setCardNotice({ id: adEdit.id, message });
                  setAdEdit(null);
                }}
              />
            )}
            {visibleCampaigns.map((c) => {
              const r = results[c.id];
              const outcome = campaignDestination(c, r);
              const attention = campaignAttention(c);
              // #662: only a campaign AdBrain launched can be reviewed and resumed here.
              const resumeElsewhere = c.status === "paused" && !!c.meta_campaign_id && !reviewableCampaign(c);
              return (
                <article key={c.id} aria-labelledby={`campaign-${c.id}-name`} className="flex flex-col gap-3 border-b border-slate-200 py-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 id={`campaign-${c.id}-name`} className="min-w-0 wrap-break-word font-semibold text-slate-900">
                          {c.name ?? `${business.name} — ${c.objective}`}
                        </h3>
                        <Status tone={goneInMeta(c) ? "neutral" : CAMPAIGN_STATUS[c.status]?.tone ?? "neutral"} className="text-sm text-slate-600">
                          {goneInMeta(c) ?? (c.status === "active" ? OWNER_WORDS.running : CAMPAIGN_STATUS[c.status]?.label ?? c.status)}
                        </Status>
                        {reviews[c.id]?.length ? <AdReviewBadge reviews={reviews[c.id]} /> : null}
                        {attention ? <Badge className="bg-red-50 text-red-800">Needs attention</Badge> : null}
                        {madeOutsideAdBrain(c) ? <Badge className="bg-slate-100 text-slate-700">{OWNER_WORDS.madeOutside}</Badge> : null}
                      </div>
                      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
                        <span className="basis-full text-sm text-slate-500 sm:basis-auto">
                          {c.daily_budget != null
                            ? formatPerDay(c.daily_budget)
                            : c.objective}
                        </span>
                        {resumeElsewhere ? (
                          <a href={adsLink(c)} target="_blank" rel="noopener noreferrer" title={RESUME_IN_ADS_MANAGER}
                            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                            <ExternalLink className="h-4 w-4" aria-hidden="true" />
                            Resume in Ads Manager
                          </a>
                        ) : c.meta_campaign_id &&
                          (c.status === "active" || c.status === "paused") && (
                            <Button
                              variant="outline"
                              data-product-event={c.status === "active" ? "campaign.pause" : "campaign.review"}
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
                          variant="outline"
                          onClick={() => refresh(c.id)}
                          aria-label="Refresh results"
                          disabled={refreshingId === c.id}
                        >
                          {refreshingId === c.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          {/* #417: a real space, so the visible text reads "Refresh results" like the label. */}
                          Refresh{" "}<span className="-ml-1 hidden sm:inline">results</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`More actions for ${c.name ?? "this campaign"}`}
                            disabled={deletingId === c.id}
                            className="inline-flex size-11 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                          >
                            {deletingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {r && (
                              <DropdownMenuItem asChild>
                                <a href={`https://wa.me/?text=${encodeURIComponent(campaignWhatsAppSummary(c, r))}`} target="_blank" rel="noopener noreferrer" data-product-event="campaign.share_results">
                                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> Share results on WhatsApp
                                </a>
                              </DropdownMenuItem>
                            )}
                            {c.meta_campaign_id && (
                              <DropdownMenuItem asChild>
                                <a href={adsLink(c)} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Ads Manager
                                </a>
                              </DropdownMenuItem>
                            )}
                            {c.meta_campaign_id && c.status === "paused" && reviewableCampaign(c) && (
                              <DropdownMenuItem data-product-event="campaign.edit_audience" onSelect={() => setAudienceEdit(c)}>
                                <Users className="h-4 w-4" aria-hidden="true" /> Edit audience
                              </DropdownMenuItem>
                            )}
                            {c.meta_campaign_id && (c.status === "paused" || (c.status === "active" && budgetFormStart(c)?.capped)) && reviewableCampaign(c) && budgetFormStart(c) && (
                              <DropdownMenuItem data-product-event="campaign.edit_budget" onSelect={() => setBudgetEdit({ campaign: c, start: budgetFormStart(c)! })}>
                                <IndianRupee className="h-4 w-4" aria-hidden="true" /> Edit budget
                              </DropdownMenuItem>
                            )}
                            {c.meta_campaign_id && (c.status === "paused" || c.status === "active") && reviewableCampaign(c) && (c.meta_ad_ids?.length ?? 0) > 0 && (
                              <DropdownMenuItem data-product-event="campaign.edit_ad" onSelect={() => setAdEdit(c)}>
                                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit ad words
                              </DropdownMenuItem>
                            )}
                            {c.meta_campaign_id && <DropdownMenuSeparator />}
                            <DropdownMenuItem variant="danger" onSelect={() => void deleteCampaign(c)}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete campaign
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {attention ? <p className="text-sm font-medium text-red-800">{attention}</p> : null}
                    {cardError?.id === c.id ? <p role="alert" className="text-sm font-medium text-red-800">
                      {cardError.message}
                      {cardError.adsManager ? <> <a href={adsLink(c)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open in Ads Manager</a></> : null}
                    </p> : null}
                    {cardNotice?.id === c.id && cardError?.id !== c.id ? <p role="status" className="text-sm text-slate-600">{cardNotice.message}</p> : null}

                    {r && (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Stat label="Impressions" value={formatNumber(r.impressions)} />
                        <Stat label="Clicks" value={formatNumber(r.clicks)} />
                        <Stat label={outcome === "whatsapp" ? "WhatsApp conversations" : outcome === "instant_form" ? "Leads" : "Results unavailable"} value={outcome === "whatsapp" ? (r.conversations != null ? formatNumber(r.conversations) : "—") : outcome === "instant_form" ? formatNumber(r.leads) : "—"} />
                        <Stat
                          label={outcome === "whatsapp" ? "Cost / conversation" : outcome === "instant_form" ? "Cost / lead" : "Cost / result"}
                          value={outcome === "whatsapp" ? (r.conversations != null && r.cost_per_conversation != null ? formatMoney(r.cost_per_conversation) : "—") : outcome === "instant_form" && r.cpl != null ? formatMoney(r.cpl) : "—"}
                        />
                      </div>
                    )}
                    {r && outcome === "whatsapp" && r.whatsapp_opens != null && r.conversations != null && (
                      // #493: people reach WhatsApp and leave; show the drop-off plainly.
                      <p className="text-sm text-slate-700">
                        {formatNumber(r.whatsapp_opens)} opened WhatsApp, {formatNumber(r.conversations)} messaged you
                      </p>
                    )}
                    {r && (r.customers ?? 0) > 0 && (
                      // #798: what a real customer cost, beside the per-enquiry figures.
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Customers">
                        <Stat label={r.customers === 1 ? "Customer" : "Customers"} value={formatNumber(r.customers ?? 0)} />
                        <Stat label="Per customer" value={(() => { const cost = costPerCustomer(r.spend, r.customers ?? 0); return cost === null ? "—" : formatMoney(cost); })()} />
                        <p className="col-span-2 -mt-2 text-xs text-slate-500 sm:col-span-4">From customers you marked in Enquiries.</p>
                      </div>
                    )}
                    {r && outcome === "whatsapp" && (
                      <WhatsAppEnquiries campaignId={c.id} spend={r.spend} enquiries={r.real_enquiries ?? 0}
                        onLogged={(count) => setResults((p) => (p[c.id] ? { ...p, [c.id]: { ...p[c.id], real_enquiries: count } } : p))}
                        onCustomers={(customers, count) => setResults((p) => (p[c.id] ? { ...p, [c.id]: { ...p[c.id], customers, real_enquiries: count } } : p))} />
                    )}
                    {r && outcome === "instant_form" && !(r.spend > 0) && (
                      <p className="text-sm text-slate-600">
                        {c.status === "paused" ? `Paused — nothing has spent.${resumeElsewhere ? "" : " Resume when you're ready."}`
                          : c.status === "active" ? "Waiting for Meta to start delivery."
                          : "Nothing has spent yet."}
                      </p>
                    )}
                    {r && outcome === "instant_form" && r.spend > 0 &&
                      (() => {
                        const h = spendHealth(
                          { spend: r.spend, leads: r.leads, cpl: r.cpl },
                          formatMoney,
                        );
                        const narrative = campaignNarrative(
                          { spend: r.spend, leads: r.leads, cpl: r.cpl },
                          formatMoney,
                        );
                        const nextAction = campaignNextAction({
                          spend: r.spend,
                          leads: r.leads,
                          cpl: r.cpl,
                        });
                        // #847: no tinted boxes inside a card; the label carries the verdict.
                        return (
                          <div className="text-sm text-slate-700">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-semibold">{h.label}.</span>
                              <span>{h.detail}</span>
                            </div>
                            <p className="mt-1 text-sm text-slate-600">{narrative}</p>
                            <p className="mt-1 text-sm font-medium text-slate-700">Next step: {nextAction}</p>
                          </div>
                        );
                      })()}
                    {summaries[c.id] && !(r && outcome === "instant_form" && !(r.spend > 0)) && (
                      <p className="text-sm text-slate-600">{summaries[c.id]}</p>
                    )}
                </article>
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

/** #763: synced from Meta, not launched by AdBrain (no launch result on record). */
function madeOutsideAdBrain(campaign: Campaign): boolean {
  const raw = campaign.raw;
  return !!campaign.meta_campaign_id && !(raw && typeof raw === "object" && "metaResult" in raw);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

const REVIEW_LABELS: Record<AdReview["state"], { label: string; style: string }> = {
  rejected: { label: "Rejected by Meta", style: "bg-red-50 text-red-700" },
  issues: { label: "Meta flagged issues", style: "bg-red-50 text-red-700" },
  in_review: { label: "In Meta review", style: "bg-slate-100 text-slate-700" },
  unknown: { label: "Review status unknown", style: "bg-slate-100 text-slate-600" },
  approved: { label: "Approved by Meta", style: "bg-emerald-50 text-emerald-700" },
};

/** The least-ready ad decides the badge; rejection reasons are shown as Meta wrote them. */
function AdReviewBadge({ reviews }: { reviews: AdReview[] }) {
  const order: AdReview["state"][] = ["rejected", "issues", "in_review", "unknown", "approved"];
  const state = order.find(candidate => reviews.some(review => review.state === candidate))!;
  const reasons = [...new Set(reviews.filter(review => review.state === state).flatMap(review => review.reasons))];
  const count = reviews.filter(review => review.state === state).length;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <Badge className={REVIEW_LABELS[state].style}>
        {REVIEW_LABELS[state].label}{reviews.length > 1 ? ` (${count} of ${reviews.length} ads)` : ""}
      </Badge>
      {reasons.length > 0 && <span className="text-xs text-slate-600">{reasons.join(" ")}</span>}
    </span>
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
