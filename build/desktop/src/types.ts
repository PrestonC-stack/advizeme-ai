export type TicketPriority = "P1" | "P2" | "P3" | "P4";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AppModuleId =
  | "morning-brief"
  | "advisor-command"
  | "tech-ops"
  | "dvi-audit-center"
  | "qc-closeout"
  | "time-clock"
  | "productivity"
  | "reference-desk"
  | "admin-integrations";

export type SourceName = "Tekmetric" | "AutoFlow" | "AutoTextMe" | "Trello" | "Manual";

export type MorningBriefStage =
  | "Check-In / Interview"
  | "DVI / Verify Concern"
  | "Technical Review"
  | "Estimate Build"
  | "Waiting Approval"
  | "Waiting Parts"
  | "Ready to Dispatch"
  | "In Service"
  | "QC / Verification"
  | "Technical Signoff"
  | "Ready / Customer Contacted"
  | "Pickup / Closed"
  | "Unknown";

export interface TicketSummary {
  id: string;
  roNumber: string;
  customerName: string;
  vehicleLabel: string;
  location: "Country Club" | "Apache";
  source: SourceName;
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
  location_code: string;
  location_name: string;
  source_code: string | null;
  external_ticket_id: string | null;
  source_status: string | null;
  ticket_type: string | null;
  priority_level: string | null;
  current_stage?: string | null;
  current_blocker?: string | null;
  next_best_action?: string | null;
  next_checkpoint?: string | null;
  checkpoint_owner_role?: string | null;
  checkpoint_due_at?: string | null;
  next_handoff_owner?: string | null;
  dispatch_ready?: boolean | null;
  dispatch_ready_reason?: string | null;
  estimate_ready?: boolean | null;
  estimate_ready_reason?: string | null;
  customer_update_due_at: string | null;
  last_customer_update_at: string | null;
  contacted_today?: boolean;
  last_contact_method?: string | null;
  last_activity_at: string | null;
  approx_next_stage_eta?: string | null;
  approx_completion_eta?: string | null;
  waiting_parts_vendor?: string | null;
  waiting_parts_eta?: string | null;
  waiting_parts_wait_mode?: string | null;
  waiting_parts_other_work_possible?: boolean | null;
  backup_task_staged?: boolean;
  backup_task_summary?: string | null;
  parts_follow_up_due_at?: string | null;
  parts_follow_up_owner_name?: string | null;
  opened_at: string | null;
  closed_at: string | null;
  summary: string | null;
  customer_name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  advisor_name: string | null;
  technician_name: string | null;
  open_alert_count: number | null;
  open_exception_count?: number | null;
  open_qc_flag_count?: number | null;
}

export interface OpenTicketAlertRow {
  id: string;
  ticket_id: string;
  alert_type: string;
  severity: string;
  title: string;
  detail: string | null;
  triggered_at: string;
  external_ticket_id?: string | null;
  location_code?: string;
  location_name?: string;
  customer_name?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

export interface DviReviewRow {
  id: string;
  ticket_id: string;
  source_id?: string | null;
  review_status: string;
  quality_score: number | null;
  missing_notes: boolean;
  missing_photos: boolean;
  missing_measurements: boolean;
  safety_flag: boolean;
  complaint_verified?: boolean | null;
  photo_present?: boolean | null;
  photo_useful?: boolean | null;
  recommendation_specific?: boolean | null;
  estimate_ready?: boolean | null;
  missing_proof?: boolean | null;
  findings_summary: string | null;
  reviewer_note: string | null;
  likely_follow_up_question?: string | null;
  likely_customer_objection?: string | null;
  technician_feedback?: string | null;
  advisor_feedback?: string | null;
  estimate_builder_feedback?: string | null;
  qc_feedback?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface TicketEventRow {
  id: string;
  ticket_id: string;
  source_id: string | null;
  event_type: string;
  event_at: string;
  actor_staff_id: string | null;
  event_value: string | null;
  payload: Record<string, unknown>;
  created_at?: string;
}
