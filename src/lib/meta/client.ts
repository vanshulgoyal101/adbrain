import { getEnv } from "@/lib/env";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaCredentials {
  adAccountId: string;
  pageId: string;
  accessToken: string;
}

export interface LeadForm {
  id: string;
  name: string;
  status: string;
}

export interface CreativeInput {
  imageUrl: string;
  headline: string;
  message: string;
  cta?: string | null;
}

export interface CreateCampaignResult {
  campaignId: string;
  adSetId: string;
  adIds: string[];
}

export interface CampaignInsights {
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  cpl: number | null;
}

export interface MetaCampaignSummary {
  id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget?: string;
  effective_status?: string;
  created_time?: string;
}

export class MetaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

/** Human CTA label → Meta call_to_action enum. */
const CTA_MAP: Record<string, string> = {
  "Get Quote": "GET_QUOTE",
  "Learn More": "LEARN_MORE",
  "Contact Us": "CONTACT_US",
  "Sign Up": "SIGN_UP",
  "Get Offer": "GET_OFFER",
  "Book Now": "BOOK_NOW",
  "Call Now": "CALL_NOW",
};

function ctaType(label?: string | null): string {
  return (label && CTA_MAP[label]) || "LEARN_MORE";
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

export function metaClientFromEnv(): MetaClient | null {
  const creds = getSolarideCredentialsFromEnv();
  return creds ? new MetaClient(creds) : null;
}

/**
 * Meta Marketing API wrapper (Graph v21). Creates Advantage+ lead campaigns in
 * PAUSED state (no spend until activated) and reads insights. Validated against
 * a live ad account.
 */
export class MetaClient {
  constructor(private readonly creds: MetaCredentials) {}

  private async graph<T>(
    path: string,
    opts: {
      method?: string;
      token?: string;
      form?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const method = opts.method ?? "GET";
    const token = opts.token ?? this.creds.accessToken;

    let res: Response;
    if (method === "POST") {
      const body = new URLSearchParams({
        ...(opts.form ?? {}),
        access_token: token,
      });
      res = await fetch(`${GRAPH}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } else {
      const sep = path.includes("?") ? "&" : "?";
      res = await fetch(
        `${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`,
        { method },
      );
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json as { error?: unknown }).error) {
      const err = (
        json as { error?: { message?: string; error_user_msg?: string } }
      ).error;
      throw new MetaError(
        err?.error_user_msg || err?.message || `Meta HTTP ${res.status}`,
        res.status,
      );
    }
    return json as T;
  }

  async getPageAccessToken(): Promise<string> {
    const data = await this.graph<{ access_token?: string }>(
      `${this.creds.pageId}?fields=access_token`,
    );
    if (!data.access_token) {
      throw new MetaError("Could not retrieve page access token.");
    }
    return data.access_token;
  }

  /** Active instant lead forms on the page. */
  async listLeadForms(): Promise<LeadForm[]> {
    const pageToken = await this.getPageAccessToken();
    const data = await this.graph<{ data: LeadForm[] }>(
      `${this.creds.pageId}/leadgen_forms?fields=id,name,status`,
      { token: pageToken },
    );
    return (data.data ?? []).filter((f) => f.status === "ACTIVE");
  }

  /** Upload an image to the ad account and return its hash. */
  async uploadAdImage(imageUrl: string): Promise<string> {
    const imgRes = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imgRes.ok) {
      throw new MetaError(`Could not fetch creative image (${imgRes.status}).`);
    }
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const data = await this.graph<{ images: Record<string, { hash: string }> }>(
      `${this.creds.adAccountId}/adimages`,
      { method: "POST", form: { bytes: b64 } },
    );
    const first = Object.values(data.images ?? {})[0];
    if (!first?.hash) throw new MetaError("Image upload returned no hash.");
    return first.hash;
  }

  /**
   * Create a PAUSED Advantage+ lead campaign: campaign → ad set → (creative →
   * ad) per creative. Nothing spends until you set it ACTIVE in Meta.
   */
  async createLeadCampaign(params: {
    name: string;
    dailyBudgetRupees: number;
    leadFormId: string;
    link: string;
    creatives: CreativeInput[];
  }): Promise<CreateCampaignResult> {
    const acct = this.creds.adAccountId;

    const campaign = await this.graph<{ id: string }>(`${acct}/campaigns`, {
      method: "POST",
      form: {
        name: params.name,
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: "[]",
        is_adset_budget_sharing_enabled: "false",
      },
    });

    const adSet = await this.graph<{ id: string }>(`${acct}/adsets`, {
      method: "POST",
      form: {
        name: `${params.name} — Ad set`,
        campaign_id: campaign.id,
        status: "PAUSED",
        daily_budget: String(Math.round(params.dailyBudgetRupees * 100)),
        billing_event: "IMPRESSIONS",
        optimization_goal: "LEAD_GENERATION",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        destination_type: "ON_AD",
        promoted_object: JSON.stringify({ page_id: this.creds.pageId }),
        targeting: JSON.stringify({
          geo_locations: { countries: ["IN"] },
          targeting_automation: { advantage_audience: 1 },
        }),
      },
    });

    const adIds: string[] = [];
    for (const c of params.creatives) {
      const imageHash = await this.uploadAdImage(c.imageUrl);
      const creative = await this.graph<{ id: string }>(
        `${acct}/adcreatives`,
        {
          method: "POST",
          form: {
            name: c.headline.slice(0, 90) || "AdBrain creative",
            object_story_spec: JSON.stringify({
              page_id: this.creds.pageId,
              link_data: {
                image_hash: imageHash,
                message: c.message,
                name: c.headline,
                link: params.link,
                call_to_action: {
                  type: ctaType(c.cta),
                  value: { lead_gen_form_id: params.leadFormId },
                },
              },
            }),
          },
        },
      );

      const ad = await this.graph<{ id: string }>(`${acct}/ads`, {
        method: "POST",
        form: {
          name: c.headline.slice(0, 90) || "AdBrain ad",
          adset_id: adSet.id,
          status: "PAUSED",
          creative: JSON.stringify({ creative_id: creative.id }),
        },
      });
      adIds.push(ad.id);
    }

    return { campaignId: campaign.id, adSetId: adSet.id, adIds };
  }

  async listCampaigns(limit = 200): Promise<MetaCampaignSummary[]> {
    const data = await this.graph<{ data: MetaCampaignSummary[] }>(
      `${this.creds.adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,effective_status,created_time&limit=${limit}`,
    );
    return data.data ?? [];
  }

  async getCampaignInsights(campaignId: string): Promise<CampaignInsights> {
    const data = await this.graph<{
      data: Array<{
        impressions?: string;
        clicks?: string;
        spend?: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    }>(`${campaignId}/insights?fields=impressions,clicks,spend,actions`);

    const row = data.data?.[0];
    const impressions = Number(row?.impressions ?? 0);
    const clicks = Number(row?.clicks ?? 0);
    const spend = Number(row?.spend ?? 0);
    const leadAction = row?.actions?.find((a) =>
      a.action_type.includes("lead"),
    );
    const leads = Number(leadAction?.value ?? 0);
    const cpl = leads > 0 ? spend / leads : null;
    return { impressions, clicks, leads, spend, cpl };
  }

  async deleteObject(id: string): Promise<void> {
    await this.graph(`${id}`, { method: "DELETE" });
  }
}
