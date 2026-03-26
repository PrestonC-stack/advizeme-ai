insert into public.locations (code, name)
values
  ('COUNTRY_CLUB', 'Country Club'),
  ('APACHE', 'Apache')
on conflict (code) do update
set name = excluded.name;

with resolved_locations as (
  select id, code from public.locations
)
insert into public.staff (location_id, full_name, role, notes)
values
  ((select id from resolved_locations where code = 'COUNTRY_CLUB'), 'Mitch', 'advisor', 'Country Club advisor'),
  ((select id from resolved_locations where code = 'COUNTRY_CLUB'), 'Drew', 'advisor', 'Country Club advisor; can help with calls and Apache coverage'),
  ((select id from resolved_locations where code = 'APACHE'), 'Preston', 'advisor', 'Apache advisor and pilot user'),
  ((select id from resolved_locations where code = 'APACHE'), 'TC', 'technician', 'Apache technician'),
  ((select id from resolved_locations where code = 'APACHE'), 'Jonathan', 'technician', 'May move between locations'),
  ((select id from resolved_locations where code = 'COUNTRY_CLUB'), 'Eugene', 'technician', 'Country Club technician'),
  ((select id from resolved_locations where code = 'COUNTRY_CLUB'), 'Luis', 'technician', 'Country Club technician')
on conflict do nothing;

insert into public.capture_sources (code, name, source_type)
values
  ('TEKMETRIC', 'Tekmetric', 'shop_management'),
  ('AUTOFLOW', 'AutoFlow', 'dvi_workflow'),
  ('AUTOTEXTME', 'AutoTextMe', 'customer_messaging'),
  ('TRELLO', 'Trello', 'workflow_board'),
  ('MANUAL', 'Manual Entry', 'manual')
on conflict (code) do update
set
  name = excluded.name,
  source_type = excluded.source_type;
