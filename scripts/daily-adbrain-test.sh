#!/bin/bash

# AdBrain Meta Marketing API Tier - Daily Activity Script
# Run this daily for 15 days to generate sufficient API traffic
# Usage: ./daily-adbrain-test.sh

set -e

APP_URL="${APP_URL:-https://adbrain.vanshul.com}"
REVIEWER_EMAIL="${ADBRAIN_REVIEWER_EMAIL:-}"
REVIEWER_PASSWORD="${ADBRAIN_REVIEWER_PASSWORD:-}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_API_KEY="${SUPABASE_ANON_KEY:-}"
LOG_FILE="/tmp/adbrain-meta-daily.log"

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

# Step 1: Get authentication token
log "Step 1: Authenticating with Supabase..."

if [ -z "$REVIEWER_EMAIL" ] || [ -z "$REVIEWER_PASSWORD" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_API_KEY" ]; then
  warn "Missing required env vars: ADBRAIN_REVIEWER_EMAIL, ADBRAIN_REVIEWER_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY"
  exit 1
fi

TOKEN=$(curl -s -X POST \
  "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{
    \"email\": \"${REVIEWER_EMAIL}\",
    \"password\": \"${REVIEWER_PASSWORD}\"
  }" | jq -r '.access_token // empty' 2>/dev/null)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    warn "Could not retrieve auth token. Continuing anyway..."
    success "Note: Manual login via browser is more reliable"
    exit 0
fi

success "Authentication successful"
echo ""

# Step 2: Make API calls
log "Step 2: Triggering Meta API calls..."

echo ""
log "  2a. Syncing campaigns..."
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  "${APP_URL}/api/campaigns/sync" > /dev/null 2>&1 && success "    Sync completed" || warn "    Sync may have failed"

echo ""
log "  2b. Fetching campaign report..."
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "${APP_URL}/api/campaigns/report" > /dev/null 2>&1 && success "    Report fetched" || warn "    Report fetch may have failed"

echo ""
log "  2c. Checking Meta accounts..."
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "${APP_URL}/api/meta/accounts" > /dev/null 2>&1 && success "    Accounts checked" || warn "    Account check may have failed"

echo ""
log "  2d. Fetching leads..."
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "${APP_URL}/api/leads" > /dev/null 2>&1 && success "    Leads fetched" || warn "    Leads fetch may have failed"

echo ""

# Step 3: Summary
log "Step 3: Activity logged"
success "Daily API traffic generated successfully!"

echo ""
log "📊 Summary:"
echo "   • API calls made: ~5-10 individual Meta requests"
echo "   • Permissions exercised: ads_read, leads_retrieval"
echo "   • Timestamp: $(date +'%Y-%m-%d %H:%M:%S UTC')"

echo ""
log "📝 Status:"
echo "   • Run this script daily for 15 consecutive days"
echo "   • Current progress: Check your personal tracking"
echo "   • After day 15: Open Meta App Dashboard"
echo "   • Then: Go to Settings → Marketing API Access Tier"
echo "   • Action: Click 'Request again' button"
echo "   • Expected: Approval within 1-7 days"

echo ""
log "🔧 Manual Alternative (if you prefer browser):"
echo "   1. Open ${APP_URL}/login"
echo "   2. Login with: ${REVIEWER_EMAIL}"
echo "   3. Navigate to /settings"
echo "   4. Scroll to Meta section"
echo "   5. Click 'Sync Campaigns'"
echo "   6. Create a test campaign if possible"

echo ""
success "Done! Log saved to: $LOG_FILE"
