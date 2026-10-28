import { createHmac } from "node:crypto";

/**
 * Meta's `appsecret_proof`: HMAC-SHA256 of the access token with the app secret (#1648). With Meta's 'Require app
 * secret' on, a token without it is refused, so a stolen token alone is useless. Null when no secret is configured.
 */
export function appSecretProof(token: string, secret = process.env.META_APP_SECRET): string | null {
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
}
