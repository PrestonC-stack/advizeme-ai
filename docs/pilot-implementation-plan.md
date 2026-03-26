# AdvizeMe.ai Pilot Implementation Plan

## Pilot Goal

Build a first usable MVP for Preston's computer that detects workflow risk early and makes the next action obvious.

The pilot should deliver three visible outcomes:

1. A lightweight desktop side panel with alerts and reminders
2. Desktop notifications for urgent or stale workflow items
3. A live dashboard backed by Supabase for shared visibility and historical tracking

## MVP Scope

### Included in version 1

- Local desktop event capture on one Windows 10 computer
- Targeted OCR or window-state capture for specific Tekmetric / AutoFlow / Trello views
- Manual and automatic job status updates
- Reminder engine for:
  - customer update overdue
  - ticket stale / no recent movement
  - missing DVI support
  - estimate likely incomplete
  - pending follow-up
- Simple DVI quality checks based on available evidence
- Lightweight web dashboard with live priority list
- Supabase database, rules, and sync layer

### Excluded from version 1

- Full-screen recording
- Broad always-on surveillance capture
- Deep API integrations unless one becomes easy and reliable
- Complex AI agent orchestration
- Fully automated estimate building
- Technician performance scoring
- Multi-computer rollout

## Recommended MVP Architecture

### Local desktop app

- Framework: Electron + React + TypeScript
- Why:
  - stable on Windows
  - supports side panel and desktop notifications
  - can run a lightweight background process
  - easiest path for OCR helpers and window-aware capture

### Backend

- Supabase for:
  - Postgres
  - auth
  - realtime subscriptions
  - storage for screenshots or evidence snippets if needed

### Dashboard

- Next.js web app or lightweight React SPA deployed separately
- Reads live job state from Supabase
- Can run on the same local machine first, then expand later

## Core Data Model

The first schema should center on workflow events, not full shop-system replication.

### Tables

- `locations`
- `staff`
- `vehicles`
- `tickets`
- `ticket_events`
- `ticket_alerts`
- `dvi_reviews`
- `estimate_reviews`
- `capture_sources`

### Key principle

Treat each captured observation as an event. Build current ticket state from events plus a small derived status layer. This keeps the MVP simple, auditable, and flexible while capture methods evolve.

## First Rules Engine

The first rules should be deterministic and easy to explain.

### Alert types

- `customer_update_overdue`
- `awaiting_follow_up`
- `stalled_ticket`
- `missing_dvi_evidence`
- `missing_estimate_items`
- `high_priority_safety_item`

### Suggested first thresholds

- customer update overdue: no logged update within 2 business hours after important status change
- stalled ticket: no meaningful change within 4 business hours while ticket is active
- missing DVI evidence: recommendation exists without note or photo evidence
- missing estimate items: DVI category present but no corresponding estimate block logged
- high priority safety item: brake, steering, leak, no-start, or disablement condition present

## Build Sequence

### Phase 1: lock source of truth

- Finalize canonical staffing/location context
- Separate current truth from outdated export material
- Define event vocabulary and alert vocabulary

### Phase 2: stand up backend

- Create Supabase project
- Add initial schema and seed data
- Add row-level structure only if needed for later multi-user rollout
- Add derived views for dashboard-ready ticket state

### Phase 3: desktop pilot shell

- Create Electron app shell
- Add local store and Supabase sync client
- Add side panel UI
- Add Windows notifications
- Add manual ticket add/edit controls so the pilot is still usable before full capture is ready

### Phase 4: capture layer

- Detect active windows for Tekmetric / AutoFlow / Trello
- Add targeted capture actions for specific regions and trigger points
- Start with operator-invoked or event-triggered captures, not constant OCR loops
- Persist capture metadata and extracted fields to Supabase

### Phase 5: rules and dashboard

- Turn events into alert state
- Build dashboard list views:
  - by priority
  - by location
  - by advisor
  - stale tickets
- Add acknowledgment and snooze actions

### Phase 6: quality review loop

- Add DVI review inputs
- Add estimate review inputs
- Compare review outcomes against alerts
- Tighten thresholds using real shop examples

## Exact Next Build Steps

1. Create the actual app scaffold in `build/` with:
   - `desktop/`
   - `dashboard/`
   - `supabase/`
2. Add a Supabase schema for locations, staff, tickets, events, alerts, and review tables.
3. Seed the current staff and locations for Country Club and Apache.
4. Build the desktop shell first:
   - side panel
   - notification service
   - local ticket list
   - Supabase sync
5. Build a minimal dashboard second:
   - active tickets
   - alerts
   - priorities
   - location filter
6. Add manual event entry before OCR so the workflow can be tested immediately.
7. Add targeted capture for one source first:
   - recommended first source: Tekmetric ticket workflow
8. Add AutoFlow reminder checks second.
9. Add Trello Apache workflow visibility third.
10. Start collecting real screenshots and real DVI/estimate examples to validate the rules.

## Build-Mode Definition

The project is officially in build mode when these three things exist in the repo:

- runnable desktop scaffold
- committed Supabase schema
- committed dashboard scaffold

Until those exist, the repo is still mostly a planning repository.
