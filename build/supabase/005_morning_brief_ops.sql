alter table public.tickets
  add column if not exists current_stage text,
  add column if not exists current_blocker text,
  add column if not exists next_best_action text,
  add column if not exists next_checkpoint text,
  add column if not exists checkpoint_owner_role text,
  add column if not exists checkpoint_due_at timestamptz,
  add column if not exists next_handoff_owner text,
  add column if not exists dispatch_ready boolean,
  add column if not exists dispatch_ready_reason text,
  add column if not exists estimate_ready boolean,
  add column if not exists estimate_ready_reason text,
  add column if not exists approx_next_stage_eta timestamptz,
  add column if not exists approx_completion_eta timestamptz,
  add column if not exists contacted_today boolean not null default false,
  add column if not exists last_contact_method text,
  add column if not exists waiting_parts_vendor text,
  add column if not exists waiting_parts_eta timestamptz,
  add column if not exists waiting_parts_wait_mode text,
  add column if not exists waiting_parts_other_work_possible boolean,
  add column if not exists backup_task_staged boolean not null default false,
  add column if not exists backup_task_summary text,
  add column if not exists parts_follow_up_due_at timestamptz,
  add column if not exists parts_follow_up_owner_id uuid references public.staff(id),
  add column if not exists metadata_version integer not null default 1;

create index if not exists idx_tickets_current_stage
  on public.tickets(current_stage);

create index if not exists idx_tickets_checkpoint_due_at
  on public.tickets(checkpoint_due_at)
  where closed_at is null;

create index if not exists idx_tickets_parts_follow_up_due_at
  on public.tickets(parts_follow_up_due_at)
  where closed_at is null;

create table if not exists public.ticket_contacts (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  employee_id uuid references public.staff(id),
  contact_type text not null default 'customer_update',
  contact_method text,
  summary text not null,
  contact_at timestamptz not null default now(),
  follow_up_due_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_contacts_ticket_id_contact_at
  on public.ticket_contacts(ticket_id, contact_at desc);

create table if not exists public.ticket_stage_checkpoints (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  checkpoint_type text not null,
  checkpoint_text text not null,
  owner_role text,
  owner_staff_id uuid references public.staff(id),
  stage_name text,
  status text not null default 'open',
  due_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ticket_stage_checkpoints_ticket_id_status
  on public.ticket_stage_checkpoints(ticket_id, status, due_at);

create table if not exists public.ticket_exception_flags (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  flag_type text not null,
  severity text not null,
  status text not null default 'open',
  title text not null,
  detail text,
  owner_role text,
  owner_staff_id uuid references public.staff(id),
  detected_at timestamptz not null default now(),
  due_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_ticket_exception_flags_ticket_id_status
  on public.ticket_exception_flags(ticket_id, status, severity, detected_at desc);

create table if not exists public.ticket_action_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  action_type text not null,
  priority_level text not null,
  queue_group text not null,
  title text not null,
  detail text,
  owner_role text,
  owner_staff_id uuid references public.staff(id),
  due_at timestamptz,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ticket_action_items_ticket_id_status
  on public.ticket_action_items(ticket_id, status, due_at);

create index if not exists idx_ticket_action_items_queue_group
  on public.ticket_action_items(queue_group, priority_level, due_at);

create table if not exists public.ticket_assignment_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  assignment_type text not null,
  from_staff_id uuid references public.staff(id),
  to_staff_id uuid references public.staff(id),
  changed_by_staff_id uuid references public.staff(id),
  changed_at timestamptz not null default now(),
  change_reason text,
  sync_risk_flag boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_ticket_assignment_history_ticket_id_changed_at
  on public.ticket_assignment_history(ticket_id, changed_at desc);

create table if not exists public.qc_flags (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  flag_type text not null,
  severity text not null,
  title text not null,
  detail text,
  status text not null default 'open',
  owner_staff_id uuid references public.staff(id),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_qc_flags_ticket_id_status
  on public.qc_flags(ticket_id, status, detected_at desc);

create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  brief_date date not null,
  generated_at timestamptz not null default now(),
  generated_by_staff_id uuid references public.staff(id),
  status text not null default 'draft',
  snapshot_json jsonb not null default '{}'::jsonb,
  printable_summary text,
  notes text,
  unique (location_id, brief_date)
);

create index if not exists idx_daily_briefs_brief_date
  on public.daily_briefs(brief_date desc, location_id);

alter table public.dvi_reviews
  add column if not exists complaint_verified boolean,
  add column if not exists photo_present boolean,
  add column if not exists photo_useful boolean,
  add column if not exists recommendation_specific boolean,
  add column if not exists estimate_ready boolean,
  add column if not exists missing_proof boolean,
  add column if not exists likely_follow_up_question text,
  add column if not exists likely_customer_objection text,
  add column if not exists technician_feedback text,
  add column if not exists advisor_feedback text,
  add column if not exists estimate_builder_feedback text,
  add column if not exists qc_feedback text;

drop view if exists public.morning_brief_rollup;
drop view if exists public.ticket_current_state;

create view public.ticket_current_state as
select
  t.id,
  l.code as location_code,
  l.name as location_name,
  cs.code as source_code,
  t.external_ticket_id,
  t.source_status,
  t.ticket_type,
  t.priority_level,
  t.current_stage,
  t.current_blocker,
  t.next_best_action,
  t.next_checkpoint,
  t.checkpoint_owner_role,
  t.checkpoint_due_at,
  t.next_handoff_owner,
  t.dispatch_ready,
  t.dispatch_ready_reason,
  t.estimate_ready,
  t.estimate_ready_reason,
  t.customer_update_due_at,
  t.last_customer_update_at,
  t.contacted_today,
  t.last_contact_method,
  t.last_activity_at,
  t.approx_next_stage_eta,
  t.approx_completion_eta,
  t.waiting_parts_vendor,
  t.waiting_parts_eta,
  t.waiting_parts_wait_mode,
  t.waiting_parts_other_work_possible,
  t.backup_task_staged,
  t.backup_task_summary,
  t.parts_follow_up_due_at,
  parts_owner.full_name as parts_follow_up_owner_name,
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
  ) as open_alert_count,
  (
    select count(*)
    from public.ticket_exception_flags tef
    where tef.ticket_id = t.id
      and tef.status = 'open'
  ) as open_exception_count,
  (
    select count(*)
    from public.qc_flags qf
    where qf.ticket_id = t.id
      and qf.status = 'open'
  ) as open_qc_flag_count
from public.tickets t
join public.locations l on l.id = t.location_id
left join public.capture_sources cs on cs.id = t.source_id
left join public.vehicles v on v.id = t.vehicle_id
left join public.staff advisor on advisor.id = t.advisor_id
left join public.staff tech on tech.id = t.technician_id
left join public.staff parts_owner on parts_owner.id = t.parts_follow_up_owner_id;

create view public.morning_brief_rollup as
select
  tcs.id as ticket_id,
  tcs.location_code,
  tcs.location_name,
  tcs.external_ticket_id,
  tcs.customer_name,
  tcs.year,
  tcs.make,
  tcs.model,
  coalesce(tcs.current_stage, tcs.source_status, 'Unknown') as stage_name,
  tcs.current_blocker,
  tcs.next_best_action,
  tcs.next_checkpoint,
  tcs.next_handoff_owner,
  tcs.dispatch_ready,
  tcs.estimate_ready,
  tcs.customer_update_due_at,
  tcs.last_customer_update_at,
  tcs.contacted_today,
  tcs.last_contact_method,
  tcs.last_activity_at,
  tcs.approx_next_stage_eta,
  tcs.approx_completion_eta,
  tcs.waiting_parts_vendor,
  tcs.waiting_parts_eta,
  tcs.waiting_parts_wait_mode,
  tcs.waiting_parts_other_work_possible,
  tcs.backup_task_staged,
  tcs.backup_task_summary,
  tcs.parts_follow_up_due_at,
  tcs.parts_follow_up_owner_name,
  tcs.advisor_name,
  tcs.technician_name,
  tcs.open_alert_count,
  tcs.open_exception_count,
  tcs.open_qc_flag_count,
  latest_dvi.review_status as latest_dvi_status,
  latest_dvi.quality_score as latest_dvi_quality_score,
  latest_dvi.safety_flag as latest_dvi_safety_flag,
  latest_dvi.estimate_ready as latest_dvi_estimate_ready,
  latest_dvi.missing_proof as latest_dvi_missing_proof
from public.ticket_current_state tcs
left join lateral (
  select
    dr.review_status,
    dr.quality_score,
    dr.safety_flag,
    dr.estimate_ready,
    dr.missing_proof
  from public.dvi_reviews dr
  where dr.ticket_id = tcs.id
  order by dr.created_at desc
  limit 1
) latest_dvi on true
where tcs.closed_at is null;
