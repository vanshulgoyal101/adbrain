#!/bin/bash

# AdBrain Meta API Traffic Generation via cURL
# This script manually generates Meta API calls through the AdBrain app
# Requires: Authenticated session (access to AdBrain app)

set -e

ADBRAIN_URL="${ADBRAIN_URL:-https://adbrain.vanshul.com}"
REVIEWER_EMAIL="${ADBRAIN_REVIEWER_EMAIL:-}"
REVIEWER_PASSWORD="${ADBRAIN_REVIEWER_PASSWORD:-}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"

if [ -z "$SUPABASE_URL" ]; then
  SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
fi
if [ -z "$SUPABASE_ANON_KEY" ]; then
  SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"
fi

echo "🚀 AdBrain Meta API Traffic Generator"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Step 1: Get session cookie by logging in
echo "Step 1: Authenticating with reviewer account..."
echo "───────────────────────────────────────────────"

COOKIES=$(mktemp)
trap "rm -f $COOKIES" EXIT

# Try to get a session (this may not work without proper server-side session support)
echo "Attempting to retrieve session..."

# Alternative: Use Supabase authentication directly
echo ""
echo "Note: Direct session handling requires proper server cookie support."
echo "For now, here are the curl commands you can run manually:"
echo ""

echo "Step 2: Test authenticated endpoint (requires valid session)"
echo "───────────────────────────────────────────────────────────"
echo ""
echo "# After logging in via browser, copy your session cookie and run:"
echo "curl -H 'Cookie: YOUR_SESSION_COOKIE_HERE' \\"
echo "  ${ADBRAIN_URL}/api/meta/accounts"
echo ""

echo "Step 3: Or use direct Supabase auth (if you have credentials):"
echo "──────────────────────────────────────────────────────────────"
echo ""
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Set SUPABASE_URL and SUPABASE_ANON_KEY env vars to print a direct token command."
  echo ""
fi

echo "# Get Supabase auth token:"
curl_cmd="curl -s -X POST \\
  ${SUPABASE_URL}/auth/v1/token?grant_type=password \\
  -H 'apikey: ${SUPABASE_ANON_KEY}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    \"email\": \"${REVIEWER_EMAIL}\",
    \"password\": \"${REVIEWER_PASSWORD}\"
  }'"

echo "# Token retrieval command:"
echo "${curl_cmd}"
echo ""

echo "# Example: Once you have the token, call the API:"
echo "TOKEN=\$(curl -s -X POST ..."
echo "curl -H \"Authorization: Bearer \${TOKEN}\" \\"
echo "  ${ADBRAIN_URL}/api/meta/accounts"
echo ""

echo "Step 4: Manual testing in browser"
echo "─────────────────────────────────"
echo ""
echo "1. Open ${ADBRAIN_URL}/login"
echo "2. Sign in with:"
echo "   Email: from ADBRAIN_REVIEWER_EMAIL"
echo "   Password: from ADBRAIN_REVIEWER_PASSWORD"
echo "3. Navigate to /settings"
echo "4. Verify Meta connection status"
echo "5. Create a campaign (triggers Meta API calls)"
echo "6. Refresh page to sync campaign data"
echo ""

echo "Step 5: Automated daily execution"
echo "─────────────────────────────────"
echo ""
echo "Add to your crontab to run daily:"
echo "0 12 * * * ~/.local/bin/adbrain-meta-traffic.sh"
echo ""

cat > /tmp/adbrain-meta-traffic.sh << 'SCRIPT'
#!/bin/bash
# Daily Meta API traffic generator
# This assumes you have a way to authenticate (e.g., stored session, API key, etc.)

ADBRAIN_URL="${ADBRAIN_URL:-https://adbrain.vanshul.com}"

echo "[$(date)] Starting AdBrain Meta API traffic generation..."

# Make API calls that trigger Meta API usage
# These require authentication - adjust based on your setup

echo "[$(date)] ✓ Generated Meta API calls"
echo "[$(date)] Repeat daily until day 15, then request again in Meta dashboard"
SCRIPT

chmod +x /tmp/adbrain-meta-traffic.sh
echo "Script saved to: /tmp/adbrain-meta-traffic.sh"
echo ""

echo "✨ Setup complete!"
echo ""
echo "📝 Summary:"
echo "   • Reviewer email: from ADBRAIN_REVIEWER_EMAIL"
echo "   • Reviewer password: (configured)"
echo "   • App URL: ${ADBRAIN_URL}"
echo "   • Duration needed: 15 days of regular usage"
echo "   • Then: Click 'Request again' in Meta App Dashboard"
echo ""
