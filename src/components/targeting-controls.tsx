"use client";

import * as React from "react";
import { Loader2, MapPin, Search, Sparkles, X } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { describeAudience } from "@/lib/campaign/targeting";
import { cn } from "@/lib/utils";

export interface GeoPick {
  key: string;
  name: string;
  type: string;
  region?: string | null;
}

export interface TargetingValue {
  locationMode: "ai" | "manual";
  included: GeoPick[];
  excluded: GeoPick[];
  radiusKm: number;
  ageMode: "ai" | "manual";
  ageMin: number;
  ageMax: number;
}

export const defaultTargeting: TargetingValue = {
  locationMode: "ai",
  included: [],
  excluded: [],
  radiusKm: 25,
  ageMode: "ai",
  ageMin: 25,
  ageMax: 55,
};

function ModeToggle({
  mode,
  onChange,
  aiLabel = "Let AdBrain decide",
}: {
  mode: "ai" | "manual";
  onChange: (m: "ai" | "manual") => void;
  aiLabel?: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange("ai")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-3 py-1 font-medium transition-colors",
          mode === "ai"
            ? "bg-white text-emerald-700 shadow-sm"
            : "text-slate-500 hover:text-slate-700",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {aiLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("manual")}
        className={cn(
          "rounded-md px-3 py-1 font-medium transition-colors",
          mode === "manual"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-500 hover:text-slate-700",
        )}
      >
        Choose myself
      </button>
    </div>
  );
}

function LocationPicker({
  value,
  onChange,
  placeholder,
  tone,
}: {
  value: GeoPick[];
  onChange: (next: GeoPick[]) => void;
  placeholder: string;
  tone: "include" | "exclude";
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<GeoPick[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (!cancelled) setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/meta/geo-search?q=${encodeURIComponent(q)}`,
        );
        const data = (await res.json()) as { results?: GeoPick[] };
        if (!cancelled) {
          setResults(data.results ?? []);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function add(pick: GeoPick) {
    if (!value.some((v) => v.type === pick.type && v.key === pick.key)) {
      onChange([...value, pick]);
    }
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function remove(pick: GeoPick) {
    onChange(value.filter((v) => !(v.type === pick.type && v.key === pick.key)));
  }

  const chip =
    tone === "include"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-rose-50 text-rose-800 border-rose-200";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className="pl-9"
        />
        {open && results.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {results.map((r) => (
              <li key={`${r.type}:${r.key}`}>
                <button
                  type="button"
                  onClick={() => add(r)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate text-slate-800">{r.name}</span>
                  <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {r.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span
              key={`${v.type}:${v.key}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                chip,
              )}
            >
              {v.name}
              <button
                type="button"
                aria-label={`Remove ${v.name}`}
                onClick={() => remove(v)}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Friendly audience targeting for a campaign: pick where ads show (and where
 * they don't), how wide around each city, and the age range — or let AdBrain
 * decide any of it. Reports the full value up via onChange.
 */
export function TargetingControls({
  value,
  onChange,
  brandAreas,
}: {
  value: TargetingValue;
  onChange: (v: TargetingValue) => void;
  brandAreas: string[];
}) {
  const set = (patch: Partial<TargetingValue>) => onChange({ ...value, ...patch });

  const hasCities = value.included.some((i) => i.type === "city");
  const areaLabel =
    value.locationMode === "manual" && value.included.length
      ? value.included.map((i) => i.name).join(", ")
      : brandAreas.length
        ? brandAreas.join(", ")
        : "India (nationwide)";

  const audience = describeAudience({
    areaLabel,
    excluded: value.excluded.map((e) => ({
      key: e.key,
      name: e.name,
      type: e.type,
    })),
    ageMode: value.ageMode,
    ageMin: value.ageMin,
    ageMax: value.ageMax,
  });

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      {/* Location */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            Where should ads show?
            <InfoHint>
              The area your ads run in. Solar is local — targeting the towns you
              actually serve means cheaper, better leads than showing to the
              whole country.
            </InfoHint>
          </Label>
          <ModeToggle
            mode={value.locationMode}
            onChange={(m) => set({ locationMode: m })}
          />
        </div>

        {value.locationMode === "ai" ? (
          <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
            {brandAreas.length ? (
              <>
                AdBrain will target your service areas from your Brand Brain:{" "}
                <span className="font-medium">{brandAreas.join(", ")}</span>.
              </>
            ) : (
              <>
                No service areas saved yet, so ads would run across India. Add
                your areas in the Brand Brain, or switch to “Choose myself”.
              </>
            )}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-slate-600">
                Show ads in
                <InfoHint>
                  Cities, districts or states where you want leads. Start typing
                  and pick from the list.
                </InfoHint>
              </Label>
              <LocationPicker
                value={value.included}
                onChange={(included) => set({ included })}
                placeholder="e.g. Jaipur, Rajasthan…"
                tone="include"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-slate-600">
                Don’t show in (optional)
                <InfoHint>
                  Places to skip — e.g. areas you can’t install in, or a city
                  you already have enough leads from.
                </InfoHint>
              </Label>
              <LocationPicker
                value={value.excluded}
                onChange={(excluded) => set({ excluded })}
                placeholder="e.g. exclude a city…"
                tone="exclude"
              />
            </div>
          </div>
        )}

        {value.locationMode === "manual" && hasCities && (
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-slate-600">
              Radius around each city: {value.radiusKm} km
              <InfoHint>
                How far out from a city centre to reach. Wider = more people but
                less local. 25 km suits most solar installers.
              </InfoHint>
            </Label>
            <input
              type="range"
              min={5}
              max={80}
              step={5}
              value={value.radiusKm}
              onChange={(e) => set({ radiusKm: Number(e.target.value) })}
              className="w-full accent-emerald-600"
            />
          </div>
        )}
      </div>

      {/* Age */}
      <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            Age range
            <InfoHint>
              Homeowners who buy solar skew 30–60. Leaving this to AdBrain lets
              Meta Advantage+ find the best ages automatically.
            </InfoHint>
          </Label>
          <ModeToggle
            mode={value.ageMode}
            onChange={(m) => set({ ageMode: m })}
          />
        </div>
        {value.ageMode === "manual" && (
          <div className="flex items-center gap-3 text-sm">
            <input
              type="number"
              min={18}
              max={65}
              value={value.ageMin}
              onChange={(e) => set({ ageMin: Number(e.target.value) })}
              className="h-10 w-20 rounded-lg border border-slate-300 bg-white px-3 text-center outline-none focus:border-emerald-500"
            />
            <span className="text-slate-400">to</span>
            <input
              type="number"
              min={18}
              max={65}
              value={value.ageMax}
              onChange={(e) => set({ ageMax: Number(e.target.value) })}
              className="h-10 w-20 rounded-lg border border-slate-300 bg-white px-3 text-center outline-none focus:border-emerald-500"
            />
          </div>
        )}
      </div>

      {/* Live summary */}
      <div className="rounded-lg bg-white px-3 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200">
        <span className="font-medium text-slate-800">Who’ll see this:</span>{" "}
        {audience}
      </div>
    </div>
  );
}
