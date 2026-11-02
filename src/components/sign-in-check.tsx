"use client";

import { useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

/**
 * #1777/#2570: Supabase Auth CAPTCHA (Cloudflare Turnstile) for email sign-in, sign-up and resend.
 * Off unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; then every email or password request carries a fresh,
 * single-use token. The secret lives only in Supabase Auth settings (docs/operations/configuration.md, "Sign-in check").
 */
export const SIGN_IN_CHECK_WORDS = {
  waiting: "The security check isn't finished yet. Wait a moment, then try again.",
  failed: "The security check couldn't load. Refresh the page, or continue with Google.",
  rejected: "The security check expired. Please try again.",
} as const;

type Options = { captchaToken?: string };

export function useSignInCheck() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const enabled = siteKey !== "";
  const widget = useRef<TurnstileInstance>(undefined);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);

  return {
    enabled,
    /** The options for one protected request, or the words to show when no token is ready. */
    take(): { options: Options } | { problem: string } {
      if (!enabled) return { options: {} };
      if (token) return { options: { captchaToken: token } };
      return { problem: failed ? SIGN_IN_CHECK_WORDS.failed : SIGN_IN_CHECK_WORDS.waiting };
    },
    /** A token works once: clear it after every request, whatever the outcome. */
    reset() {
      if (!enabled) return;
      setToken(null);
      widget.current?.reset();
    },
    widget: enabled ? (
      <Turnstile
        ref={widget}
        siteKey={siteKey}
        // Hidden unless Cloudflare needs the visitor to act; out of the flex flow until then, so no empty gap.
        options={{ size: "flexible", appearance: "interaction-only", theme: "light", language: "auto" }}
        style={asking ? undefined : { position: "absolute" }}
        onBeforeInteractive={() => setAsking(true)}
        onAfterInteractive={() => setAsking(false)}
        onSuccess={(value) => { setToken(value); setFailed(false); }}
        onExpire={() => setToken(null)}
        onError={() => { setToken(null); setFailed(true); }}
      />
    ) : null,
  };
}
