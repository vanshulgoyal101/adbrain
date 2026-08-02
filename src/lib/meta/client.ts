import { getEnv } from "@/lib/env";

export interface MetaCredentials {
  adAccountId: string;
  pageId: string;
  accessToken: string;
}

export class MetaNotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is a Phase 1 feature and is not implemented yet.`);
    this.name = "MetaNotImplementedError";
  }
}

/** Read Solaride's single-tenant credentials from the environment. */
export function getSolarideCredentialsFromEnv(): MetaCredentials | null {
  const env = getEnv();
  if (
    !env.META_SYSTEM_USER_TOKEN ||
    !env.META_AD_ACCOUNT_ID ||
    !env.META_PAGE_ID
  ) {
    return null;
  }
  return {
    adAccountId: env.META_AD_ACCOUNT_ID,
    pageId: env.META_PAGE_ID,
    accessToken: env.META_SYSTEM_USER_TOKEN,
  };
}

export function isMetaConfigured(): boolean {
  return getSolarideCredentialsFromEnv() !== null;
}

/**
 * Thin wrapper around the Meta Marketing API. Phase 1 will implement
 * Advantage+ campaign creation and insights here (via
 * facebook-nodejs-business-sdk). Kept as a typed boundary so the rest of the
 * app can depend on the interface today.
 */
export class MetaClient {
  constructor(private readonly creds: MetaCredentials) {}

  get accountId(): string {
    return this.creds.adAccountId;
  }

  async createAdvantageCampaign(): Promise<never> {
    throw new MetaNotImplementedError("Advantage+ campaign creation");
  }

  async fetchInsights(): Promise<never> {
    throw new MetaNotImplementedError("Campaign insights");
  }
}
