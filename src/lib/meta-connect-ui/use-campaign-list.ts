"use client";

import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Campaign, CampaignResult } from "@/lib/types";

export function useCampaignList(input: {
  businessId: string;
  initialCampaigns: Campaign[];
  initialResults: Record<string, CampaignResult>;
  initialNextCursor: string | null;
  onError: (message: string) => void;
}) {
  const { businessId, initialCampaigns, initialResults, initialNextCursor, onError } = input;
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [results, setResults] = useState(initialResults);
  const [campaignQuery, setCampaignQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [nextListCursor, setNextListCursor] = useState(initialNextCursor);
  const [listLoading, setListLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const lastFilters = useRef({ businessId, query: "", status: "all" });
  const mounted = useRef(false);

  async function loadCampaignPage(append = false) {
    append = append && lastFilters.current.businessId === businessId && lastFilters.current.query === campaignQuery && lastFilters.current.status === statusFilter;
    lastFilters.current = { businessId, query: campaignQuery, status: statusFilter };
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setListLoading(true);
    const params = new URLSearchParams({ businessId });
    if (campaignQuery.trim()) params.set("query", campaignQuery.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (append && nextListCursor) params.set("cursor", nextListCursor);
    try {
      const response = await fetch(`/api/campaigns/list?${params}`, { signal: controller.signal });
      const data = await response.json() as { campaigns: Campaign[]; results: Record<string, CampaignResult>; nextCursor: string | null; error?: string };
      controller.signal.throwIfAborted();
      if (!response.ok || !Array.isArray(data.campaigns)) throw new Error(data.error ?? "Campaign list could not be loaded.");
      setCampaigns(current => append ? [...new Map([...current, ...data.campaigns].map(campaign => [campaign.id, campaign])).values()] : data.campaigns);
      setResults(current => append ? { ...current, ...data.results } : data.results);
      setNextListCursor(data.nextCursor);
    } catch (reason) {
      if (!controller.signal.aborted) onError(reason instanceof Error ? reason.message : "Campaign list could not be loaded.");
    } finally {
      if (controllerRef.current === controller && !controller.signal.aborted) setListLoading(false);
    }
  }

  function replaceCampaignPage(nextCampaigns: Campaign[], cursor: string | null) {
    controllerRef.current?.abort();
    if (campaignQuery || statusFilter !== "all") { void loadCampaignPage(); return; }
    setCampaigns(nextCampaigns);
    setNextListCursor(cursor);
    setListLoading(false);
  }

  const reload = useEffectEvent(() => void loadCampaignPage());
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    controllerRef.current?.abort();
    startTransition(() => setListLoading(true));
    if (lastFilters.current.businessId !== businessId || lastFilters.current.status !== statusFilter || !campaignQuery.trim()) {
      startTransition(reload);
      return;
    }
    const timer = setTimeout(reload, 250);
    return () => clearTimeout(timer);
  }, [businessId, campaignQuery, statusFilter]);

  const receiveInitialPage = useEffectEvent(() => {
    replaceCampaignPage(initialCampaigns, initialNextCursor);
    setResults(current => ({ ...current, ...initialResults }));
  });
  useEffect(() => { startTransition(receiveInitialPage); }, [initialCampaigns, initialNextCursor, initialResults]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { campaigns, setCampaigns, results, setResults, campaignQuery, setCampaignQuery, statusFilter, setStatusFilter,
    nextListCursor, listLoading, loadCampaignPage, replaceCampaignPage };
}