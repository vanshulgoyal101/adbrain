/**
 * Activation checklist for the dashboard. Turns the account's real state into
 * the ordered steps a new owner should complete to get their first leads.
 * Pure — the dashboard passes counts and renders the result.
 */

export interface OnboardingState {
  hasBrand: boolean;
  creativeCount: number;
  approvedCount: number;
  campaignCount: number;
}

export interface OnboardingStep {
  id: "brand" | "generate" | "approve" | "launch";
  title: string;
  hint: string;
  href: string;
  done: boolean;
}

export function onboardingSteps(state: OnboardingState): OnboardingStep[] {
  return [
    {
      id: "brand",
      title: "Set up your Brand Brain",
      hint: "Add your business once — voice, offers, and areas.",
      href: "/brand",
      done: state.hasBrand,
    },
    {
      id: "generate",
      title: "Create your first ad",
      hint: "Tell the Ad Assistant what you want and get finished ads.",
      href: "/create",
      done: state.creativeCount > 0,
    },
    {
      id: "approve",
      title: "Approve an ad you like",
      hint: "Pick a favourite in the Creative Studio.",
      href: "/studio",
      done: state.approvedCount > 0,
    },
    {
      id: "launch",
      title: "Launch a campaign",
      hint: "Turn approved ads into a paused Meta lead campaign.",
      href: "/campaigns",
      done: state.campaignCount > 0,
    },
  ];
}

export interface OnboardingProgress {
  done: number;
  total: number;
  /** True once every step is complete (hide the checklist). */
  complete: boolean;
  /** The first not-yet-done step, or null when finished. */
  next: OnboardingStep | null;
}

export function onboardingProgress(steps: OnboardingStep[]): OnboardingProgress {
  const done = steps.filter((s) => s.done).length;
  return {
    done,
    total: steps.length,
    complete: done === steps.length,
    next: steps.find((s) => !s.done) ?? null,
  };
}
