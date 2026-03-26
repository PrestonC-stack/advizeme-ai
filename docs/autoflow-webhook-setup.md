# AutoFlow Webhook Setup

## Recommended Flow

AutoFlow should send webhooks to a cloud endpoint first.

Use:

- AutoFlow webhook
- Supabase Edge Function
- `autoflow_webhook_events` raw log table
- normalization into `tickets`, `ticket_events`, and `ticket_alerts`

## First Events To Enable

- Status Update
- First DVI Signoff
- Update DVI Signoff
- DVI Sent
- Customer Viewed DVI
- Repair Order Approved
- Work Order Signoff
- Appointment Created

## URL Pattern

Once deployed, the webhook URL should look like:

`https://YOUR_PROJECT_ID.supabase.co/functions/v1/autoflow-webhook`

## Notes

- Deploy the function without JWT verification because AutoFlow is an external sender.
- Validate the request inside the function if AutoFlow provides a shared secret or signature.
- Store every raw webhook payload first before trying to normalize it.
- Use the RO length rule as a fallback:
  - 5 digits = Country Club
  - 4 digits = Apache
