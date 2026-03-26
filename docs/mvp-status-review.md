# AdvizeMe.ai MVP Status Review

## What Is Already Defined

### Core product direction

- AdvizeMe.ai is consistently defined as a lightweight desktop copilot plus workflow intelligence layer for Callahan Auto & Diesel.
- The intended MVP watches advisor workflow across Tekmetric, AutoFlow / AutoTextMe, and Trello rather than replacing those systems.
- The system should prioritize:
  - stalled workflow detection
  - customer update reminders
  - DVI quality review
  - estimate completeness
  - ticket prioritization
  - next-step coaching for advisors

### Business context already captured

- The canonical current context is in `docs/project-master-context.md`.
- Active locations:
  - Country Club
  - Apache
- Active advisors:
  - Country Club: Mitch, Drew
  - Apache: Preston
  - Drew may help Apache and phone coverage
- Active technicians:
  - Apache: TC, Jonathan
  - Country Club: Eugene, Luis
  - Jonathan may move between locations
- Removed from current context:
  - Bob
  - Hank

### Implementation constraints already defined

- First pilot is for one computer first, then broader rollout.
- The app should stay lightweight for older Windows 10 shop machines.
- Preferred capture model is targeted OCR and event capture, not full-time recording.
- Visible notifications plus a side panel are required.
- A live dashboard and central database are part of the MVP direction.
- Supabase is the current preferred backend starting point.

### Logic themes already present in the exports

- The exports repeatedly define the system as:
  - a workflow copilot
  - a DVI and estimate audit layer
  - a priority engine
  - an advisor coaching system
  - a stale-update / follow-up reminder system
- Strong recurring concepts:
  - no missed findings
  - no duplicate work
  - clear next actions
  - structured output instead of long narrative reports
  - safety, customer concern, reliability, and future work separation

## What Is In The Repo Right Now

- `docs/project-master-context.md` is the best current source of truth.
- `exports/chatgpt/` contains useful project thinking and workflow ideas from prior ChatGPT threads.
- `prompts/gpt prompts/chat gpt prompts and instructions.txt` contains broad prompt direction and some reusable operating logic.
- `examples/` and `assets/` mostly contain placeholders rather than real training or validation data.
- `build/` is effectively empty and there is no application scaffold yet.

## Important Gaps And Drift

### Outdated context in older exports

Several exports still reference older business assumptions that should not drive implementation:

- Bob appears as an active advisor in multiple export files.
- Main Street appears in older exports but is not part of the current location context for this MVP.
- Some prompt/export content assumes Airtable, Make, Zapier, and a broader ecosystem that does not match the current Supabase-first MVP direction.

### Missing MVP definition details

The repo does not yet define:

- the exact pilot user flow on Preston's computer
- the event model for Tekmetric / AutoFlow / Trello capture
- the MVP notification rules
- the dashboard metrics and screen layout
- the source-of-truth database schema
- the first scoring rules for DVI quality and estimate completeness
- the boundary between local desktop logic and central backend logic

### Missing implementation assets

- No real screenshots for target OCR/capture areas
- No real DVI examples
- No real estimate examples
- No real workflow edge-case examples
- No technical architecture doc for the desktop app
- No Supabase schema
- No local app scaffold
- No dashboard scaffold
- No ingestion pipeline

## MVP Recommendation

The first pilot should narrow the problem down to one dependable loop:

1. Capture a small set of workflow events from the desktop.
2. Sync those events to Supabase.
3. Score jobs against simple reminder and stall rules.
4. Show high-signal alerts in a side panel plus desktop notifications.
5. Mirror the same alert state to a lightweight dashboard.

This is the shortest path to a usable pilot without overbuilding OCR, AI, or full workflow automation too early.
