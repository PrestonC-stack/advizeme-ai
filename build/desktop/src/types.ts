export type TicketPriority = "P1" | "P2" | "P3" | "P4";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export interface TicketSummary {
  id: string;
  roNumber: string;
  customerName: string;
  vehicleLabel: string;
  location: "Country Club" | "Apache";
  source: "Tekmetric" | "AutoFlow" | "AutoTextMe" | "Trello" | "Manual";
  status: string;
  priority: TicketPriority;
  advisor: string;
  technician: string;
  lastActivity: string;
  nextAction: string;
}

export interface AlertItem {
  id: string;
  ticketId: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export interface EventDraft {
  roNumber: string;
  location: TicketSummary["location"];
  source: TicketSummary["source"];
  status: string;
  priority: TicketPriority;
  customerName: string;
  vehicleLabel: string;
  advisor: string;
  technician: string;
  nextAction: string;
}

export interface TicketCurrentStateRow {
  id: string;
  location_name: string;
  source_code: string | null;
  external_ticket_id: string | null;
  source_status: string | null;
  priority_level: string | null;
  customer_name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  advisor_name: string | null;
  technician_name: string | null;
  last_activity_at: string | null;
  summary: string | null;
}

export interface OpenTicketAlertRow {
  id: string;
  ticket_id: string;
  alert_type: string;
  severity: string;
  title: string;
  detail: string | null;
}
