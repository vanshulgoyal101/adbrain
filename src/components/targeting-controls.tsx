"use client";

import * as React from "react";
import { Loader2, MapPin, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/info-hint";
import { AGE_BOUNDS, describeAudience, normalizeAgeRange } from "@/lib/campaign/targeting";
import { cn } from "@/lib/utils";
import type { GeoPick, TargetingValue } from "@/lib/campaign/editor-targeting";
export { defaultTargeting, type GeoPick, type TargetingValue } from "@/lib/campaign/editor-targeting";

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
        aria-pressed={mode === "ai"}
        onClick={() => onChange("ai")}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-3 py-1 font-medium transition-colors",
          mode === "ai"
            ? "bg-white text-blue-700 shadow-sm"
            : "text-slate-500 hover:text-slate-700",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {aiLabel}
      </button>
      <button
        type="button"
        aria-pressed={mode === "manual"}
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
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [retry, setRetry] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const listId = React.useId();
  const statusId = React.useId();
  const loading = status === "loading";
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const searchCache = React.useRef(new Map<string, { results: GeoPick[]; expiresAt: number }>());
  // Set when the user dismisses the list, so a slow in-flight search can't pop
  // it back open underneath them. Cleared as soon as they type again.
  const dismissed = React.useRef(false);

  const dismiss = React.useCallback(() => {
    dismissed.current = true;
    setOpen(false);
  }, []);

  // Close the results dropdown when focus/clicks move outside the picker.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        dismissed.current = true;
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  React.useEffect(() => {
    const q = query.trim();
    const cacheKey = q.toLowerCase();
    const cached = searchCache.current.get(cacheKey);
    const fresh = cached && cached.expiresAt > Date.now();
    const controller = new AbortController();
    let cancelled = false;
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (!cancelled) { setResults([]); setStatus("idle"); }
        return;
      }
      if (fresh) {
        setResults(cached.results);
        setStatus("success");
        if (!dismissed.current) setOpen(true);
        return;
      }
      setStatus("loading");
      try {
        const res = await fetch(
          `/api/meta/geo-search?q=${encodeURIComponent(q)}`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) },
        );
        const data = (await res.json()) as { results?: GeoPick[] };
        if (!res.ok || !Array.isArray(data.results)) throw new Error("Location search failed.");
        if (!cancelled) {
          if (searchCache.current.size >= 20) {
            const oldest = searchCache.current.keys().next().value;
            if (oldest !== undefined) searchCache.current.delete(oldest);
          }
          searchCache.current.set(cacheKey, { results: data.results, expiresAt: Date.now() + 60_000 });
          setResults(data.results);
          setStatus("success");
          if (!dismissed.current) setOpen(true);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setStatus("error");
          if (!dismissed.current) setOpen(true);
        }
      }
    }, fresh ? 0 : 300);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(t);
    };
  }, [query, retry]);

  React.useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeIndex, listId, open]);

  function add(pick: GeoPick) {
    if (!value.some((v) => v.type === pick.type && v.key === pick.key)) {
      onChange([...value, pick]);
    }
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
    setStatus("idle");
    dismiss();
  }

  function remove(pick: GeoPick) {
    onChange(value.filter((v) => !(v.type === pick.type && v.key === pick.key)));
  }

  const chip =
    tone === "include"
      ? "bg-blue-50 text-blue-800 border-blue-200"
      : "bg-rose-50 text-rose-800 border-rose-200";

  return (
    <div ref={rootRef} className="flex flex-col gap-2" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
    }}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </span>
        <Input
          ref={inputRef}
          role="combobox"
          aria-label={tone === "include" ? "Search locations to include" : "Search locations to exclude"}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open && results.length > 0 ? listId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-describedby={open && (loading || status === "error" || (status === "success" && results.length === 0)) ? statusId : undefined}
          aria-busy={loading}
          value={query}
          onChange={(e) => {
            dismissed.current = false;
            setQuery(e.target.value);
            setResults([]);
            setActiveIndex(-1);
            const searchable = e.target.value.trim().length >= 2;
            setStatus(searchable ? "loading" : "idle");
            setOpen(searchable);
          }}
          onFocus={() => {
            dismissed.current = false;
            if (status !== "idle") setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Tab" && status !== "error")) dismiss();
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length > 0) {
              e.preventDefault();
              dismissed.current = false;
              setOpen(true);
              setActiveIndex((current) => e.key === "ArrowDown"
                ? (current + 1) % results.length
                : (current <= 0 ? results.length - 1 : current - 1));
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (activeIndex >= 0 && results[activeIndex]) add(results[activeIndex]);
            }
          }}
          placeholder={placeholder}
          className="pl-9"
        />
        {open && results.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={tone === "include" ? "Locations to include" : "Locations to exclude"}
            className="scrollbar-stable absolute z-30 mt-1 max-h-60 w-full overflow-y-scroll rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {results.map((r, index) => (
              <li key={`${r.type}:${r.key}`} role="presentation">
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => add(r)}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50", activeIndex === index && "bg-blue-50")}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 text-slate-800">
                    <span className="block truncate">{r.name}</span>
                    {r.region && <span className="block truncate text-xs text-slate-500">{r.region}</span>}
                  </span>
                  <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {r.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && (loading || status === "error" || (status === "success" && results.length === 0)) && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-lg">
            <p id={statusId} role="status" className="wrap-break-word">
              {loading ? "Searching locations..." : status === "error" ? "Location search is unavailable. Your selected places are unchanged." : `No locations found for "${query.trim()}".`}
            </p>
            {status === "error" && (
              <button type="button" className="mt-2 inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600"
                onClick={() => { inputRef.current?.focus(); dismissed.current = false; setStatus("loading"); setRetry((current) => current + 1); }}>
                <RefreshCw className="h-3.5 w-3.5" />Retry
              </button>
            )}
          </div>
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
  plannedAreas = [],
  plannedExclusions = [],
  onDecide,
}: {
  value: TargetingValue;
  onChange: (v: TargetingValue) => void;
  brandAreas: string[];
  plannedAreas?: string[];
  plannedExclusions?: string[];
  onDecide?: (field: "location" | "age") => void;
}) {
  const set = (patch: Partial<TargetingValue>) => onChange({ ...value, ...patch });

  // Ignore unparseable input so a cleared box can't put NaN in the field.
  const setAge = (key: "ageMin" | "ageMax", raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) set({ [key]: n } as Partial<TargetingValue>);
  };

  // Apply the same rule the server does, so the preview matches the campaign.
  const settleAges = () => {
    const settled = normalizeAgeRange(value.ageMin, value.ageMax);
    if (settled.min !== value.ageMin || settled.max !== value.ageMax) {
      set({ ageMin: settled.min, ageMax: settled.max });
    }
  };

  const hasCities = [...value.included, ...value.excluded].some((place) => place.type === "city");
  const cityScope = value.cityScope ?? "radius";
  const scopeId = React.useId();
  const areaNames = [...(value.locationMode === "manual" ? value.included.map((item) => item.name) : plannedAreas.length ? [] : brandAreas), ...plannedAreas];
  const areaLabel = areaNames.length ? areaNames.join(", ") : "an area still to be selected";

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
              The area your ads run in. Most local businesses do best targeting
              only the towns they actually serve — cheaper, better leads than
              showing to the whole country.
            </InfoHint>
          </Label>
          <ModeToggle
            mode={value.locationMode}
            onChange={(mode) => mode === "ai" && onDecide ? onDecide("location") : set({ locationMode: mode })}
          />
        </div>

        {value.locationMode === "ai" ? (
          <p className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm text-blue-800">
            {plannedAreas.length ? (
              <>Saved campaign areas: <span className="font-medium">{plannedAreas.join(", ")}</span>.</>
            ) : brandAreas.length ? (
              <>
                AdBrain will target your service areas from your Brand Brain:{" "}
                <span className="font-medium">{brandAreas.join(", ")}</span>.
              </>
            ) : (
              <>
                No service areas selected.
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

        {(value.locationMode === "ai" || hasCities || plannedAreas.length > 0 || plannedExclusions.length > 0) && (
          <fieldset className="min-w-0">
            <legend className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              City coverage
              <InfoHint>No added radius uses Meta&apos;s city area, not a guaranteed municipal boundary. Applies to included and excluded cities; states and countries are unchanged.</InfoHint>
            </legend>
            <div className="grid w-full grid-cols-2 rounded-md border border-slate-200 bg-slate-100 p-0.5 sm:max-w-80">
              {([ ["city_only", "City only"], ["radius", "City + radius"] ] as const).map(([scope, label]) => (
                <label key={scope} className="relative min-w-0 cursor-pointer">
                  <input type="radio" name={scopeId} value={scope} checked={cityScope === scope}
                    onChange={() => set({ cityScope: scope })} className="peer sr-only" />
                  <span title={scope === "city_only" ? "No added radius; Meta defines the city area" : "City with a surrounding radius"}
                    className="flex min-h-10 items-center justify-center rounded px-2 py-1 text-center text-sm font-medium text-slate-600 peer-checked:bg-white peer-checked:text-blue-700 peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-blue-600">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {cityScope === "radius" && (hasCities || plannedAreas.length > 0 || plannedExclusions.length > 0 || value.locationMode === "ai") && (
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-slate-600">
              Radius around each city: {value.radiusKm} km
              <InfoHint>
                How far out from a city centre to reach. Wider = more people but
                less local. 25 km suits most local businesses.
              </InfoHint>
            </Label>
            <input
              type="range"
              aria-label="City radius in kilometers"
              min={17}
              max={80}
              step={1}
              value={value.radiusKm}
              onChange={(e) => set({ radiusKm: Number(e.target.value) })}
              className="w-full accent-blue-600"
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
              AdBrain recommends an age range from the business and campaign context.
              You can review and change the recommendation before creation.
            </InfoHint>
          </Label>
          <ModeToggle
            mode={value.ageMode}
            onChange={(mode) => mode === "ai" && onDecide ? onDecide("age") : set({ ageMode: mode })}
          />
        </div>
        {value.ageMode === "manual" && (
          <div className="flex items-center gap-3 text-sm">
            <input
              type="number"
              min={AGE_BOUNDS.min}
              max={AGE_BOUNDS.max}
              aria-label="Minimum age"
              value={value.ageMin}
              // Settle on blur, not per keystroke, so typing "3" toward "30"
              // isn't fought by the clamp.
              onChange={(e) => setAge("ageMin", e.target.value)}
              onBlur={() => settleAges()}
              className="h-10 w-20 rounded-lg border border-slate-300 bg-white px-3 text-center outline-none focus:border-blue-500"
            />
            <span className="text-slate-400">to</span>
            <input
              type="number"
              min={AGE_BOUNDS.min}
              max={AGE_BOUNDS.max}
              aria-label="Maximum age"
              value={value.ageMax}
              onChange={(e) => setAge("ageMax", e.target.value)}
              onBlur={() => settleAges()}
              className="h-10 w-20 rounded-lg border border-slate-300 bg-white px-3 text-center outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        <Label htmlFor="audience-gender">Gender</Label>
        <select
          id="audience-gender"
          value={value.gender ?? "all"}
          onChange={(event) => set({ gender: event.target.value as TargetingValue["gender"] })}
          className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 sm:max-w-64"
        >
          <option value="all">All genders</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
        </select>
      </div>

      {/* Live summary */}
      <div className="rounded-lg bg-white px-3 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200">
        <span className="font-medium text-slate-800">Who’ll see this:</span>{" "}
        {audience}
        {" "}{value.gender === "men" ? "Men." : value.gender === "women" ? "Women." : "All genders."}
        {plannedExclusions.length > 0 && <> Excluding {plannedExclusions.join(", ")}.</>}
      </div>
    </div>
  );
}
