# Authentication API

Sign-in handlers and the sign-in outcome event. Conventions: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| POST | `/api/auth/outcome` | How a browser sign-in step ended: `{method: password\|email_link\|google, outcome: success\|started}` or `{…, outcome: failed, code}` (Supabase code from a fixed list, else `other`) | Signed-out allowed; same origin, strict body ≤ 512 bytes, 20/min per address (`x-real-ip`) and 600/min overall; a `success` counts only with a session; 204, never the email (#451 L4) |

### Authentication Handlers

These sit outside `/api` and return redirects rather than the API envelope:

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| GET | `/auth/callback` | `code` or `token_hash` + `type`; optional `redirect`; `via=email\|google` (which sign-in started it, #1562) | Exchanges/validates Supabase credentials, then redirects to safe local destination; failure -> `/login?error=<reason>` (`link_expired`, `other_browser`, `link_other_browser` for an email link opened in another browser, `cancelled`, `auth`; #1414) |
| GET | `/auth/dev-login` | No body | Disabled -> login; enabled development tries configured real login, otherwise a seven-day offline development cookie |
| GET | `/auth/dev-logout` | No body | Clears offline development cookie and redirects to login; not a general Supabase sign-out API |

If both completion forms are supplied, `code` takes precedence. Never put callback
codes/token hashes in example URLs, logs or screenshots. Development cookie access
does not satisfy real API ownership/authentication. Normal login methods use
Supabase Auth client APIs rather than an invented `/api/login` endpoint.
