# Automatic Supabase Deploy

This project is set up to auto-deploy Supabase Edge Functions from GitHub Actions.

## What deploys automatically

Any push to `main` that changes:

- `supabase/functions/**`
- `supabase/config.toml`

will trigger the GitHub Action:

- `.github/workflows/deploy-supabase-functions.yml`

## One-time GitHub setup

Add this GitHub repository secret:

- `SUPABASE_ACCESS_TOKEN`

## Where to get it

In Supabase:

1. Open your account settings
2. Create or copy a personal access token
3. Save that token as the GitHub repository secret `SUPABASE_ACCESS_TOKEN`

## Current project ref

- `edxnjuadoencmyxppjxq`

## JWT behavior

`supabase/config.toml` sets:

- `functions.autoflow-webhook.verify_jwt = false`

That keeps the webhook public for AutoFlow after each automatic deploy.
