#!/usr/bin/env node

/**
 * Generate Meta Marketing API traffic via AdBrain internal API endpoints.
 * This calls the app's endpoints which internally make Meta API calls,
 * ensuring proper logging and credential handling.
 */

const ADBRAIN_URL = process.env.ADBRAIN_URL || 'https://adbrain.vanshul.com';
const REVIEWER_EMAIL = process.env.ADBRAIN_REVIEWER_EMAIL || '';
const REVIEWER_PASSWORD = process.env.ADBRAIN_REVIEWER_PASSWORD || '';

let sessionToken = null;

async function makeRequest(endpoint, options = {}) {
  const url = new URL(`${ADBRAIN_URL}${endpoint}`);
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  console.log(`📤 ${options.method || 'GET'} ${endpoint}`);

  try {
    const response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(`❌ Error ${response.status}:`, data?.error || data);
      return null;
    }

    console.log(`✅ Success!\n`);
    return data;
  } catch (error) {
    console.error(`❌ Network error:`, error.message, '\n');
    return null;
  }
}

async function login() {
  console.log('🔐 Logging in...\n');
  
  const response = await fetch(`${ADBRAIN_URL}/auth/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: REVIEWER_EMAIL,
      password: REVIEWER_PASSWORD,
    }),
  });

  if (!response.ok) {
    console.error('❌ Login failed');
    return false;
  }

  const data = await response.json();
  sessionToken = data.session?.access_token;
  
  if (!sessionToken) {
    console.error('❌ No session token returned');
    return false;
  }

  console.log('✅ Login successful!\n');
  return true;
}

async function generateTraffic() {
  console.log('🚀 Starting AdBrain API traffic generation...\n');

  if (!REVIEWER_EMAIL || !REVIEWER_PASSWORD) {
    console.warn('Missing reviewer env vars (ADBRAIN_REVIEWER_EMAIL / ADBRAIN_REVIEWER_PASSWORD).');
    console.warn('Continuing without login; authenticated endpoints may return 401.\n');
  }

  // Try to login (though this might not work via this approach)
  // Instead, we'll make unauthenticated requests that trigger the business's
  // server-side Meta credentials (pre-connected mode)

  console.log('Step 1: Fetch Meta accounts/connections');
  console.log('────────────────────────────────────────────────');
  await makeRequest('/api/meta/accounts');

  console.log('Step 2: Sync campaigns');
  console.log('────────────────────────────────────────────────');
  await makeRequest('/api/campaigns/sync', { method: 'POST' });

  console.log('Step 3: Get campaign report');
  console.log('────────────────────────────────────────────────');
  await makeRequest('/api/campaigns/report');

  console.log('Step 4: Get campaign leads');
  console.log('────────────────────────────────────────────────');
  await makeRequest('/api/leads');

  console.log('Step 5: Repeat calls multiple times...');
  console.log('────────────────────────────────────────────────\n');

  for (let i = 1; i <= 3; i++) {
    console.log(`Round ${i}/3:`);
    await makeRequest('/api/meta/accounts');
    await makeRequest('/api/campaigns/sync', { method: 'POST' });
    
    // Add small delay between rounds
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n✨ Traffic generation complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Run this script daily for the next 15 days');
  console.log('   2. Monitor Meta API calls in the app logs');
  console.log('   3. After day 15, log in to Meta App Dashboard');
  console.log('   4. Find "Marketing API Access Tier" request');
  console.log('   5. Click "Request again" button');
  console.log('   6. Approval should follow within 1-7 days\n');
}

generateTraffic().catch(console.error);
