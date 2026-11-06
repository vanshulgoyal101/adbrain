import assert from "node:assert/strict";

/** @param {string} value */
function loopbackOrigin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", "Synthetic UI checks require local HTTP");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Synthetic UI checks require loopback hosts");
  assert.equal(url.username + url.password + url.search + url.hash, "", "Synthetic URLs cannot contain credentials or parameters");
  assert.equal(url.pathname, "/", "Synthetic URLs must be origins");
  return url.origin;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} appOrigin
 */
export function syntheticSession(env, appOrigin) {
  loopbackOrigin(appOrigin);
  assert.equal(env.SMOKE_EMAIL, "meta-qa@example.test", "Only the synthetic UI fixture may be used");
  assert.ok(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY, "Local Supabase credentials are required");
  return {
    email: env.SMOKE_EMAIL,
    config: {
      url: loopbackOrigin(env.NEXT_PUBLIC_SUPABASE_URL),
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  };
}
