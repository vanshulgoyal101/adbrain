"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Save, Wand2 } from "lucide-react";
import { saveBusiness, type SaveState } from "@/app/(app)/brand/actions";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Business } from "@/lib/types";
import type { BrandExtraction } from "@/lib/templates/ads";

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
    languages: (b?.languages ?? []).join(", "),
    locations: (b?.locations ?? []).join(", "),
    usps: (b?.usps ?? []).join("\n"),
    offers: (b?.offers ?? []).join("\n"),
    logo_url: b?.logo_url ?? "",
  };
}

export function BrandForm({ business }: { business: Business | null }) {
  const [fields, setFields] = useState<FieldsState>(() =>
    fromBusiness(business),
  );
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveBusiness,
    { ok: false },
  );
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);

  function set<K extends keyof FieldsState>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function autofill() {
    setAutofillError(null);
    if (!fields.website.trim()) {
      setAutofillError("Enter your website URL first.");
      return;
    }
    const hasContent = Boolean(
      fields.description ||
        fields.brand_voice ||
        fields.target_audience ||
        fields.usps ||
        fields.offers,
    );
    if (
      hasContent &&
      !window.confirm(
        "Autofill will replace some fields you've already filled. Continue?",
      )
    ) {
      return;
    }
    setAutofilling(true);
    try {
      const res = await fetch("/api/brand/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fields.website }),
      });
      const data = (await res.json()) as {
        extraction?: BrandExtraction;
        error?: string;
      };
      if (!res.ok) {
        setAutofillError(data.error ?? "Autofill failed.");
        return;
      }
      const e = data.extraction ?? {};
      setFields((f) => ({
        ...f,
        description: e.description ?? f.description,
        vertical: e.vertical ?? f.vertical,
        brand_voice: e.brand_voice ?? f.brand_voice,
        primary_color: e.primary_color ?? f.primary_color,
        secondary_color: e.secondary_color ?? f.secondary_color,
        target_audience: e.target_audience ?? f.target_audience,
        usps: e.usps?.length ? e.usps.join("\n") : f.usps,
        offers: e.offers?.length ? e.offers.join("\n") : f.offers,
        languages: e.languages?.length ? e.languages.join(", ") : f.languages,
      }));
    } catch {
      setAutofillError("Autofill failed — could not reach the site.");
    } finally {
      setAutofilling(false);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {business && <input type="hidden" name="id" value={business.id} />}

      <Card>
        <CardHeader className="flex items-center justify-between gap-4">
          <CardTitle>Basics</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={autofill}
            disabled={autofilling}
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
              placeholder="Solaride"
            />
          </Field>
          <Field label="Website">
            <Input
              name="website"
              value={fields.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="solaride.in"
            />
          </Field>
          <Field label="Industry / business type">
            <Input
              name="vertical"
              value={fields.vertical}
              onChange={(e) => set("vertical", e.target.value)}
              placeholder="solar energy, dental clinic, gym…"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand voice">
            <Input
              name="brand_voice"
              value={fields.brand_voice}
              onChange={(e) => set("brand_voice", e.target.value)}
              placeholder="friendly, trustworthy, no-jargon"
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
          <Field label="Primary color">
            <Input
              name="primary_color"
              value={fields.primary_color}
              onChange={(e) => set("primary_color", e.target.value)}
              placeholder="#0A7E3D"
            />
          </Field>
          <Field label="Secondary color">
            <Input
              name="secondary_color"
              value={fields.secondary_color}
              onChange={(e) => set("secondary_color", e.target.value)}
              placeholder="#F59E0B"
            />
          </Field>
          <Field label="Font">
            <Input
              name="font"
              value={fields.font}
              onChange={(e) => set("font", e.target.value)}
              placeholder="Inter"
            />
          </Field>
          <Field label="Logo URL">
            <Input
              name="logo_url"
              value={fields.logo_url}
              onChange={(e) => set("logo_url", e.target.value)}
              placeholder="https://…/logo.png"
            />
          </Field>
          <Field label="Languages" hint="comma-separated">
            <Input
              name="languages"
              value={fields.languages}
              onChange={(e) => set("languages", e.target.value)}
              placeholder="English, Hindi"
            />
          </Field>
          <Field label="Locations served" hint="comma-separated">
            <Input
              name="locations"
              value={fields.locations}
              onChange={(e) => set("locations", e.target.value)}
              placeholder="Pune, Mumbai"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="USPs" hint="one per line">
              <Textarea
                name="usps"
                rows={3}
                value={fields.usps}
                onChange={(e) => set("usps", e.target.value)}
                placeholder={"25-year warranty\nSubsidy paperwork handled\n500+ installations"}
              />
            </Field>
          </div>
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
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Save className="h-4 w-4" />}
          Save Brand Brain
        </Button>
        {state.ok && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Saved
          </span>
        )}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
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
    </Label>
  );
}
