import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { assessRecordedMetaFundingSetup, fundingContextSchema } from "./meta-funding";
import { assessMetaCharge, metaBillingEventSchema, metaChargeContextSchema, type MetaChargeAssessment } from "./meta-billing-events";

export interface StoredMetaFundingAssessment {
  status: "available" | "missing" | "unavailable" | "invalid_context";
  assessment: ReturnType<typeof assessRecordedMetaFundingSetup>;
}

export async function getStoredMetaFundingAssessment(context: unknown): Promise<StoredMetaFundingAssessment> {
  const parsed = fundingContextSchema.safeParse(context);
  const blocked = assessRecordedMetaFundingSetup(null, context);
  if (!parsed.success) return { status: "invalid_context", assessment: blocked };

  try {
    const { data, error } = await createAdminClient().rpc("meta_funding_latest_record", {
      p_business_id: parsed.data.businessId,
      p_environment: parsed.data.environment,
    });
    if (error) return { status: "unavailable", assessment: blocked };
    if (data === null) return { status: "missing", assessment: blocked };
    return { status: "available", assessment: assessRecordedMetaFundingSetup(data, parsed.data) };
  } catch {
    return { status: "unavailable", assessment: blocked };
  }
}

const ingestionContextSchema = metaChargeContextSchema.extend({
  actorId: z.uuid(),
  source: z.enum(["provider_verification", "operator_review", "test_fixture"]),
  sourceReference: z.uuid(),
});

export async function recordMetaBillingEvent(event: unknown, context: unknown): Promise<
  "recorded" | "duplicate" | "conflict" | "invalid_input" | "scope_mismatch" | "unavailable"
> {
  const parsedEvent = metaBillingEventSchema.safeParse(event);
  const parsedContext = ingestionContextSchema.safeParse(context);
  if (!parsedEvent.success || !parsedContext.success) return "invalid_input";
  const observation = parsedEvent.data;
  const expected = parsedContext.data;
  if (observation.businessId !== expected.businessId || observation.environment !== expected.environment
    || observation.accountId !== expected.accountId || observation.chargeId !== expected.chargeId
    || (expected.source === "test_fixture" && expected.environment !== "test")) return "scope_mismatch";
  if (Date.parse(observation.occurredAt) > Date.parse(expected.now)) return "invalid_input";

  try {
    const { data, error } = await createAdminClient().rpc("meta_billing_event_record", {
      p_business_id: expected.businessId, p_environment: expected.environment, p_record: observation,
      p_actor_id: expected.actorId, p_source: expected.source, p_source_reference: expected.sourceReference,
    });
    if (error || (data !== "recorded" && data !== "duplicate" && data !== "conflict")) return "unavailable";
    return data;
  } catch {
    return "unavailable";
  }
}

const chargeObservationsSchema = z.strictObject({ events: z.array(z.unknown()).max(1_000), hasConflicts: z.boolean() });

export async function getStoredMetaChargeAssessment(context: unknown): Promise<{
  status: "available" | "missing" | "unavailable" | "invalid_context";
  assessment: MetaChargeAssessment;
}> {
  const parsed = metaChargeContextSchema.safeParse(context);
  const blocked = assessMetaCharge(null, context);
  if (!parsed.success) return { status: "invalid_context", assessment: blocked };
  try {
    const { data, error } = await createAdminClient().rpc("meta_billing_charge_observations", {
      p_business_id: parsed.data.businessId, p_environment: parsed.data.environment, p_charge_id: parsed.data.chargeId,
    });
    const observations = chargeObservationsSchema.safeParse(data);
    if (error || !observations.success) return { status: "unavailable", assessment: blocked };
    const assessment = assessMetaCharge(observations.data.events, parsed.data);
    if (observations.data.hasConflicts) return {
      status: "available",
      assessment: { ...assessment, status: "needs_reconciliation", observedAmountPaise: null,
        blockers: [...new Set([...assessment.blockers, "EVENT_CONFLICT" as const])] },
    };
    return { status: observations.data.events.length ? "available" : "missing", assessment };
  } catch {
    return { status: "unavailable", assessment: blocked };
  }
}