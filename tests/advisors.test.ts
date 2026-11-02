import { describe, expect, it } from "vitest";
import { ACCEPTED, lintKey, newFindings } from "../scripts/advisors.mjs";

const lint = (level: string, name: string, schema?: string, object?: string) => ({ level, name, title: name, metadata: schema ? { schema, name: object } : {} });

describe("advisors gate (#359)", () => {
  it("fails only on WARN or ERROR findings that are not accepted", () => {
    const found = newFindings([
      lint("INFO", "unindexed_foreign_keys", "public", "audit_log"),
      lint("WARN", "authenticated_security_definer_function_executable", "public", "change_declared_preferences"),
      lint("WARN", "auth_leaked_password_protection"),
      lint("WARN", "auth_rls_initplan", "public", "leads"),
      lint("ERROR", "rls_disabled_in_public", "public", "new_table"),
    ]);
    expect(found.map(lintKey)).toEqual(["auth_rls_initplan:public.leads", "rls_disabled_in_public:public.new_table"]);
  });

  it("gives every accepted finding a reason", () => {
    for (const reason of Object.values(ACCEPTED)) expect(reason.length).toBeGreaterThan(10);
  });

  it("accepts the owner-checked alert RPC warnings without blocking unrelated migrations", () => {
    expect(newFindings([
      lint("WARN", "authenticated_security_definer_function_executable", "public", "owner_alert_prefs_set"),
      lint("WARN", "authenticated_security_definer_function_executable", "public", "owner_alert_start_verification"),
    ])).toEqual([]);
  });

  it("still blocks unreviewed roles, schemas and alert RPCs", () => {
    const findings = [
      lint("WARN", "anon_security_definer_function_executable", "public", "owner_alert_prefs_set"),
      lint("WARN", "authenticated_security_definer_function_executable", "private", "owner_alert_prefs_set"),
      lint("WARN", "authenticated_security_definer_function_executable", "public", "owner_alert_confirm"),
    ];
    expect(newFindings(findings)).toEqual(findings);
  });
});
