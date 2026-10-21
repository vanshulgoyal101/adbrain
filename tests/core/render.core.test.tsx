// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Business } from "@/lib/types";
import run4 from "./fixtures/create-cedar-ridge-run4.json";
import { requestUrl } from "./replay";

// Core regression gate (#110): the Create result must render under the production CSP.
// Any CSP change fails the first test; review Create rendering before updating it.

const ORIGIN = "https://adbrain.vanshul.com";
const SUPABASE = "https://core-test.supabase.co";
const PRODUCTION_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://vanshul.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE} https://*.supabase.co https://vanshul.com https://graph.facebook.com`,
  "frame-src 'self' https://accounts.google.com https://www.facebook.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

/** Minimal CSP source matching: 'self', 'none', schemes and (wildcard) hosts. */
function allowedBy(policy: string, directive: string, target: string) {
  const directives = new Map(policy.split(";").map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources] as const;
  }));
  const url = new URL(target, ORIGIN);
  return (directives.get(directive) ?? directives.get("default-src") ?? []).some((source) => {
    if (source === "'self'") return url.origin === ORIGIN;
    if (/^[a-z][a-z\d+.-]*:$/.test(source)) return url.protocol === source;
    const host = /^(https?):\/\/(\*\.)?([^/:]+)$/.exec(source);
    if (!host || url.protocol !== `${host[1]}:`) return false;
    return host[2] ? url.hostname.endsWith(`.${host[3]}`) : url.hostname === host[3];
  });
}

const business = { ...run4.brand } as unknown as Business;
const variantGroup = "6d0e7324-171e-45df-894a-28ef6c910196";
const creatives = run4.angles.map(({ angleId, concept }, index) => ({
  id: `6f1c1d64-3a51-4b41-9f6f-0c0de000000${index + 1}`,
  business_id: business.id,
  variant_group: variantGroup,
  angle: angleId,
  headline: concept.headline,
  primary_text: concept.primary_text,
  cta: concept.cta,
  image_url: `${SUPABASE}/storage/v1/object/public/creatives/${business.id}/${variantGroup}/${angleId}-final.png`,
  status: "draft",
  generation: { concept },
}));

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("Create result under the production CSP", () => {
  it("serves the pinned policy on every route", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    const rules = await config.headers!();
    const policy = rules.find((rule) => rule.source === "/:path*")?.headers
      .find((header) => header.key === "Content-Security-Policy")?.value;
    expect(policy).toBe(PRODUCTION_POLICY);
  });

  it("renders three generated ads using only allowed sources and no eval", async () => {
    const { AdAssistant } = await import("@/components/ad-assistant");
    const { getSecurityHeaders } = await import("@/lib/security/headers");
    const policy = getSecurityHeaders(SUPABASE).find((header) => header.key === "Content-Security-Policy")!.value;
    // jsdom's selector engine compiles queries with Function; only app and library code is held to the CSP.
    const harness = /[\\/]node_modules[\\/](?:@asamuzakjp[\\/][^\\/]+|nwsapi|jsdom|@testing-library[\\/][^\\/]+|vitest|@vitest[\\/][^\\/]+|vite)[\\/]/;
    const blockedEval = vi.fn();
    const guard = (original: (...args: string[]) => unknown) => (...args: string[]) => {
      const caller = (new Error().stack ?? "").split("\n")[2] ?? "";
      if (harness.test(caller)) return original(...args);
      blockedEval(caller.trim());
      throw new EvalError("Refused to evaluate a string as JavaScript: 'unsafe-eval' is not allowed by the CSP.");
    };
    vi.stubGlobal("Function", guard(Function));
    vi.stubGlobal("eval", guard(eval));
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      requests.push(url);
      if (url === "/api/creatives/generate" && init?.method === "POST") return Response.json({ variantGroup, creatives, failures: [] });
      return Response.json({});
    }));
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({
      goal: run4.brief, started: true, turns: [], phase: "review", answers: [], prepared: { brief: run4.brief },
    }));

    render(<AdAssistant business={business} />);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });

    for (const { headline } of creatives) expect(await screen.findByRole("heading", { name: headline })).toBeInTheDocument();
    const images = [...document.querySelectorAll("img")].map((image) => image.getAttribute("src") ?? "");
    expect(images).toEqual(expect.arrayContaining(creatives.map((creative) => creative.image_url)));
    for (const src of images) expect(allowedBy(policy, "img-src", src), src).toBe(true);
    expect(requests).toContain("/api/creatives/generate");
    for (const url of requests) expect(allowedBy(policy, "connect-src", url), url).toBe(true);
    expect(document.querySelectorAll("object, embed, iframe")).toHaveLength(0);
    expect(blockedEval).not.toHaveBeenCalled();
  });
});
