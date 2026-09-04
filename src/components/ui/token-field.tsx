"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Comma-separated list rendered as removable chips with native suggestions.
 * Values stay free-form (the copywriter LLM handles anything, and website
 * autofill returns arbitrary strings), so suggestions are a shortcut rather
 * than a fixed set. A hidden input keeps the server's comma-separated contract.
 */
export function TokenField({
  name,
  value,
  onChange,
  suggestions = [],
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const listId = useId();
  const [draft, setDraft] = useState("");

  const tokens = value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  function commit(raw: string) {
    const next = raw.trim().replace(/,+$/, "").trim();
    if (!next) return;
    const exists = tokens.some((t) => t.toLowerCase() === next.toLowerCase());
    if (!exists) onChange([...tokens, next].join(", "));
    setDraft("");
  }

  function remove(token: string) {
    onChange(tokens.filter((t) => t !== token).join(", "));
  }

  const unused = suggestions.filter(
    (s) => !tokens.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={value} />

      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tokens.map((token) => (
            <span
              key={token}
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800"
            >
              {token}
              <button
                type="button"
                aria-label={`Remove ${token}`}
                onClick={() => remove(token)}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Input
        value={draft}
        list={unused.length ? listId : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          // Typing or picking a suggestion that ends in a comma commits it.
          if (next.includes(",")) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && tokens.length) {
            onChange(tokens.slice(0, -1).join(", "));
          }
        }}
        onBlur={() => commit(draft)}
      />

      {unused.length > 0 && (
        <datalist id={listId}>
          {unused.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
