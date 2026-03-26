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

type AutoflowDviResponse = {
  message?: string;
  success?: number;
  content?: Record<string, unknown> & {
    invoice?: string;
    additional_notes?: string;
    customer_firstname?: string;
    customer_lastname?: string;
    service_advisor_name?: string;
    dvis?: unknown[];
  };
};

type DviAnalysis = {
  qualityScore: number;
  reviewStatus: "acceptable" | "needs_review" | "not_acceptable";
  missingNotes: boolean;
  missingPhotos: boolean;
  missingMeasurements: boolean;
  safetyFlag: boolean;
  findingsSummary: string;
  metrics: {
    noteCount: number;
    photoCount: number;
    measurementCount: number;
    recommendationCount: number;
    itemCount: number;
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

  if (eventType === "dvi_signoff" || eventType === "dvi_signoff_update") {
    const signoffType = eventType === "dvi_signoff" ? "first signoff" : "updated signoff";

    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: eventType,
      event_at: eventAt,
      actor_staff_id: techRes.data?.id ?? advisorRes.data?.id ?? null,
      event_value: payload.event?.callback_endpoint ?? signoffType,
      payload
    });

    const dviFetch = await fetchAutoflowDvi(payload, invoice);
    if (!dviFetch.ok || !dviFetch.data?.content) {
      await upsertOpenAlert(supabase, {
        ticketId: ticketRes.data.id,
        alertType: "dvi_fetch_failed",
        severity: "medium",
        title: `${invoice} DVI fetch failed`,
        detail: dviFetch.note ?? "AutoFlow DVI signoff arrived, but the full DVI could not be fetched."
      });

      return { ok: true, note: `Stored ${eventType} for RO ${invoice}; DVI fetch failed` };
    }

    const analysis = analyzeDviContent(dviFetch.data.content);

    await supabase.from("dvi_reviews").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      review_status: analysis.reviewStatus,
      quality_score: analysis.qualityScore,
      missing_notes: analysis.missingNotes,
      missing_photos: analysis.missingPhotos,
      missing_measurements: analysis.missingMeasurements,
      safety_flag: analysis.safetyFlag,
      findings_summary: analysis.findingsSummary,
      reviewer_note: JSON.stringify({
        fetched_at: new Date().toISOString(),
        callback_endpoint: payload.event?.callback_endpoint ?? null,
        api_source: dviFetch.url ?? null,
        metrics: analysis.metrics,
        invoice
      })
    });

    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "dvi_reviewed",
      event_at: new Date().toISOString(),
      actor_staff_id: null,
      event_value: analysis.reviewStatus,
      payload: {
        autoflow_event_type: eventType,
        analysis,
        dvi: dviFetch.data.content
      }
    });

    if (analysis.reviewStatus !== "acceptable") {
      await upsertOpenAlert(supabase, {
        ticketId: ticketRes.data.id,
        alertType: "dvi_quality_review",
        severity: analysis.reviewStatus === "not_acceptable" ? "high" : "medium",
        title: `${invoice} DVI needs critique`,
        detail: analysis.findingsSummary
      });
    } else {
      await resolveAlertIfOpen(supabase, ticketRes.data.id, "dvi_quality_review");
    }

    if (analysis.metrics.recommendationCount > 0) {
      await upsertOpenAlert(supabase, {
        ticketId: ticketRes.data.id,
        alertType: "dvi_sales_opportunity",
        severity: "medium",
        title: `${invoice} has low-hanging fruit`,
        detail: `${analysis.metrics.recommendationCount} recommendation signals found in the DVI.`
      });
    }

    return {
      ok: true,
      note: `Fetched and reviewed DVI for RO ${invoice} (${analysis.reviewStatus}, score ${analysis.qualityScore})`
    };
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

  if (eventType === "dvi_viewed") {
    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "dvi_viewed",
      event_at: eventAt,
      actor_staff_id: null,
      event_value: payload.event?.callback_endpoint ?? "viewed",
      payload
    });

    await upsertOpenAlert(supabase, {
      ticketId: ticketRes.data.id,
      alertType: "awaiting_customer_decision",
      severity: "medium",
      title: `${invoice} DVI viewed`,
      detail: "Customer opened the DVI. This is a good time for advisor follow-up."
    });

    return { ok: true, note: `Normalized dvi_viewed for RO ${invoice}` };
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

  if (eventType === "inbound_message") {
    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "inbound_message",
      event_at: eventAt,
      actor_staff_id: null,
      event_value: payload.message?.message ?? "inbound_message",
      payload
    });

    await resolveAlertIfOpen(supabase, ticketRes.data.id, "customer_update_overdue");
    await resolveAlertIfOpen(supabase, ticketRes.data.id, "awaiting_follow_up");

    await upsertOpenAlert(supabase, {
      ticketId: ticketRes.data.id,
      alertType: "customer_reply_received",
      severity: "medium",
      title: `${invoice} customer replied`,
      detail: payload.message?.message ?? "Inbound message received."
    });

    return { ok: true, note: `Normalized inbound_message for RO ${invoice}` };
  }

  if (eventType === "ro_approval") {
    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "ro_approval",
      event_at: eventAt,
      actor_staff_id: null,
      event_value: "approved",
      payload
    });

    await resolveAlertIfOpen(supabase, ticketRes.data.id, "awaiting_customer_decision");
    await resolveAlertIfOpen(supabase, ticketRes.data.id, "awaiting_follow_up");

    await upsertOpenAlert(supabase, {
      ticketId: ticketRes.data.id,
      alertType: "approved_work_ready",
      severity: "medium",
      title: `${invoice} approved by customer`,
      detail: "Customer approved work. Move the ticket forward promptly."
    });

    return { ok: true, note: `Normalized ro_approval for RO ${invoice}` };
  }

  if (eventType === "appointment_create" || eventType === "appointment_update" || eventType === "appointment_confirmed") {
    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: eventType,
      event_at: eventAt,
      actor_staff_id: advisorRes.data?.id ?? null,
      event_value: payload.event?.timestamp ?? eventType,
      payload
    });

    await upsertOpenAlert(supabase, {
      ticketId: ticketRes.data.id,
      alertType: "appointment_change",
      severity: "low",
      title: `${invoice} appointment updated`,
      detail: payload.text ?? `AutoFlow appointment event: ${eventType}.`
    });

    return { ok: true, note: `Normalized ${eventType} for RO ${invoice}` };
  }

  if (eventType === "wo_signoff") {
    await supabase.from("ticket_events").insert({
      ticket_id: ticketRes.data.id,
      source_id: sourceRes.data.id,
      event_type: "wo_signoff",
      event_at: eventAt,
      actor_staff_id: techRes.data?.id ?? null,
      event_value: "signed_off",
      payload
    });

    await upsertOpenAlert(supabase, {
      ticketId: ticketRes.data.id,
      alertType: "ready_for_advisor_review",
      severity: "medium",
      title: `${invoice} work order signed off`,
      detail: "Technician signed off the work order. Advisor review may be needed."
    });

    return { ok: true, note: `Normalized wo_signoff for RO ${invoice}` };
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

function getAutoflowAuthHeader() {
  const apiKey = Deno.env.get("AUTOFLOW_API_KEY");
  const apiPassword = Deno.env.get("AUTOFLOW_API_PASSWORD");

  if (!apiKey || !apiPassword) {
    return null;
  }

  return `Basic ${btoa(`${apiKey}:${apiPassword}`)}`;
}

async function fetchAutoflowDvi(payload: AutoflowPayload, invoice: string) {
  const authHeader = getAutoflowAuthHeader();
  const baseUrl = (Deno.env.get("AUTOFLOW_BASE_URL") ?? "https://integration.autotext.me").replace(/\/$/, "");
  const domainBase = payload.shop?.domain ? `https://${payload.shop.domain}` : null;
  const callbackEndpoint = payload.event?.callback_endpoint;

  if (!authHeader) {
    return { ok: false as const, note: "Missing AutoFlow API secrets" };
  }

  const candidateUrls = [
    callbackEndpoint && domainBase ? `${domainBase}${callbackEndpoint}` : null,
    callbackEndpoint ? `${baseUrl}${callbackEndpoint}` : null,
    `${baseUrl}/api/v1/dvi/${invoice}`,
    domainBase ? `${domainBase}/api/v1/dvi/${invoice}` : null
  ].filter((value): value is string => Boolean(value));

  let lastError = "No DVI URL candidates";

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: authHeader,
          "content-type": "application/json"
        }
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${url}`;
        continue;
      }

      const data = (await response.json()) as AutoflowDviResponse;
      if (data?.content) {
        return { ok: true as const, data, url };
      }

      lastError = `Empty DVI content from ${url}`;
    } catch (error) {
      lastError = `${url}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return { ok: false as const, note: lastError };
}

function analyzeDviContent(content: Record<string, unknown>): DviAnalysis {
  const metrics = {
    noteCount: 0,
    photoCount: 0,
    measurementCount: 0,
    recommendationCount: 0,
    itemCount: 0
  };

  const walk = (value: unknown, parentKey = "") => {
    if (Array.isArray(value)) {
      if (parentKey.toLowerCase() === "dvis") {
        metrics.itemCount += value.length;
      }

      for (const item of value) {
        walk(item, parentKey);
      }
      return;
    }

    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 0 && /(item|inspection|finding|recommend|condition|result)/i.test(parentKey)) {
        metrics.itemCount += 1;
      }

      for (const [key, child] of entries) {
        const normalized = key.toLowerCase();
        if (typeof child === "string") {
          const text = child.trim();
          if (!text) {
            continue;
          }

          if (/(note|comment|description|details|cause|correction|finding|observ)/i.test(normalized) && !/^https?:\/\//i.test(text)) {
            metrics.noteCount += 1;
          }

          if (/(photo|image|picture)/i.test(normalized) && /^https?:\/\//i.test(text)) {
            metrics.photoCount += 1;
          }

          if (/(measure|reading|thickness|pressure|voltage|spec|remaining|depth)/i.test(normalized)) {
            metrics.measurementCount += 1;
          }

          if (/(recommend|action|repair|replace|service|attention|urgent|immediate)/i.test(normalized) || /(recommend|repair|replace|service advised|attention needed)/i.test(text)) {
            metrics.recommendationCount += 1;
          }
        } else if (typeof child === "number") {
          if (/(measure|reading|thickness|pressure|voltage|spec|remaining|depth)/i.test(normalized)) {
            metrics.measurementCount += 1;
          }
        }

        walk(child, key);
      }
    }
  };

  walk(content);

  const additionalNotes = typeof content.additional_notes === "string" && content.additional_notes.trim().length > 0 ? 1 : 0;
  metrics.noteCount += additionalNotes;

  const safetyFlag = JSON.stringify(content).toLowerCase().includes("safety");
  const missingNotes = metrics.noteCount === 0;
  const missingPhotos = metrics.photoCount === 0;
  const missingMeasurements = metrics.measurementCount === 0;

  let qualityScore = 100;
  if (missingNotes) qualityScore -= 30;
  if (missingPhotos) qualityScore -= 25;
  if (missingMeasurements) qualityScore -= 15;
  if (metrics.itemCount === 0) qualityScore -= 10;
  if (metrics.recommendationCount === 0) qualityScore -= 10;
  if (safetyFlag) qualityScore += 5;
  qualityScore = Math.max(0, Math.min(100, qualityScore));

  const reviewStatus =
    qualityScore >= 80 ? "acceptable" : qualityScore >= 60 ? "needs_review" : "not_acceptable";

  const notes: string[] = [];
  if (missingNotes) notes.push("missing technician notes");
  if (missingPhotos) notes.push("missing supporting photos");
  if (missingMeasurements) notes.push("missing measurable evidence");
  if (metrics.recommendationCount > 0) notes.push(`${metrics.recommendationCount} recommendation signals found`);
  if (metrics.itemCount > 0) notes.push(`${metrics.itemCount} inspection item groups detected`);
  if (safetyFlag) notes.push("contains safety language");

  return {
    qualityScore,
    reviewStatus,
    missingNotes,
    missingPhotos,
    missingMeasurements,
    safetyFlag,
    findingsSummary: notes.length > 0 ? notes.join("; ") : "DVI analyzed with no strong signals detected.",
    metrics
  };
}
