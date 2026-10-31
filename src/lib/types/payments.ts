/** #1824: payments tables and functions of the `public` schema (moved from types.ts; part of `Database`). */
import type { Json } from "./json";

export type PaymentsTables = Record<never, never>;

export type PaymentsFunctions = {
  razorpay_test_order_claim: {
    Args: { p_business_id: string; p_user_id: string; p_request_key: string; p_order_id: string; p_account_id: string; p_key_id: string };
    Returns: Json;
  };
  razorpay_test_order_result: {
    Args: { p_order_id: string; p_provider_order_id: string | null };
    Returns: Json;
  };
  razorpay_test_order_get: {
    Args: { p_order_id: string; p_user_id: string };
    Returns: Json;
  };
  razorpay_test_order_find: {
    Args: { p_provider_order_id: string; p_account_id: string; p_key_id: string };
    Returns: Json;
  };
  razorpay_test_order_observe: {
    Args: { p_order_id: string; p_account_id: string; p_key_id: string; p_event_id: string; p_payload_hash: string; p_payment_id: string; p_outcome: string };
    Returns: Json;
  };
  production_payment_funding_valid: { Args: { p_business_id: string; p_funding_evidence_id: string }; Returns: boolean };
  production_payment_webhook_health: { Args: { p_account_id: string }; Returns: Json };
  production_payment_order_claim: {
    Args: { p_business_id: string; p_user_id: string; p_request_key: string; p_order_id: string; p_account_id: string; p_key_id: string;
      p_quote: Json; p_terms: string; p_terms_hash: string; p_funding_evidence_id: string | null };
    Returns: Json;
  };
  production_payment_order_get: { Args: { p_order_id: string; p_user_id: string }; Returns: Json };
  production_payment_order_result: {
    Args: { p_order_id: string; p_account_id: string; p_key_id: string; p_provider_order_id: string | null }; Returns: Json;
  };
  production_payment_orders_list: { Args: { p_business_id: string; p_user_id: string }; Returns: Json };
  production_payment_event_receive: {
    Args: { p_account_id: string; p_key_id: string; p_webhook_id: string; p_event_id: string; p_payload_hash: string;
      p_payment_id: string; p_provider_order_id: string | null; p_refund_id: string | null; p_kind: string }; Returns: Json;
  };
  production_payment_observe: {
    Args: { p_order_id: string; p_account_id: string; p_key_id: string; p_payment_id: string; p_capture_verified: boolean;
      p_provider_refunded_paise: number; p_review_required: boolean; p_snapshot_hash: string;
      p_refund_id?: string | null; p_refund_amount_paise?: number | null; p_refund_status?: string | null }; Returns: Json;
  };
  production_payment_operator_allowed: { Args: { p_user_id: string; p_refund?: boolean }; Returns: boolean };
  production_payment_refund_claim: {
    Args: { p_order_id: string; p_account_id: string; p_key_id: string; p_actor_id: string; p_request_key: string; p_refund_id: string;
      p_amount_paise: number; p_terms_hash: string; p_approval_reference: string; p_reason: string }; Returns: Json;
  };
  production_payment_refund_result: {
    Args: { p_refund_id: string; p_account_id: string; p_key_id: string; p_provider_refund_id: string | null }; Returns: Json;
  };
  production_payment_refund_observed: {
    Args: { p_refund_id: string; p_account_id: string; p_provider_refund_id: string; p_amount_paise: number; p_status: string }; Returns: undefined;
  };
  production_payment_recovery: {
    Args: { p_account_id: string; p_key_id: string; p_order_id?: string | null; p_provider_order_id?: string | null }; Returns: Json;
  };
  production_payment_events_pending: {
    Args: { p_account_id: string; p_key_id: string; p_order_id?: string | null; p_after_event_id?: string | null }; Returns: Json;
  };
  production_payment_event_processed: { Args: { p_account_id: string; p_event_id: string; p_payload_hash: string }; Returns: undefined };
  production_payment_event_get: { Args: { p_account_id: string; p_key_id: string; p_event_id: string }; Returns: Json };
  production_payment_order_review: { Args: { p_order_id: string; p_account_id: string; p_key_id: string }; Returns: Json };
};
