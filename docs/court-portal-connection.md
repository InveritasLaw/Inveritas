# Court portal read-only analysis connection

`GET /api/portal-analysis` returns the latest saved analysis from one configured case. It cannot start runs or mutate evidence. It does not accept caller-selected case or owner IDs.

Configure server-side only:

- `COURT_PORTAL_CASE_ID`: explicitly selected criminal case UUID.
- `COURT_PORTAL_OWNER_ID`: that case's owner UUID.
- `COURT_PORTAL_READ_TOKEN`: a fresh random secret of at least 40 characters dedicated to this connection.

Set the same secret as `INVERITAS_READ_TOKEN` on the authenticated Cloudflare court portal. Never send Supabase service-role credentials to that portal or the browser. Leave all three Inveritas settings unset until the correct case and owner are confirmed. Existing Supabase configuration remains server-side.

The court portal fetches on overview load and manual refresh. It displays the actual analysis timestamp and version, preserves the last loaded report if a refresh fails, and offers a PDF for the attorney. This is not automatic reanalysis or an email delivery integration. Reruns continue through Inveritas's authenticated usage-controlled flow.
