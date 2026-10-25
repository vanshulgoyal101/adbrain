import { encryptMetaToken } from "@/lib/meta/token-store";

// #624: managed businesses run on their child's own system-user token, stored encrypted in
// private.meta_tokens and read with meta_token_get scoped to the business.
export const CHILD_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

/** A meta_token_get stand-in serving each business only its own sealed child token. */
export function childTokenRpc(tokens: Record<string, { businessId: string; token: string }>) {
  return async (name: string, args: { p_token_id?: string; p_business_id?: string }) => {
    const stored = name === "meta_token_get" && args.p_token_id ? tokens[args.p_token_id] : undefined;
    if (!stored || stored.businessId !== args.p_business_id) return { data: [], error: null };
    const sealed = encryptMetaToken(stored.token, { tokenId: args.p_token_id!, businessId: stored.businessId });
    return { data: [{ id: args.p_token_id, business_id: stored.businessId, ciphertext: sealed.ciphertext, nonce: sealed.nonce,
      auth_tag: sealed.authTag, key_id: sealed.keyId, format_version: sealed.formatVersion,
      revoked_at: null, expires_at: null, data_access_expires_at: null }], error: null };
  };
}
