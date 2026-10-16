# Convex environment setup

Auth and model secrets for Better Auth / AI Gateway belong on the **Convex** deployment, not only in Next.js `.env.local`.

## Local anonymous backend (default for this agent)

```bash
pnpm install
npx convex dev --once   # or keep `npx convex dev` running
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000
# Optional: live models (default is labeled MOCK via mockModel)
# npx convex env set USE_AI_GATEWAY true
```

`.env.local` (written by CLI) should include:

```
CONVEX_DEPLOYMENT=...
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then:

```bash
pnpm dev
```

## Cloud Convex project

1. `npx convex login` (human) or provide `CONVEX_DEPLOY_KEY` for an isolated **dev** deployment.
2. `npx convex dev` to link the project.
3. Set the same Convex env vars:

```bash
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL https://your-preview-or-local-url
# Phase 2+: AI Gateway / model credentials per Convex docs
```

4. Mirror public URLs into Vercel / `.env.local`:

```
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
NEXT_PUBLIC_SITE_URL=https://<your-app-host>
```

## Never put these only in Vercel

- `BETTER_AUTH_SECRET`
- OAuth client secrets used by Better Auth running on Convex
- AI Gateway keys consumed inside Convex actions

Vercel still needs Chat SDK / Redis / Twilio vars for Next.js webhook routes (Phase 4).

## Agent mode note

Cloud coding agents should use a local backend (`npx convex dev` without login) or a dedicated `CONVEX_DEPLOY_KEY` for an isolated cloud dev deployment — never the human’s default personal deployment.
