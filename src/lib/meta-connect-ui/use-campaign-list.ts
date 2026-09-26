"use client";

import { useEffect, useEffectEvent, useRef, useState, type SetStateAction } from "react";
import { QueryClient, useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { Campaign, CampaignResult } from "@/lib/types";

type CampaignPage = {
  campaigns: Campaign[];
  results: Record<string, CampaignResult>;
  nextCursor: string | null;
};

type CampaignPages = InfiniteData<CampaignPage, string | null>;

export function useCampaignList(input: {
  ownerId: string;
  businessId: string;
  initialCampaigns: Campaign[];
  initialResults: Record<string, CampaignResult>;
  initialNextCursor: string | null;
  onError: (message: string) => void;
}) {
  const { ownerId, businessId, initialCampaigns, initialResults, initialNextCursor, onError } = input;
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 60_000 } } });
    client.setQueryData<CampaignPages>(["campaign-list", ownerId, businessId, { query: "", status: "all" }], {
      pages: [{ campaigns: initialCampaigns, results: initialResults, nextCursor: initialNextCursor }], pageParams: [null],
    });
    return client;
  });
  const [campaignQuery, setCampaignQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const search = campaignQuery.trim();
  const [settledSearch, setSettledSearch] = useState(search);
  const scopeKey = ["campaign-list", ownerId, businessId] as const;
  const queryKey = [...scopeKey, { query: search, status: statusFilter }] as const;
  const initialPage = { campaigns: initialCampaigns, results: initialResults, nextCursor: initialNextCursor };
  const received = useRef({ ownerId, businessId, initialCampaigns, initialResults, initialNextCursor });

  useEffect(() => {
    queryClient.mount();
    return () => { queryClient.clear(); queryClient.unmount(); };
  }, [queryClient]);

  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const key = ["campaign-list", ownerId, businessId, { query: search, status: statusFilter }];
    return () => queryClient.removeQueries({ queryKey: key, exact: true });
  }, [queryClient, ownerId, businessId, search, statusFilter]);

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<CampaignPage> => {
      const params = new URLSearchParams({ businessId });
      if (search) params.set("query", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(`/api/campaigns/list?${params}`, { signal, credentials: "same-origin", cache: "no-store" });
      const data = await response.json() as CampaignPage & { error?: string };
      signal.throwIfAborted();
      if (!response.ok || !data || !Array.isArray(data.campaigns) || !data.results || typeof data.results !== "object" ||
        Array.isArray(data.results) || (data.nextCursor !== null && typeof data.nextCursor !== "string")) {
        throw new Error(data?.error ?? "Campaign list could not be loaded.");
      }
      return data;
    },
    getNextPageParam: page => page.nextCursor,
    enabled: !search || search === settledSearch,
    staleTime: 30_000,
    gcTime: 60_000,
    networkMode: "always",
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  }, queryClient);

  const pages = query.data?.pages ?? [];
  const campaigns = [...new Map(pages.flatMap(page => page.campaigns).map(campaign => [campaign.id, campaign])).values()];
  const results = Object.assign({}, ...pages.map(page => page.results)) as Record<string, CampaignResult>;
  const nextListCursor = pages.at(-1)?.nextCursor ?? null;
  const listLoading = query.isFetching || Boolean(search && search !== settledSearch);
  const reportError = useEffectEvent((error: Error) => onError(error.message));
  useEffect(() => { if (query.error) reportError(query.error); }, [query.error, query.errorUpdatedAt]);

  async function loadCampaignPage(append = false) {
    if (search && search !== settledSearch) return;
    if (append) {
      if (query.hasNextPage && !query.isFetching) await query.fetchNextPage({ cancelRefetch: false });
    } else {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<CampaignPages>(queryKey, current => current && {
        pages: current.pages.slice(0, 1), pageParams: current.pageParams.slice(0, 1),
      });
      await query.refetch();
    }
  }

  function setCampaigns(update: SetStateAction<Campaign[]>) {
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<CampaignPages>(queryKey, current => current && {
      ...current,
      pages: current.pages.map(page => ({ ...page, campaigns: typeof update === "function" ? update(page.campaigns) : update })),
    });
    void queryClient.invalidateQueries({ queryKey: scopeKey });
  }

  function setResults(update: SetStateAction<Record<string, CampaignResult>>) {
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<CampaignPages>(queryKey, current => current && {
      ...current,
      pages: current.pages.map(page => ({ ...page, results: typeof update === "function" ? update(page.results) : update })),
    });
    void queryClient.invalidateQueries({ queryKey: scopeKey });
  }

  function receivePage(page: CampaignPage) {
    void queryClient.cancelQueries({ queryKey: scopeKey });
    queryClient.setQueryData<CampaignPages>([...scopeKey, { query: "", status: "all" }], { pages: [page], pageParams: [null] });
    void queryClient.invalidateQueries({ queryKey: scopeKey, refetchType: search || statusFilter !== "all" ? "active" : "none" });
  }

  function replaceCampaignPage(nextCampaigns: Campaign[], cursor: string | null) {
    receivePage({ campaigns: nextCampaigns, results, nextCursor: cursor });
  }

  const receiveInitialPage = useEffectEvent(() => {
    const previous = received.current;
    received.current = { ownerId, businessId, initialCampaigns, initialResults, initialNextCursor };
    if (previous.initialCampaigns === initialCampaigns && previous.initialResults === initialResults && previous.initialNextCursor === initialNextCursor) return;
    receivePage(initialPage);
  });
  useEffect(() => { receiveInitialPage(); }, [ownerId, businessId, initialCampaigns, initialNextCursor, initialResults]);

  return { campaigns, setCampaigns, results, setResults, campaignQuery, setCampaignQuery, statusFilter, setStatusFilter,
    nextListCursor, listLoading, loadCampaignPage, replaceCampaignPage };
}