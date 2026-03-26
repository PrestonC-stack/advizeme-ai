# AdvizeMe.ai Desktop Pilot

This is the first desktop shell for the AdvizeMe.ai pilot.

## What is included

- Electron shell for Windows desktop use
- React side-panel interface
- alert feed
- manual event entry
- starter ticket queue
- desktop notification bridge
- Supabase-ready environment config

## Files to know

- `electron/main.ts`: Electron window and native notifications
- `electron/preload.ts`: safe IPC bridge
- `src/App.tsx`: pilot UI and manual event workflow
- `src/supabase.ts`: Supabase client setup
- `.env.example`: required environment values

## Local setup

1. Run `npm install`
2. Copy `.env.example` to `.env`
3. Fill in the Supabase URL and anon key
4. Run `npm run dev`

## Current pilot behavior

- Uses starter mock data until Supabase is connected
- Shows whether Supabase config is present
- Lets you add manual tickets/events into the queue
- Fires a desktop notification when a manual event is added

## Next implementation step

Wire the UI to Supabase tables and replace mock data with live reads from:

- `ticket_current_state`
- `open_ticket_alerts`
