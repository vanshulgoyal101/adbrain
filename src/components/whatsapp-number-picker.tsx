"use client";

import Link from "next/link";
import { useState } from "react";
import { Label } from "@/components/ui/input";
import { pickWhatsAppNumber, selectedWhatsAppNumberChoice } from "@/lib/campaign/manual-draft-input";
import { wantedWhatsAppMask } from "@/services/whatsapp-number-selection";
import type { WhatsAppNumberChoice, WhatsAppNumberSource } from "@/lib/types/campaign";

const choiceValue = ({ choiceId }: WhatsAppNumberChoice) => choiceId;

type WhatsAppNumberSelection = {
  whatsappNumber?: string;
  whatsappNumberSource?: WhatsAppNumberSource;
  whatsappNumberChoiceId?: string;
};

export function useWhatsAppNumberSelection(
  options: WhatsAppNumberChoice[],
  initial?: WhatsAppNumberSelection,
  businessUnavailable = false,
) {
  const [selection, setSelection] = useState({
    whatsappNumber: initial?.whatsappNumber ?? "",
    whatsappNumberSource: initial?.whatsappNumberSource,
    whatsappNumberChoiceId: initial?.whatsappNumberChoiceId,
  });
  const wantedMask = wantedWhatsAppMask(selection.whatsappNumber);
  const chosenNumber = pickWhatsAppNumber(options, wantedMask);
  const selectedChoice = selectedWhatsAppNumberChoice(
    options,
    selection.whatsappNumber,
    chosenNumber,
    selection.whatsappNumberSource,
    businessUnavailable,
    selection.whatsappNumberChoiceId,
  );
  const draft = {
    whatsappNumber: selection.whatsappNumber || chosenNumber,
    whatsappNumberSource: selection.whatsappNumber ? selection.whatsappNumberSource : selectedChoice?.source,
    whatsappNumberChoiceId: selection.whatsappNumber ? selection.whatsappNumberChoiceId : selectedChoice?.choiceId,
  };

  return {
    ...selection,
    wantedMask,
    selectedChoice,
    draft,
    guidedProps: draft.whatsappNumber ? draft : {},
    choose(choice: WhatsAppNumberChoice) {
      setSelection({
        whatsappNumber: choice.masked,
        whatsappNumberSource: choice.source,
        whatsappNumberChoiceId: choice.choiceId,
      });
    },
    restore(value: WhatsAppNumberSelection) {
      setSelection({
        whatsappNumber: value.whatsappNumber ?? "",
        whatsappNumberSource: value.whatsappNumberSource,
        whatsappNumberChoiceId: value.whatsappNumberChoiceId,
      });
    },
  };
}

export function WhatsAppNumberPicker({ options, selected, wanted, businessUnavailable, notLinked = false, checking = false, onChoose }: {
  options: WhatsAppNumberChoice[];
  selected: WhatsAppNumberChoice | undefined;
  wanted: string;
  businessUnavailable: boolean;
  notLinked?: boolean;
  checking?: boolean;
  onChoose: (choice: WhatsAppNumberChoice) => void;
}) {
  if (!options.length) {
    return <div className="flex min-w-0 flex-col gap-1.5">
      <p role="status" className="text-sm text-slate-600">
        {notLinked
          ? <>No WhatsApp number is linked yet. <Link href="/brand" className="font-medium text-blue-700 underline">Your business</Link> shows how to link one.</>
          : checking ? "Checking your WhatsApp numbers..." : "AdBrain checks your WhatsApp number when you prepare the review."}
      </p>
    </div>;
  }

  const page = options.find(({ source }) => source === "page");
  return <div className="flex min-w-0 flex-col gap-1.5">
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
  </div>;
}
