/** Chips that mean "I'll type my own" (#284): the text box already does that, so they are never sent as answers. */
export function isWriteYourOwnOption(option: string): boolean {
  const text = option.normalize("NFKC").trim().toLowerCase();
  return /^(other|others|something else|custom|my own|your own|none of these|none of the above)$/.test(text)
    || /^(other|custom|my own|your own)\s+[\p{L}-]+$/u.test(text)
    || /\b(type|write|enter|specify)\b.*\b(below|own|yourself|here)\b/.test(text);
}

/** Answers that add no fact, so asking the same question again is not a repeat. */
export function isNonAnswer(answer: string): boolean {
  return isWriteYourOwnOption(answer)
    || /^(skip|not sure|i'?m not sure|i don'?t know|don'?t know|no idea|n\/?a|-|\.)$/i.test(answer.trim());
}
