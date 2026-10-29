"use client";

import { ExternalLink, Trash2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isMetaTestLead } from "@/lib/leads/test-lead";
import type { WorkflowStatus } from "@/lib/leads/filters";
import type { Campaign, Lead } from "@/lib/types";

export function leadName(lead: Pick<Lead, "full_name">): string | null {
  return isMetaTestLead(lead) ? "Test enquiry from Meta" : lead.full_name;
}

export function CampaignEnquiryFeedback({ error, notice, adsManagerUrl }: {
  error?: { message: string; adsManager?: boolean };
  notice?: { message: string };
  adsManagerUrl?: string;
}) {
  if (error) return <p role="alert" className="text-sm font-medium text-red-800">
    {error.message}
    {error.adsManager ? <> <a href={adsManagerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open in Ads Manager</a></> : null}
  </p>;
  return notice ? <p role="status" className="text-sm text-slate-600">{notice.message}</p> : null;
}

export function CampaignEnquiryDeleteItem({ campaign, askConfirm, onError, onNotice }: {
  campaign: Campaign;
  askConfirm: ReturnType<typeof useConfirm>[0];
  onError: (error: { id: string; message: string } | null) => void;
  onNotice: (notice: { id: string; message: string }) => void;
}) {
  async function deleteEnquiries() {
    if (!(await askConfirm({
      title: "Delete this campaign's enquiries?",
      description: `Every enquiry from "${campaign.name ?? "this campaign"}" is removed from AdBrain for good, including chats you added. Meta keeps its own copy in your Page's leads. Your ads aren't affected.`,
      confirmLabel: "Delete enquiries", tone: "danger",
    }))) return;
    onError(null);
    try {
      const response = await fetch(`/api/leads?campaignId=${encodeURIComponent(campaign.id)}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { deleted?: number; error?: string };
      if (!response.ok) { onError({ id: campaign.id, message: data.error ?? "Couldn't delete the enquiries. Try again." }); return; }
      const n = data.deleted ?? 0;
      onNotice({ id: campaign.id, message: n ? `Deleted ${n} ${n === 1 ? "enquiry" : "enquiries"} from this campaign.` : "This campaign had no enquiries to delete." });
    } catch {
      onError({ id: campaign.id, message: "Couldn't delete the enquiries — check your connection." });
    }
  }

  return <DropdownMenuItem variant="danger" onSelect={() => void deleteEnquiries()}>
    <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete its enquiries
  </DropdownMenuItem>;
}

export function useLeadErasure(onError: (message: string | null) => void, onDeleted: (lead: Lead) => void) {
  const [askConfirm, confirmDialog] = useConfirm();
  async function deleteLead(lead: Lead) {
    const who = leadName(lead);
    const confirmed = await askConfirm({
      title: "Delete this enquiry?",
      description: `${who ? `${who}'s` : "Their"} details and answers are removed from AdBrain for good. Meta keeps its own copy in your Page's leads.`,
      confirmLabel: "Delete enquiry",
      tone: "danger",
    });
    if (!confirmed) return;
    onError(null);
    const ok = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" }).then((response) => response.ok, () => false);
    if (!ok) { onError("Couldn't delete that enquiry. Try again."); return; }
    onDeleted(lead);
  }
  return [deleteLead, confirmDialog] as const;
}

export function EnquiryStatusNotice({ notice, marking, onUndo }: {
  notice: { lead: Lead; previous: WorkflowStatus; status: WorkflowStatus; undone?: boolean };
  marking: boolean;
  onUndo: () => void;
}) {
  return <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
    {notice.undone
      ? `${leadName(notice.lead) ?? "This enquiry"} is back to ${notice.previous}.`
      : notice.status === "closed" ? `${leadName(notice.lead) ?? "This enquiry"} is marked not interested.`
        : `${leadName(notice.lead) ?? "This enquiry"} became a customer.`}
    {!notice.undone && (
      <button type="button" className="min-h-11 font-medium text-blue-700" disabled={marking} onClick={onUndo}>Undo</button>
    )}
  </p>;
}
