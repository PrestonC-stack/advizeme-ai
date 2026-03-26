# Morning Brief Schema Layer

Phase 1B / 1C adds the first operational-memory schema layer for the Morning Brief module.

## Migration File

- `build/supabase/005_morning_brief_ops.sql`

## What It Adds

### Ticket-level operational fields

Extends `tickets` with Morning Brief state such as:

- `current_stage`
- `current_blocker`
- `next_best_action`
- `next_checkpoint`
- `checkpoint_owner_role`
- `checkpoint_due_at`
- `next_handoff_owner`
- `dispatch_ready`
- `dispatch_ready_reason`
- `estimate_ready`
- `estimate_ready_reason`
- `approx_next_stage_eta`
- `approx_completion_eta`
- `contacted_today`
- `last_contact_method`
- waiting-on-parts planning fields
- backup-task planning fields

### New tables

- `ticket_contacts`
- `ticket_stage_checkpoints`
- `ticket_exception_flags`
- `ticket_action_items`
- `ticket_assignment_history`
- `qc_flags`
- `daily_briefs`

### DVI audit expansion

Extends `dvi_reviews` toward a more evidence-based rubric:

- complaint verification
- photo present / useful
- recommendation specificity
- estimate readiness
- missing proof
- likely follow-up question
- likely customer objection
- technician / advisor / estimate builder / QC feedback

### New / updated views

- updated `ticket_current_state`
- new `morning_brief_rollup`

## Intent

This layer is not trying to rebuild Tekmetric or AutoFlow.

It creates shared operational memory in Supabase so AdvizeMe.ai can:

- hold stage-based production state
- store checkpoints and handoffs
- log exception flags
- track contact discipline
- support Morning Brief snapshots
- support later Advisor Command and DVI Audit Center work

## Current UI Use

The desktop app already understands many of these fields and will use them when present.

Until the migration is applied and populated, the app still falls back to derived logic from:

- `ticket_current_state`
- `open_ticket_alerts`
- `ticket_events`
- `dvi_reviews`

## Next Steps

1. Apply `005_morning_brief_ops.sql`
2. Backfill / begin writing:
   - `current_stage`
   - `current_blocker`
   - `next_best_action`
   - checkpoints
   - exception flags
3. Update webhook / normalization logic to populate the new operational fields
4. Add daily brief generation and saved printable snapshots
