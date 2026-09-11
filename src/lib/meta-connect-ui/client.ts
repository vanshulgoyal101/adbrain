import { z } from "zod";
import {
  createCampaignRequestSchema,
  draftDtoSchema,
  draftInputSchema,
  operationDtoSchema,
  reviewDtoSchema,
  type CreateCampaignRequest,
  type DraftDTO,
  type DraftInput,
  type OperationDTO,
  type ReviewDTO,
} from "@/lib/campaign/connect-contracts";
import {
  apiResultSchema,
  attemptDtoSchema,
  connectionDtoSchema,
  type AttemptDTO,
  type ConnectIntent,
  type ConnectionDTO,
} from "@/lib/meta/connect-contracts";

const startDataSchema = z.object({
  attemptId: z.string().uuid(),
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
});

export type StartConnection = {
  attemptId: string;
  authorizationUrl: string;
  expiresAt: string;
};

export class MetaConnectClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = "MetaConnectClientError";
    this.code = options.code ?? "UNAVAILABLE";
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId ?? null;
  }
}

type FetchLike = typeof fetch;

export type MetaConnectClientOptions = {
  fetchImpl?: FetchLike;
};

function assertSameOrigin(path: string): void {
  if (!path.startsWith("/api/")) {
    throw new MetaConnectClientError("Connection requests must use AdBrain routes.", {
      code: "INVALID_INPUT",
    });
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MetaConnectClientError("AdBrain returned an unreadable response.", {
      retryable: true,
    });
  }
}

export function createMetaConnectClient({
  fetchImpl = fetch,
}: MetaConnectClientOptions = {}) {
  async function request<Value>(
    path: string,
    schema: { safeParse(value: unknown): { success: boolean; data?: Value } },
    init: RequestInit = {},
  ): Promise<Value> {
    assertSameOrigin(path);
    const response = await fetchImpl(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", ...init.headers },
    });
    const body = await readJson(response);
    const envelope = apiResultSchema(schema as never).safeParse(body);

    if (!envelope.success) {
      throw new MetaConnectClientError("AdBrain returned an invalid connection response.", {
        retryable: true,
      });
    }
    if (!envelope.data.ok) {
      throw new MetaConnectClientError(envelope.data.error.message, {
        code: envelope.data.error.code,
        retryable: envelope.data.error.retryable,
        requestId: envelope.data.requestId,
      });
    }
    if (!response.ok) {
      throw new MetaConnectClientError("The connection request could not be completed.", {
        requestId: envelope.data.requestId,
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    return envelope.data.data;
  }

  return {
    start(
      businessId: string,
      intent: ConnectIntent,
      signal?: AbortSignal,
    ): Promise<StartConnection> {
      return request("/api/meta/connections/start", startDataSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, intent }),
        signal,
      });
    },
    status(businessId: string, signal?: AbortSignal): Promise<ConnectionDTO> {
      return request(
        `/api/meta/connections/status?businessId=${encodeURIComponent(businessId)}`,
        connectionDtoSchema,
        { signal },
      );
    },
    attempt(attemptId: string, signal?: AbortSignal): Promise<AttemptDTO> {
      return request(`/api/meta/connections/attempts/${encodeURIComponent(attemptId)}`, attemptDtoSchema, {
        signal,
      });
    },
    retry(
      attemptId: string,
      revision: number,
      signal?: AbortSignal,
    ): Promise<AttemptDTO> {
      return request(`/api/meta/connections/attempts/${encodeURIComponent(attemptId)}/retry`, attemptDtoSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
        signal,
      });
    },
    select(
      attemptId: string,
      pairId: string,
      revision: number,
      confirmReplacement: boolean,
      signal?: AbortSignal,
    ): Promise<AttemptDTO> {
      return request(`/api/meta/connections/attempts/${encodeURIComponent(attemptId)}/select`, attemptDtoSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairId, revision, confirmReplacement }),
        signal,
      });
    },
    draft(draftId: string, signal?: AbortSignal): Promise<DraftDTO> {
      return request(`/api/campaign-drafts/${encodeURIComponent(draftId)}`, draftDtoSchema, { signal });
    },
    drafts(businessId: string, signal?: AbortSignal): Promise<DraftDTO[]> {
      return request(`/api/campaign-drafts?businessId=${encodeURIComponent(businessId)}`, draftDtoSchema.array(), { signal });
    },
    deleteDraft(draftId: string, version: number, signal?: AbortSignal): Promise<{ deleted: true }> {
      return request(`/api/campaign-drafts/${encodeURIComponent(draftId)}?version=${version}`, z.object({ deleted: z.literal(true) }), { method: "DELETE", signal });
    },
    operationForRequest(businessId: string, idempotencyKey: string, signal?: AbortSignal): Promise<OperationDTO | null> {
      return request(`/api/campaigns/operations?businessId=${encodeURIComponent(businessId)}&idempotencyKey=${encodeURIComponent(idempotencyKey)}`, operationDtoSchema.nullable(), { signal });
    },
    saveDraft(input: DraftInput, signal?: AbortSignal): Promise<DraftDTO> {
      return request("/api/campaign-drafts", draftDtoSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftInputSchema.parse(input)),
        signal,
      });
    },
    updateDraft(
      draftId: string,
      expectedVersion: number,
      input: DraftInput,
      signal?: AbortSignal,
    ): Promise<DraftDTO> {
      return request(`/api/campaign-drafts/${encodeURIComponent(draftId)}`, draftDtoSchema, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion, input: draftInputSchema.parse(input) }),
        signal,
      });
    },
    preflight(
      businessId: string,
      draftId: string,
      draftVersion: number,
      signal?: AbortSignal,
    ): Promise<ReviewDTO> {
      return request("/api/campaigns/preflight", reviewDtoSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, draftId, draftVersion }),
        signal,
      });
    },
    createCampaign(
      input: CreateCampaignRequest,
      signal?: AbortSignal,
    ): Promise<OperationDTO> {
      return request("/api/campaigns/create", operationDtoSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createCampaignRequestSchema.parse(input)),
        signal,
      });
    },
    operation(operationId: string, signal?: AbortSignal): Promise<OperationDTO> {
      return request(`/api/campaigns/operations/${encodeURIComponent(operationId)}`, operationDtoSchema, {
        signal,
      });
    },
  };
}

export type MetaConnectClient = ReturnType<typeof createMetaConnectClient>;