# AdvizeMe.ai Event Model

The pilot should store workflow observations as events first and derive current state second.

## Core event types

- `ticket_opened`
- `ticket_status_changed`
- `customer_updated`
- `advisor_follow_up_needed`
- `dvi_completed`
- `dvi_reviewed`
- `estimate_started`
- `estimate_updated`
- `estimate_authorized`
- `work_started`
- `work_completed`
- `parts_waiting`
- `parts_received`
- `trello_card_moved`
- `manual_note_added`

## First alert types

- `customer_update_overdue`
- `awaiting_follow_up`
- `stalled_ticket`
- `missing_dvi_evidence`
- `missing_estimate_items`
- `high_priority_safety_item`

## First MVP rules

### Customer update overdue

Open an alert when:

- the ticket is active
- and `customer_update_due_at` is in the past
- and there is no newer `customer_updated` event

### Stalled ticket

Open an alert when:

- the ticket is active
- and `last_activity_at` is older than the target threshold
- and the ticket is not waiting on an explicitly known external block

### Missing DVI evidence

Open an alert when:

- a DVI review is present
- and any of these are true:
  - `missing_notes`
  - `missing_photos`
  - `missing_measurements`

### Missing estimate items

Open an alert when:

- an estimate review is present
- and any completeness flag is true

## Why this model

- It works whether the event came from OCR, a screenshot parser, a direct integration, or manual entry.
- It lets the pilot launch before capture automation is perfect.
- It keeps the dashboard and desktop app reading from the same source of truth.
