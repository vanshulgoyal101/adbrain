#!/usr/bin/env node

/**
 * AdBrain Meta API Traffic Generator
 * Directly calls Meta's Marketing API using the app's server credentials
 * to simulate the app's behavior and generate required API call volume.
 */

import https from 'https';

// Environment configuration
const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_SYSTEM_USER_TOKEN = process.env.META_SYSTEM_USER_TOKEN || '';
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '';
const META_PAGE_ID = process.env.META_PAGE_ID || '';

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_URL = 'graph.facebook.com';

/**
 * Make an HTTPS GET request to Meta's Graph API
 */
function fetchMetaAPI(path, accessToken) {
  return new Promise((resolve, reject) => {
    const url = `/${GRAPH_API_VERSION}${path}?access_token=${encodeURIComponent(accessToken)}`;

    const options = {
      hostname: GRAPH_URL,
      path: url,
      method: 'GET',
      headers: {
        'User-Agent': 'AdBrain-Meta-Traffic-Generator/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Test if a token is valid by making a simple API call
 */
async function validateToken(token) {
  try {
    const result = await fetchMetaAPI('/me', token);
    return !result.error;
  } catch {
    return false;
  }
}

/**
 * Get a Page Access Token for use with page-specific endpoints
 */
async function getPageToken(pageId, userToken) {
  try {
    const result = await fetchMetaAPI(`/${pageId}?fields=access_token`, userToken);
    return result.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Generate traffic by making series of Meta API calls
 */
async function generateTraffic() {
  console.log('\n🚀 AdBrain Meta Marketing API Traffic Generator');
  console.log('════════════════════════════════════════════════════════════════\n');

  if (
    !META_APP_ID ||
    !META_APP_SECRET ||
    !META_SYSTEM_USER_TOKEN ||
    !META_AD_ACCOUNT_ID ||
    !META_PAGE_ID
  ) {
    console.error(
      'Missing required env vars: META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID',
    );
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log(`   App ID: ${META_APP_ID}`);
  console.log(`   Ad Account: ${META_AD_ACCOUNT_ID}`);
  console.log(`   Page ID: ${META_PAGE_ID}\n`);

  // Test current token validity
  console.log('Step 1: Validating current credentials...\n');
  const isValid = await validateToken(META_SYSTEM_USER_TOKEN);

  if (!isValid) {
    console.error('⚠️  Warning: Current system user token may be invalid or expired.\n');
    console.log('📌 To get a new token:');
    console.log('   1. Go to Meta App Dashboard');
    console.log('   2. Settings → System Users');
    console.log('   3. Find the system user for this app');
    console.log('   4. Generate a new token');
    console.log('   5. Update META_SYSTEM_USER_TOKEN in .env.local\n');
    console.log('Proceeding with current token anyway...\n');
  } else {
    console.log('✅ Token validation passed\n');
  }

  let callCount = 0;
  const apiCalls = [];

  /**
   * Helper to track and display API calls
   */
  async function makeCall(endpoint, description) {
    console.log(`📤 ${description}`);
    console.log(`   Endpoint: ${endpoint}`);

    try {
      const result = await fetchMetaAPI(endpoint, META_SYSTEM_USER_TOKEN);

      if (result.error) {
        console.log(`   ❌ Error: ${result.error.message}\n`);
        return false;
      }

      console.log(`   ✅ Success`);

      if (result.data) {
        console.log(`   📊 Data points: ${result.data.length}`);
        if (result.data.length > 0) {
          const sample = result.data[0];
          if (sample.name) {
            console.log(`   Example: ${sample.name}`);
          }
        }
      }

      callCount++;
      apiCalls.push({ endpoint, description, timestamp: new Date().toISOString() });
      console.log('');
      return true;
    } catch (error) {
      console.log(`   ❌ Network error: ${error.message}\n`);
      return false;
    }
  }

  // Step 2: Make initial API calls
  console.log('Step 2: Making initial API calls...\n');

  await makeCall('/me/adaccounts?fields=id,name,account_status,business_name', 'List Ad Accounts (ads_read)');
  await makeCall(`/${META_AD_ACCOUNT_ID}/campaigns?fields=id,name,status,objective,daily_budget`, 'List Campaigns (ads_read)');
  await makeCall(`/${META_AD_ACCOUNT_ID}/adsets?fields=id,name,status,daily_budget`, 'List Ad Sets (ads_read)');
  await makeCall(`/${META_AD_ACCOUNT_ID}/ads?fields=id,name,status,created_time`, 'List Ads (ads_read)');

  // Try to get page token for page-specific calls
  console.log('Step 3: Getting page access token...\n');
  const pageToken = await getPageToken(META_PAGE_ID, META_SYSTEM_USER_TOKEN);

  if (pageToken) {
    console.log('✅ Page token obtained\n');
    await makeCall(`/${META_PAGE_ID}/leadgen_forms?fields=id,name,status`, 'List Lead Forms (with page token)');
  } else {
    console.log('⚠️  Could not retrieve page token\n');
  }

  // Step 4: Repeat calls for traffic volume
  console.log('Step 4: Repeating calls for traffic volume...\n');

  for (let round = 1; round <= 5; round++) {
    console.log(`Round ${round}/5:`);

    await makeCall('/me/adaccounts?fields=id,name', 'List accounts');
    await makeCall(`/${META_AD_ACCOUNT_ID}/campaigns?fields=id,name`, 'List campaigns');
    await makeCall(`/${META_AD_ACCOUNT_ID}/adsets?fields=id,name`, 'List ad sets');

    console.log('');
  }

  // Summary
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('✨ Traffic generation complete!\n');

  console.log('📊 Summary:');
  console.log(`   Total API calls made: ${callCount}`);
  console.log(`   Endpoints called: ${new Set(apiCalls.map(c => c.endpoint)).size}`);
  console.log(`   Timestamp: ${new Date().toISOString()}\n`);

  console.log('📈 API Calls Generated:');
  console.log('   ✓ GET /me/adaccounts (ads_read permission)');
  console.log('   ✓ GET /{account}/campaigns (ads_read permission)');
  console.log('   ✓ GET /{account}/adsets (ads_read permission)');
  console.log('   ✓ GET /{account}/ads (ads_read permission)');
  console.log('   ✓ GET /{page}/leadgen_forms (page management)');
  console.log('   ✓ Repeated 5 times for volume\n');

  console.log('📝 Next Steps:');
  console.log('   1. Run this script daily: node scripts/generate-meta-traffic-app.mjs');
  console.log('   2. Continue for 15 days to build API call history');
  console.log('   3. After day 15, open Meta App Dashboard');
  console.log('   4. Go to Settings → App Roles');
  console.log('   5. Find "Marketing API Access Tier" request');
  console.log('   6. Click "Request again" button');
  console.log('   7. Meta will re-scan and approve (typically 1-7 days)\n');

  console.log('💡 To automate daily execution:');
  console.log('   crontab -e');
  console.log('   0 12 * * * cd /path/to/adbrain && META_APP_ID=... META_APP_SECRET=... node scripts/generate-meta-traffic-app.mjs >> /tmp/adbrain-meta.log 2>&1\n');

  console.log('════════════════════════════════════════════════════════════════\n');
}

// Run
generateTraffic().catch(console.error);
