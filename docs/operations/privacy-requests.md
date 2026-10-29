# Privacy Requests

Part of [Operations](README.md).

## Privacy Request Operations

Before publishing the Settings request controls, DevOps applies the reviewed
`20260930_privacy_requests.sql` migration to the verified target and records the
ledger checksum. Identify the real owner-controlled operator account through
authenticated readback, then register its user UUID in
`private.privacy_request_operators` using the authorized database administration
channel. Never infer the operator from an email, grant a public table policy, or
paste identifiers into a public issue. A new installation has **no** active
privacy operator by default; without one, the operator queue is 403 and the
request channel is not operational. Revocation sets `revoked_at` on that private
row. This registry is separate from payment/refund operators.

For this Production release, the migration ledger matches SHA-256
`02a409069475caff00872c9de31296771d0669bf852f5e5034f7f876a47d972c`. The
owner-confirmed account was resolved through the sole restored Settings row and
its auth/business owner binding. Readback found one active operator, request and
operator RLS enabled, service-only operator RPC execute, and zero requests.

After deployment, use a bounded synthetic request from an owner-controlled
account to confirm that Settings reports Received, the operator queue shows the
same request, and the operator can mark it In review; confirm the owner sees that
status after reload. Do not mark Completed until manual verification, export or
deletion work is actually finished. Review the oldest Received/In review requests
regularly at `/settings/privacy-requests`; this page and its status actions require
the private operator grant, and ordinary customers receive 404. Contact the owner through a verified secure channel for scope and
delivery. The API does not send email, automatically export data or delete records.
Financial/security retention and provider-held Meta data remain separate.

### Meta data-deletion request (#1734)

Meta's deauthorize/deletion callback has already revoked every token for that Meta user
(`meta_revoke_subject`) and filed one `privacy_requests` row (`source = 'meta'`, a
`confirmation_code`, the `meta_subject_id`). `/data-deletion?code=` shows its status to the person.
The deletion itself is this checklist (DevOps runs it; service role in the Supabase SQL editor,
never an application client; no subject ids or names in public issues):

1. **Queue:** `select id, confirmation_code, meta_subject_id, status, created_at from public.privacy_requests where source = 'meta' and status in ('received','in_review') order by created_at;`
   Mark each **In review** at `/settings/privacy-requests` within 7 days (the status page promises this).
2. **Scope:** `select distinct business_id from private.meta_tokens where subject_id = '<subject>';`
   Any token still live (`revoked_at is null`)? Stop and ask on the issue: the callback didn't run.
3. **Delete, in one transaction:**
   `delete from private.meta_connection_attempts where token_id in (select id from private.meta_tokens where subject_id = '<subject>');`
   `update public.meta_connections set meta_business_id = null, account_name = null, page_name = null, currency = null, timezone_name = null, selection_reason = null, capabilities = '{}' where business_id in (<scope>) and token_id is null and authorization_status = 'revoked';`
   (a business that has since reconnected with another person keeps its connection);
   `delete from private.meta_tokens where subject_id = '<subject>' and revoked_at is not null;`
   (`managed_meta_accounts.manager_token_id` is set to null by its foreign key).
4. **Kept:** payment, invoice, refund and security records (as the status page lists); synced
   `leads`, `campaign_results` and `ad_results` are the business's records and stay until the
   CTO's scope call on #1734.
5. **Read-backs, all `0`:**
   `select count(*) from private.meta_tokens where subject_id = '<subject>';`
   `select count(*) from private.meta_connection_attempts a where a.business_id in (<scope>) and a.token_id is null and a.discovered_assets is not null and a.user_id in (select owner_id from public.businesses where id in (<scope>));`
   (attempts that never got a token but still hold discovered asset names: delete them too);
   `select count(*) from public.meta_connections where business_id in (<scope>) and token_id is null and (account_name is not null or page_name is not null or meta_business_id is not null);`
6. Mark **Completed**, then post 'Meta deletion done' with the date and request id (no names)
   on the tracking issue.
