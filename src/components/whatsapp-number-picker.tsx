"use client";

import { Label } from "@/components/ui/input";
import type { WhatsAppNumberChoice } from "@/lib/types/campaign";

const choiceValue = ({ choiceId }: WhatsAppNumberChoice) => choiceId;

export function WhatsAppNumberPicker({ options, selected, wanted, businessUnavailable, onChoose }: {
  options: WhatsAppNumberChoice[];
  selected: WhatsAppNumberChoice | undefined;
  wanted: string;
  businessUnavailable: boolean;
  onChoose: (choice: WhatsAppNumberChoice) => void;
}) {
  const page = options.find(({ source }) => source === "page");
  return <>
    <Label htmlFor="whatsapp-number">WhatsApp button number</Label>
    <select
      id="whatsapp-number"
      value={selected ? choiceValue(selected) : `unavailable:${wanted}`}
      onChange={(event) => {
        const choice = options.find((option) => choiceValue(option) === event.target.value);
        if (choice) onChoose(choice);
      }}
      className="h-11 w-full min-w-0 max-w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
    >
      {!selected && <option value={`unavailable:${wanted}`} disabled>
        {wanted ? `${wanted} (previously selected; check this number)` : "Choose your WhatsApp number"}
      </option>}
      {options.map((choice) => (
        <option key={choiceValue(choice)} value={choiceValue(choice)}>
          {choice.masked} ({choice.source === "page" ? "linked to your Page" : "your WhatsApp Business account"})
        </option>
      ))}
    </select>
    {businessUnavailable && <p role="status" className="text-sm text-slate-600">Some WhatsApp Business numbers could not be checked. Try again or choose your Page number.</p>}
    {businessUnavailable && !selected && page && <button
      type="button"
      className="min-h-11 max-w-full self-start text-left text-sm font-medium text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      onClick={() => onChoose(page)}
    >Use Page number {page.masked}</button>}
  </>;
}
