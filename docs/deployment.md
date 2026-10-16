# Deployment guide

## Preview (recommended before production)

1. Attach this repo to GitHub and a Vercel project.
2. Create/link a **Convex production or preview deployment** (do not point agents at a shared personal `dev` without isolation).
3. Set Vercel env:
   - `NEXT_PUBLIC_CONVEX_URL`
   - `NEXT_PUBLIC_SITE_URL` = preview URL
   - Better Auth / site URL alignment with Convex `SITE_URL`
4. Set Convex env per [`convex-env-setup.md`](./convex-env-setup.md).
5. Deploy preview: `vercel deploy` or Git-connected preview.
6. Smoke **dry-run only** on the preview org (`outboundDryRun=true`).

## Production checklist (authorization required)

Do **not** enable the following without explicit user authorization:

- [ ] `ALLOW_LIVE_OUTBOUND=true` on Convex
- [ ] Live Composio connected accounts (Box / Drive / Gmail / Calendar)
- [ ] Live GHL write scopes
- [ ] Live AgentMail + Twilio sender registration
- [ ] Redis (`REDIS_URL`) for Chat SDK (replace memory adapter)
- [ ] Org `schedulesEnabled=true` + enabled schedules
- [ ] Production Better Auth secret rotation
- [ ] Authorized live provider smoke (test recipients only)

## Deploy commands

```bash
# Preview / production web (Vercel)
vercel deploy
# Production promote only after preview sign-off
vercel --prod

# Convex schema + functions to the linked deployment
npx convex deploy   # production Convex only — use convex dev for development
```

Development always uses `npx convex dev`, never `deploy`.

## Git remote / PR

If `origin` is missing:

```bash
git remote add origin git@github.com:<org>/<repo>.git
git push -u origin HEAD
gh pr create --fill
```

## Post-deploy ops

- Open `/ops` for failed inbound, unknown outbound, connection renewals.
- Confirm Mode banner shows dry-run until go-live.
- Cron jobs (`convex/crons.ts`) register on deploy: schedule reconcile (15m), dry-run unknown fold (1h), retention purge (daily UTC 07:30).
