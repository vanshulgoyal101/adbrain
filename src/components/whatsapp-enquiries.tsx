"use client";

import { useId, useState } from "react";
import { Loader2, Plus, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { costPerRealEnquiry } from "@/lib/campaign/real-enquiries";
import { formatMoney, formatNumber } from "@/lib/format";

/**
 * #335: Meta counts chats started, not customers. The owner logs each real enquiry from a WhatsApp
 * ad's chats (details optional); it is saved to Enquiries and results show cost per real enquiry.
 */
export function WhatsAppEnquiries({ campaignId, spend, enquiries, onLogged, onCustomers }: {
  campaignId: string;
  spend: number;
  enquiries: number;
  onLogged: (count: number) => void;
  /** #798: the campaign's customer count after "+1 customer" or its Undo. */
  onCustomers?: (customers: number, enquiries: number) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ name: "", phone: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const cost = costPerRealEnquiry(spend, enquiries);
  const [customer, setCustomer] = useState<{ id: string; undone?: boolean } | null>(null);
  const [customerBusy, setCustomerBusy] = useState(false);

  /** #798: most WhatsApp customers never become an enquiry row, so one tap logs one already marked a customer. */
  async function addCustomer(undo?: string) {
    setCustomerBusy(true);
    setError(null);
    try {
      const response = undo
        ? await fetch(`/api/campaigns/${campaignId}/enquiries?lead=${encodeURIComponent(undo)}`, { method: "DELETE" })
        : await fetch(`/api/campaigns/${campaignId}/enquiries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: true }) });
      const data = await response.json().catch(() => ({})) as { id?: string; enquiries?: number | null; customers?: number | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? "That couldn't be saved. Try again.");
      if (typeof data.enquiries === "number") onLogged(data.enquiries);
      if (typeof data.customers === "number" && typeof data.enquiries === "number") onCustomers?.(data.customers, data.enquiries);
      setCustomer(undo ? { id: undo, undone: true } : data.id ? { id: data.id } : null);
      setSaved(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That couldn't be saved. Try again.");
    } finally {
      setCustomerBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
      const response = await fetch(`/api/campaigns/${campaignId}/enquiries`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as { enquiries?: number | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The enquiry could not be saved. Try again.");
      onLogged(typeof data.enquiries === "number" ? data.enquiries : enquiries + 1);
      setFields({ name: "", phone: "", note: "" });
      setOpen(false);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The enquiry could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Real enquiries" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-lg font-semibold tabular-nums text-slate-900">{formatNumber(enquiries)}</p>
          <p className="text-xs text-slate-500">Real enquiries</p>
        </div>
        <div>
          <p className="text-lg font-semibold tabular-nums text-slate-900">{cost === null ? "—" : formatMoney(cost)}</p>
          <p className="text-xs text-slate-500">Per real enquiry</p>
        </div>
      </div>
      <p className="text-xs text-slate-500">Not every chat is a customer. Add each real enquiry from these WhatsApp chats.</p>
      {open ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label htmlFor={`${id}-name`}>Name (optional)</Label><Input id={`${id}-name`} maxLength={200} value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} /></div>
            <div><Label htmlFor={`${id}-phone`}>Phone (optional)</Label><Input id={`${id}-phone`} type="tel" maxLength={40} value={fields.phone} onChange={(event) => setFields({ ...fields, phone: event.target.value })} /></div>
          </div>
          <div><Label htmlFor={`${id}-note`}>Note (optional)</Label><Textarea id={`${id}-note`} rows={2} maxLength={2000} value={fields.note} onChange={(event) => setFields({ ...fields, note: event.target.value })} className="mt-1 rounded-md p-2" /></div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Save enquiry</Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setSaved(false); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add enquiry
          </Button>
          <Button type="button" size="sm" variant="outline" data-product-event="lead.customer" disabled={customerBusy}
            aria-label="Got a customer from this ad? Add 1 customer" onClick={() => void addCustomer()}>
            {customerBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserCheck className="h-4 w-4" aria-hidden="true" />} Got a customer? +1
          </Button>
          {customer && (
            <p role="status" className="flex items-center gap-2 text-sm text-slate-700">
              {customer.undone ? "Removed that customer." : "Added 1 customer."}
              {!customer.undone && <button type="button" className="min-h-10 font-semibold text-blue-700 underline" disabled={customerBusy} onClick={() => void addCustomer(customer.id)}>Undo</button>}
            </p>
          )}
          {saved && <p role="status" className="text-sm text-blue-700">Saved to Enquiries.</p>}
        </div>
      )}
    </section>
  );
}
