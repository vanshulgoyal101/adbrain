"use client";

import { OWNER_WORDS } from "@/lib/copy/owner-words";
import { useActionState, useRef, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import Link from "next/link";
import { CheckCircle2, Circle, Save, Wand2 } from "lucide-react";
import { saveBusiness, type SaveState } from "@/app/(app)/brand/actions";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ColorField } from "@/components/ui/color-field";
import { PhoneField } from "@/components/ui/phone-field";
import { TokenField } from "@/components/ui/token-field";
import { Spinner } from "@/components/ui/spinner";
import { BRAND_FONTS, brandFontId } from "@/lib/brand/fonts";
import { normalizeWebsite, validateBrandFields } from "@/lib/brand/validation";
import type { Business } from "@/lib/types";
import type { BrandExtraction } from "@/lib/templates/ads";

/** Common ad languages — a shortcut, not a limit; any value is allowed. */
const LANGUAGE_SUGGESTIONS = [
  "English",
  "Hindi",
  "Hinglish",
  "Marathi",
  "Gujarati",
  "Tamil",
  "Telugu",
  "Kannada",
  "Bengali",
  "Punjabi",
  "Malayalam",
];

interface FieldsState {
  name: string;
  vertical: string;
  website: string;
  description: string;
  brand_voice: string;
  primary_color: string;
  secondary_color: string;
  font: string;
  target_audience: string;
  languages: string;
  locations: string;
  usps: string;
  offers: string;
  logo_url: string;
  phone: string;
  email: string;
  address: string;
}

function fromBusiness(b: Business | null): FieldsState {
  return {
    name: b?.name ?? "",
    vertical: b?.vertical ?? "",
    website: b?.website ?? "",
    description: b?.description ?? "",
    brand_voice: b?.brand_voice ?? "",
    primary_color: b?.primary_color ?? "",
    secondary_color: b?.secondary_color ?? "",
    font: b?.font ?? "",
    target_audience: b?.target_audience ?? "",
    languages: (b?.languages ?? []).join("\n"),
    locations: (b?.locations ?? []).join("\n"),
    usps: (b?.usps ?? []).join("\n"),
    offers: (b?.offers ?? []).join("\n"),
    logo_url: b?.logo_url ?? "",
    phone: b?.phone ?? "",
    email: b?.email ?? "",
    address: b?.address ?? "",
  };
}

const AUTOFILL_LABELS: Partial<Record<keyof FieldsState, string>> = {
  name: "name",
  description: "description",
  vertical: "category",
  brand_voice: "voice",
  target_audience: "audience",
  usps: "selling points",
  offers: "offers",
  languages: "languages",
  locations: "service areas (check them)",
  phone: "phone number",
};
// Facts Create may only state when the Brand has them; a website rarely gives all of them.
const KEY_FACTS: [keyof FieldsState, string][] = [
  ["offers", "offers or prices"],
  ["locations", "service areas"],
  ["phone", "phone number"],
  ["target_audience", "audience"],
];

/** Plain words for what autofill filled and which key facts the owner still has to add. */
function autofillSummary(extracted: Partial<FieldsState>, before: FieldsState, pasted = false): string {
  const filled = (Object.keys(AUTOFILL_LABELS) as (keyof FieldsState)[])
    .filter((key) => extracted[key]?.trim())
    .map((key) => AUTOFILL_LABELS[key]!);
  const missing = KEY_FACTS.filter(([key]) => !(extracted[key] ?? before[key]).trim()).map(([, label]) => label);
  const from = pasted ? "your text" : "your website";
  const found = filled.length ? `Filled from ${from}: ${filled.join(", ")}.` : `${pasted ? "Your text" : "Your website"} didn't give us any Brand details.`;
  return missing.length
    ? `${found} Still missing: ${missing.join(", ")}. Add them below; ads only state facts your Brand has.`
    : `${found} Check the fields below, then save.`;
}

function firstLine(value: string): string {
  return value
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean) ?? "";
}

type BrandSaveState = SaveState & { submittedRevision?: number };

export function BrandForm({ business, photoCount = 0 }: { business: Business | null; photoCount?: number }) {
  const [form, setForm] = useState(() => ({ fields: fromBusiness(business), revision: 0 }));
  const { fields, revision } = form;
  function setFields(update: (current: FieldsState) => FieldsState) {
    setForm(current => {
      const next = update(current.fields);
      return next === current.fields ? current : { fields: next, revision: current.revision + 1 };
    });
  }
  const [state, formAction, pending] = useActionState<BrandSaveState, FormData>(
    async (previous, formData) => {
      const submittedRevision = revision;
      const result = await saveBusiness(previous, formData);
      return result.ok ? { ...result, submittedRevision } : result;
    },
    { ok: false },
  );
  const [autofilling, setAutofilling] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const websiteRevision = useRef(0);
  const autoTried = useRef<string | null>(null);
  const [savedLogo, setSavedLogo] = useState(business?.logo_url ?? "");
  const incomingLogo = business?.logo_url ?? "";
  if (savedLogo !== incomingLogo) {
    setSavedLogo(incomingLogo);
    setFields((current) => current.logo_url === savedLogo ? { ...current, logo_url: incomingLogo } : current);
  }

  // Mirrors the server action's checks so problems surface before submitting.
  const errors = Object.fromEntries(
    validateBrandFields(fields).map((i) => [i.field, i.message]),
  ) as Partial<Record<string, string>>;
  const previewMessage =
    firstLine(fields.offers) ||
    firstLine(fields.usps) ||
    fields.description.trim() ||
    "Add an offer or proof point to shape the message.";
  const areas = fields.locations.split("\n").map((part) => part.trim()).filter(Boolean);
  // Each fact on its own line: audience text often names the area too, so a joined sentence read twice.
  const previewFacts: [string, string][] = [
    ["Who", fields.target_audience.trim() || "Not added"],
    ["Where", areas.join(", ") || "Not added"],
    ...(fields.brand_voice.trim() ? [["Voice", fields.brand_voice.trim()] as [string, string]] : []),
    ...((fields.phone.trim() || fields.website.trim()) ? [["Contact", fields.phone.trim() || fields.website.trim()] as [string, string]] : []),
  ];
  // What Prepare and Meta will use: a bare domain is stored with https:// (#470).
  const websiteLink = normalizeWebsite(fields.website);
  // #681: what ads need, each linking to where it's filled. Brand voice and audience text stay optional.
  const readinessChecks = [
    {
      label: "Business identity",
      ready: Boolean(fields.name.trim() && (fields.description.trim() || fields.vertical.trim())),
      href: "#brand-identity",
    },
    { label: "Audience and area", ready: Boolean(firstLine(fields.locations)), href: "#brand-creative" },
    { label: "Offer or proof point", ready: Boolean(firstLine(fields.usps) || firstLine(fields.offers)), href: "#brand-creative" },
    { label: "Logo", ready: Boolean(fields.logo_url.trim()), href: business ? "#brand-assets" : undefined },
    { label: "Real photos", ready: photoCount > 0, href: business ? "#brand-assets" : undefined },
  ];
  const readinessCount = readinessChecks.filter((check) => check.ready).length;

  function set<K extends keyof FieldsState>(key: K, value: string) {
    if (key === "website") websiteRevision.current++;
    setFields((f) => ({ ...f, [key]: value }));
  }

  const hasContent = Boolean(
    fields.description ||
      fields.brand_voice ||
      fields.target_audience ||
      fields.usps ||
      fields.offers,
  );

  /** #1025: leaving the Website field of an empty Brand runs autofill once for that address. */
  function autofillOnBlur() {
    const url = fields.website.trim();
    if (hasContent || autofilling || pending || !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(url)) return;
    if (autoTried.current === url.toLowerCase()) return;
    autoTried.current = url.toLowerCase();
    void autofill();
  }

  /** #1317: from the website, or from text pasted instead (an Instagram bio, a Google listing). */
  async function autofill(pasted?: string) {
    setAutofillError(null);
    setAutofillNote(null);
    if (pasted === undefined && !fields.website.trim()) {
      setAutofillError("Enter your website URL first, or paste a bio or listing.");
      return;
    }
    if (
      hasContent &&
      !(await confirm({ title: "Replace what you've filled in?", description: `Autofill replaces some fields you've already filled with what it finds ${pasted === undefined ? "on your website" : "in the text"}.`, confirmLabel: "Autofill" }))
    ) {
      return;
    }
    setAutofilling(true);
    const revision = websiteRevision.current;
    try {
      const res = await fetch("/api/brand/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // #650: usage is logged on the business once it exists.
        body: JSON.stringify({ ...(pasted === undefined ? { url: fields.website } : { text: pasted }), ...(business ? { businessId: business.id } : {}) }),
        signal: AbortSignal.timeout(50_000),
      });
      const data = (await res.json()) as {
        extraction?: BrandExtraction;
        error?: string;
      };
      if (!res.ok) {
        setAutofillError(data.error ?? "Autofill failed.");
        return;
      }
      if (pasted === undefined && revision !== websiteRevision.current) {
        setAutofillError("Website changed during autofill. Run it again for the current website.");
        return;
      }
      const e = data.extraction ?? {};
      const extracted: Partial<FieldsState> = {
        description: e.description,
        vertical: e.vertical,
        brand_voice: e.brand_voice,
        primary_color: e.primary_color,
        secondary_color: e.secondary_color,
        target_audience: e.target_audience,
        usps: e.usps?.length ? e.usps.join("\n") : undefined,
        offers: e.offers?.length ? e.offers.join("\n") : undefined,
        languages: e.languages?.length ? e.languages.join("\n") : undefined,
        // #1037: proposed as removable chips; nothing is saved until the owner taps Save.
        locations: e.locations?.length ? e.locations.join("\n") : undefined,
        phone: e.phone,
        // #1379: a name the owner already typed stays.
        name: fields.name.trim() ? undefined : e.name,
      };
      setFields((current) => {
        const merged = { ...current };
        for (const key of Object.keys(extracted) as (keyof FieldsState)[]) {
          const value = extracted[key];
          if (value != null && current[key] === fields[key]) merged[key] = value;
        }
        return merged;
      });
      setAutofillNote(autofillSummary(extracted, fields, pasted !== undefined));
    } catch {
      setAutofillError(pasted === undefined ? "Autofill failed — could not reach the site." : "Autofill failed. Try again in a moment.");
    } finally {
      setAutofilling(false);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {confirmDialog}
      {business && <input type="hidden" name="id" value={business.id} />}

      <div id="brand-identity" className="scroll-mt-6">
      <Card>
        <CardHeader className="flex items-center justify-between gap-4">
          <CardTitle as="h2">Basics</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void autofill()}
            disabled={autofilling || pending}
          >
            {autofilling ? <Spinner /> : <Wand2 className="h-4 w-4" />}
            Autofill from website
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" required>
            <Input
              name="name"
              required
              value={fields.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Your business name"
            />
          </Field>
          <Field label="Website (optional: lets AdBrain fill this page for you)" error={errors.website}>
            <Input
              name="website"
              value={fields.website}
              onChange={(e) => set("website", e.target.value)}
              onBlur={autofillOnBlur}
              placeholder="example.com"
              aria-invalid={errors.website ? true : undefined}
            />
            {!pasteOpen && !fields.website.trim() && (
              <button type="button" onClick={() => setPasteOpen(true)} className="min-h-11 w-fit text-left text-sm font-medium text-blue-700 underline underline-offset-4">
                No website? Paste a bio or listing
              </button>
            )}
            {pasteOpen && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="brand-paste">Instagram bio, Google listing or catalogue text</Label>
                <Textarea id="brand-paste" rows={4} value={pastedText} onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste what the business says about itself: what it sells, where, and a phone number." />
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void autofill(pastedText)} disabled={autofilling || pending || !pastedText.trim()}>
                  {autofilling ? <Spinner /> : <Wand2 className="h-4 w-4" />}
                  Fill from this text
                </Button>
              </div>
            )}
            {websiteLink && (
              <p className="text-xs text-slate-500">
                Ads link to{" "}
                <a href={websiteLink} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-blue-700 underline underline-offset-2">
                  {websiteLink}
                </a>
              </p>
            )}
          </Field>
          <Field label="Industry / business type">
            <Input
              name="vertical"
              value={fields.vertical}
              onChange={(e) => set("vertical", e.target.value)}
              placeholder="Coffee shop, fitness studio, interior design…"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea
                name="description"
                rows={2}
                value={fields.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="What your business does, in a sentence or two."
              />
            </Field>
          </div>
          {autofillError && (
            <div className="sm:col-span-2">
              <Alert variant="error">{autofillError}</Alert>
            </div>
          )}
          {autofillNote && (
            <div className="sm:col-span-2" aria-live="polite">
              <Alert>{autofillNote}</Alert>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      <div id="brand-contact" className="scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Contact details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <p className="text-sm text-slate-500 sm:col-span-2">
            Shown on your ads so people can reach you. The phone number appears
            on the generated poster.
          </p>
          <Field label="Phone" error={errors.phone}>
            <PhoneField
              name="phone"
              value={fields.phone}
              onChange={(v) => set("phone", v)}
              invalid={Boolean(errors.phone)}
            />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input
              name="email"
              type="email"
              value={fields.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="hello@yourbusiness.com"
              aria-invalid={errors.email ? true : undefined}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <Input
                name="address"
                value={fields.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Shop 4, MI Road, Jaipur 302001"
              />
            </Field>
          </div>
        </CardContent>
      </Card>
      </div>

      <div id="brand-creative" className="scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Brand details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {/* #681: what ads need first (area, offer); styling after, so a phone reaches them sooner. */}
          <Field label="Locations served">
            <TokenField
              name="locations"
              value={fields.locations}
              onChange={(v) => set("locations", v)}
              placeholder="Type a city and press Enter"
            />
          </Field>
          <Field label="Target audience">
            <Input
              name="target_audience"
              value={fields.target_audience}
              onChange={(e) => set("target_audience", e.target.value)}
              placeholder="the customers you most want to reach"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Offers" hint="one per line">
              <Textarea
                name="offers"
                rows={2}
                value={fields.offers}
                onChange={(e) => set("offers", e.target.value)}
                placeholder={"Free site survey this month"}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label={OWNER_WORDS.usps} hint="one per line">
              <Textarea
                name="usps"
                rows={3}
                value={fields.usps}
                onChange={(e) => set("usps", e.target.value)}
                placeholder={"25-year warranty\nSubsidy paperwork handled\n500+ installations"}
              />
            </Field>
          </div>
          <Field label="Brand voice">
            <Input
              name="brand_voice"
              value={fields.brand_voice}
              onChange={(e) => set("brand_voice", e.target.value)}
              placeholder="friendly, trustworthy, no-jargon"
            />
          </Field>
          <Field label="Languages">
            <TokenField
              name="languages"
              value={fields.languages}
              onChange={(v) => set("languages", v)}
              suggestions={LANGUAGE_SUGGESTIONS}
              placeholder="Type a language and press Enter"
            />
          </Field>
          <Field label="Primary color">
            <ColorField
              name="primary_color"
              value={fields.primary_color}
              onChange={(v) => set("primary_color", v)}
              placeholder="#2563EB"
            />
          </Field>
          <Field label="Secondary color">
            <ColorField
              name="secondary_color"
              value={fields.secondary_color}
              onChange={(v) => set("secondary_color", v)}
              placeholder="#F59E0B"
            />
          </Field>
          <Field label="Font" hint="used on generated posters">
            <Select
              name="font"
              value={brandFontId(fields.font)}
              onChange={(e) => set("font", e.target.value)}
            >
              {BRAND_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={OWNER_WORDS.logoUrl} error={errors.logo_url}>
            <Input
              name="logo_url"
              type="url"
              value={fields.logo_url}
              onChange={(e) => set("logo_url", e.target.value)}
              placeholder="https://…/logo.png"
              aria-invalid={errors.logo_url ? true : undefined}
            />
          </Field>
        </CardContent>
      </Card>
      </div>

      {/* #681: on a phone the fields come first; on desktop this panel leads (order-first). */}
      <section
        aria-labelledby="brand-preview-title"
        className="grid gap-4 border-y border-slate-200 py-6 lg:order-first lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12"
      >
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="brand-preview-title" className="text-lg font-semibold text-slate-950">
              {OWNER_WORDS.preview}
            </h2>
            <span className="text-xs text-slate-500">
              {readinessCount} of {readinessChecks.length} ready
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">What every ad will use. It updates as you type.</p>
          {readinessCount < readinessChecks.length && (
            <ul className="mt-3 flex flex-col">
              {readinessChecks.filter((check) => !check.ready).map((check) => (
                <li key={check.label} className="flex min-h-11 items-center gap-2 text-sm text-slate-500">
                  <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {check.href ? (
                    <a href={check.href} className="font-medium text-blue-700 underline-offset-2 hover:underline">
                      Add {check.label.toLowerCase()}
                    </a>
                  ) : (
                    `Add ${check.label.toLowerCase()}`
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-950">{previewMessage}</p>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            {previewFacts.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-slate-500">{term}</dt>
                <dd className="text-slate-700">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_10px_30px_rgba(16,24,40,0.12)]">
        <Button type="submit" data-product-event="brand.save" disabled={pending || autofilling}>
          {pending ? <Spinner /> : <Save className="h-4 w-4" />}
          Save your business
        </Button>
        {/* #1262: always in the page, so screen readers announce "Saved" or the error when it appears. */}
        <span role="status" className="inline-flex items-center gap-1.5 text-sm empty:hidden">
          {state.ok && state.submittedRevision === revision && !pending
            ? <span className="inline-flex items-center gap-1.5 text-blue-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved</span>
            : state.error ? <span className="text-red-600">{state.error}</span> : null}
        </span>
        {state.ok && state.submittedRevision === revision && !pending && (
          // #681: the next step sits beside Saved, so a phone isn't left at the bottom of the page.
          <Link href="/create" className="ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-slate-100">
            Next: Create ads
          </Link>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <Label className="flex flex-col gap-1.5">
      <span>
        {label}
        {required && <span className="text-red-500"> *</span>}
        {hint && <span className="ml-1 font-normal text-slate-400">({hint})</span>}
      </span>
      {children}
      {error && <span className="text-xs font-normal text-red-600">{error}</span>}
    </Label>
  );
}
