"use client";

import useSWR from "swr";
import type { PrintGroupWithItems } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function usePrintGroups(status?: string) {
  const params = status ? `?status=${status}` : "";
  const { data, error, isLoading, mutate } = useSWR<PrintGroupWithItems[]>(
    `/api/print-groups${params}`,
    fetcher,
    { refreshInterval: 5000 }
  );

  return {
    groups: data || [],
    isLoading,
    error,
    refresh: () => mutate(),
  };
}
