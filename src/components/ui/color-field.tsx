"use client";

import { useId } from "react";
import { normalizeHex } from "@/lib/creative/design";
import { Input } from "@/components/ui/input";

/**
 * Hex colour field with a native swatch picker. The swatch needs a valid
 * `#rrggbb` at all times, so it shows the normalised colour while the text box
 * keeps whatever the user is mid-way through typing.
 */
export function ColorField({
  name,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const swatchId = useId();
  // <input type="color"> only accepts #rrggbb, so it tracks the normalised value.
  const swatch = normalizeHex(value, placeholder ?? "#2563eb").toLowerCase();
  const invalid = value.trim().length > 0 && normalizeHex(value, "") === "";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={swatchId}
          type="color"
          aria-label="Pick colour"
          value={swatch}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
        />
        <Input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          aria-invalid={invalid || undefined}
        />
      </div>
      {invalid && (
        <p className="text-xs text-red-600">
          Use a hex colour like {placeholder ?? "#2563EB"}.
        </p>
      )}
    </div>
  );
}
