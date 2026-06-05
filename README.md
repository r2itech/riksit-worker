# riksit-worker

Cloudflare Worker that powers the live report feed and spotted-info banner in
the [RIKSIT](https://riksit.vercel.app) dashboard. Every 30 minutes it scrapes
public sources for Indonesian environmental issues, analyses them with Groq,
and writes the results into Supabase.

App repo: [r2itech/riksit](https://github.com/r2itech/riksit).

## Pipeline

```
cron (*/30 * * * *)
  ├── fetch Google News RSS (Indonesia, environmental keywords)
  └── fetch GDACS RSS (global disaster alerts)
        │
        ▼
  dedupe by URL + filter to the last 24h
        │
        ▼
  Groq analysis (Bahasa Indonesia)
    • isEnvironmental? (Indonesia-only — overseas issues are filtered out)
    • severity: high | medium
    • location: province / regency / district / village
    • 1–2 sentence ringkasan
        │
        ▼
  Supabase
    • reports   — every environmental item (username: "Riksit Agent")
    • spotted_info — only severity = "high", expires after 6h
```

## Development

```bash
npm install
npm run dev                                              # local worker
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"  # trigger the cron handler
npx tsc --noEmit                                         # type check
npm run deploy                                           # deploy to Cloudflare
```

Local secrets go in `.dev.vars` (gitignored). Production secrets live in
Cloudflare Workers secrets — never commit keys.

| Variable            | Description                       |
| ------------------- | --------------------------------- |
| `GROQ_API_KEY`      | Groq API key (riksit-worker key)  |
| `SUPABASE_URL`      | Supabase project URL              |
| `SUPABASE_ANON_KEY` | Supabase anon key                 |
| `ENVIRONMENT`       | `production` or `development`     |

## Cloudflare

Runs as a Cloudflare Worker. Config lives in `wrangler.jsonc`:

| Field                | Value                |
| -------------------- | -------------------- |
| `name`               | `riksit-worker`      |
| `main`               | `src/index.ts`       |
| `compatibility_date` | `2024-01-01`         |
| `triggers.crons`     | `*/30 * * * *` (every 30 min UTC) |
| `vars.ENVIRONMENT`   | `production`         |

One-time setup:

```bash
npx wrangler login                              # auth to Cloudflare account
npx wrangler secret put GROQ_API_KEY            # paste secret when prompted
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
```

Day-to-day:

```bash
npx wrangler tail            # stream live logs from the deployed worker
npx wrangler deployments list
npx wrangler triggers deploy # re-register cron if it stops firing
```

Bundle stays under the 1 MB Worker limit by calling Groq and Supabase via
`fetch` rather than pulling in SDKs.

## Layout

```
src/
  index.ts              cron + fetch handlers
  sources/
    google-news.ts      Google News RSS by keyword
    gdacs.ts            GDACS global disaster RSS
  lib/
    groq.ts             Groq client + analysis prompt
    supabase.ts         Supabase REST client (fetch only, no SDK)
    parser.ts           RSS/XML helpers
    types.ts            shared types
```

No SDK dependencies — Groq and Supabase are called via `fetch` to stay under
the 1 MB Worker bundle limit.

## Groq behaviour

- Primary model `llama-3.3-70b-versatile`, fallback `llama-3.1-8b-instant`.
- Batches of 5 articles per call, with a 3s pause between batches.
- Each article is truncated before being sent: `title` ≤ 100 chars,
  `description` ≤ 300 chars (with `...` suffix when trimmed).
- Retry rules: `408`, `429`, `5xx` are retried with exponential backoff;
  any other `4xx` breaks immediately and falls through to the next model.

## Supabase tables

### `reports`

Every environmental item lands here. AI-generated rows use `username: "Riksit Agent"`
and `is_ai: true`. Location names are lowercased before insert. Inserts are
deduped against the last 2 hours by `source_url`.

### `spotted_info`

Only `severity: "high"` items. Each row expires 6 hours after creation
(`expires_at = created_at + 6h`). Same lowercase-location rule.

## CI / deploy

- `.github/workflows/ci.yml` — runs `tsc --noEmit` on PRs to `develop`/`master`
  and on pushes to `develop`.
- `.github/workflows/deploy.yml` — `wrangler deploy` on pushes to `master`.

Working branch is `develop`. PRs land on `develop`; merging to `master`
triggers a production deploy.
