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
  customerConcern: string | null;
  extractedFindings: string[];
  suggestedJobs: Array<{
    title: string;
    priority: "Now" | "Soon" | "Later" | "Monitor";
    category: "Confirmed Repair" | "Diagnostic / Not Yet Confirmed" | "Maintenance" | "Monitor";
    labor: string;
    parts: string;
    roNote: string;
    requiredRelatedItems: string;
    recommendedAddOns: string;
    laborOverlapNotes: string;
  }>;
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
        contacted_today: false,
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

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
    });

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

      await syncOperationalState(supabase, {
        ticketId: ticketRes.data.id,
        advisorId: advisorRes.data?.id ?? null,
        technicianId: techRes.data?.id ?? null,
        invoice,
        payload,
        status,
        eventType,
        eventAt,
        analysis: null
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
      complaint_verified: Boolean(analysis.customerConcern),
      photo_present: !analysis.missingPhotos,
      photo_useful: !analysis.missingPhotos,
      recommendation_specific: analysis.metrics.recommendationCount > 0,
      estimate_ready: analysis.reviewStatus === "acceptable",
      missing_proof: analysis.reviewStatus !== "acceptable",
      findings_summary: analysis.findingsSummary,
      likely_follow_up_question:
        analysis.reviewStatus === "acceptable"
          ? null
          : "What proof or test result supports this recommendation?",
      likely_customer_objection:
        analysis.reviewStatus === "acceptable"
          ? null
          : "Customer may push back if the recommendation is not supported clearly.",
      technician_feedback:
        analysis.reviewStatus === "acceptable"
          ? "Inspection support is strong enough to move forward."
          : "Tighten the proof, measurements, or notes before expecting a clean estimate handoff.",
      advisor_feedback:
        analysis.reviewStatus === "acceptable"
          ? "You can build from this DVI, but keep the customer concern and safety items leading the conversation."
          : "Do not oversell this yet. Ask for stronger support or sell diagnostic time first.",
      estimate_builder_feedback:
        analysis.suggestedJobs.length > 0
          ? `Suggested job blocks identified: ${analysis.suggestedJobs.map((job) => job.title).join("; ")}`
          : "Keep this in review mode until the repair path is clearer.",
      qc_feedback: analysis.safetyFlag
        ? "Safety-related findings were detected. Preserve the proof and verify final closeout carefully."
        : "No major QC-specific concern surfaced from the DVI alone.",
      reviewer_note: JSON.stringify({
        fetched_at: new Date().toISOString(),
        callback_endpoint: payload.event?.callback_endpoint ?? null,
        api_source: dviFetch.url ?? null,
        metrics: analysis.metrics,
        invoice,
        customer_concern: analysis.customerConcern,
        extracted_findings: analysis.extractedFindings,
        suggested_jobs: analysis.suggestedJobs
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

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis
    });

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

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
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

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
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
      await logTicketContact(supabase, {
        ticketId: ticketRes.data.id,
        employeeId: advisorRes.data?.id ?? null,
        contactMethod: payload.event?.send_method ?? "message",
        summary: payload.message?.message ?? `Outbound message delivered for RO ${invoice}.`,
        contactAt: eventAt
      });
    } else {
      await upsertOpenAlert(supabase, {
        ticketId: ticketRes.data.id,
        alertType: "customer_update_overdue",
        severity: "high",
        title: `${invoice} message issue`,
        detail: `Message ${payload.event?.message_id ?? ""} is ${deliveryStatus} (${messageType}).`
      });
    }

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
    });

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

    await logTicketContact(supabase, {
      ticketId: ticketRes.data.id,
      employeeId: null,
      contactMethod: "inbound_message",
      summary: payload.message?.message ?? "Inbound customer reply received.",
      contactAt: eventAt
    });

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
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

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
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

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
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

    await syncOperationalState(supabase, {
      ticketId: ticketRes.data.id,
      advisorId: advisorRes.data?.id ?? null,
      technicianId: techRes.data?.id ?? null,
      invoice,
      payload,
      status,
      eventType,
      eventAt,
      analysis: null
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

  await syncOperationalState(supabase, {
    ticketId: ticketRes.data.id,
    advisorId: advisorRes.data?.id ?? null,
    technicianId: techRes.data?.id ?? null,
    invoice,
    payload,
    status,
    eventType,
    eventAt,
    analysis: null
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

async function syncOperationalState(
  supabase: ReturnType<typeof createClient>,
  input: {
    ticketId: string;
    advisorId: string | null;
    technicianId: string | null;
    invoice: string;
    payload: AutoflowPayload | Record<string, unknown>;
    status: string | null;
    eventType: string;
    eventAt: string;
    analysis: DviAnalysis | null;
  }
) {
  const stage = deriveOperationalStage(input.status, input.eventType);
  const blocker = deriveOperationalBlocker(stage, input.analysis, input.eventType, input.status);
  const nextBestAction = deriveOperationalNextAction(stage, input.analysis, input.eventType);
  const nextCheckpoint = deriveOperationalCheckpoint(stage, input.analysis);
  const nextHandoffOwner = deriveNextHandoffOwner(stage);
  const dispatchReady = isDispatchReady(stage, input.analysis, input.eventType);
  const dispatchReadyReason = dispatchReady
    ? "Approved, aligned, and ready for controlled dispatch."
    : "Approved is not enough yet. Close the proof, plan, or parts gaps first.";
  const estimateReady = isEstimateReady(stage, input.analysis);
  const estimateReadyReason = estimateReady
    ? "Support is strong enough to build a clean estimate."
    : "Keep this in review or sell diagnostic time before going deeper.";
  const promiseCandidate = extractPromiseCandidate(input.payload, input.eventAt);
  const waitingPartsPlan = buildWaitingPartsPlan(input.payload, stage, input.eventAt);

  await supabase
    .from("tickets")
    .update({
      current_stage: stage,
      current_blocker: blocker,
      next_best_action: nextBestAction,
      next_checkpoint: nextCheckpoint,
      checkpoint_owner_role: nextHandoffOwner,
      checkpoint_due_at: promiseCandidate,
      next_handoff_owner: nextHandoffOwner,
      dispatch_ready: dispatchReady,
      dispatch_ready_reason: dispatchReadyReason,
      estimate_ready: estimateReady,
      estimate_ready_reason: estimateReadyReason,
      approx_next_stage_eta: promiseCandidate,
      approx_completion_eta: buildCompletionEta(stage, input.eventAt, promiseCandidate),
      waiting_parts_vendor: waitingPartsPlan.vendor,
      waiting_parts_eta: waitingPartsPlan.eta,
      waiting_parts_wait_mode: waitingPartsPlan.waitMode,
      waiting_parts_other_work_possible: waitingPartsPlan.otherWorkPossible,
      backup_task_staged: waitingPartsPlan.backupTaskStaged,
      backup_task_summary: waitingPartsPlan.backupTaskSummary,
      parts_follow_up_due_at: waitingPartsPlan.followUpDueAt,
      parts_follow_up_owner_id: input.advisorId,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.ticketId);

  await upsertCheckpoint(supabase, {
    ticketId: input.ticketId,
    checkpointType: "next_handoff",
    checkpointText: nextCheckpoint,
    ownerRole: nextHandoffOwner,
    ownerStaffId: nextHandoffOwner.includes("Technician") ? input.technicianId : input.advisorId,
    stageName: stage,
    dueAt: promiseCandidate
  });

  await upsertActionItem(supabase, {
    ticketId: input.ticketId,
    actionType: "next_best_action",
    priorityLevel: derivePriorityLevel(stage, input.analysis, input.eventType),
    queueGroup: deriveQueueGroup(stage),
    title: `${input.invoice} next move`,
    detail: nextBestAction,
    ownerRole: nextHandoffOwner,
    ownerStaffId: nextHandoffOwner.includes("Technician") ? input.technicianId : input.advisorId,
    dueAt: promiseCandidate
  });

  await syncExceptionFlags(supabase, {
    ticketId: input.ticketId,
    invoice: input.invoice,
    stage,
    eventType: input.eventType,
    eventAt: input.eventAt,
    analysis: input.analysis,
    dispatchReady,
    waitingPartsPlan,
    advisorId: input.advisorId,
    technicianId: input.technicianId
  });
}

async function upsertCheckpoint(
  supabase: ReturnType<typeof createClient>,
  input: {
    ticketId: string;
    checkpointType: string;
    checkpointText: string;
    ownerRole: string;
    ownerStaffId: string | null;
    stageName: string;
    dueAt: string | null;
  }
) {
  const existing = await supabase
    .from("ticket_stage_checkpoints")
    .select("id")
    .eq("ticket_id", input.ticketId)
    .eq("checkpoint_type", input.checkpointType)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    await supabase
      .from("ticket_stage_checkpoints")
      .update({
        checkpoint_text: input.checkpointText,
        owner_role: input.ownerRole,
        owner_staff_id: input.ownerStaffId,
        stage_name: input.stageName,
        due_at: input.dueAt,
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.data.id);
    return;
  }

  await supabase.from("ticket_stage_checkpoints").insert({
    ticket_id: input.ticketId,
    checkpoint_type: input.checkpointType,
    checkpoint_text: input.checkpointText,
    owner_role: input.ownerRole,
    owner_staff_id: input.ownerStaffId,
    stage_name: input.stageName,
    due_at: input.dueAt
  });
}

async function upsertActionItem(
  supabase: ReturnType<typeof createClient>,
  input: {
    ticketId: string;
    actionType: string;
    priorityLevel: string;
    queueGroup: string;
    title: string;
    detail: string;
    ownerRole: string;
    ownerStaffId: string | null;
    dueAt: string | null;
  }
) {
  const existing = await supabase
    .from("ticket_action_items")
    .select("id")
    .eq("ticket_id", input.ticketId)
    .eq("action_type", input.actionType)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    await supabase
      .from("ticket_action_items")
      .update({
        priority_level: input.priorityLevel,
        queue_group: input.queueGroup,
        title: input.title,
        detail: input.detail,
        owner_role: input.ownerRole,
        owner_staff_id: input.ownerStaffId,
        due_at: input.dueAt
      })
      .eq("id", existing.data.id);
    return;
  }

  await supabase.from("ticket_action_items").insert({
    ticket_id: input.ticketId,
    action_type: input.actionType,
    priority_level: input.priorityLevel,
    queue_group: input.queueGroup,
    title: input.title,
    detail: input.detail,
    owner_role: input.ownerRole,
    owner_staff_id: input.ownerStaffId,
    due_at: input.dueAt
  });
}

async function syncExceptionFlags(
  supabase: ReturnType<typeof createClient>,
  input: {
    ticketId: string;
    invoice: string;
    stage: string;
    eventType: string;
    eventAt: string;
    analysis: DviAnalysis | null;
    dispatchReady: boolean;
    waitingPartsPlan: ReturnType<typeof buildWaitingPartsPlan>;
    advisorId: string | null;
    technicianId: string | null;
  }
) {
  if (input.analysis && input.analysis.reviewStatus !== "acceptable") {
    await upsertExceptionFlag(supabase, {
      ticketId: input.ticketId,
      flagType: "dvi_weak_support",
      severity: input.analysis.reviewStatus === "not_acceptable" ? "high" : "medium",
      title: "Weak DVI likely to bounce back",
      detail: input.analysis.findingsSummary,
      ownerRole: "Technician / Advisor",
      ownerStaffId: input.technicianId ?? input.advisorId
    });
  } else {
    await resolveExceptionFlag(supabase, input.ticketId, "dvi_weak_support");
  }

  if (input.stage === "Ready to Dispatch" && !input.dispatchReady) {
    await upsertExceptionFlag(supabase, {
      ticketId: input.ticketId,
      flagType: "dispatch_not_ready",
      severity: "high",
      title: "Approved job not truly ready to dispatch",
      detail: `RO ${input.invoice} still has planning, proof, or parts gaps before dispatch.`,
      ownerRole: "Advisor / Dispatch",
      ownerStaffId: input.advisorId
    });
  } else {
    await resolveExceptionFlag(supabase, input.ticketId, "dispatch_not_ready");
  }

  if (input.stage === "Waiting Parts" && !input.waitingPartsPlan.backupTaskStaged) {
    await upsertExceptionFlag(supabase, {
      ticketId: input.ticketId,
      flagType: "no_backup_task_staged",
      severity: "medium",
      title: "No next queued task",
      detail: `RO ${input.invoice} is waiting on parts and does not show a backup task for the technician.`,
      ownerRole: "Advisor / Dispatch",
      ownerStaffId: input.advisorId
    });
  } else {
    await resolveExceptionFlag(supabase, input.ticketId, "no_backup_task_staged");
  }

  if (input.stage === "Waiting Parts" && !input.waitingPartsPlan.followUpDueAt) {
    await upsertExceptionFlag(supabase, {
      ticketId: input.ticketId,
      flagType: "waiting_parts_no_followup",
      severity: "medium",
      title: "Waiting on parts but no follow-up note",
      detail: `RO ${input.invoice} needs an owner and next follow-up timing while parts are pending.`,
      ownerRole: "Parts / Advisor",
      ownerStaffId: input.advisorId
    });
  } else {
    await resolveExceptionFlag(supabase, input.ticketId, "waiting_parts_no_followup");
  }

  if (input.eventType === "ro_approval" && input.technicianId === null) {
    await upsertExceptionFlag(supabase, {
      ticketId: input.ticketId,
      flagType: "assignment_mismatch",
      severity: "high",
      title: "Approved job with missing dispatch clarity",
      detail: `RO ${input.invoice} was approved without a clear technician assignment.`,
      ownerRole: "Advisor / Management",
      ownerStaffId: input.advisorId
    });
  } else {
    await resolveExceptionFlag(supabase, input.ticketId, "assignment_mismatch");
  }
}

async function upsertExceptionFlag(
  supabase: ReturnType<typeof createClient>,
  input: {
    ticketId: string;
    flagType: string;
    severity: string;
    title: string;
    detail: string;
    ownerRole: string;
    ownerStaffId: string | null;
  }
) {
  const existing = await supabase
    .from("ticket_exception_flags")
    .select("id")
    .eq("ticket_id", input.ticketId)
    .eq("flag_type", input.flagType)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (existing.data?.id) {
    await supabase
      .from("ticket_exception_flags")
      .update({
        severity: input.severity,
        title: input.title,
        detail: input.detail,
        owner_role: input.ownerRole,
        owner_staff_id: input.ownerStaffId,
        detected_at: new Date().toISOString()
      })
      .eq("id", existing.data.id);
    return;
  }

  await supabase.from("ticket_exception_flags").insert({
    ticket_id: input.ticketId,
    flag_type: input.flagType,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    owner_role: input.ownerRole,
    owner_staff_id: input.ownerStaffId
  });
}

async function resolveExceptionFlag(
  supabase: ReturnType<typeof createClient>,
  ticketId: string,
  flagType: string
) {
  await supabase
    .from("ticket_exception_flags")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString()
    })
    .eq("ticket_id", ticketId)
    .eq("flag_type", flagType)
    .eq("status", "open");
}

async function logTicketContact(
  supabase: ReturnType<typeof createClient>,
  input: {
    ticketId: string;
    employeeId: string | null;
    contactMethod: string;
    summary: string;
    contactAt: string;
  }
) {
  await supabase.from("ticket_contacts").insert({
    ticket_id: input.ticketId,
    employee_id: input.employeeId,
    contact_method: input.contactMethod,
    summary: input.summary,
    contact_at: input.contactAt
  });

  await supabase
    .from("tickets")
    .update({
      contacted_today: true,
      last_contact_method: input.contactMethod,
      last_customer_update_at: input.contactAt
    })
    .eq("id", input.ticketId);
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

function deriveOperationalStage(status: string | null, eventType: string) {
  const normalized = (status ?? "").toLowerCase();

  if (eventType === "appointment_create" || eventType === "appointment_update" || eventType === "appointment_confirmed") {
    return "Check-In / Interview";
  }
  if (eventType === "dvi_signoff" || eventType === "dvi_signoff_update") {
    return "Technical Review";
  }
  if (eventType === "dvi_sent" || eventType === "dvi_viewed") {
    return "Waiting Approval";
  }
  if (eventType === "ro_approval") {
    return "Ready to Dispatch";
  }
  if (eventType === "wo_signoff") {
    return "Technical Signoff";
  }

  if (normalized.includes("pickup") || normalized.includes("closed")) return "Pickup / Closed";
  if (normalized.includes("ready") && normalized.includes("contact")) return "Ready / Customer Contacted";
  if (normalized.includes("technical signoff")) return "Technical Signoff";
  if (normalized.includes("qc") || normalized.includes("verification")) return "QC / Verification";
  if (normalized.includes("service") || normalized.includes("repair")) return "In Service";
  if (normalized.includes("dispatch")) return "Ready to Dispatch";
  if (normalized.includes("parts")) return "Waiting Parts";
  if (normalized.includes("approval")) return "Waiting Approval";
  if (normalized.includes("estimate")) return "Estimate Build";
  if (normalized.includes("technical review") || normalized.includes("technical advisor")) return "Technical Review";
  if (normalized.includes("dvi") || normalized.includes("inspect") || normalized.includes("verify")) return "DVI / Verify Concern";
  return "Check-In / Interview";
}

function deriveOperationalBlocker(stage: string, analysis: DviAnalysis | null, eventType: string, status: string | null) {
  if (analysis && analysis.reviewStatus !== "acceptable") {
    return "Weak DVI support needs cleanup before estimate build.";
  }
  if (stage === "Waiting Parts") {
    return "Parts ETA and follow-up plan are controlling the next move.";
  }
  if (stage === "Waiting Approval") {
    return "Customer decision or advisor follow-up is still open.";
  }
  if (stage === "Ready to Dispatch" && eventType === "ro_approval") {
    return "Dispatch plan still needs confirmation after approval.";
  }
  if (stage === "Technical Signoff") {
    return "Final handoff, reconciliation, and QC review need closure.";
  }
  return status ?? "No major blocker logged";
}

function deriveOperationalNextAction(stage: string, analysis: DviAnalysis | null, eventType: string) {
  if (analysis && analysis.reviewStatus !== "acceptable") {
    return "Get stronger proof or sell diagnostic time before going deeper.";
  }

  switch (stage) {
    case "Check-In / Interview":
      return "Lock the concern, assign the first checkpoint, and stage the intake cleanly.";
    case "DVI / Verify Concern":
      return "Finish the DVI and verify the concern before deeper work starts.";
    case "Technical Review":
      return "Organize the findings and hand the advisor a clean next step.";
    case "Estimate Build":
      return "Build the estimate with concern first, safety second, and no missing support.";
    case "Waiting Approval":
      return "Call or text the customer now instead of waiting for them to reach out first.";
    case "Waiting Parts":
      return "Confirm ETA, owner, and backup task so the tech does not stall.";
    case "Ready to Dispatch":
      return eventType === "ro_approval"
        ? "Confirm parts, plan, and direction before dispatching."
        : "Dispatch with a clear plan and duration.";
    case "In Service":
      return "Track the next checkpoint and catch any scope change before it snowballs.";
    case "QC / Verification":
      return "Run forced-pause QC and touched-area checks before closeout.";
    case "Technical Signoff":
      return "Capture notes, reconcile parts, and hand the RO back cleanly.";
    case "Ready / Customer Contacted":
      return "Confirm the customer contact and lock the pickup timing.";
    default:
      return "Review the RO and assign the next real owner.";
  }
}

function deriveOperationalCheckpoint(stage: string, analysis: DviAnalysis | null) {
  if (analysis && analysis.reviewStatus !== "acceptable") {
    return "When the proof is stronger or diag is sold, come get me.";
  }

  switch (stage) {
    case "Check-In / Interview":
      return "When intake is complete, come get me.";
    case "DVI / Verify Concern":
      return "When the concern is verified and DVI is complete, come get me.";
    case "Technical Review":
      return "When the review is organized into estimate-ready findings, come get me.";
    case "Estimate Build":
      return "When the estimate is ready and major items are on the table, come get me.";
    case "Waiting Approval":
      return "When the customer answers yes, no, or questions, come get me.";
    case "Waiting Parts":
      return "When ETA changes or parts land, come get me.";
    case "Ready to Dispatch":
      return "When plan, duration, and direction are all clear, release it.";
    case "In Service":
      return "When you hit the next scope checkpoint, come get me.";
    case "QC / Verification":
      return "When the forced-pause checks are done, come get me.";
    case "Technical Signoff":
      return "When notes and parts are reconciled, hand it back.";
    default:
      return "Assign the next checkpoint before this sits.";
  }
}

function deriveNextHandoffOwner(stage: string) {
  switch (stage) {
    case "Check-In / Interview":
    case "Estimate Build":
    case "Waiting Approval":
    case "Ready / Customer Contacted":
      return "Advisor";
    case "Waiting Parts":
      return "Advisor / Parts";
    case "DVI / Verify Concern":
    case "Technical Review":
    case "In Service":
    case "QC / Verification":
    case "Technical Signoff":
      return "Technician / Lead";
    case "Ready to Dispatch":
      return "Advisor / Dispatch";
    default:
      return "Front counter";
  }
}

function isDispatchReady(stage: string, analysis: DviAnalysis | null, eventType: string) {
  if (stage !== "Ready to Dispatch") return false;
  if (eventType === "ro_approval") return false;
  if (analysis && analysis.reviewStatus !== "acceptable") return false;
  return true;
}

function isEstimateReady(stage: string, analysis: DviAnalysis | null) {
  if (analysis) {
    return analysis.reviewStatus === "acceptable";
  }
  return stage === "Estimate Build" || stage === "Waiting Approval" || stage === "Ready to Dispatch";
}

function derivePriorityLevel(stage: string, analysis: DviAnalysis | null, eventType: string) {
  if (eventType === "appointment_create" || stage === "Check-In / Interview") return "P1";
  if (analysis && analysis.reviewStatus !== "acceptable") return "P2";
  if (stage === "Waiting Parts" || stage === "Waiting Approval" || stage === "Ready / Customer Contacted") return "P4";
  if (stage === "Ready to Dispatch" || stage === "In Service" || stage === "QC / Verification") return "P3";
  return "P2";
}

function deriveQueueGroup(stage: string) {
  if (stage === "Check-In / Interview" || stage === "Ready to Dispatch") return "Do Now";
  if (stage === "DVI / Verify Concern" || stage === "Technical Review" || stage === "Estimate Build") return "Build Next";
  return "Follow Up Now";
}

function extractPromiseCandidate(payload: AutoflowPayload | Record<string, unknown>, fallback: string) {
  const summary = payload.text ?? "";
  const direct = summary.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
  return direct ? direct[1].replace(" ", "T") : fallback;
}

function buildCompletionEta(stage: string, eventAt: string, promiseCandidate: string | null) {
  if (promiseCandidate) return promiseCandidate;
  const eta = new Date(eventAt);
  const addHours =
    stage === "In Service" ? 4 : stage === "QC / Verification" ? 1 : stage === "Technical Signoff" ? 1 : 2;
  eta.setHours(eta.getHours() + addHours);
  return eta.toISOString();
}

function buildWaitingPartsPlan(payload: AutoflowPayload | Record<string, unknown>, stage: string, eventAt: string) {
  if (stage !== "Waiting Parts") {
    return {
      vendor: null,
      eta: null,
      waitMode: null,
      otherWorkPossible: null,
      backupTaskStaged: true,
      backupTaskSummary: null,
      followUpDueAt: null
    };
  }

  const text = (payload.text ?? "").toLowerCase();
  const etaMatch = (payload.text ?? "").match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
  const followUp = new Date(eventAt);
  followUp.setHours(followUp.getHours() + 4);

  return {
    vendor: text.includes("napa") ? "NAPA" : text.includes("dealer") ? "Dealer" : null,
    eta: etaMatch ? etaMatch[1].replace(" ", "T") : null,
    waitMode: text.includes("tomorrow") || text.includes("overnight") ? "long_wait" : "short_wait",
    otherWorkPossible: false,
    backupTaskStaged: false,
    backupTaskSummary: "Load a backup task before the technician stalls on parts.",
    followUpDueAt: followUp.toISOString()
  };
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

  const extractedFindings: string[] = [];
  const addFinding = (text: string) => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return;
    }
    if (!extractedFindings.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      extractedFindings.push(normalized);
    }
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
            if (text.length > 8) {
              addFinding(text);
            }
          }

          if (/(photo|image|picture)/i.test(normalized) && /^https?:\/\//i.test(text)) {
            metrics.photoCount += 1;
          }

          if (/(measure|reading|thickness|pressure|voltage|spec|remaining|depth)/i.test(normalized)) {
            metrics.measurementCount += 1;
          }

          if (/(recommend|action|repair|replace|service|attention|urgent|immediate)/i.test(normalized) || /(recommend|repair|replace|service advised|attention needed)/i.test(text)) {
            metrics.recommendationCount += 1;
            addFinding(text);
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
  if (typeof content.additional_notes === "string" && content.additional_notes.trim().length > 0) {
    addFinding(content.additional_notes);
  }

  const safetyFlag = JSON.stringify(content).toLowerCase().includes("safety");
  const customerConcern = extractCustomerConcern(content);
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

  const suggestedJobs = buildSuggestedJobs(extractedFindings, customerConcern, safetyFlag);

  return {
    qualityScore,
    reviewStatus,
    missingNotes,
    missingPhotos,
    missingMeasurements,
    safetyFlag,
    findingsSummary: notes.length > 0 ? notes.join("; ") : "DVI analyzed with no strong signals detected.",
    customerConcern,
    extractedFindings,
    suggestedJobs,
    metrics
  };
}

function extractCustomerConcern(content: Record<string, unknown>) {
  const raw = content.reason_vehicle_is_here;

  if (Array.isArray(raw)) {
    const flattened = raw
      .flatMap((item) => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object") {
          return Object.values(item as Record<string, unknown>).filter((value): value is string => typeof value === "string");
        }
        return [];
      })
      .map((value) => value.trim())
      .filter(Boolean);

    return flattened.length > 0 ? flattened.join("; ") : null;
  }

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function buildSuggestedJobs(
  findings: string[],
  customerConcern: string | null,
  safetyFlag: boolean
): DviAnalysis["suggestedJobs"] {
  const jobs: DviAnalysis["suggestedJobs"] = [];
  const combined = findings.join(" || ").toLowerCase();

  const pushJob = (job: DviAnalysis["suggestedJobs"][number]) => {
    if (!jobs.some((existing) => existing.title === job.title)) {
      jobs.push(job);
    }
  };

  if (/(oil leak|timing cover|oil pan|power steering leak|leak source)/i.test(combined)) {
    pushJob({
      title: "Diagnose Fluid Leak Source",
      priority: "Now",
      category: "Diagnostic / Not Yet Confirmed",
      labor: "Clean, inspect, and verify the exact fluid leak source before quoting final reseal work.",
      parts: "Cleaner, dye, shop supplies as needed.",
      roNote: "Leak is documented but exact source still needs confirmation before final repair is sold.",
      requiredRelatedItems: "Sold diagnostic time and pre-approval before deeper teardown.",
      recommendedAddOns: "Build confirmed reseal repair after source verification.",
      laborOverlapNotes: "Do not let deeper leak tracing turn into unpaid tech time."
    });
  }

  if (/(brake|pad|rotor|blued|heat damage|brake fluid)/i.test(combined)) {
    pushJob({
      title: "Front Brake Pads and Rotors",
      priority: "Now",
      category: "Confirmed Repair",
      labor: "Replace worn front brake pads and damaged rotors, then complete final brake verification.",
      parts: "Front pads, front rotors, brake fluid if flush is combined.",
      roNote: "Brake findings support immediate service and should be presented as priority work.",
      requiredRelatedItems: "Brake fluid flush if contamination is documented.",
      recommendedAddOns: "Brake hardware kit and caliper slide service if supported.",
      laborOverlapNotes: "Bundle brake flush with brake repair labor when sold together."
    });
  }

  if (/(control arm|bushing|ball joint|shock|strut|suspension)/i.test(combined)) {
    pushJob({
      title: "Front Suspension / Control Arm Repair",
      priority: safetyFlag ? "Now" : "Soon",
      category: "Confirmed Repair",
      labor: "Replace documented worn suspension components and verify handling afterward.",
      parts: "Control arm assemblies, shocks/struts only if specifically documented.",
      roNote: "Suspension wear is documented clearly enough to support estimate-ready repair planning.",
      requiredRelatedItems: "Alignment after steering or suspension work.",
      recommendedAddOns: "Bundle overlap-friendly front end items if they are documented.",
      laborOverlapNotes: "Do not promise struts or related parts unless they were actually documented."
    });
  }

  if (/(transmission fluid|atf|power steering fluid|fluid contaminated|dark fluid|maintenance)/i.test(combined)) {
    pushJob({
      title: "Fluid Service Based on Inspection Findings",
      priority: "Later",
      category: "Maintenance",
      labor: "Perform the documented fluid service and verify level/condition afterward.",
      parts: "Correct service fluid and any required washers or seals.",
      roNote: "Fluid condition was documented as degraded or contaminated during inspection.",
      requiredRelatedItems: "Use the correct fluid specification for the vehicle.",
      recommendedAddOns: "Bundle with related approved repair if labor overlap exists.",
      laborOverlapNotes: "Keep maintenance lines separate from confirmed repair unless overlap is real."
    });
  }

  if (/(washer|reservoir)/i.test(combined)) {
    pushJob({
      title: "Replace Windshield Washer Reservoir",
      priority: "Soon",
      category: "Confirmed Repair",
      labor: "Replace leaking washer reservoir and refill fluid.",
      parts: "Washer reservoir, washer fluid.",
      roNote: "Washer reservoir leak is documented and should stay in its own clean job line.",
      requiredRelatedItems: "Washer fluid refill.",
      recommendedAddOns: "Washer pump inspection if operation is questioned.",
      laborOverlapNotes: "Do not bury this part inside an unrelated maintenance job."
    });
  }

  if (jobs.length === 0) {
    pushJob({
      title: "Review DVI Findings and Build Next Step",
      priority: safetyFlag ? "Now" : "Soon",
      category: customerConcern ? "Diagnostic / Not Yet Confirmed" : "Monitor",
      labor: customerConcern
        ? "Use the current inspection notes to confirm whether the complaint is estimate-ready or still needs sold diagnostic time."
        : "Review documented inspection findings and determine the next advisor action.",
      parts: "None until the repair path is clearer.",
      roNote: customerConcern ?? "Inspection produced findings, but the next repair path is still being organized.",
      requiredRelatedItems: customerConcern ? "Protect tech time and get approval before deeper testing." : "None.",
      recommendedAddOns: "None.",
      laborOverlapNotes: "Keep this as a workflow placeholder until more exact repair detail is available."
    });
  }

  return jobs;
}
