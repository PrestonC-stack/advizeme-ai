create table if not exists public.autoflow_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  webhook_name text,
  event_type text,
  source text not null default 'AUTOFLOW',
  ro_number text,
  location_hint text,
  signature text,
  payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz,
  processing_note text
);

create index if not exists idx_autoflow_webhook_events_received_at
  on public.autoflow_webhook_events(received_at desc);

create index if not exists idx_autoflow_webhook_events_processed
  on public.autoflow_webhook_events(processed, received_at desc);

create index if not exists idx_autoflow_webhook_events_ro_number
  on public.autoflow_webhook_events(ro_number);
