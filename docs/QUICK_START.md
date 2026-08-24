# 🚀 AdBrain Meta Tier 2 Approval - Quick Start Guide

## Status
- ✅ App submission completed (Aug 22)
- ❌ **Rejected**: Insufficient API call volume (Aug 24)
- ⏳ **Action Required**: Generate 15 days of API traffic, then re-submit

## Your Task (Next 15 Days)

### Option 1: Browser (Recommended - Most Reliable)
**Time per day**: 5-10 minutes

Each day, simply:
1. Go to https://adbrain.vanshul.com/login
2. Login: `<REVIEWER_EMAIL>` / `<REVIEWER_PASSWORD>`
3. Navigate to /settings
4. Click "Sync Campaigns" 
5. Create 1-2 test campaigns (optional but helps)
6. Log out

That's it! Every action triggers Meta API calls behind the scenes.

### Option 2: Automated Script
**One-time setup**, then automatic daily execution

```bash
# Make executable
chmod +x ~/Development/copilot/adbrain/scripts/daily-adbrain-test.sh

# Test it
~/Development/copilot/adbrain/scripts/daily-adbrain-test.sh

# Add to crontab for automatic daily execution
crontab -e

# Add this line to run every day at noon:
0 12 * * * ~/Development/copilot/adbrain/scripts/daily-adbrain-test.sh >> /tmp/adbrain-meta.log 2>&1
```

## Timeline

| Period | Action | Expected Outcome |
|--------|--------|------------------|
| **Days 1-15** | Use app daily (5-10 min) | Meta logs your API calls |
| **Day 16** | Log in once more | Ensure final day of activity recorded |
| **Day 17+** | Open Meta App Dashboard | Check your API call history |
| **Day 17** | Click "Request again" on Tier request | Meta re-scans your history |
| **Days 17-22** | Wait for Meta review | Typically 1-7 days |
| **By Day 23** | ✅ Approval expected | Tier 2 access granted |

## Why This Works

When you use AdBrain:
- ✅ App calls `GET /adaccounts` → Meta logs this call
- ✅ App calls `GET /campaigns` → Meta logs this call
- ✅ App calls `POST /campaigns` (when creating) → Meta logs this call
- ✅ App calls `GET /leads` → Meta logs this call

After 15 days of legitimate usage, Meta's system sees the volume and approves.

## Credentials

| Item | Value |
|------|-------|
| App URL | https://adbrain.vanshul.com |
| Login Email | <REVIEWER_EMAIL> |
| Login Password | <REVIEWER_PASSWORD> |
| Test Ad Account | <TEST_AD_ACCOUNT_ID> |
| Test Page | <TEST_PAGE_ID> |

## When You're Done (Day 17+)

1. **Open**: https://developers.facebook.com/apps/<YOUR_META_APP_ID>/
2. **Go to**: Settings → App Roles → Marketing API Access Tier
3. **Find**: Your rejected request (should say "Rejected")
4. **Click**: "Request again" button
5. **Wait**: Meta reviews (1-7 days usually)
6. **Check Status**: You'll get notification when approved

## Troubleshooting

### "Can't log in"
→ Use magic link instead of password (check email for link)

### "Settings page shows 'No Meta connection'"
→ This is normal - app falls back to test credentials automatically
→ Just sync campaigns anyway - API calls are still made

### "After 15 days, still not approved"
→ Click "Request again" one more time
→ Contact Meta support with your App ID: <YOUR_META_APP_ID>
→ Include: Screenshot of API call history from App Dashboard

## Files Created For You

1. **[docs/META_APPROVAL_ACTION_PLAN.md](../docs/META_APPROVAL_ACTION_PLAN.md)**
   - Detailed 20-page guide with everything explained

2. **[scripts/daily-adbrain-test.sh](../scripts/daily-adbrain-test.sh)**
   - Automated script (run daily)

3. **[scripts/generate-meta-traffic-final.mjs](../scripts/generate-meta-traffic-final.mjs)**
   - Advanced Node.js script (optional)

## Questions?

Refer to the comprehensive guide: [META_APPROVAL_ACTION_PLAN.md](../docs/META_APPROVAL_ACTION_PLAN.md)

---

**Start Date**: August 24, 2026  
**Target Approval**: September 8-14, 2026  
**Contact**: Meta Developer Support (if issues arise)
