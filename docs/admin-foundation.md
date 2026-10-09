# Admin foundation (local/test only)

## Safety boundary

This foundation is deliberately isolated from production. `APP_ENV=production` is rejected, and the SQLite path must be inside the repository's ignored `.data/` directory. No Vercel project, DNS record, public page, production database, Telegram secret, or deployment setting is changed.

The existing static pages, three languages, blog, SEO files, article files, images, Telegram endpoint, and Codex draft automation remain unchanged.

## Data decisions

- `services` contains fixed business concepts, not shop products: trial lesson, individual/group lesson type, online/in-person mode.
- `service_translations` stores editable names and descriptions for `ru`, `hy`, and `en`. Keys and kinds are stable integration identifiers.
- `applications` stores the current form fields and Telegram delivery result. It intentionally has no price, stock, discount, workflow status, or internal note.
- `application_items` stores one immutable snapshot for the service, lesson type, and mode selected at submission time. Editing a service later must not rewrite a historical application.
- `articles`, `article_translations`, and `media_assets` reserve the shared schema for existing/imported articles, drafts, images, and separate video files. A source-language article can be published while failed translations retain a visible warning.
- Authentication supports one or more rows technically, but the agreed product flow provisions one owner only. Passwords use scrypt; only token hashes are stored for sessions and password resets.

## Frozen interfaces for tasks A and B

Languages are `ru | hy | en`.

Service identifiers:

- `service`: `trial-lesson`
- `lesson_type`: `individual | group`
- `mode`: `online | offline`

The application input contract is the current public form contract:

```json
{
  "parentName": "string",
  "phone": "0 + 8 digits",
  "childName": "string",
  "grade": "string",
  "lessonType": "individual | group",
  "mode": "online | offline",
  "helpNeeded": "string (optional)",
  "language": "ru | hy | en"
}
```

Protected admin APIs live below `/api/admin/` and return HTTP `401` with `{"ok":false,"code":"authentication_required"}` without a valid owner session. Protected pages live below `/admin/` and redirect unauthenticated visitors to `/admin/login.html`.

Independent features plug into the common server without editing it. `features/services-routes.js` and `features/applications-routes.js` each export an array of `{ method, path, access, handle }`. `access` is `public` or `owner`; every `/api/admin/*` route is rejected at startup unless it is owner-only. Handlers receive the database, authenticated owner, parsed URL, a bounded JSON reader, and a JSON response helper.

Common files have one owner and are not edited independently by A or B:

- `db/migrations/**`
- `server/config.js`, `server/database.js`, `server/migrations.js`
- `server/auth.js`, `server/contracts.js`, `server/http-app.js`
- `server/feature-routes.js`
- `admin/login.*`, `admin/shared.css`, `admin/index.html`

Task A owns service repository/API, `admin/services.*`, and public service-data binding. Task B owns application repository/API, `admin/applications.*`, the public submission binding, and Telegram delivery. If either task needs a schema or shared-contract change, it reports the request to the common owner instead of changing shared files.

## Local test setup

Node 22.5 or newer is required because the foundation uses built-in `node:sqlite`; there are no external packages to install.

1. Copy only variable names from `.env.example` into a local ignored `.env` or export them in the shell.
2. Set a test-only owner email and a password of at least 12 characters.
3. Run `npm run db:seed:test`, then `npm run dev:test`.
4. Open `http://127.0.0.1:4173/admin/login.html`.

The reset flow exposes a delivery adapter to tests but deliberately sends no real email by default. A production email provider and production-capable shared database are separate, approval-gated decisions before deployment.

## Migration and rollback

Migrations are ordered SQL files recorded in `schema_migrations` and applied in one transaction each. Seed operations only insert missing fixed services and translations; they do not overwrite later admin edits. The test database is disposable and ignored by Git.

Rollback of this foundation is a Git rollback to the commit before the foundation branch. No production rollback is required because production is untouched.
