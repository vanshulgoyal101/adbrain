import { beforeEach, describe, expect, it, vi } from "vitest";
import hi from "../../messages/hi.json";
import { ConnectionAccessError } from "@/lib/meta/connection-access-error";

// #2333: Review (preflight) and Go live (create) answer in the owner's language, and create's gone draft
// says what happened and what to do, as preflight does, instead of "Draft not found.".
const mocks = vi.hoisted(() => ({
  lang: undefined as string | undefined,
  requireOwnedBusiness: vi.fn(),
  prepareCampaignReview: vi.fn(),
}));

const businessId = "b123b123-b123-4123-8123-b123b123b123";
const draftId = "d123d123-d123-4123-8123-d123d123d123";
const DRAFT_GONE = "This campaign draft has expired or was removed. Reload the page and set up the campaign again. Nothing was sent to Meta.";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "adbrain_lang" && mocks.lang ? { value: mocks.lang } : undefined) }),
}));
vi.mock("@/lib/observability/logger", async (original) => ({
  ...await original<typeof import("@/lib/observability/logger")>(),
  recordProductEvent: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "a123a123-a123-4123-8123-a123a123a123" } } }) },
    // No saved operation for this key and no draft row: the draft expired or was removed.
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    },
  }),
}));
vi.mock("@/lib/meta/connection-access", async (original) => ({
  ...await original<typeof import("@/lib/meta/connection-access")>(),
  requireOwnedBusiness: mocks.requireOwnedBusiness,
}));
vi.mock("@/lib/campaign/preflight-service", () => ({ prepareCampaignReview: mocks.prepareCampaignReview }));
vi.mock("@/lib/campaign/preflight-runtime", () => ({ buildCampaignPreflightLoaders: () => ({}) }));

const post = (body: unknown) => new Request("https://adbrain.test/api", { method: "POST", body: JSON.stringify(body) });
const preflight = async () => (await import("@/app/api/campaigns/preflight/route")).POST(post({ businessId, draftId, draftVersion: 1 }));
const create = async () => (await import("@/app/api/campaigns/create/route")).POST(post({
  businessId, draftId, draftVersion: 1, planHash: "a".repeat(64), connectionGeneration: 1, idempotencyKey: "key-12345678",
}));
const error = async (response: Response) => ({ status: response.status, ...(await response.json()).error });

describe("#2333 Review and Go live errors in the owner's language", () => {
  beforeEach(() => {
    mocks.lang = undefined;
    mocks.requireOwnedBusiness.mockReset().mockResolvedValue({ businessId, userId: "a123a123-a123-4123-8123-a123a123a123" });
    mocks.prepareCampaignReview.mockReset();
  });

  it("create's expired draft says what to do and that nothing was sent, as preflight does", async () => {
    expect(await error(await create())).toMatchObject({ status: 404, code: "NOT_FOUND", message: DRAFT_GONE });
  });

  it("create's expired draft is Hindi for a हिन्दी owner", async () => {
    mocks.lang = "hi";
    expect(await error(await create())).toMatchObject({ status: 404, code: "NOT_FOUND", message: hi.errors.draftGone });
  });

  it("preflight's expired draft and failed check are Hindi for a हिन्दी owner", async () => {
    mocks.lang = "hi";
    mocks.prepareCampaignReview.mockResolvedValueOnce({ kind: "not_found" });
    expect(await error(await preflight())).toMatchObject({ status: 404, message: hi.errors.draftGone });
    mocks.prepareCampaignReview.mockRejectedValueOnce(new Error("loader exploded"));
    expect(await error(await preflight())).toMatchObject({ status: 503, retryable: true, message: hi.errors.reviewCheckFailed });
    mocks.prepareCampaignReview.mockResolvedValueOnce({ kind: "stale" });
    expect(await error(await preflight())).toMatchObject({ status: 409, message: hi.errors.draftChangedElsewhere });
  });

  it("a business the owner can't open is Hindi on both routes, by the access error's code", async () => {
    mocks.lang = "hi";
    mocks.requireOwnedBusiness.mockRejectedValue(new ConnectionAccessError("FORBIDDEN", "Business access is not allowed."));
    expect(await error(await preflight())).toMatchObject({ status: 403, code: "FORBIDDEN", message: hi.errors.businessAccessDenied });
    expect(await error(await create())).toMatchObject({ status: 403, code: "FORBIDDEN", message: hi.errors.businessAccessDenied });
    mocks.requireOwnedBusiness.mockRejectedValue(new ConnectionAccessError("UNAVAILABLE", "Business access could not be checked."));
    expect(await error(await preflight())).toMatchObject({ status: 503, message: hi.errors.businessAccessUnchecked });
    expect(await error(await create())).toMatchObject({ status: 503, message: hi.errors.businessAccessUnchecked });
  });
});
