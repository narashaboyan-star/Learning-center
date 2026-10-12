# Optional parent account (Lesson 16)

## Product adaptation

Kostanyan Learning Center provides lessons, not shippable products. The lesson's customer/order terminology maps to parent/application:

- the existing guest application remains available without sign-in;
- an optional Telegram-authenticated parent account stores parent name and phone;
- child name and grade stay on each application so one parent can register multiple children;
- only applications created after authenticated sign-in appear in that account;
- old and guest applications are never claimed by matching name, username or phone;
- group lessons store an immutable price snapshot of AMD 15,000 per month;
- individual lessons store “after consultation”; there is no online payment.

## Local test preview

The local mock is deliberately restricted to `APP_ENV=test` and must never be deployed:

```text
APP_ENV=test
CUSTOMER_AUTH_MODE=mock
TEST_DATABASE_PATH=.data/customer-preview.sqlite3
```

Run the seed and test server, then open `/account.html?lang=ru`. The yellow notice identifies simulated authentication. It does not contact Telegram.

## Real Telegram OIDC configuration

The implemented flow is Authorization Code with PKCE S256 and a browser-bound, one-time state. It validates the RS256 signature against Telegram JWKS, issuer, audience, expiry and nonce. Required configuration names are:

- `CUSTOMER_AUTH_MODE=telegram`
- `TELEGRAM_OIDC_CLIENT_ID`
- `TELEGRAM_OIDC_CLIENT_SECRET`
- `PUBLIC_BASE_URL`
- `COOKIE_SECURE=true`

For a future HTTPS preview at `https://example.test`, the exact callback is:

```text
https://example.test/api/customer/auth/telegram/callback
```

The site URL and exact callback must be registered in BotFather Allowed URLs. The client secret belongs only in protected server environment configuration. It must not appear in HTML, JavaScript, Git, screenshots or reports.

The Bot API token used for owner notifications is separate from the OIDC client secret. Account sign-in does not request a phone number or permission to send Telegram messages.

## Data and authorization

Migration `002_customer_portal.sql` adds customer accounts, profiles, sessions and OIDC transactions to the same database as applications. Applications receive an optional customer ID, status, price snapshot and idempotency key.

Customer APIs derive identity from the verified server session. They do not accept a customer ID from the browser. Owner and customer sessions use separate cookies. Customers cannot read another customer's application, update statuses, or access owner APIs.

## Statuses

- `new` — new application
- `in_progress` — owner is working on it
- `completed` — processing completed
- `cancelled` — application cancelled

## Current limits

- Real Telegram authentication is implemented but not externally configured or verified.
- The durable production database is not selected; local SQLite is test-only.
- No deployment, BotFather change, production write or external notification test is part of this branch.
- Telegram owner notification failures are recorded, but a saved application remains successful for the visitor.
