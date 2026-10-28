const CONTACT_KEY = /^(full_name|first_name|last_name|name)$|phone|mobile|email|whatsapp/;

/** The form's other answers: "What is your monthly bill: ₹3,000 · City: Mohali". */
export function leadAnswers(fieldData: unknown): { question: string; answer: string }[] {
  if (!fieldData || typeof fieldData !== "object" || Array.isArray(fieldData)) return [];
  return Object.entries(fieldData as Record<string, unknown>)
    .filter(([key, value]) => typeof value === "string" && value.trim() && !CONTACT_KEY.test(key))
    .map(([key, value]) => {
      const question = key.replace(/_+/g, " ").replace(/\?+$/, "").trim();
      return { question: question.charAt(0).toUpperCase() + question.slice(1), answer: value as string };
    });
}
