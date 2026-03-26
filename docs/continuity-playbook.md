# Continuity Playbook

Use this file to preserve project context as the desktop app evolves.

## Why This Exists

The chat thread can get long, but the project should not depend on chat history to stay understandable.

This repo should always contain enough context to resume work from:

- the code
- the docs
- the database schema
- the latest committed state

## Current Continuity Strategy

We are using four layers of continuity:

1. Git + GitHub
- The project is version-controlled.
- Changes should be committed and pushed regularly.
- Supabase function deploys are wired through GitHub Actions.

2. Repo docs
- Architecture decisions, workflow rules, and handoff notes belong in `docs/`.
- Important advisor/tech logic should be written into docs, not left only in chat.

3. Supabase
- Live operational state lives in Supabase.
- AutoFlow webhooks, DVI reviews, alerts, and timeline data already flow there.

4. App structure
- The desktop app should be modular enough that new work can be resumed by reading the codebase, not reconstructing one giant file mentally.

## Working Rules

To reduce context loss over time:

- Commit after each meaningful phase.
- Push after backend or workflow logic changes.
- Update docs when product rules change.
- Keep operational logic in code and docs, not just in conversation.
- Prefer adding focused docs over relying on memory.

## Recommended Stop Points

Good pause points for this project are:

- after shell/navigation changes
- after a module is functional
- after schema changes
- after webhook logic changes
- after print/export workflow changes

At each stop point:

1. update docs if needed
2. run local checks
3. commit
4. push

## Current Live Capabilities

As of this checkpoint:

- Desktop app launches locally
- Supabase project is connected
- AutoFlow webhook receiver is live
- AutoFlow DVI fetch is live
- DVI analysis writes into `dvi_reviews`
- Advisor/tech/customer workflow output exists in the app
- Print/export helpers exist for advisor output, tech redo, customer update, and follow-up sheets
- GitHub Action deploys Supabase functions automatically

## Current Architectural Direction

The app is moving toward a single shop operating system with focused modules:

- Morning Brief
- Advisor Command
- Tech Ops
- DVI Audit Center
- QC Closeout
- Time Clock
- Productivity
- Reference Desk
- Admin / Integrations

This direction should guide refactors going forward.

## Resume Checklist

When resuming work later:

1. Read:
   - `docs/project-master-context.md`
   - `docs/continuity-playbook.md`
   - `docs/app-architecture-modules.md`
2. Review current app structure in `build/desktop`
3. Review current webhook logic in `supabase/functions/autoflow-webhook/index.ts`
4. Check latest Git status / recent commits
5. Continue from the current phase rather than rebuilding old context from memory

## What We Should Keep Doing

- Treat docs as durable working memory
- Keep module boundaries clear
- Keep production tools separate from admin/testing tools
- Keep advisor-first workflow as the primary product path
