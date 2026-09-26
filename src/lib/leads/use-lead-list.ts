"use client";

import { useEffect, useRef, useState } from "react";
import type { LeadPage } from "./queries";

export function useLeadList(initialPage: LeadPage, filters: { query: string; status: string; contact: string; sort: string }) {
  const { query, status, contact, sort } = filters;
  const key = JSON.stringify([query.trim(), status, contact, sort]);
  const [state, setState] = useState({ ...initialPage, key, loading: false, error: null as string | null });
  const current = useRef(state);
  const seed = useRef(true);
  const previousSearch = useRef(query);
  const initial = useRef(initialPage.leads);
  const [request, setRequest] = useState<{ append: boolean } | null>(null);

  useEffect(() => {
    if (initial.current !== initialPage.leads) {
      initial.current = initialPage.leads;
      setRequest({ append: false });
    }
  }, [initialPage.leads]);

  useEffect(() => {
    if (seed.current && current.current.key === key && !request) return;
    seed.current = false;
    const sameFilters = current.current.key === key;
    const cursor = sameFilters && request?.append ? current.current.nextCursor : null;
    const debounce = previousSearch.current !== query && Boolean(query.trim());
    previousSearch.current = query;
    const base = sameFilters ? current.current : { leads: [], total: 0, nextCursor: null, key, loading: false, error: null };
    current.current = { ...base, loading: true, error: null };
    setState(current.current);
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ query: query.trim(), status, contact, sort });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/leads?${params}`, { signal: controller.signal, credentials: "same-origin", cache: "no-store" });
        const data = await response.json() as LeadPage;
        controller.signal.throwIfAborted();
        if (!response.ok || !Array.isArray(data.leads) || !Number.isInteger(data.total) || data.total < 0 ||
          (data.nextCursor !== null && typeof data.nextCursor !== "string")) throw new Error("Invalid page");
        const rows = cursor ? [...base.leads, ...data.leads] : data.leads;
        current.current = { ...data, leads: [...new Map(rows.map(lead => [lead.id, lead])).values()], key, loading: false, error: null };
        setState(current.current);
      } catch {
        if (!controller.signal.aborted) {
          current.current = { ...base, loading: false, error: "Enquiries could not be loaded. Your saved records have not changed." };
          setState(current.current);
        }
      }
    }
    const timer = setTimeout(() => { void load(); }, debounce ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, query, status, contact, sort, request]);

  return {
    ...state,
    leads: state.key === key ? state.leads : [],
    loading: state.loading || state.key !== key,
    refresh: () => setRequest({ append: false }),
    loadMore: () => { if (!state.loading && state.nextCursor) setRequest({ append: true }); },
  };
}