# Project Master Context

Use this file as the living source of truth for AdvizeMe.ai.

## Current Goal

Build a first MVP of AdvizeMe.ai on Preston's computer as a desktop copilot plus live dashboard that monitors advisor workflow across Tekmetric, AutoFlow / AutoTextMe, and Trello, then provides reminders, flags, and prioritization.

## Current Business Context

- Business: Callahan Auto & Diesel
- Locations:
  - Country Club
  - Apache
- Core systems in use:
  - Tekmetric at both locations
  - AutoFlow / AutoTextMe at Country Club
  - Trello for Apache mobile truck workflow

## Current Team Structure

### Advisors

- Country Club:
  - Mitch
  - Drew
- Apache:
  - Preston
  - Drew may help cover calls and occasionally assist

### Technicians

- Apache:
  - TC
  - Jonathan
  - Both are in local service trucks
  - Jonathan may move between both locations
- Country Club:
  - Eugene
  - Luis

### Former Staff To Remove From Current Context

- Bob is no longer with the company
- Hank is no longer with the company

## MVP Priorities

- Track whether customers are being updated
- Evaluate whether DVI findings are justified, documented, and usable
- Help ensure estimates cover customer concern, safety, and reliability items
- Flag future work that should still be presented
- Surface stalled workflow, missed follow-up, and missing evidence

## Short-Term Priorities

- Consolidate ChatGPT exports into one clean project memory
- Set up Supabase project and schema
- Build a one-computer pilot
- Add desktop notifications and side panel reminders
- Create a live dashboard for priorities and workflow status

## Mid-Term Priorities

- Expand DVI quality scoring
- Add estimate-vs-DVI audit logic
- Improve OCR and event capture reliability
- Add stronger location-aware workflow handling
- Prepare rollout to additional advisor computers

## Long-Term Vision

- AdvizeMe.ai becomes an advisor copilot and workflow intelligence platform
- Blend desktop monitoring, AI audit logic, and direct API integrations
- Standardize technician, advisor, and manager workflows across both shops
- Support productivity tracking, coaching, follow-up, and missed-opportunity prevention

## Systems Involved

- Tekmetric
- AutoFlow / AutoTextMe
- Trello
- Supabase
- ChatGPT exports and prompt libraries

## Notes

- First pilot should stay lightweight for older Windows 10 computers
- Prefer event capture and targeted OCR over constant screen recording
- Use both visible notifications and a side panel so reminders are not easy to ignore
- Start on Preston's computer first, then expand
