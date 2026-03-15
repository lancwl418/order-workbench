"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import useSWR from "swr";
import { Textarea } from "@/components/ui/textarea";
import { AtSign } from "lucide-react";

type UserOption = {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  mentions: string[];
  onMentionsChange: (mentions: string[]) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  onSubmit?: () => void;
}

export function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  placeholder,
  rows = 2,
  className,
  onSubmit,
}: MentionInputProps) {
  const { data: users } = useSWR<UserOption[]>("/api/users", fetcher);
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredUsers = (users || []).filter((u) => {
    const search = filter.toLowerCase();
    return (
      u.username.toLowerCase().includes(search) ||
      (u.displayName || "").toLowerCase().includes(search)
    );
  });

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      const cursorPos = e.target.selectionStart;
      // Look back from cursor for @ trigger
      const textBeforeCursor = newValue.slice(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");

      if (lastAtIndex >= 0) {
        const charBefore = lastAtIndex > 0 ? newValue[lastAtIndex - 1] : " ";
        const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
        // Only trigger if @ is at start or preceded by whitespace, and no spaces in query
        if ((charBefore === " " || charBefore === "\n" || lastAtIndex === 0) && !textAfterAt.includes(" ")) {
          setShowDropdown(true);
          setFilter(textAfterAt);
          setMentionStart(lastAtIndex);
          setSelectedIndex(0);
          return;
        }
      }

      setShowDropdown(false);
    },
    [onChange]
  );

  const insertMention = useCallback(
    (user: UserOption) => {
      const name = user.displayName || user.username;
      const before = value.slice(0, mentionStart);
      const afterCursor = textareaRef.current
        ? value.slice(textareaRef.current.selectionStart)
        : "";
      const newValue = `${before}@${name} ${afterCursor}`;
      onChange(newValue);

      if (!mentions.includes(user.id)) {
        onMentionsChange([...mentions, user.id]);
      }

      setShowDropdown(false);
      setFilter("");

      // Restore cursor position
      setTimeout(() => {
        const pos = before.length + name.length + 2; // @name + space
        textareaRef.current?.setSelectionRange(pos, pos);
        textareaRef.current?.focus();
      }, 0);
    },
    [value, mentionStart, mentions, onChange, onMentionsChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown && filteredUsers.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredUsers.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(filteredUsers[selectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          setShowDropdown(false);
          return;
        }
      }

      // Cmd/Ctrl+Enter to submit
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSubmit?.();
      }
    },
    [showDropdown, filteredUsers, selectedIndex, insertMention, onSubmit]
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />

      {/* @ hint button */}
      <button
        type="button"
        className="absolute right-2 bottom-2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        onClick={() => {
          const textarea = textareaRef.current;
          if (!textarea) return;
          const pos = textarea.selectionStart;
          const before = value.slice(0, pos);
          const after = value.slice(pos);
          const needsSpace = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
          const insert = (needsSpace ? " " : "") + "@";
          onChange(before + insert + after);
          setShowDropdown(true);
          setFilter("");
          setMentionStart(before.length + (needsSpace ? 1 : 0));
          setSelectedIndex(0);
          setTimeout(() => {
            const newPos = before.length + insert.length;
            textarea.setSelectionRange(newPos, newPos);
            textarea.focus();
          }, 0);
        }}
        tabIndex={-1}
      >
        <AtSign className="h-3.5 w-3.5" />
      </button>

      {/* Mention dropdown */}
      {showDropdown && filteredUsers.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 left-0 bottom-full mb-1 w-56 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md"
        >
          {filteredUsers.slice(0, 8).map((user, i) => (
            <button
              key={user.id}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                i === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(user);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                {(user.displayName || user.username)[0].toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {user.displayName || user.username}
                </div>
                {user.displayName && (
                  <div className="text-xs text-muted-foreground truncate">
                    @{user.username}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
