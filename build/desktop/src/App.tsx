import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient, hasSupabaseConfig, locationCodeMap, sourceMap } from "./supabase";
import { starterAlerts, starterTickets } from "./mock-data";
import { parseImportText, type ImportKind } from "./parsers";
import {
  sampleSalesImport,
  sampleTekmetricBoardImport,
  sampleWorkflowImport
} from "./sample-imports";
import type {
  AlertItem,
  EventDraft,
  OpenTicketAlertRow,
  TicketCurrentStateRow,
  TicketPriority,
  TicketSummary
} from "./types";

const defaultDraft: EventDraft = {
  roNumber: "",
  location: "Country Club",
  source: "Manual",
  status: "Needs Review",
  priority: "P3",
  customerName: "",
  vehicleLabel: "",
  advisor: "",
  technician: "",
  nextAction: ""
};

const severityRank: Record<AlertItem["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

export default function App() {
  const [tickets, setTickets] = useState<TicketSummary[]>(hasSupabaseConfig() ? [] : starterTickets);
  const [alerts, setAlerts] = useState<AlertItem[]>(hasSupabaseConfig() ? [] : starterAlerts);
  const [draft, setDraft] = useState<EventDraft>(defaultDraft);
  const [selectedLocation, setSelectedLocation] = useState<"All" | TicketSummary["location"]>("All");
  const [connectionMessage, setConnectionMessage] = useState(
    hasSupabaseConfig() ? "Connecting to Supabase..." : "Waiting for Supabase config"
  );
  const [importKind, setImportKind] = useState<ImportKind>("tekmetric_job_board");
  const [importText, setImportText] = useState(sampleTekmetricBoardImport);
  const [importSummary, setImportSummary] = useState("Paste raw text and click Parse Import.");
  const [importRows, setImportRows] = useState<Array<Record<string, string | number | boolean | null>>>([]);
  const [importStatus, setImportStatus] = useState("");

  useEffect(() => {
    const client = getSupabaseClient();

    if (!client) {
      setConnectionMessage("Using starter mock data");
      return;
    }

    void refreshLiveData(client);

    const interval = window.setInterval(() => {
      void refreshLiveData(client);
    }, 15000);

    return () => window.clearInterval(interval);
  }, []);

  const visibleTickets = useMemo(() => {
    if (selectedLocation === "All") {
      return tickets;
    }
    return tickets.filter((ticket) => ticket.location === selectedLocation);
  }, [selectedLocation, tickets]);

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]),
    [alerts]
  );

  const countsByPriority = useMemo(() => {
    return tickets.reduce<Record<TicketPriority, number>>(
      (acc, ticket) => {
        acc[ticket.priority] += 1;
        return acc;
      },
      { P1: 0, P2: 0, P3: 0, P4: 0 }
    );
  }, [tickets]);

  const opportunityFeed = useMemo(() => buildOpportunityFeed(tickets, alerts), [tickets, alerts]);
  const recentActivity = useMemo(() => tickets.slice(0, 6), [tickets]);

  const handleFieldChange = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const addManualEvent = async () => {
    if (!draft.roNumber.trim() || !draft.customerName.trim() || !draft.vehicleLabel.trim()) {
      return;
    }

    const client = getSupabaseClient();
    const ticketId = `ticket-${Date.now()}`;
    const newTicket: TicketSummary = {
      id: ticketId,
      roNumber: draft.roNumber.trim(),
      customerName: draft.customerName.trim(),
      vehicleLabel: draft.vehicleLabel.trim(),
      location: draft.location,
      source: draft.source,
      status: draft.status.trim(),
      priority: draft.priority,
      advisor: draft.advisor.trim() || "Unassigned",
      technician: draft.technician.trim() || "Unassigned",
      lastActivity: "Just now",
      nextAction: draft.nextAction.trim() || "Review and assign next action"
    };

    const newAlert: AlertItem = {
      id: `alert-${Date.now()}`,
      ticketId,
      type: "manual_review_needed",
      severity: draft.priority === "P1" ? "critical" : "medium",
      title: `${draft.roNumber.trim()} added for review`,
      detail: draft.nextAction.trim() || "Manual event added to pilot queue."
    };

    if (client) {
      const locationCode = locationCodeMap[draft.location];
      const sourceCode = draft.source.toUpperCase().replace(/\s+/g, "");

      const [{ data: locationRows }, { data: sourceRows }, { data: advisorRows }, { data: techRows }] =
        await Promise.all([
          client.from("locations").select("id, code").eq("code", locationCode).limit(1),
          client.from("capture_sources").select("id, code").eq("code", sourceCode).limit(1),
          client.from("staff").select("id, full_name").ilike("full_name", draft.advisor.trim() || "unassigned").limit(1),
          client.from("staff").select("id, full_name").ilike("full_name", draft.technician.trim() || "unassigned").limit(1)
        ]);

      const locationId = locationRows?.[0]?.id ?? null;
      const sourceId = sourceRows?.[0]?.id ?? null;
      const advisorId = advisorRows?.[0]?.id ?? null;
      const technicianId = techRows?.[0]?.id ?? null;

      if (locationId) {
        const vehiclePayload = {
          location_id: locationId,
          customer_name: draft.customerName.trim(),
          year: parseVehicleYear(draft.vehicleLabel),
          make: parseVehicleMake(draft.vehicleLabel),
          model: parseVehicleModel(draft.vehicleLabel)
        };

        const vehicleResult = await client.from("vehicles").insert(vehiclePayload).select("id").single();
        const vehicleId = vehicleResult.data?.id ?? null;

        const ticketResult = await client
          .from("tickets")
          .insert({
            location_id: locationId,
            vehicle_id: vehicleId,
            source_id: sourceId,
            external_ticket_id: draft.roNumber.trim(),
            source_status: draft.status.trim(),
            priority_level: draft.priority,
            advisor_id: advisorId,
            technician_id: technicianId,
            summary: draft.nextAction.trim(),
            last_activity_at: new Date().toISOString(),
            opened_at: new Date().toISOString()
          })
          .select("id")
          .single();

        const persistedTicketId = ticketResult.data?.id;

        if (persistedTicketId) {
          await client.from("ticket_events").insert({
            ticket_id: persistedTicketId,
            source_id: sourceId,
            event_type: "manual_note_added",
            event_at: new Date().toISOString(),
            event_value: draft.status.trim(),
            payload: {
              next_action: draft.nextAction.trim(),
              priority: draft.priority
            }
          });

          await client.from("ticket_alerts").insert({
            ticket_id: persistedTicketId,
            alert_type: "manual_review_needed",
            severity: draft.priority === "P1" ? "critical" : "medium",
            title: `${draft.roNumber.trim()} added for review`,
            detail: draft.nextAction.trim() || "Manual event added to pilot queue."
          });

          const refreshedTickets = await client
            .from("ticket_current_state")
            .select("*")
            .order("last_activity_at", { ascending: false });

          const refreshedAlerts = await client
            .from("open_ticket_alerts")
            .select("*")
            .order("triggered_at", { ascending: false });

          if (refreshedTickets.data) {
            setTickets((refreshedTickets.data as TicketCurrentStateRow[]).map(mapTicketRow));
          } else {
            setTickets((current) => [newTicket, ...current]);
          }

          if (refreshedAlerts.data) {
            setAlerts((refreshedAlerts.data as OpenTicketAlertRow[]).map(mapAlertRow));
          } else {
            setAlerts((current) => [newAlert, ...current]);
          }
        } else {
          setTickets((current) => [newTicket, ...current]);
          setAlerts((current) => [newAlert, ...current]);
        }
      } else {
        setTickets((current) => [newTicket, ...current]);
        setAlerts((current) => [newAlert, ...current]);
      }
    } else {
      setTickets((current) => [newTicket, ...current]);
      setAlerts((current) => [newAlert, ...current]);
    }

    setDraft(defaultDraft);

    await window.advizeMeDesktop?.notify(
      "AdvizeMe.ai alert",
      `${newTicket.roNumber} added to the pilot queue.`
    );
  };

  const runImportPreview = () => {
    const result = parseImportText(importKind, importText);
    setImportSummary(result.summary);
    setImportRows(result.rows.slice(0, 12));
    setImportStatus("");
  };

  const loadImportSample = (kind: ImportKind) => {
    setImportKind(kind);
    if (kind === "tekmetric_job_board") {
      setImportText(sampleTekmetricBoardImport);
    } else if (kind === "tekmetric_sales_details") {
      setImportText(sampleSalesImport);
    } else {
      setImportText(sampleWorkflowImport);
    }
  };

  const importPreviewRows = async () => {
    const client = getSupabaseClient();

    if (!client) {
      setImportStatus("Supabase is not connected.");
      return;
    }

    if (importRows.length === 0) {
      setImportStatus("Parse some rows first.");
      return;
    }

    setImportStatus("Importing parsed rows...");

    const [locationsResult, sourcesResult, staffResult] = await Promise.all([
      client.from("locations").select("id, code, name"),
      client.from("capture_sources").select("id, code"),
      client.from("staff").select("id, full_name")
    ]);

    if (locationsResult.error || sourcesResult.error || staffResult.error) {
      setImportStatus("Could not load supporting Supabase data.");
      return;
    }

    const locationByName = new Map(
      (locationsResult.data ?? []).map((row) => [row.name as string, row.id as string])
    );
    const sourceByCode = new Map(
      (sourcesResult.data ?? []).map((row) => [row.code as string, row.id as string])
    );
    const staffByName = new Map(
      (staffResult.data ?? []).map((row) => [String(row.full_name).toLowerCase(), row.id as string])
    );

    let importedCount = 0;

    for (const row of importRows) {
      const locationName = normalizeImportedLocation(row.location);
      const locationId = locationByName.get(locationName);
      const sourceId = sourceByCode.get(sourceCodeForImport(importKind));

      if (!locationId || !sourceId) {
        continue;
      }

      const roNumber = firstString(row.roNumber, row.invoiceNumber) ?? `import-${Date.now()}-${importedCount}`;
      const customerName = firstString(row.customerName) ?? "Unknown customer";
      const vehicleLabel = firstString(row.vehicleLabel, row.vehicleName) ?? "Unknown vehicle";
      const status = firstString(row.boardColumn, row.status) ?? "Imported";
      const summary = summarizeImportedRow(importKind, row);
      const advisorName = firstString(row.serviceWriter);
      const techName = firstString(row.techs);
      const advisorId = advisorName ? staffByName.get(advisorName.toLowerCase()) ?? null : null;
      const technicianId = techName ? staffByName.get(techName.toLowerCase()) ?? null : null;

      const vehicleResult = await client
        .from("vehicles")
        .insert({
          location_id: locationId,
          customer_name: customerName,
          year: parseVehicleYear(vehicleLabel),
          make: parseVehicleMake(vehicleLabel),
          model: parseVehicleModel(vehicleLabel)
        })
        .select("id")
        .single();

      const vehicleId = vehicleResult.data?.id ?? null;

      const ticketResult = await client
        .from("tickets")
        .upsert(
          {
            location_id: locationId,
            vehicle_id: vehicleId,
            source_id: sourceId,
            external_ticket_id: roNumber,
            source_status: status,
            priority_level: inferredPriorityFromRow(row),
            advisor_id: advisorId,
            technician_id: technicianId,
            summary,
            metadata: {
              import_kind: importKind,
              imported_at: new Date().toISOString(),
              raw_row: row
            },
            last_activity_at: new Date().toISOString(),
            opened_at: new Date().toISOString()
          },
          { onConflict: "source_id,external_ticket_id" }
        )
        .select("id")
        .single();

      const ticketId = ticketResult.data?.id;

      if (!ticketId) {
        continue;
      }

      await client.from("ticket_events").insert({
        ticket_id: ticketId,
        source_id: sourceId,
        event_type: importEventType(importKind),
        event_at: new Date().toISOString(),
        event_value: status,
        payload: row
      });

      if (importKind === "autoflow_workflow_report" && isLongAgingRow(row.totalElapsedTime)) {
        await client.from("ticket_alerts").insert({
          ticket_id: ticketId,
          alert_type: "stalled_ticket",
          severity: "high",
          title: `${roNumber} may be stalled`,
          detail: `Imported workflow row shows extended elapsed time: ${String(row.totalElapsedTime ?? "unknown")}`
        });
      }

      importedCount += 1;
    }

    await refreshLiveData(client);
    setImportStatus(`Imported ${importedCount} row(s) into Supabase.`);
  };

  const refreshLiveData = async (clientArg?: ReturnType<typeof getSupabaseClient>) => {
    const client = clientArg ?? getSupabaseClient();
    if (!client) {
      setConnectionMessage("Using starter mock data");
      return;
    }

    const [ticketResult, alertResult] = await Promise.all([
      client.from("ticket_current_state").select("*").order("last_activity_at", { ascending: false }),
      client.from("open_ticket_alerts").select("*").order("triggered_at", { ascending: false })
    ]);

    if (ticketResult.error || alertResult.error) {
      setConnectionMessage("Supabase connected, but query failed");
      return;
    }

    const liveTickets = (ticketResult.data as TicketCurrentStateRow[]).map(mapTicketRow);
    const liveAlerts = (alertResult.data as OpenTicketAlertRow[]).map(mapAlertRow);

    setTickets(liveTickets);
    setAlerts(liveAlerts);

    if (liveTickets.length === 0 && liveAlerts.length === 0) {
      setConnectionMessage("Supabase connected, waiting for live webhook or import data");
    } else {
      setConnectionMessage("Supabase connected");
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AdvizeMe.ai Pilot</p>
          <h1>Desktop Copilot</h1>
          <p className="connection-message">{connectionMessage}</p>
        </div>
        <div className={`status-pill ${hasSupabaseConfig() ? "ready" : "warning"}`}>
          {hasSupabaseConfig() ? "Supabase Ready" : "Supabase Not Connected"}
        </div>
      </header>

      <section className="stats-grid">
        <StatCard label="P1" value={countsByPriority.P1} tone="critical" />
        <StatCard label="P2" value={countsByPriority.P2} tone="high" />
        <StatCard label="Open Alerts" value={alerts.length} tone="medium" />
        <StatCard label="Focus" value={selectedLocation} tone="neutral" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>AI Opportunity Feed</h2>
          <span>low hanging fruit first</span>
        </div>
        <div className="opportunity-list">
          {opportunityFeed.length > 0 ? (
            opportunityFeed.map((item) => (
              <article key={item.id} className={`opportunity-card severity-${item.severity}`}>
                <div className="alert-row">
                  <strong>{item.title}</strong>
                  <span>{item.score}</span>
                </div>
                <p>{item.detail}</p>
              </article>
            ))
          ) : (
            <article className="empty-card">
              <strong>No opportunities scored yet</strong>
              <p>As live tickets and alerts build up, AdvizeMe will rank the easiest next wins here.</p>
            </article>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Alert Feed</h2>
          <span>{sortedAlerts.length} active</span>
        </div>
        <div className="alert-list">
          {sortedAlerts.length > 0 ? (
            sortedAlerts.map((alert) => (
              <article key={alert.id} className={`alert-card severity-${alert.severity}`}>
                <div className="alert-row">
                  <strong>{alert.title}</strong>
                  <span>{alert.severity}</span>
                </div>
                <p>{alert.detail}</p>
              </article>
            ))
          ) : (
            <article className="empty-card">
              <strong>No live alerts yet</strong>
              <p>AutoFlow webhooks, imports, and manual events will create alerts here.</p>
            </article>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Recent Live Changes</h2>
          <span>{recentActivity.length} shown</span>
        </div>
        <div className="activity-list">
          {recentActivity.length > 0 ? (
            recentActivity.map((ticket) => (
              <article key={`${ticket.id}-activity`} className="activity-card">
                <div className="alert-row">
                  <strong>{ticket.roNumber} · {ticket.customerName}</strong>
                  <span>{ticket.lastActivity}</span>
                </div>
                <p>{ticket.status} · {ticket.location} · {ticket.source}</p>
                <p>{ticket.nextAction}</p>
              </article>
            ))
          ) : (
            <article className="empty-card">
              <strong>No live changes yet</strong>
              <p>Webhook-driven ticket movement and imports will show up here as soon as they land.</p>
            </article>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Manual Event Entry</h2>
          <span>pilot-safe fallback</span>
        </div>
        <div className="form-grid">
          <input
            value={draft.roNumber}
            onChange={(event) => handleFieldChange("roNumber", event.target.value)}
            placeholder="RO# / ticket id"
          />
          <input
            value={draft.customerName}
            onChange={(event) => handleFieldChange("customerName", event.target.value)}
            placeholder="Customer name"
          />
          <input
            value={draft.vehicleLabel}
            onChange={(event) => handleFieldChange("vehicleLabel", event.target.value)}
            placeholder="Vehicle or job label"
          />
          <select
            value={draft.location}
            onChange={(event) => handleFieldChange("location", event.target.value as EventDraft["location"])}
          >
            <option>Country Club</option>
            <option>Apache</option>
          </select>
          <select
            value={draft.source}
            onChange={(event) => handleFieldChange("source", event.target.value as EventDraft["source"])}
          >
            <option>Manual</option>
            <option>Tekmetric</option>
            <option>AutoFlow</option>
            <option>AutoTextMe</option>
            <option>Trello</option>
          </select>
          <select
            value={draft.priority}
            onChange={(event) => handleFieldChange("priority", event.target.value as TicketPriority)}
          >
            <option>P1</option>
            <option>P2</option>
            <option>P3</option>
            <option>P4</option>
          </select>
          <input
            value={draft.status}
            onChange={(event) => handleFieldChange("status", event.target.value)}
            placeholder="Current status"
          />
          <input
            value={draft.advisor}
            onChange={(event) => handleFieldChange("advisor", event.target.value)}
            placeholder="Advisor"
          />
          <input
            value={draft.technician}
            onChange={(event) => handleFieldChange("technician", event.target.value)}
            placeholder="Technician"
          />
          <textarea
            value={draft.nextAction}
            onChange={(event) => handleFieldChange("nextAction", event.target.value)}
            placeholder="Next action or reminder"
            rows={3}
          />
        </div>
        <button className="primary-button" onClick={() => void addManualEvent()}>
          Add To Pilot Queue
        </button>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Raw Import Preview</h2>
          <span>paste Tekmetric or AutoFlow text</span>
        </div>
        <div className="form-grid">
          <select
            value={importKind}
            onChange={(event) => setImportKind(event.target.value as ImportKind)}
          >
            <option value="tekmetric_job_board">Tekmetric Job Board</option>
            <option value="tekmetric_sales_details">Tekmetric Sales Details</option>
            <option value="autoflow_workflow_report">AutoFlow Workflow Report</option>
          </select>
          <button className="secondary-button" onClick={() => loadImportSample(importKind)}>
            Load Sample
          </button>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="Paste raw text from Tekmetric or AutoFlow here"
            rows={10}
          />
        </div>
        <button className="primary-button" onClick={runImportPreview}>
          Parse Import
        </button>
        <p className="import-summary">{importSummary}</p>
        <button className="secondary-button" onClick={() => void importPreviewRows()}>
          Import To Supabase
        </button>
        <p className="import-summary">{importStatus}</p>
        <div className="import-preview-list">
          {importRows.map((row, index) => (
            <article className="import-preview-card" key={`${index}-${row.roNumber ?? row.invoiceNumber ?? row.rowNumber ?? "row"}`}>
              {Object.entries(row).map(([key, value]) => (
                <div className="import-preview-row" key={key}>
                  <span>{key}</span>
                  <strong>{String(value ?? "")}</strong>
                </div>
              ))}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Ticket Queue</h2>
          <select
            value={selectedLocation}
            onChange={(event) =>
              setSelectedLocation(event.target.value as "All" | TicketSummary["location"])
            }
          >
            <option value="All">All locations</option>
            <option value="Country Club">Country Club</option>
            <option value="Apache">Apache</option>
          </select>
        </div>
        <div className="ticket-list">
          {visibleTickets.length > 0 ? (
            visibleTickets.map((ticket) => (
              <article key={ticket.id} className="ticket-card">
                <div className="ticket-header">
                  <div>
                    <p className="ticket-ro">{ticket.roNumber}</p>
                    <h3>{ticket.customerName}</h3>
                  </div>
                  <span className={`priority-chip priority-${ticket.priority.toLowerCase()}`}>
                    {ticket.priority}
                  </span>
                </div>
                <p className="ticket-vehicle">{ticket.vehicleLabel}</p>
                <div className="ticket-meta">
                  <span>{ticket.location}</span>
                  <span>{ticket.source}</span>
                  <span>{ticket.status}</span>
                </div>
                <div className="ticket-meta">
                  <span>Advisor: {ticket.advisor}</span>
                  <span>Tech: {ticket.technician}</span>
                </div>
                <p className="ticket-next">{ticket.nextAction}</p>
                <p className="ticket-last">Last activity: {ticket.lastActivity}</p>
              </article>
            ))
          ) : (
            <article className="empty-card">
              <strong>No live tickets yet</strong>
              <p>Import Tekmetric text, add a manual event, or wait for AutoFlow webhook events to normalize into tickets.</p>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

function mapTicketRow(row: TicketCurrentStateRow): TicketSummary {
  const vehicleParts = [row.year, row.make, row.model].filter(Boolean).join(" ");

  return {
    id: row.id,
    roNumber: row.external_ticket_id ?? "No RO",
    customerName: row.customer_name ?? "Unknown customer",
    vehicleLabel: vehicleParts || "Unspecified vehicle",
    location: row.location_name === "Apache" ? "Apache" : "Country Club",
    source: row.source_code ? sourceMap[row.source_code] ?? "Manual" : "Manual",
    status: row.source_status ?? "Needs Review",
    priority: isPriority(row.priority_level) ? row.priority_level : "P3",
    advisor: row.advisor_name ?? "Unassigned",
    technician: row.technician_name ?? "Unassigned",
    lastActivity: row.last_activity_at ? new Date(row.last_activity_at).toLocaleString() : "Unknown",
    nextAction: row.summary ?? "Review next action"
  };
}

function mapAlertRow(row: OpenTicketAlertRow): AlertItem {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    type: row.alert_type,
    severity: isSeverity(row.severity) ? row.severity : "medium",
    title: row.title,
    detail: row.detail ?? "No detail provided"
  };
}

function isPriority(value: string | null): value is TicketPriority {
  return value === "P1" || value === "P2" || value === "P3" || value === "P4";
}

function isSeverity(value: string | null): value is AlertItem["severity"] {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}

function parseVehicleYear(label: string): number | null {
  const match = label.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function parseVehicleMake(label: string): string | null {
  const parts = label.trim().split(/\s+/);
  return parts.length >= 2 && /^\d{4}$/.test(parts[0]) ? parts[1] : null;
}

function parseVehicleModel(label: string): string | null {
  const parts = label.trim().split(/\s+/);
  return parts.length >= 3 && /^\d{4}$/.test(parts[0]) ? parts.slice(2).join(" ") : null;
}

function firstString(...values: Array<string | number | boolean | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeImportedLocation(value: string | number | boolean | null | undefined): "Country Club" | "Apache" {
  return String(value ?? "").toLowerCase().includes("apache") ? "Apache" : "Country Club";
}

function sourceCodeForImport(kind: ImportKind): string {
  if (kind === "autoflow_workflow_report") {
    return "AUTOFLOW";
  }
  return "TEKMETRIC";
}

function importEventType(kind: ImportKind): string {
  if (kind === "autoflow_workflow_report") {
    return "workflow_report_imported";
  }
  if (kind === "tekmetric_sales_details") {
    return "sales_report_imported";
  }
  return "job_board_imported";
}

function summarizeImportedRow(
  kind: ImportKind,
  row: Record<string, string | number | boolean | null>
): string {
  if (kind === "tekmetric_job_board") {
    return `Imported from ${row.boardColumn ?? "job board"} with status context.`;
  }
  if (kind === "tekmetric_sales_details") {
    return `Imported sales detail row with total ${row.totalSales ?? "$0.00"}.`;
  }
  return `Imported workflow row with elapsed time ${row.totalElapsedTime ?? "unknown"}.`;
}

function inferredPriorityFromRow(
  row: Record<string, string | number | boolean | null>
): TicketPriority {
  const sourcePriority = firstString(row.priority, row.priority_level);
  if (sourcePriority === "P1" || sourcePriority === "P2" || sourcePriority === "P3" || sourcePriority === "P4") {
    return sourcePriority;
  }

  const status = String(row.status ?? row.boardColumn ?? "").toLowerCase();
  const elapsed = String(row.totalElapsedTime ?? "").toLowerCase();

  if (status.includes("waiting approval") || status.includes("advisor estimate")) {
    return "P2";
  }
  if (elapsed.includes("day(s)") || elapsed.includes("59 day")) {
    return "P1";
  }
  if (status.includes("completed") || status.includes("close")) {
    return "P4";
  }
  return "P3";
}

function isLongAgingRow(value: string | number | boolean | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const dayMatch = value.match(/(\d+)\sday\(s\)/i);
  const hourMatch = value.match(/(\d+)\shour\(s\)/i);
  const days = dayMatch ? Number(dayMatch[1]) : 0;
  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  return days >= 3 || (days === 0 && hours >= 8);
}

function buildOpportunityFeed(tickets: TicketSummary[], alerts: AlertItem[]) {
  const items = tickets.map((ticket) => {
    const relatedAlerts = alerts.filter((alert) => alert.ticketId === ticket.id);
    let score = 25;
    let title = `${ticket.roNumber} needs review`;
    let detail = `${ticket.customerName} · ${ticket.vehicleLabel}`;
    let severity: AlertItem["severity"] = "low";

    if (ticket.priority === "P1") {
      score += 45;
      severity = "critical";
      title = `${ticket.roNumber} is top priority`;
      detail = `P1 ticket for ${ticket.customerName}. Move the next action now: ${ticket.nextAction}`;
    }

    if (ticket.status.toLowerCase().includes("advisor estimate")) {
      score += 30;
      severity = severity === "critical" ? severity : "high";
      title = `${ticket.roNumber} is low-hanging fruit`;
      detail = `Advisor Estimate status usually means an approval conversation is close. ${ticket.nextAction}`;
    }

    if (ticket.status.toLowerCase().includes("waiting approval")) {
      score += 28;
      severity = severity === "critical" ? severity : "high";
      title = `${ticket.roNumber} needs customer contact`;
      detail = `Waiting Approval is often a quick win if the customer has not been re-engaged yet.`;
    }

    if (ticket.status.toLowerCase().includes("technical advisor")) {
      score += 20;
      severity = severity === "low" ? "medium" : severity;
      title = `${ticket.roNumber} may need estimate conversion`;
      detail = `Technical Advisor status can become a sale quickly if the estimate gets built and presented.`;
    }

    if (relatedAlerts.length > 0) {
      score += relatedAlerts.length * 12;
      const highestSeverity = [...relatedAlerts].sort(
        (a, b) => severityRank[a.severity] - severityRank[b.severity]
      )[0];
      severity = highestSeverity.severity;
      title = highestSeverity.title;
      detail = highestSeverity.detail;
    }

    return {
      id: ticket.id,
      score,
      severity,
      title,
      detail
    };
  });

  return items.sort((a, b) => b.score - a.score).slice(0, 8);
}

function StatCard({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone: "critical" | "high" | "medium" | "neutral";
}) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
