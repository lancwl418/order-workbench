"use client";

import useSWR from "swr";
import { useCallback, useState } from "react";
import type { OrderListItem, PaginatedResponse } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export type OrderFilters = {
  page: number;
  limit: number;
  status?: string;
  shippingRoute?: string;
  labelStatus?: string;
  search?: string;
  sort: string;
  dir: "asc" | "desc";
  view: string;
};

const defaultFilters: OrderFilters = {
  page: 1,
  limit: 25,
  sort: "shopifyCreatedAt",
  dir: "desc",
  view: "all",
};

function buildQueryString(filters: OrderFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  });
  return params.toString();
}

export function useOrders(initialView: string = "all") {
  const [filters, setFilters] = useState<OrderFilters>({
    ...defaultFilters,
    view: initialView,
  });

  const queryString = buildQueryString(filters);
  const { data, error, isLoading, mutate } = useSWR<
    PaginatedResponse<OrderListItem>
  >(`/api/orders?${queryString}`, fetcher, {
    keepPreviousData: true,
  });

  const setPage = useCallback(
    (page: number) => setFilters((f) => ({ ...f, page })),
    []
  );

  const setSearch = useCallback(
    (search: string) => setFilters((f) => ({ ...f, search, page: 1 })),
    []
  );

  const setStatus = useCallback(
    (status: string | undefined) =>
      setFilters((f) => ({ ...f, status, page: 1 })),
    []
  );

  const setShippingRoute = useCallback(
    (shippingRoute: string | undefined) =>
      setFilters((f) => ({ ...f, shippingRoute, page: 1 })),
    []
  );

  const setSort = useCallback(
    (sort: string, dir?: "asc" | "desc") =>
      setFilters((f) => ({
        ...f,
        sort,
        dir: dir || (f.sort === sort && f.dir === "asc" ? "desc" : "asc"),
      })),
    []
  );

  const resetFilters = useCallback(
    () => setFilters({ ...defaultFilters, view: initialView }),
    [initialView]
  );

  return {
    orders: data?.data || [],
    pagination: data?.pagination,
    isLoading,
    error,
    filters,
    setFilters,
    setPage,
    setSearch,
    setStatus,
    setShippingRoute,
    setSort,
    resetFilters,
    refresh: mutate,
  };
}
