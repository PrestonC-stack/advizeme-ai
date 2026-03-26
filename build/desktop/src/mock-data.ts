import type { AlertItem, TicketSummary } from "./types";

export const starterTickets: TicketSummary[] = [
  {
    id: "ticket-13387",
    roNumber: "RO#13387",
    customerName: "John Freeman",
    vehicleLabel: "2007 Ford F-150 XLT",
    location: "Country Club",
    source: "Tekmetric",
    status: "Estimate Build",
    priority: "P1",
    advisor: "Mitch",
    technician: "Eugene",
    lastActivity: "15 min ago",
    nextAction: "Review findings, lock estimate, and call customer"
  },
  {
    id: "ticket-13389",
    roNumber: "RO#13389",
    customerName: "Harrold Murray",
    vehicleLabel: "2010 Nissan Murano",
    location: "Country Club",
    source: "Tekmetric",
    status: "Technical Review",
    priority: "P2",
    advisor: "Mitch",
    technician: "Luis",
    lastActivity: "43 min ago",
    nextAction: "Finish technical review and hand off to advisor"
  },
  {
    id: "ticket-apache-7179",
    roNumber: "RO#7179",
    customerName: "Maria Ortega",
    vehicleLabel: "2012 Chevrolet Silverado 1500",
    location: "Apache",
    source: "AutoFlow",
    status: "Waiting Parts",
    priority: "P2",
    advisor: "Preston",
    technician: "TC",
    lastActivity: "2 hr ago",
    nextAction: "Confirm parts ETA and stage a backup job for the tech"
  }
];

export const starterAlerts: AlertItem[] = [
  {
    id: "alert-1",
    ticketId: "ticket-13387",
    type: "missing_estimate_items",
    severity: "high",
    title: "Estimate may be incomplete",
    detail: "Verify labor, fluids, and related work before customer approval."
  },
  {
    id: "alert-2",
    ticketId: "ticket-13389",
    type: "customer_update_overdue",
    severity: "medium",
    title: "Customer update due",
    detail: "No recent contact logged after estimate review."
  },
  {
    id: "alert-3",
    ticketId: "ticket-apache-7179",
    type: "stalled_ticket",
    severity: "high",
    title: "Apache workflow may be stalled",
    detail: "Trello activity exists, but next customer-facing step is unclear."
  }
];
