"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/**
 * Updates an exception status (investigate or resolve) with optional note and owner.
 */
export function useExceptionActions(onSuccess?: () => void) {
  const [loading, setLoading] = useState<string | null>(null);

  async function updateException(
    exceptionId: string,
    data: { status?: string; owner?: string | null; note?: string | null }
  ) {
    setLoading(exceptionId);
    try {
      const res = await fetch(`/api/exceptions/${exceptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update exception");
      toast.success(
        data.status === "RESOLVED"
          ? "Exception resolved"
          : data.status === "INVESTIGATING"
          ? "Marked as investigating"
          : "Exception updated"
      );
      onSuccess?.();
    } catch {
      toast.error("Failed to update exception");
    } finally {
      setLoading(null);
    }
  }

  async function investigate(exceptionId: string) {
    await updateException(exceptionId, { status: "INVESTIGATING" });
  }

  async function resolve(exceptionId: string) {
    await updateException(exceptionId, { status: "RESOLVED" });
  }

  return { loading, updateException, investigate, resolve };
}

/**
 * Inline note input for adding a note to an exception.
 */
export function ExceptionNoteInput({
  exceptionId,
  currentNote,
  onSaved,
}: {
  exceptionId: string;
  currentNote?: string | null;
  onSaved?: () => void;
}) {
  const [note, setNote] = useState(currentNote || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/exceptions/${exceptionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Note saved");
      onSaved?.();
    } catch {
      toast.error("Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add note..."
        className="h-7 text-xs"
      />
      <Button
        size="xs"
        variant="outline"
        onClick={handleSave}
        disabled={saving}
      >
        Save
      </Button>
    </div>
  );
}
