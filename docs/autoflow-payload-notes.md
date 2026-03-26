# AutoFlow Payload Notes

## Confirmed `status_update` payload shape

Observed fields from live webhook:

- `shop.id`
- `shop.domain`
- `shop.remote_id`
- `shop.text_number`
- `text`
- `event.id`
- `event.type`
- `event.timestamp`
- `ticket.id`
- `ticket.status`
- `ticket.invoice`
- `ticket.remote_id`
- `ticket.advisor.id`
- `ticket.advisor.name`
- `ticket.techs[].id`
- `ticket.techs[].name`
- `vehicle.id`
- `vehicle.vin`
- `vehicle.make`
- `vehicle.year`
- `vehicle.model`
- `vehicle.license`
- `vehicle.license_state`
- `vehicle.remote_id`
- `customer.id`
- `customer.firstname`
- `customer.lastname`
- `customer.remote_id`
- `customer.phone_numbers[].phonenumber`

## First normalization mapping

- `ticket.invoice` -> `tickets.external_ticket_id`
- `ticket.status` -> `tickets.source_status`
- `ticket.advisor.name` -> `staff.full_name`
- first `ticket.techs[].name` -> `staff.full_name`
- `event.timestamp` -> `ticket_events.event_at`
- `text` -> `tickets.summary`
- `vehicle.*` -> `vehicles.*`
- `customer.firstname + lastname` -> `vehicles.customer_name`

## Current location fallback

- 5-digit invoice -> Country Club
- 4-digit invoice -> Apache

## Next event payloads to capture

- `inbound_message`
- `message_status`
- `appointment_created`
- `appointment_updated`
- `appointment_confirmed`
- `repair_order_approved`
- `customer_viewed_dvi`
