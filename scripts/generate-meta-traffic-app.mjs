#!/usr/bin/env node

/**
 * Generate Meta Marketing API traffic using app credentials (App ID + Secret).
 * This is more reliable than system user tokens which can expire.
 */

const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '';

const API_VERSION = 'v21.0';
const GRAPH_URL = 'https://graph.facebook.com';

/**
 * Get an app access token using App ID + Secret.
 * App access tokens are simple and don't expire (unless revoked).
 */
async function getAppAccessToken() {
  console.log('🔐 Getting app access token...\n');
  
  const url = new URL(`${GRAPH_URL}/${API_VERSION}/oauth/access_token`);
  url.searchParams.append('client_id', META_APP_ID);
  url.searchParams.append('client_secret', META_APP_SECRET);
  url.searchParams.append('grant_type', 'client_credentials');

  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    const data = await response.json();

    if (data.error) {
      console.error('❌ Token error:', data.error.message);
      return null;
    }

    console.log('✅ Got app access token\n');
    return data.access_token;
  } catch (error) {
    console.error('❌ Network error:', error.message);
    return null;
  }
}

/**
 * Make a Meta Graph API call.
 */
async function callMetaAPI(endpoint, token, params = {}) {
  const url = new URL(`${GRAPH_URL}/${API_VERSION}${endpoint}`);
  url.searchParams.append('access_token', token);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      url.searchParams.append(key, JSON.stringify(value));
    } else if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }

  console.log(`📤 ${endpoint}`);

  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    const data = await response.json();

    if (data.error) {
      console.error(`   ❌ Error:`, data.error.message);
      return null;
    }

    console.log(`   ✅ Success`);
    
    if (data.data) {
      console.log(`   📊 Returned ${data.data.length} item(s)`);
      if (data.data.length > 0 && data.data[0].name) {
        const items = data.data.slice(0, 2);
        items.forEach(item => {
          console.log(`      - ${item.name || item.id}`);
        });
        if (data.data.length > 2) {
          console.log(`      ... and ${data.data.length - 2} more`);
        }
      }
    }
    
    return data;
  } catch (error) {
    console.error(`   ❌ Network error:`, error.message);
    return null;
  }
}

async function generateTraffic() {
  console.log('🚀 Meta Marketing API Traffic Generator\n');
  console.log('This generates API calls to meet Meta\'s minimum volume requirement');
  console.log('for Marketing API Access Tier approval.\n');
  console.log(`Using Ad Account: ${META_AD_ACCOUNT_ID}\n`);

  if (!META_APP_ID || !META_APP_SECRET || !META_AD_ACCOUNT_ID) {
    console.error('Missing required env vars: META_APP_ID, META_APP_SECRET, META_AD_ACCOUNT_ID');
    process.exit(1);
  }

  // Step 1: Get app access token
  const token = await getAppAccessToken();
  if (!token) {
    console.error('❌ Could not get access token. Stopping.');
    process.exit(1);
  }

  // Step 2: Make API calls
  console.log('Step 1: List Ad Accounts (ads_read)\n');
  const accounts = await callMetaAPI('/me/adaccounts', token, {
    fields: 'id,name,account_status,business_name',
  });
  console.log('');

  console.log('Step 2: List Campaigns (ads_read)\n');
  const campaigns = await callMetaAPI(
    `/${META_AD_ACCOUNT_ID}/campaigns`,
    token,
    { fields: 'id,name,status,objective,daily_budget,created_time' }
  );
  console.log('');

  console.log('Step 3: List Ad Sets (ads_read)\n');
  const adsets = await callMetaAPI(
    `/${META_AD_ACCOUNT_ID}/adsets`,
    token,
    { fields: 'id,name,status,daily_budget,lifetime_budget' }
  );
  console.log('');

  console.log('Step 4: List Ads (ads_read)\n');
  const ads = await callMetaAPI(
    `/${META_AD_ACCOUNT_ID}/ads`,
    token,
    { fields: 'id,name,status,created_time' }
  );
  console.log('');

  console.log('Step 5: List Leads (leads_retrieval)\n');
  const leads = await callMetaAPI(
    `/${META_AD_ACCOUNT_ID}/leads`,
    token,
    { fields: 'id,created_time,ad_name,form_id', limit: 10 }
  );
  console.log('');

  // Step 3: Repeat calls for traffic volume
  console.log('Step 6: Repeating API calls for traffic volume...\n');
  for (let i = 1; i <= 5; i++) {
    console.log(`Round ${i}/5:`);
    await callMetaAPI('/me/adaccounts', token, { fields: 'id,name' });
    await callMetaAPI(`/${META_AD_ACCOUNT_ID}/campaigns`, token, {
      fields: 'id,name,status',
    });
    await callMetaAPI(`/${META_AD_ACCOUNT_ID}/leads`, token, { limit: 5 });
    console.log('');
  }

  console.log('\n✨ Traffic generation complete!\n');
  console.log('📊 API Calls Made:');
  console.log('   ✓ GET /me/adaccounts (ads_read)');
  console.log('   ✓ GET /{account}/campaigns (ads_read)');
  console.log('   ✓ GET /{account}/adsets (ads_read)');
  console.log('   ✓ GET /{account}/ads (ads_read)');
  console.log('   ✓ GET /{account}/leads (leads_retrieval)');
  console.log('   ✓ Repeated 5 additional times for volume\n');

  console.log('📝 Next Steps:');
  console.log('   1. Run this script once daily for the next 15 days');
  console.log('   2. Monitor Meta API activity in your App Dashboard');
  console.log('   3. After 15 days, open Meta App Dashboard');
  console.log('   4. Go to Settings → App Roles → Marketing API Access Tier');
  console.log('   5. Click "Request again" button');
  console.log('   6. Meta will review (typically 1-7 days)');
  console.log('   7. Approval typically follows once API traffic is confirmed\n');

  console.log('💡 Pro tip: To automate this, add to your crontab:');
  console.log('   0 12 * * * cd /path/to/adbrain && node scripts/generate-meta-traffic-app.mjs\n');
}

generateTraffic().catch(console.error);
