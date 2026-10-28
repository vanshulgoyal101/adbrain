Role: fixes #

**Why:** the problem and its evidence.

**Change:** what this PR does.

**Done when / evidence:** the red-then-green test, `test:core`, and the production check after release.

**Files:** the main ones.

**Built properly (AGENTS.md):**
- [ ] Every layer it needs changed in the right place: types, DB, service, API, UI, words, docs
- [ ] Fits #1792: core stays channel-neutral; platform calls only in that channel's adapter
- [ ] Reused or extended existing code; no duplicated logic, no one-off special cases
- [ ] Tests at the right level (unit / recorded core test / e2e)
- [ ] Any shortcut has a `TODO(#issue)` and a follow-up issue

**Risk:** low / money / migration (base `main`) / tenant. Low auto-merges on green CI; anything else waits for QA (AGENTS.md).

→ Role: next step
