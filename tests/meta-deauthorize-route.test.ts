import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.NEXT_PUBLIC_SITE_URL = "https://adbrain.example.com/";
  process.env.META_APP_ID = "123456";
  process.env.META_APP_SECRET = "shhh-secret";
});

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

function signedRequest(userId: string, secret = "shhh-secret") {
  const payload = Buffer.from(JSON.stringify({
    algorithm: "HMAC-SHA256",
    user_id: userId,
    issued_at: 1_757_200_000,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${signature}.${payload}`;
}

function post(value: string) {
  return new Request("https://adbrain.example.com/api/meta/deauthorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: value }),
  });
}

describe("POST /api/meta/deauthorize (Meta data deletion callback)", () => {
  it("revokes the subject and returns Meta's {url, confirmation_code} contract", async () => {
    const { POST } = await import("@/app/api/meta/deauthorize/route");
    const res = await POST(post(signedRequest("meta-user-1")));
    expect(res.status).toBe(200);
    const body = await res.json() as { url: string; confirmation_code: string };
    expect(rpc).toHaveBeenCalledWith("meta_revoke_subject", { p_subject_id: "meta-user-1" });
    expect(body.confirmation_code).toMatch(/^[a-f0-9]{16}$/);
    expect(body.url).toBe(`https://adbrain.example.com/data-deletion?code=${body.confirmation_code}`);

    const again = await (await POST(post(signedRequest("meta-user-1")))).json() as { confirmation_code: string };
    const other = await (await POST(post(signedRequest("meta-user-2")))).json() as { confirmation_code: string };
    expect(again.confirmation_code).toBe(body.confirmation_code);
    expect(other.confirmation_code).not.toBe(body.confirmation_code);
  });

  // #730: the operator must see the request the status URL promises to answer.
  it("records a deletion request under the same confirmation code it returns", async () => {
    const { POST } = await import("@/app/api/meta/deauthorize/route");
    const body = await (await POST(post(signedRequest("meta-user-1")))).json() as { confirmation_code: string };
    expect(rpc).toHaveBeenCalledWith("meta_deletion_request_record", { p_subject_id: "meta-user-1", p_code: body.confirmation_code });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["meta_revoke_subject", "meta_deletion_request_record"]);
  });

  it("answers 503 so Meta retries when the request can't be recorded", async () => {
    rpc.mockImplementation(async (name: string) => ({ error: name === "meta_deletion_request_record" ? { message: "down" } : null }));
    const { POST } = await import("@/app/api/meta/deauthorize/route");
    expect((await POST(post(signedRequest("meta-user-1")))).status).toBe(503);
  });

  it("rejects an unsigned or forged request without revoking anything", async () => {
    const { POST } = await import("@/app/api/meta/deauthorize/route");
    const res = await POST(post(signedRequest("meta-user-1", "wrong-secret")));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
