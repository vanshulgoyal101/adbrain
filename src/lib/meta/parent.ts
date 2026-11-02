import { GRAPH } from "@/lib/meta/graph-version";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { appSecretProof } from "@/lib/meta/appsecret-proof";

const meSchema = z.object({ id: z.string() });
const businessSchema = z.object({ id: z.string(), verification_status: z.string().optional() });
const errorSchema = z.object({ error: z.object({ code: z.number().optional(), error_subcode: z.number().optional(), type: z.string().optional() }) });

export type ParentAccess =
  | { configured: false; enabled: boolean }
  | { configured: true; enabled: boolean; ok: true; businessVerified: boolean }
  | { configured: true; enabled: boolean; ok: false; errorCode: string };

/**
 * Read-only check of the 2-Tier parent's system-user token (#520): the token is valid and can
 * read the parent business. Returns codes only, never the token, IDs or Meta's message text.
 */
export async function checkParentAccess(fetchImpl: typeof fetch = fetch): Promise<ParentAccess> {
  const env = getEnv();
  const enabled = env.MANAGED_ACCOUNTS_ENABLED;
  const token = env.META_PARENT_SYSTEM_TOKEN;
  if (!token) return { configured: false, enabled };
  const parentId = env.META_PARENT_BUSINESS_ID;
  if (!parentId) return { configured: true, enabled, ok: false, errorCode: "NOT_CONFIGURED" };
  async function read(path: string) {
    const proof = appSecretProof(token);
    const response = await fetchImpl(`${GRAPH}/${path}${proof ? `${path.includes("?") ? "&" : "?"}appsecret_proof=${proof}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const meta = errorSchema.safeParse(body);
      const code = meta.success ? `META_${meta.data.error.code ?? "?"}${meta.data.error.error_subcode ? `_${meta.data.error.error_subcode}` : ""}` : `HTTP_${response.status}`;
      throw new Error(code);
    }
    return body;
  }
  try {
    meSchema.parse(await read("me?fields=id"));
    const business = businessSchema.parse(await read(`${encodeURIComponent(parentId)}?fields=id,verification_status`));
    if (business.id !== parentId) return { configured: true, enabled, ok: false, errorCode: "BUSINESS_MISMATCH" };
    return { configured: true, enabled, ok: true, businessVerified: business.verification_status === "verified" };
  } catch (error) {
    const code = error instanceof Error && /^(META|HTTP)_[\w?]+$/.test(error.message) ? error.message : "UNREADABLE_RESPONSE";
    return { configured: true, enabled, ok: false, errorCode: code };
  }
}
