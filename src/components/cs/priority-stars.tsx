"use client";

import { Star } from "lucide-react";

export function PriorityStars({ priority }: { priority: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < priority
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

export function PrioritySelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(value === i + 1 ? 0 : i + 1)}
        >
          <Star
            className={`h-4 w-4 cursor-pointer transition-colors ${
              i < value
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30 hover:text-amber-300"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
