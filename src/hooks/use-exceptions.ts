"use client";

import useSWR from "swr";
import type { PaginatedResponse, ExceptionWithRelations, ExceptionCounts } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useExceptions(params?: {
  category?: "shipment" | "processing";
  status?: string;
  type?: string;
  page?: number;
  limit?: number;
  orderId?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set("category", params.category);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.type) searchParams.set("type", params.type);
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.orderId) searchParams.set("orderId", params.orderId);

  const { data, error, isLoading, mutate } = useSWR<
    PaginatedResponse<ExceptionWithRelations>
  >(`/api/exceptions?${searchParams.toString()}`, fetcher, {
    refreshInterval: 30000,
  });

  return {
    exceptions: data?.data || [],
    pagination: data?.pagination,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useExceptionCounts() {
  const { data, mutate } = useSWR<ExceptionCounts>(
    "/api/exceptions/counts",
    fetcher,
    { refreshInterval: 30000 }
  );
  return { counts: data, refreshCounts: mutate };
}
