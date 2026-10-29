# Prospect Account Hand-over

Part of the [incident playbooks](README.md#incident-playbooks).

### Prospect accounts: prepare, then hand over (#1315, #1317)

AdBrain is one business per account, so each prospect gets its own account; at signing the
owner takes it over by its email. Keep prospect names in the private sales files, not here or
in issues.

**Prepare (sales, before the visit):**
1. Sign in with a team plus-address, `<you>+prospect-<short>@<team domain>`. A confirmed team
   address is internal (`isInternalUser`), so Create uses the free image providers and no paid
   model (#466; CEO #1129: no paid spend until the owner tops up).
2. Step 1, "Tell us about your business": **Fill it from my website**, or **No website? Paste a
   bio or listing** with the shop's Instagram bio, Google listing or catalogue text, pasted by hand
   (no scraping or unofficial APIs). Both fill only empty fields, name included; check each line
   (it saves as you go), then **Make my ads**.
3. Step 2, "Your ads": all 3 are picked; **Download sample pack (3)** approves them and downloads the
   marked pack (no Review, no Go live). Don't connect Meta, start a campaign or add funds.
   Downloads go through the export, which marks every picture with a 'Sample ad: not live yet' pill (bottom-left) and puts a note card (`00-sample-note.png`) first; Share and the
   Assets tile's Download, Copy link and Open are hidden on a `+prospect` account, so no clean
   picture leaves before hand-over. After hand-over they come back on their own.

**Hand over (self-serve on the visit, #1670; once `20261028_business_transfer.sql` is live):**
1. On the prospect account, **Settings → Hand this account to the owner**: type the owner's email
   (read it back with them) and tap **Hand to owner**. The rows must both show ✓ (no Meta account,
   no campaigns); anything else set up blocks too, in plain words. It waits 30 minutes; **Cancel
   hand-over** stops it.
2. On the owner's own phone: `adbrain.vanshul.com/login`, **Continue with Google** or **Email me a
   sign-in link** with that email, then **Make it mine** on Home. No link comes from AdBrain; the sign-in
   proves the address. The business (Brand, picked ads, drafts, preferences) moves to their own new login
   in one transaction; sales `ad_instructions` are deleted; one `audit_log` row names both users. Their
   monthly AI allowance starts at the hand-over. 'This isn't my business' shows on the rep's Settings.
3. The prospect login keeps no access to it. A target email that already owns a business is refused.

**Hand over by runbook (fallback until the migration is live; DevOps executes, QA reviews; a tenant step):**
1. Read-only checks, all must hold:
   `select authorization_status, token_id from public.meta_connections where business_id='<business id>';`
   returns no row, or `disconnected`/`revoked` with `token_id` null;
   `select provider from auth.identities where user_id='<user id>';` returns `email` only (a
   linked Google or other identity still signs staff in: unlink it first);
   `select count(*) from public.campaigns where business_id='<business id>';` is `0`;
   `select count(*) from private.meta_tokens where business_id='<business id>';` is `0`;
   `select count(*) from private.meta_connection_attempts where business_id='<business id>';` is `0`;
   `select count(*) from public.managed_meta_accounts where business_id='<business id>';` is `0`;
   `select count(*) from public.owner_alert_prefs where business_id='<business id>';` is `0`;
   `select count(*) from auth.mfa_factors where user_id='<user id>';` is `0` (a staff TOTP factor
   would lock the owner out); and the user id is not in `src/lib/internal-accounts.json`
   (`userIds`, `smokeUserIds`, `exemptFromFreeProviders`), or the owner stays internal.
   If any fails, stop and ask on the issue. Do not connect Meta, provision a managed
   account, or enable WhatsApp/lead alerts during preparation.
2. With the owner present, first clear the prospect's password and revoke every existing
   session and pending sign-in token in Supabase Auth. In the SQL editor, run the
   service-role-only cleanup:
   `update auth.users set encrypted_password = '' where id='<user id>';`
   `delete from auth.sessions where user_id='<user id>';`
   `delete from auth.one_time_tokens where user_id='<user id>';`
   `update auth.users set recovery_token = '', confirmation_token = '', email_change_token_new = '', email_change_token_current = '', reauthentication_token = '' where id='<user id>';`
   Read back: `select recovery_token, confirmation_token, email_change_token_new, email_change_token_current, reauthentication_token from auth.users where id='<user id>';`
   are all empty. Never run these statements with an application client or paste
   credentials into an issue. Deleting sessions doesn't void an access token staff
   already hold: it works until it expires (`jwt_expiry`, 1 hour), so note the time.
   Then make the Brand theirs: set `businesses.email`/`phone` to the owner's, set
   `profiles.email` (id = user id) to their address, and delete sales-only
   `ad_instructions` for the business. The audit log shows staff actions from
   preparation as the owner's account; say so to the owner.
3. Have the owner read their address back first: `updateUserById` sends no confirmation, so a
   typo hands the account to a stranger. Change the account's email to theirs (Supabase dashboard → Authentication → the user →
   change email, or `auth.admin.updateUserById(<user id>, { email })`). Read back:
   `select email, email_confirmed_at, encrypted_password from auth.users where id='<user id>';`
   shows their address, a confirmation timestamp, and no usable password. Read back:
   `select count(*) from auth.sessions where user_id='<user id>';` and
   `select count(*) from auth.one_time_tokens where user_id='<user id>';` — both are `0`.
4. The owner signs in with the sign-in link emailed to that address (or *Continue with Google* for
   a Gmail address). Opening the link is their confirmation. The account is no longer internal, so the normal owner rules (paid images,
   allowance) apply from here. Do not connect Meta until the session/token counts above are
   zero, the owner has confirmed the new address, **and at least 1 hour has passed since
   step 2** (staff access tokens expired). Auth **Confirm email** must be on in production
   (dashboard → Authentication → Sign In / Providers → Email); check it once per hand-over.
5. Post 'handed over' with the date on the issue (no names); the owner connects Meta on the
   20-minute onboarding call (#1279).
6. Send the CPO's hand-over message (#1473) from our WhatsApp, or as an email with the subject
   *Your AdBrain account is ready*. Fill in `{name}`, `{email}` and `{day, time}`; change nothing else.
   > Hi {name}, your AdBrain account is ready, and it's yours now. Your business details and the 3 ads we made are inside.
   > 1. Sign in at adbrain.vanshul.com/login with **{email}**: tap *Continue with Google* (if it's a Gmail address) or *Email me a sign-in link*.
   > 2. What's changed: the 'Sample' mark is off your ads. Nothing runs until you tap *Go live*.
   > 3. Next: connect your Facebook Page (step 3). We'll do it together on **{day, time}**; it takes about 20 minutes.
   > Your first campaign is set up free. You pay Meta directly from your own account, only for ads you approve. After that, AdBrain is ₹999 a month, first month free, no auto-debit.

   Hinglish:
   > Hi {name}, aapka AdBrain account ready hai, ab yeh aapka hai. Aapke business ki details aur humare banaye 3 ads isme hain.
   > 1. adbrain.vanshul.com/login pe **{email}** se sign in karein: *Continue with Google* (Gmail ho to) ya *Email me a sign-in link*.
   > 2. Ab ads pe 'Sample' nahi likha. Jab tak aap *Go live* nahi dabate, kuch nahi chalta.
   > 3. Agla step: apna Facebook Page connect karna (step 3). **{day, time}** ko saath mein karenge, lagbhag 20 minute.
   > Pehla campaign free set hoga. Ad ka paisa aap seedha Meta ko dete hain, sirf un ads ka jo aap approve karein. Uske baad ₹999 mahina, pehla mahina free, koi auto-debit nahi.
