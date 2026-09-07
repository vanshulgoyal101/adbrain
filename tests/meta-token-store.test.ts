import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.META_TOKEN_ENCRYPTION_KEY = KEY;
});

describe("Meta token encryption", () => {
  it("round-trips with a fresh nonce and authenticated context", async () => {
    const { decryptMetaToken, encryptMetaToken, fromPostgresBytea, toPostgresBytea } = await import("@/lib/meta/token-store");
    const context = { tokenId: "token-1", businessId: "business-1" };
    const encrypted = encryptMetaToken("secret-token", context);

    expect(encrypted.keyId).toBe("meta-token-v1");
    expect(encrypted.formatVersion).toBe("v1");
    expect(encrypted.nonce).not.toBe(
      encryptMetaToken("secret-token", context).nonce,
    );
    expect(decryptMetaToken(encrypted, context)).toBe("secret-token");
    expect(fromPostgresBytea(toPostgresBytea(encrypted.ciphertext))).toBe(encrypted.ciphertext);
    expect(fromPostgresBytea(toPostgresBytea(encrypted.nonce))).toBe(encrypted.nonce);
  });

  it("rejects a different tenant or modified authentication tag", async () => {
    const { decryptMetaToken, encryptMetaToken } = await import("@/lib/meta/token-store");
    const encrypted = encryptMetaToken("secret-token", {
      tokenId: "token-1",
      businessId: "business-1",
    });

    expect(() =>
      decryptMetaToken(encrypted, { tokenId: "token-1", businessId: "business-2" }),
    ).toThrow();
    expect(() =>
      decryptMetaToken(
        { ...encrypted, authTag: Buffer.alloc(16, 1).toString("base64") },
        { tokenId: "token-1", businessId: "business-1" },
      ),
    ).toThrow();
  });

  it("fails closed when the key is missing or malformed", async () => {
    delete process.env.META_TOKEN_ENCRYPTION_KEY;
    const missing = await import("@/lib/meta/token-store");
    expect(() =>
      missing.encryptMetaToken("secret-token", { tokenId: "t", businessId: "b" }),
    ).toThrow(/not configured/i);

    vi.resetModules();
    process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(31).toString("base64");
    const malformed = await import("@/lib/meta/token-store");
    expect(() =>
      malformed.encryptMetaToken("secret-token", { tokenId: "t", businessId: "b" }),
    ).toThrow(/32 bytes/i);
  });
});