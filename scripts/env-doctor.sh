#!/bin/bash

# Quick environment checker for Meta traffic scripts and internal runner.
# Usage:
#   scripts/env-doctor.sh
#   scripts/env-doctor.sh --strict
#
# --strict returns non-zero if any recommended variable is missing.

set -u

STRICT=0
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
fi

# Resolve fallbacks the same way scripts do.
SUPABASE_URL_VALUE="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
SUPABASE_ANON_VALUE="${SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"

failures=0
warnings=0

print_header() {
  echo "AdBrain Env Doctor"
  echo "=================="
}

show_var() {
  local name="$1"
  local value="$2"
  if [ -n "$value" ]; then
    echo "[ok]   $name is set"
  else
    echo "[miss] $name is not set"
  fi
}

require_var() {
  local name="$1"
  local value="$2"
  show_var "$name" "$value"
  if [ -z "$value" ]; then
    failures=$((failures + 1))
  fi
}

recommend_var() {
  local name="$1"
  local value="$2"
  show_var "$name" "$value"
  if [ -z "$value" ]; then
    warnings=$((warnings + 1))
    if [ "$STRICT" -eq 1 ]; then
      failures=$((failures + 1))
    fi
  fi
}

print_header

echo ""
echo "Core traffic runner settings"
require_var "TRAFFIC_GENERATOR_ALLOWED_EMAILS" "${TRAFFIC_GENERATOR_ALLOWED_EMAILS:-}"
recommend_var "TRAFFIC_GENERATOR_MAX_ROUNDS" "${TRAFFIC_GENERATOR_MAX_ROUNDS:-}"

echo ""
echo "Meta API settings"
require_var "META_APP_ID" "${META_APP_ID:-}"
require_var "META_APP_SECRET" "${META_APP_SECRET:-}"
require_var "META_SYSTEM_USER_TOKEN" "${META_SYSTEM_USER_TOKEN:-}"
require_var "META_AD_ACCOUNT_ID" "${META_AD_ACCOUNT_ID:-}"
require_var "META_PAGE_ID" "${META_PAGE_ID:-}"

echo ""
echo "Reviewer/script login settings"
require_var "ADBRAIN_REVIEWER_EMAIL" "${ADBRAIN_REVIEWER_EMAIL:-}"
require_var "ADBRAIN_REVIEWER_PASSWORD" "${ADBRAIN_REVIEWER_PASSWORD:-}"
require_var "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)" "$SUPABASE_URL_VALUE"
require_var "SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)" "$SUPABASE_ANON_VALUE"
recommend_var "APP_URL or ADBRAIN_URL" "${APP_URL:-${ADBRAIN_URL:-}}"

echo ""
if [ "$failures" -gt 0 ]; then
  echo "Result: FAIL ($failures missing required setting(s))"
  echo "Tip: copy .env.example to .env.local and fill the missing values."
  exit 1
fi

echo "Result: PASS"
if [ "$warnings" -gt 0 ]; then
  echo "Note: $warnings recommended setting(s) are missing."
  exit 0
fi

echo "All required and recommended settings are present."
exit 0
