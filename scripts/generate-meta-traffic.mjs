#!/usr/bin/env node

/**
 * Generate Meta Marketing API traffic to meet minimum requirements for Access Tier approval.
 * Calls: GET /me/adaccounts, GET /me/adaccounts/{id}/campaigns, GET /me/adaccounts/{id}/leads
 */

const META_SYSTEM_USER_TOKEN = process.env.META_SYSTEM_USER_TOKEN || '';
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || '';

const API_VERSION = 'v21.0';
const BASE_URL = `https://graph.instagram.com/${API_VERSION}`;

async function makeMetaCall(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.append('access_token', META_SYSTEM_USER_TOKEN);
  
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      url.searchParams.append(key, JSON.stringify(value));
    } else {
      url.searchParams.append(key, String(value));
    }
  }

  console.log(`📤 Calling: ${endpoint}`);
  console.log(`   URL: ${url.toString().replace(META_SYSTEM_USER_TOKEN, '[REDACTED]')}\n`);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'AdBrain-Meta-Traffic-Generator/1.0',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Error:`, data);
      return null;
    }

    console.log(`✅ Success!\n`);
    return data;
  } catch (error) {
    console.error(`❌ Network error:`, error.message, '\n');
    return null;
  }
}

async function generateTraffic() {
  console.log('🚀 Starting Meta Marketing API traffic generation...\n');

  if (!META_SYSTEM_USER_TOKEN || !META_AD_ACCOUNT_ID) {
    console.error('Missing required env vars: META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID');
    process.exit(1);
  }

  // 1. Get user's ad accounts (ads_read permission)
  console.log('Step 1: Fetching ad accounts (GET /me/adaccounts)');
  console.log('────────────────────────────────────────────────');
  const accountsData = await makeMetaCall('/me/adaccounts', {
    fields: 'id,name,account_status',
  });

  if (!accountsData?.data?.length) {
    console.error('❌ No ad accounts found. Stopping.');
    process.exit(1);
  }

  console.log(`Found ${accountsData.data.length} account(s):\n`);
  accountsData.data.forEach((acc, i) => {
    console.log(`  ${i + 1}. ${acc.name} (${acc.id})`);
  });
  console.log('\n');

  // 2. Get campaigns for the primary account (ads_read permission)
  console.log('Step 2: Fetching campaigns');
  console.log('────────────────────────────────────────────────');
  const campaignsData = await makeMetaCall(`/${META_AD_ACCOUNT_ID}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget',
  });

  if (campaignsData?.data) {
    console.log(`Found ${campaignsData.data.length} campaign(s):\n`);
    campaignsData.data.slice(0, 5).forEach((camp, i) => {
      console.log(`  ${i + 1}. ${camp.name} (${camp.id})`);
    });
    if (campaignsData.data.length > 5) {
      console.log(`  ... and ${campaignsData.data.length - 5} more`);
    }
    console.log('\n');
  }

  // 3. Get leads if available (leads_retrieval permission)
  console.log('Step 3: Fetching leads');
  console.log('────────────────────────────────────────────────');
  const leadsData = await makeMetaCall(`/${META_AD_ACCOUNT_ID}/leads`, {
    fields: 'id,created_time,ad_name,form_id',
    limit: 10,
  });

  if (leadsData?.data) {
    console.log(`Found ${leadsData.data.length} lead(s):\n`);
    leadsData.data.slice(0, 5).forEach((lead, i) => {
      console.log(`  ${i + 1}. ${lead.ad_name || 'N/A'} (${lead.id})`);
    });
    if (leadsData.data.length > 5) {
      console.log(`  ... and ${leadsData.data.length - 5} more`);
    }
    console.log('\n');
  }

  // 4. Repeat calls multiple times to ensure Meta logs them
  console.log('Step 4: Repeating calls for traffic volume...');
  console.log('────────────────────────────────────────────────');

  for (let i = 1; i <= 5; i++) {
    console.log(`\nRound ${i}/5:`);
    await makeMetaCall('/me/adaccounts', { fields: 'id,name' });
    await makeMetaCall(`/${META_AD_ACCOUNT_ID}/campaigns`, { fields: 'id,name' });
    await makeMetaCall(`/${META_AD_ACCOUNT_ID}/leads`, { limit: 5 });
  }

  console.log('\n✨ Traffic generation complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Run this script daily for the next 15 days');
  console.log('   2. After day 15, log in to Meta App Dashboard');
  console.log('   3. Find Marketing API Access Tier request');
  console.log('   4. Click "Request again" button');
  console.log('   5. Approval should follow within 1-7 days\n');
}

generateTraffic().catch(console.error);
