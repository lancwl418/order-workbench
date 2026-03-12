"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INTERNAL_STATUSES, SHIPPING_ROUTES, STATUS_LABELS } from "@/lib/constants";
import { Search, X } from "lucide-react";
import type { OrderFilters } from "@/hooks/use-orders";

interface OrderFilterProps {
  filters: OrderFilters;
  onSearchChange: (search: string) => void;
  onStatusChange: (status: string | undefined) => void;
  onRouteChange: (route: string | undefined) => void;
  onReset: () => void;
}

export function OrderFilterBar({
  filters,
  onSearchChange,
  onStatusChange,
  onRouteChange,
  onReset,
}: OrderFilterProps) {
  const hasFilters =
    filters.search || filters.status || filters.shippingRoute;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search orders..."
          value={filters.search || ""}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      <Select
        value={filters.status || "ALL"}
        onValueChange={(v) =>
          onStatusChange(!v || v === "ALL" ? undefined : v)
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Statuses</SelectItem>
          {INTERNAL_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.shippingRoute || "ALL"}
        onValueChange={(v) =>
          onRouteChange(!v || v === "ALL" ? undefined : v)
        }
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All Routes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Routes</SelectItem>
          {SHIPPING_ROUTES.map((r) => (
            <SelectItem key={r} value={r}>
              {STATUS_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X className="h-4 w-4 mr-1" />
          Reset
        </Button>
      )}
    </div>
  );
}
