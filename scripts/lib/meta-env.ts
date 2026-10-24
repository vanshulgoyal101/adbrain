// Local fixture recorders only (#520): the single Meta test account from .env.local. The app has no
// global Meta credentials; every tenant resolves its own connection (src/lib/meta/credentials).
import { MetaClient, type MetaCredentials } from "@/lib/meta/client";

export function getMetaCredentialsFromEnv(): MetaCredentials | null {
  const { META_SYSTEM_USER_TOKEN: accessToken, META_AD_ACCOUNT_ID: adAccountId, META_PAGE_ID: pageId } = process.env;
  return accessToken && adAccountId && pageId ? { accessToken, adAccountId, pageId } : null;
}

export function metaClientFromEnv(): MetaClient | null {
  const creds = getMetaCredentialsFromEnv();
  return creds ? new MetaClient(creds) : null;
}
