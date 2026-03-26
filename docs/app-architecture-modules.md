# App Architecture Modules

This document defines the target structure for the AdvizeMe.ai desktop app as a single shop operating system with multiple focused modules.

## Product Direction

The app should feel like apps inside one app:

- one shell
- one design system
- one shared Supabase backend
- one shared user/session model
- multiple focused modules

The app should not become one giant scrolling operational page and should not split into disconnected mini-apps.

## Main Modules

1. Morning Brief
2. Advisor Command
3. Tech Ops
4. DVI Audit Center
5. QC Closeout
6. Time Clock
7. Productivity
8. Reference Desk
9. Admin / Integrations

## Shared Shell

The shell should provide:

- sidebar or module-card navigation
- role-based visibility
- shared layout and design system
- location awareness
- notifications / alerts
- quick RO lookup

## Shared Operational Entities

The app should center on shared operational entities:

- users
- roles
- employees
- locations
- repair orders
- events/timeline
- alerts
- DVI audits
- QC closeouts
- contact tracking
- time punches
- productivity snapshots
- AI/generated notes

## Role Intent

### Morning Brief
- clean daily launch point
- summary only
- no clutter from import or testing tools

### Advisor Command
- main front-counter operations module
- active RO handling
- priority queue
- customer follow-up
- estimate readiness
- event timeline

### Tech Ops
- assigned work
- DVI needed
- QC needed
- rechecks
- status acknowledgements

### DVI Audit Center
- documentation quality
- estimate readiness
- advisor guidance
- tech redo guidance

### QC Closeout
- touched component checklist
- reinstall / connector / fluid / fastener verification
- comeback prevention
- anti-pencil-whip controls

### Time Clock
- simple clock in/out
- current status
- location-aware use

### Productivity
- billed vs clocked
- efficiency
- productivity
- rolling comparisons

### Reference Desk
- lightweight helper module
- specs
- conversions
- fluid / application questions

### Admin / Integrations
- imports
- sample/test tools
- manual event entry
- integration status
- webhook / parse / diagnostics

## UI Principles

- advisor-first
- easy to scan
- minimal clutter
- consistent cards
- focused per-module experiences
- action-first, not essay-first

## Refactor Rules

As the app is restructured:

- move production-facing logic out of `App.tsx` into modules
- keep admin/testing tools off operational screens
- keep RO-level details inside dedicated workspaces
- keep role outputs separated:
  - tech
  - advisor
  - customer
- keep writeback actions controlled and confirmed

## Implementation Priority

Phase 1:
- shell
- navigation
- role model

Phase 2:
- Morning Brief
- Advisor Command

Phase 3:
- Time Clock
- Productivity

Phase 4:
- DVI Audit Center

Phase 5:
- QC Closeout

Phase 6:
- Reference Desk
- Admin cleanup

## Current Reality

The current app already has working building blocks we should preserve:

- Supabase connection
- AutoFlow webhook ingestion
- DVI fetch and scoring
- role-style output for advisor/tech/customer
- print/export helpers
- basic production pipeline scoring

The refactor should reorganize these into cleaner modules rather than throwing them away.
