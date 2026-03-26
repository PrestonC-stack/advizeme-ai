import { createClient } from "npm:@supabase/supabase-js@2";

type AutoflowPayload = {
  text?: string;
  shop?: {
    id?: number;
    domain?: string;
    remote_id?: string;
    text_number?: string;
  };
  event?: {
    id?: string;
    type?: string;
    timestamp?: string;
    message_id?: number;
    delivery_status?: string;
    send_method?: string;
    recipient_email?: string | null;
    recipient_phone?: string | null;
    callback_endpoint?: string;
  };
  ticket?: {
    id?: number;
    status?: string;
    invoice?: number;
    remote_id?: string;
    advisor?: {
      id?: number;
      name?: string;
    };
    techs?: Array<{
      id?: number;
      name?: string;
      priority?: number;
    }>;
  };
  vehicle?: {
    id?: number;
    vin?: string;
    make?: string;
    year?: number;
    model?: string;
    license?: string;
    license_state?: string;
    remote_id?: string;
  };
  customer?: {
    id?: number;
    firstname?: string;
    lastname?: string;
    remote_id?: string;
    phone_numbers?: Array<{
      phonenumber?: string;
    }>;
  };
  message?: {
    id?: number;
    type?: string;
    message?: string;
    timestamp?: string;
    twilio_sid?: string;
    delivery_status?: string;
  };
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let payload: AutoflowPayload | Record<string, unknown> = {};
  let bodyText = "";

  try {
    bodyText = await req.text();
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    payload = { raw_text: bodyText };
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const eventType = payload.event?.type ?? "unknown";
  const roNumber = payload.ticket?.invoice ? String(payload.ticket.invoice) : null;
  const locationHint = inferLocation(roNumber);

  const { data: rawEvent, error: rawError } = await supabase
    .from("autoflow_webhook_events")
    .insert({
      webhook_name: "AutoFlow Webhook",
      event_type: eventType,
      ro_number: roNumber,
      location_hint: locationHint,
      signature: req.headers.get("x-signature") ?? req.headers.get("authorization"),
      payload
    })
    .select("id")
    .single();

  if (rawError) {
    return json({ ok: false, error: rawError.message }, 500);
  }

  const normalizationResult = await normalizeAutoflowEvent(supabase, payload, eventType, locationHint);

  await supabase
    .from("autoflow_webhook_events")
    .update({
      processed: normalizationResult.ok,
      processed_at: new Date().toISOString(),
      processing_note: normalizationResult.note
    })
    .eq("id", rawEvent.id);

  return json({
    ok: true,
    event_type: eventType,
    ro_number: roNumber,
    normalization: normalizationResult
  });
});

async function normalizeAutoflowEvent(
  supabase: ReturnType<typeof createClient>,
  payload: AutoflowPayload | Record<string, unknown>,
  eventType: string,
  locationHint: "Country Club" | "Apache" | null
) {
  const invoice = payload.ticket?.invoice ? String(payload.ticket.invoice) : null;
  const status = payload.ticket?.status ?? null;
  const advisorName = payload.ticket?.advisor?.name ?? null;
  const techName = payload.ticket?.techs?.[0]?.name ?? null;
  const customerName = [payload.customer?.firstname, payload.customer?.lastname].filter(Boolean).join(" ").trim();
  const eventAt = payload.event?.timestamp ?? new Date().toISOString();

  if (!invoice || !locationHint) {
    return { ok: false, note: "Missing invoice or location hint" };
  }

  const [locationRes, sourceRes, advisorRes, techRes] = await Promise.all([
    supabase.from("locations").select("id, name").eq("name", locationHint).limit(1).single(),
    supabase.from("capture_sources").select("id").eq("code", "AUTOFLOW").limit(1).single(),
    advisorName
      ? supabase.from("staff").select("id").ilike("full_name", advisorName).limit(1).single()
      : Promise.resolve({ data: null, error: null }),
    techName
      ? supabase.from("staff").select("id").ilike("full_name", techName).limit(1).single()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (!locationRes.data || !sourceRes.data) {
    return { ok: false, note: "Missing location or capture source mapping" };
  }

  const vehicleRes = await supabase
    .from("vehicles")
    .insert({
      location_id: locationRes.data.id,
      customer_name: customerName || "Unknown customer",
      vin: payload.vehicle?.vin ?? null,
      plate: payload.vehicle?.license ?? null,
      year: payload.vehicle?.year ?? null,
      make: payload.vehicle?.make ?? null,
      model: payload.vehicle?.model ?? null
    })
    .select("id")
    .single();

  const ticketRes = await supabase
    .from("tickets")
    .upsert(
      {
        location_id: locationRes.data.id,
        vehicle_id: vehicleRes.data?.id ?? null,
        source_id: sourceRes.data.id,
        external_ticket_id: invoice,
        source_status: status,
        advisor_id: advisorRes.data?.id ?? null,
        technician_id: techRes.data?.id ?? null,
        summary: payload.text ?? `AutoFlow event: ${eventType}`,
        last_activity_at: eventAt,
        metadata: {
          autoflow_ticket_id: payload.ticket?.id ?? null,
          autoflow_remote_id: payload.ticket?.remote_id ?? null,
          shop_domain: payload.shop?.domain ?? null
        }
      },
      { onConflict: "source_id,external_ticket_id" }
    )
    .select("id")
    .single();

  if (!ticketRes.data) {
    return { ok: false, note: "Ticket upsert failed" };
  }

  if (eventType === "status_update") {
    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "status_update",
      event_at: eventAt,
      actor_staff_id: advisorRes.data?.id ?? null,
      event_value: status,
      payload
    });

    if (status && ["Waiting approval", "Advisor Estimate", "Technical Advisor"].includes(status)) {
      await upsertOpenAlert(supabase, {
        ticketId: ticketRes.data.id,
        alertType: "awaiting_follow_up",
        severity: "medium",
        title: `${invoice} needs advisor follow-up`,
        detail: `AutoFlow moved RO ${invoice} to ${status}.`
      });
    }

    return { ok: true, note: `Normalized status_update for RO ${invoice}` };
  }

  if (eventType === "dvi_sent") {
    const sendMethod = payload.event?.send_method ?? "unknown";
    const recipient = payload.event?.recipient_email ?? payload.event?.recipient_phone ?? null;

    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "dvi_sent",
      event_at: eventAt,
      actor_staff_id: advisorRes.data?.id ?? null,
      event_value: sendMethod,
      payload
    });

    await upsertOpenAlert(supabase, {
      ticketId: ticketRes.data.id,
      alertType: "awaiting_follow_up",
      severity: "medium",
      title: `${invoice} DVI sent`,
      detail: `DVI sent by ${sendMethod}${recipient ? ` to ${recipient}` : ""}.`
    });

    return { ok: true, note: `Normalized dvi_sent for RO ${invoice}` };
  }

  if (eventType === "message_status") {
    const deliveryStatus = payload.event?.delivery_status ?? payload.message?.delivery_status ?? "unknown";
    const messageType = payload.message?.type ?? "unknown";

    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "message_status",
      event_at: eventAt,
      actor_staff_id: advisorRes.data?.id ?? null,
      event_value: deliveryStatus,
      payload
    });

    if (deliveryStatus === "delivered") {
      await resolveAlertIfOpen(supabase, ticketRes.data.id, "awaiting_follow_up");
    } else {
      await upsertOpenAlert(supabase, {
        ticketId: ticketRes.data.id,
        alertType: "customer_update_overdue",
        severity: "high",
        title: `${invoice} message issue`,
        detail: `Message ${payload.event?.message_id ?? ""} is ${deliveryStatus} (${messageType}).`
      });
    }

    return { ok: true, note: `Normalized message_status for RO ${invoice}` };
  }

  await supabase.from("ticket_events").insert({
    ticket_id: ticketRes.data.id,
    source_id: sourceRes.data.id,
    event_type: eventType,
    event_at: eventAt,
    actor_staff_id: advisorRes.data?.id ?? null,
    event_value: status ?? eventType,
    payload
  });

  return { ok: true, note: `Stored generic event ${eventType} for RO ${invoice}` };
}

function inferLocation(roNumber: string | null): "Country Club" | "Apache" | null {
  if (!roNumber) {
    return null;
  }

  const digits = roNumber.replace(/\D/g, "");
  if (digits.length === 5) {
    return "Country Club";
  }
  if (digits.length === 4) {
    return "Apache";
  }
  return null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function upsertOpenAlert(
  supabase: ReturnType<typeof createClient>,
  input: {
    ticketId: string;
    alertType: string;
    severity: string;
    title: string;
    detail: string;
  }
) {
  const existing = await supabase
    .from("ticket_alerts")
    .select("id")
    .eq("ticket_id", input.ticketId)
    .eq("alert_type", input.alertType)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    await supabase
      .from("ticket_alerts")
      .update({
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        triggered_at: new Date().toISOString()
      })
      .eq("id", existing.data.id);
    return;
  }

  await supabase.from("ticket_alerts").insert({
    ticket_id: input.ticketId,
    alert_type: input.alertType,
    severity: input.severity,
    title: input.title,
    detail: input.detail
  });
}

async function resolveAlertIfOpen(
  supabase: ReturnType<typeof createClient>,
  ticketId: string,
  alertType: string
) {
  await supabase
    .from("ticket_alerts")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString()
    })
    .eq("ticket_id", ticketId)
    .eq("alert_type", alertType)
    .eq("status", "open");
}
