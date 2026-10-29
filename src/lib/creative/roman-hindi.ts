// Pure, so browser code (whatsapp-greeting) can use it without pulling in the LLM router (#2230).
const HINGLISH_WORDS = new Set(["mujhe", "humein", "hume", "chahiye", "karo", "karna", "karwa", "karwao", "banao", "banana", "hai", "hain",
  "liye", "aur", "nahi", "nahin", "kya", "apne", "apna", "apni", "mera", "meri", "hamara", "zyada", "jyada", "mein", "wala", "wale", "kaise", "abhi"]);

/** Hindi written in Roman script: at least two common Hindi words ("mujhe … chahiye"). */
export function isRomanHindi(text: string): boolean {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  return [...HINGLISH_WORDS].filter((word) => words.has(word)).length >= 2;
}
