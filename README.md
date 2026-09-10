# Inveritas

Static HTML frontend and Vercel Node functions using Supabase, Stripe and Anthropic.

## Local verification

Use a supported Node LTS release. Run `npm ci --ignore-scripts` to install the locked dependencies, then `npm test`. Tests use synthetic accounts and mocked providers; they do not contact production or make payments. `npm run dev` requires the Vercel CLI and a correctly configured development project.

## Configuration

- `AI_PROVIDER`: `openai` (default) or `anthropic`.
- `OPENAI_API_KEY`, `OPENAI_MODEL`: primary generation configuration; the model defaults to benchmark winner `gpt-5.6-sol`.
- `OPENAI_REASONING_EFFORT`: defaults to `medium` for legal analysis.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`: optional fallback configuration; the Anthropic model defaults to `claude-sonnet-5`.
- Run `node scripts/legal-model-benchmark.mjs` before changing the primary model.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: server-side database/auth access.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: use test-mode values in staging.
- `APP_ORIGIN`: canonical origin for checkout return URLs; defaults to `https://inveritaslaw.com`. Set to the staging HTTPS origin for staging. No trailing slash.
- `COURTLISTENER_API_TOKEN`: verify the exact existing caller configuration before staging citation checks.

Never commit credentials. Frontend Supabase project settings are currently embedded in the HTML; staging must use a separate project's public URL/key. The committed SQL is not a complete database bootstrap. Obtain and review the existing schema, RPCs, policies and storage rules before migrating it.

`GET /api/health` reports configuration presence only. HTTP 200 means configured, **not** that external dependencies have been tested. HTTP 503 indicates missing/invalid configuration.

## Repair branch: release gates

The first repair adds shared model selection, evidence path ownership checks, signed-in checkout and retryable fulfillment errors. Existing dashboard evidence paths use `user_id/case_id/filename`; records outside that layout are blocked from file operations pending an ownership review. No files are moved or deleted by the patch.

The webhook retains a paginated legacy email lookup for sessions created before user-bound checkout. Missing/ambiguous subscription linkage requires reconciliation; inspect failed webhook deliveries. Replayed profile updates are assignments, but payment event logs can duplicate. Do not use those logs as a revenue ledger.

Before production rollout:

1. Verify two-user database/storage isolation and review legacy object paths.
2. Implement and validate the transactional purchase-credit/event ledger and atomic usage reservations. The current free-preview/single-purchase quota bug is not resolved by the first patch.
3. Enforce preview/result access in the API and database policies. The existing visual paywall is not an entitlement boundary.
4. Exercise account creation → Stripe test checkout → verified webhook → purchased output → saved-history read-back, including retry, repeat purchase, cancellation and recovery.
5. Validate all AI paths with the configured model and verify citations against sources. The first patch does not fix verification quality or establish legal accuracy.
6. Review checkout/subscription concurrency and out-of-order events. The first patch blocks checkout when a subscription ID is already linked; it does not replace a transactional billing state machine.

No production database migrations or deployment have been performed by this repair.
