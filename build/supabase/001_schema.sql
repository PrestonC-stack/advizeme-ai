create extension if not exists pgcrypto;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),
  full_name text not null,
  role text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.capture_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  source_type text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),
  plate text,
  vin text,
  year integer,
  make text,
  model text,
  customer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  vehicle_id uuid references public.vehicles(id),
  source_id uuid references public.capture_sources(id),
  external_ticket_id text,
  source_status text,
  ticket_type text,
  priority_level text,
  customer_update_due_at timestamptz,
  last_customer_update_at timestamptz,
  last_activity_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  advisor_id uuid references public.staff(id),
  technician_id uuid references public.staff(id),
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_ticket_id)
);

create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  source_id uuid references public.capture_sources(id),
  event_type text not null,
  event_at timestamptz not null,
  actor_staff_id uuid references public.staff(id),
  event_value text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_events_ticket_id_event_at
  on public.ticket_events(ticket_id, event_at desc);

create table if not exists public.ticket_alerts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  alert_type text not null,
  severity text not null,
  status text not null default 'open',
  title text not null,
  detail text,
  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  snoozed_until timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_ticket_alerts_ticket_id_status
  on public.ticket_alerts(ticket_id, status);

create table if not exists public.dvi_reviews (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  source_id uuid references public.capture_sources(id),
  review_status text not null default 'pending',
  quality_score integer,
  missing_notes boolean not null default false,
  missing_photos boolean not null default false,
  missing_measurements boolean not null default false,
  safety_flag boolean not null default false,
  findings_summary text,
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.estimate_reviews (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  source_id uuid references public.capture_sources(id),
  review_status text not null default 'pending',
  completeness_score integer,
  missing_labor boolean not null default false,
  missing_parts boolean not null default false,
  missing_sublet boolean not null default false,
  missing_fluids boolean not null default false,
  missing_related_work boolean not null default false,
  findings_summary text,
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view public.ticket_current_state as
select
  t.id,
  l.code as location_code,
  l.name as location_name,
  cs.code as source_code,
  t.external_ticket_id,
  t.source_status,
  t.ticket_type,
  t.priority_level,
  t.customer_update_due_at,
  t.last_customer_update_at,
  t.last_activity_at,
  t.opened_at,
  t.closed_at,
  t.summary,
  v.customer_name,
  v.year,
  v.make,
  v.model,
  advisor.full_name as advisor_name,
  tech.full_name as technician_name,
  (
    select count(*)
    from public.ticket_alerts ta
    where ta.ticket_id = t.id
      and ta.status = 'open'
  ) as open_alert_count
from public.tickets t
join public.locations l on l.id = t.location_id
left join public.capture_sources cs on cs.id = t.source_id
left join public.vehicles v on v.id = t.vehicle_id
left join public.staff advisor on advisor.id = t.advisor_id
left join public.staff tech on tech.id = t.technician_id;

create or replace view public.open_ticket_alerts as
select
  ta.id,
  ta.ticket_id,
  ta.alert_type,
  ta.severity,
  ta.title,
  ta.detail,
  ta.triggered_at,
  t.external_ticket_id,
  l.code as location_code,
  l.name as location_name,
  v.customer_name,
  v.year,
  v.make,
  v.model
from public.ticket_alerts ta
join public.tickets t on t.id = ta.ticket_id
join public.locations l on l.id = t.location_id
left join public.vehicles v on v.id = t.vehicle_id
where ta.status = 'open';
