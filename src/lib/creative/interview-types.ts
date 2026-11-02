import type { BrandContext } from "@/lib/templates/ads";

/**
 * A single, tap-friendly question the Ad Assistant asks a non-technical user.
 * The UI renders `options` as chips, plus optional shortcuts:
 * - `allowText`   → the user can type their own answer
 * - `allowRandom` → a "Surprise me" button (the AI picks a fun on-brand option)
 * - `aiCanDecide` → a "Let AI decide" button, shown ONLY when the Brand Brain
 *                   already implies a sensible default so the user can skip.
 */
export interface InterviewQuestion {
  id: string;
  field?: string;
  question: string;
  help?: string;
  options?: string[];
  allowText?: boolean;
  allowRandom?: boolean;
  aiCanDecide?: boolean;
}

/** One answered question, replayed to continue the interview. */
export interface InterviewAnswer {
  question: string;
  answer: string;
  questionId?: string;
  field?: string;
  options?: string[];
}

export interface InterviewResult {
  /** True when the assistant has enough to write the ad. */
  ready: boolean;
  /** The next single question (when not ready). */
  question?: InterviewQuestion;
  /** A vivid creative brief to generate from (when ready). */
  brief?: string;
  /** An AD_LANGUAGES id, if the user/brand implies a specific language. */
  language?: string;
  /** A preferred AD_ANGLES id, if one clearly fits. */
  angleId?: string;
  recommendations?: { label: string; prompt: string }[];
}

export interface InterviewInput {
  brand: BrandContext;
  instructions?: string;
  preferences?: string;
  goal: string;
  answers?: InterviewAnswer[];
  recentGoals?: string[];
  referenceBrief?: string;
  /** #371: the PAST RESULTS block built in code from the business's own results; "" or absent when none. */
  pastResults?: string;
}
