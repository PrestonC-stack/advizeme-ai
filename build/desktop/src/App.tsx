import { useEffect, useMemo, useState } from "react";
import { starterAlerts, starterTickets } from "./mock-data";
import { getSupabaseClient, hasSupabaseConfig, sourceMap } from "./supabase";
import type {
  AppModuleId,
  DviReviewRow,
  MorningBriefStage,
  OpenTicketAlertRow,
  TicketCurrentStateRow,
  TicketEventRow,
  TicketPriority
} from "./types";

type ModuleDefinition = {
  id: AppModuleId;
  label: string;
  group: string;
  description: string;
};

type DispatchCheck = {
  label: string;
  ok: boolean;
};

type ExceptionFlag = {
  id: string;
  ticketId: string;
  roNumber: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  owner: string;
};

type OperationalTicket = {
  id: string;
  roNumber: string;
  customerName: string;
  vehicleLabel: string;
  location: string;
  source: string;
  currentStatus: string;
  stage: MorningBriefStage;
  stageIndex: number;
  priority: TicketPriority;
  priorityScore: number;
  priorityReason: string;
  blocker: string;
  nextBestAction: string;
  assignedAdvisor: string;
  assignedTechnician: string;
  promiseTime: string | null;
  promiseDate: Date | null;
  contactStatus: string;
  lastContactAt: string | null;
  summary: string;
  stageAgeHours: number;
  stageAgeLabel: string;
  totalHoursOnJob: number | null;
  estimatedCompletion: string;
  nextCheckpoint: string;
  nextHandoffOwner: string;
  openAlertCount: number;
  dispatchReadiness: {
    ready: boolean;
    score: number;
    checks: DispatchCheck[];
    reason: string;
  };
  latestDvi: DviReviewRow | null;
  alerts: OpenTicketAlertRow[];
  events: TicketEventRow[];
  exceptions: ExceptionFlag[];
  appointmentDate: Date | null;
  queueGroup: "Do Now" | "Build Next" | "Follow Up Now";
  nextQueuedJob: string;
};

type TechnicianRollup = {
  name: string;
  jobCount: number;
  jobs: OperationalTicket[];
  activeStage: string;
  blocker: string;
  nextQueuedJob: string;
  estimatedCompletion: string;
  totalHours: number;
  needsBackupQueue: boolean;
};

const MODULES: ModuleDefinition[] = [
  {
    id: "morning-brief",
    label: "Morning Brief",
    group: "Home",
    description: "Daily production recalibration, team pulse, and exception watch."
  },
  {
    id: "advisor-command",
    label: "Advisor Command",
    group: "Operations",
    description: "Priority queue, customer follow-up, and stage-by-stage RO handling."
  },
  {
    id: "tech-ops",
    label: "Tech Ops",
    group: "Operations",
    description: "Assigned work, DVI needs, rechecks, and stage acknowledgements."
  },
  {
    id: "dvi-audit-center",
    label: "DVI Audit Center",
    group: "Quality",
    description: "Evidence-based DVI quality, estimate readiness, and feedback split by role."
  },
  {
    id: "qc-closeout",
    label: "QC Closeout",
    group: "Quality",
    description: "Forced-pause closeout checks, verification, and accountability."
  },
  {
    id: "time-clock",
    label: "Time Clock",
    group: "People",
    description: "Internal punch status, location context, and tablet-friendly time tracking."
  },
  {
    id: "productivity",
    label: "Productivity",
    group: "People",
    description: "Clocked versus billed visibility, efficiency, and simple trend coaching."
  },
  {
    id: "reference-desk",
    label: "Reference Desk",
    group: "Tools",
    description: "Quick reference support, conversions, and lightweight repair help."
  },
  {
    id: "admin-integrations",
    label: "Admin / Integrations",
    group: "Admin",
    description: "Import tools, integration health, and testing utilities kept off the production floor."
  }
];

const STAGE_FLOW: MorningBriefStage[] = [
  "Check-In / Interview",
  "DVI / Verify Concern",
  "Technical Review",
  "Estimate Build",
  "Waiting Approval",
  "Waiting Parts",
  "Ready to Dispatch",
  "In Service",
  "QC / Verification",
  "Technical Signoff",
  "Ready / Customer Contacted",
  "Pickup / Closed",
  "Unknown"
];

const TECH_ROSTER = ["Eugene", "Luis", "TC", "Jonathan"];

const STAGE_AGE_THRESHOLDS: Record<MorningBriefStage, number> = {
  "Check-In / Interview": 1.5,
  "DVI / Verify Concern": 2,
  "Technical Review": 1.5,
  "Estimate Build": 1.5,
  "Waiting Approval": 3,
  "Waiting Parts": 24,
  "Ready to Dispatch": 1,
  "In Service": 5,
  "QC / Verification": 1.5,
  "Technical Signoff": 1,
  "Ready / Customer Contacted": 2,
  "Pickup / Closed": 6,
  Unknown: 2
};

function App() {
  const [activeModule, setActiveModule] = useState<AppModuleId>("morning-brief");
  const [ticketRows, setTicketRows] = useState<TicketCurrentStateRow[]>([]);
  const [alertRows, setAlertRows] = useState<OpenTicketAlertRow[]>([]);
  const [dviRows, setDviRows] = useState<DviReviewRow[]>([]);
  const [eventRows, setEventRows] = useState<TicketEventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshStamp, setRefreshStamp] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState(
    hasSupabaseConfig()
      ? "Pulling live shop state from Supabase."
      : "Supabase is not configured in this desktop build. Showing starter Morning Brief data."
  );
  const [supportTechState, setSupportTechState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    const refreshLiveData = async () => {
      setIsLoading(true);
      const supabase = getSupabaseClient();

      if (!supabase) {
        if (!cancelled) {
          setTicketRows([]);
          setAlertRows([]);
          setDviRows([]);
          setEventRows([]);
          setRefreshStamp(new Date().toISOString());
          setIsLoading(false);
        }
        return;
      }

      const [ticketsRes, alertsRes, dviRes, eventsRes] = await Promise.all([
        supabase.from("ticket_current_state").select("*").order("last_activity_at", { ascending: false }).limit(150),
        supabase.from("open_ticket_alerts").select("*").order("triggered_at", { ascending: false }).limit(200),
        supabase.from("dvi_reviews").select("*").order("created_at", { ascending: false }).limit(150),
        supabase.from("ticket_events").select("*").order("event_at", { ascending: false }).limit(600)
      ]);

      if (cancelled) {
        return;
      }

      if (ticketsRes.error || alertsRes.error || dviRes.error || eventsRes.error) {
        setConnectionMessage(
          `Live read issue detected. Falling back to starter Morning Brief data. ${
            ticketsRes.error?.message ??
            alertsRes.error?.message ??
            dviRes.error?.message ??
            eventsRes.error?.message ??
            ""
          }`.trim()
        );
        setTicketRows([]);
        setAlertRows([]);
        setDviRows([]);
        setEventRows([]);
      } else {
        setConnectionMessage("Live shop state is synced from Supabase and recalculated for Morning Brief.");
        setTicketRows((ticketsRes.data as TicketCurrentStateRow[]) ?? []);
        setAlertRows((alertsRes.data as OpenTicketAlertRow[]) ?? []);
        setDviRows((dviRes.data as DviReviewRow[]) ?? []);
        setEventRows(
          ((eventsRes.data as TicketEventRow[]) ?? []).map((event) => ({
            ...event,
            payload:
              event.payload && typeof event.payload === "object" ? event.payload : {}
          }))
        );
      }

      setRefreshStamp(new Date().toISOString());
      setIsLoading(false);
    };

    void refreshLiveData();
    const interval = window.setInterval(() => {
      void refreshLiveData();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const operationalTickets = useMemo(() => {
    if (ticketRows.length === 0) {
      return buildFallbackTickets();
    }

    const alertsByTicket = groupByTicket(alertRows, (item) => item.ticket_id);
    const eventsByTicket = groupByTicket(eventRows, (item) => item.ticket_id);
    const latestDviByTicket = new Map<string, DviReviewRow>();

    for (const review of dviRows) {
      if (!latestDviByTicket.has(review.ticket_id)) {
        latestDviByTicket.set(review.ticket_id, review);
      }
    }

    const stagedTickets = ticketRows.map((row) =>
      buildOperationalTicket({
        row,
        alerts: alertsByTicket.get(row.id) ?? [],
        events: eventsByTicket.get(row.id) ?? [],
        latestDvi: latestDviByTicket.get(row.id) ?? null
      })
    );

    const techQueues = new Map<string, OperationalTicket[]>();
    for (const ticket of stagedTickets) {
      const tech = ticket.assignedTechnician;
      if (tech === "Unassigned") {
        continue;
      }
      const queue = techQueues.get(tech) ?? [];
      queue.push(ticket);
      techQueues.set(tech, queue);
    }

    for (const queue of techQueues.values()) {
      queue.sort((left, right) => right.priorityScore - left.priorityScore || left.stageIndex - right.stageIndex);
      queue.forEach((ticket, index) => {
        ticket.nextQueuedJob = queue[index + 1]?.roNumber ?? "No backup task staged";
        if (
          ["DVI / Verify Concern", "Technical Review", "Ready to Dispatch", "In Service", "Waiting Parts"].includes(
            ticket.stage
          ) &&
          index === queue.length - 1
        ) {
          ticket.exceptions.push({
            id: `${ticket.id}-queue-gap`,
            ticketId: ticket.id,
            roNumber: ticket.roNumber,
            severity: "medium",
            title: "No next queued task",
            detail: `${ticket.assignedTechnician} does not have a backup task staged after ${ticket.roNumber}.`,
            owner: "Advisor / Dispatch"
          });
        }
      });
    }

    return stagedTickets.sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return left.stageIndex - right.stageIndex;
    });
  }, [alertRows, dviRows, eventRows, ticketRows]);

  const visibleTickets = useMemo(
    () => operationalTickets.filter((ticket) => ticket.stage !== "Pickup / Closed"),
    [operationalTickets]
  );

  const hotWork = useMemo(() => visibleTickets.filter((ticket) => ticket.priority === "P1"), [visibleTickets]);

  const exceptionFlags = useMemo(
    () =>
      visibleTickets
        .flatMap((ticket) => ticket.exceptions)
        .sort((left, right) => severityRank(right.severity) - severityRank(left.severity)),
    [visibleTickets]
  );

  const technicianRollCall = useMemo<TechnicianRollup[]>(() => {
    const names = Array.from(new Set([...TECH_ROSTER, ...visibleTickets.map((ticket) => ticket.assignedTechnician)])).filter(
      (name) => name && name !== "Unassigned"
    );

    return names
      .map((name) => {
        const jobs = visibleTickets
          .filter((ticket) => ticket.assignedTechnician === name)
          .sort((left, right) => right.priorityScore - left.priorityScore);
        const lead = jobs[0];

        return {
          name,
          jobCount: jobs.length,
          jobs,
          activeStage: lead?.stage ?? "No active stage",
          blocker: lead?.blocker ?? "No blocker logged",
          nextQueuedJob: lead?.nextQueuedJob ?? "No backup task staged",
          estimatedCompletion: lead?.estimatedCompletion ?? "No ETA set",
          totalHours: jobs.reduce((sum, job) => sum + (job.totalHoursOnJob ?? 0), 0),
          needsBackupQueue: jobs.length > 0 && jobs.every((job) => job.nextQueuedJob === "No backup task staged")
        };
      })
      .sort((left, right) => right.jobCount - left.jobCount || left.name.localeCompare(right.name));
  }, [visibleTickets]);

  const forecast = useMemo(() => {
    const today = new Date();
    const appointmentsToday = visibleTickets.filter(
      (ticket) => ticket.appointmentDate && isSameCalendarDay(ticket.appointmentDate, today)
    ).length;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const appointmentsTomorrow = visibleTickets.filter(
      (ticket) => ticket.appointmentDate && isSameCalendarDay(ticket.appointmentDate, tomorrow)
    ).length;
    const closingToday = visibleTickets.filter((ticket) =>
      ["Technical Signoff", "Ready / Customer Contacted", "Pickup / Closed"].includes(ticket.stage)
    ).length;
    const inService = visibleTickets.filter((ticket) => ticket.stage === "In Service").length;
    const waitingParts = visibleTickets.filter((ticket) => ticket.stage === "Waiting Parts").length;
    const readyToBuild = visibleTickets.filter((ticket) =>
      ["Technical Review", "Estimate Build"].includes(ticket.stage)
    ).length;

    return {
      appointmentsToday,
      appointmentsTomorrow,
      closingToday,
      workloadLabel: `${inService} in service, ${waitingParts} waiting on parts, ${readyToBuild} ready to build`
    };
  }, [visibleTickets]);

  const snapshot = useMemo(() => {
    const now = new Date();
    const promiseToday = visibleTickets.filter(
      (ticket) => ticket.promiseDate && isSameCalendarDay(ticket.promiseDate, now)
    ).length;
    const waitingApproval = visibleTickets.filter((ticket) => ticket.stage === "Waiting Approval").length;
    const waitingParts = visibleTickets.filter((ticket) => ticket.stage === "Waiting Parts").length;
    const qcRiskCount = visibleTickets.filter((ticket) =>
      ticket.exceptions.some((flag) => flag.title.toLowerCase().includes("qc"))
    ).length;
    const missingCustomerContact = visibleTickets.filter(
      (ticket) => ticket.contactStatus === "Overdue" || ticket.contactStatus === "No update logged"
    ).length;

    return {
      openRoCount: visibleTickets.length,
      hotJobs: hotWork.length,
      promiseToday,
      waitingApproval,
      waitingParts,
      qcRiskCount,
      missingCustomerContact
    };
  }, [hotWork.length, visibleTickets]);

  const teamActionBuckets = useMemo(() => {
    return {
      advisorFollowUps: visibleTickets.filter((ticket) =>
        ["Waiting Approval", "Estimate Build", "Ready / Customer Contacted"].includes(ticket.stage)
      ),
      partsFollowUps: visibleTickets.filter((ticket) => ticket.stage === "Waiting Parts"),
      dviFirst: visibleTickets.filter((ticket) => ticket.stage === "DVI / Verify Concern"),
      readyToBuild: visibleTickets.filter((ticket) =>
        ["Technical Review", "Estimate Build"].includes(ticket.stage)
      ),
      readyToClose: visibleTickets.filter((ticket) =>
        ["QC / Verification", "Technical Signoff", "Ready / Customer Contacted"].includes(ticket.stage)
      ),
      riskOfStalling: visibleTickets.filter((ticket) =>
        ticket.exceptions.some((flag) =>
          [
            "Stage too old",
            "No next queued task",
            "Waiting on parts too long",
            "No customer update logged"
          ].includes(flag.title)
        )
      )
    };
  }, [visibleTickets]);

  const dispatchWatch = useMemo(
    () =>
      visibleTickets
        .filter((ticket) =>
          ["Ready to Dispatch", "Waiting Approval", "In Service"].includes(ticket.stage) ||
          ticket.events.some((event) => event.event_type === "ro_approval")
        )
        .sort((left, right) => left.dispatchReadiness.score - right.dispatchReadiness.score),
    [visibleTickets]
  );

  const waitingOnPartsWatch = useMemo(
    () => visibleTickets.filter((ticket) => ticket.stage === "Waiting Parts"),
    [visibleTickets]
  );

  const performanceSnapshot = useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const yesterdayEvents = eventRows.filter((event) => isSameCalendarDay(new Date(event.event_at), yesterday));
    const recentCloseSignals = yesterdayEvents.filter((event) =>
      ["wo_signoff", "status_update", "ro_approval"].includes(event.event_type)
    ).length;
    const lastWeekCloseSignals = eventRows.filter((event) => {
      const eventDate = new Date(event.event_at);
      return eventDate >= sevenDaysAgo && eventDate < yesterday && ["wo_signoff", "status_update"].includes(event.event_type);
    }).length;
    const weekTrend = lastWeekCloseSignals > 0 ? Math.round((recentCloseSignals / Math.max(lastWeekCloseSignals / 6, 1)) * 100) : null;

    const indicator =
      recentCloseSignals >= 8 ? "Green" : recentCloseSignals >= 4 ? "Yellow" : "Red";
    const challenge =
      indicator === "Green"
        ? "Keep the handoffs tight and protect dispatch-ready work from bouncing backward."
        : indicator === "Yellow"
          ? "Tighten follow-up timing and queue discipline so technicians never wait for the next move."
          : "Rebuild the day plan early, stage backup work, and close communication gaps before production stalls.";

    return {
      billedHoursYesterday: null as number | null,
      clockedHoursYesterday: null as number | null,
      proxyCloseSignalsYesterday: recentCloseSignals,
      weekTrend,
      indicator,
      challenge
    };
  }, [eventRows]);

  const dailyTarget = useMemo(() => {
    const completionTarget = Math.max(3, Math.ceil((visibleTickets.filter((ticket) => ticket.stageIndex <= 9).length || 1) / 3));
    const topRisk = exceptionFlags[0];
    const gamePlan =
      waitingOnPartsWatch.length > 0
        ? "Lock parts follow-ups early, then stage backup work before technicians hit a dead stop."
        : "Push estimate-ready work forward fast and define every next checkpoint before the first bay opens.";
    const recommendedFocus = topRisk
      ? `Start with ${topRisk.roNumber}: ${topRisk.title.toLowerCase()}.`
      : "Keep hot work moving, confirm customer updates, and protect clean dispatches.";

    return {
      completionTarget,
      gamePlan,
      recommendedFocus
    };
  }, [exceptionFlags, visibleTickets, waitingOnPartsWatch.length]);

  const activeModuleInfo = MODULES.find((module) => module.id === activeModule) ?? MODULES[0];

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <p className="eyebrow">AdvizeMe.ai</p>
          <h1>Shop Operating System</h1>
          <p>{connectionMessage}</p>
        </div>

        <div className="module-list">
          {Array.from(new Set(MODULES.map((module) => module.group))).map((group) => (
            <div key={group} className="module-group">
              <p className="module-group-label">{group}</p>
              {MODULES.filter((module) => module.group === group).map((module) => (
                <button
                  key={module.id}
                  type="button"
                  className={`module-button ${module.id === activeModule ? "module-button-active" : ""}`}
                  onClick={() => setActiveModule(module.id)}
                >
                  <strong>{module.label}</strong>
                  <span>{module.description}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <main className="main-panel">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Phase 1</p>
            <h2>{activeModuleInfo.label}</h2>
            <p className="workspace-subtitle">{activeModuleInfo.description}</p>
          </div>
          <div className="workspace-actions">
            <div className={`status-pill ${isLoading ? "warning" : "ready"}`}>
              {isLoading ? "Refreshing live state..." : "Live recalibration ready"}
            </div>
            <button type="button" className="secondary-button" onClick={() => window.print()}>
              Print Morning Brief
            </button>
          </div>
        </header>

        {activeModule === "morning-brief" ? (
          <div className="morning-brief-layout">
            <section className="panel huddle-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Team Huddle</p>
                  <h3>Daily recalibration</h3>
                </div>
                <span>{formatLongDate(new Date())}</span>
              </div>
              <div className="huddle-grid">
                <div className="prompt-card">
                  <strong>How is everyone doing?</strong>
                  <p>Check pulse early so small issues do not become production excuses later.</p>
                </div>
                <div className="prompt-card">
                  <strong>Any problems or questions?</strong>
                  <p>Pull blockers into the open before technicians have to self-run the workflow.</p>
                </div>
                <div className="prompt-card">
                  <strong>Anyone waiting on anything?</strong>
                  <p>Call out missing parts, missing approvals, missing direction, and missing backup work.</p>
                </div>
                <div className="prompt-card">
                  <strong>Safety / hydration / housekeeping</strong>
                  <p>Quick reminder to keep bays staged, water close, and hazards handled before the rush builds.</p>
                </div>
              </div>
            </section>

            <section className="stats-grid morning-stats">
              <StatCard label="Open ROs" value={String(snapshot.openRoCount)} tone="neutral" />
              <StatCard label="Hot Jobs" value={String(snapshot.hotJobs)} tone="critical" />
              <StatCard label="Promise-Time Jobs Today" value={String(snapshot.promiseToday)} tone="warning" />
              <StatCard label="Waiting Approval" value={String(snapshot.waitingApproval)} tone="warning" />
              <StatCard label="Waiting Parts" value={String(snapshot.waitingParts)} tone="warning" />
              <StatCard label="QC Risk Count" value={String(snapshot.qcRiskCount)} tone="critical" />
              <StatCard label="Missing Customer Contact" value={String(snapshot.missingCustomerContact)} tone="critical" />
              <StatCard label="Last Refresh" value={refreshStamp ? formatTime(refreshStamp) : "—"} tone="neutral" />
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Today&apos;s Hot Work</p>
                  <h3>P1 production priorities</h3>
                </div>
                <span>{hotWork.length} hot jobs</span>
              </div>
              <div className="queue-list">
                {hotWork.length > 0 ? (
                  hotWork.map((ticket) => <PriorityCard key={ticket.id} ticket={ticket} compact />)
                ) : (
                  <EmptyCard title="No P1 work flagged" body="The queue is calm right now. Keep it that way by staging the next checkpoint and backup work." />
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Technician Roll Call</p>
                  <h3>Current workload and next-stage readiness</h3>
                </div>
                <span>{technicianRollCall.length} technicians in rotation</span>
              </div>
              <div className="tech-grid">
                {technicianRollCall.map((tech) => (
                  <article key={tech.name} className="tech-card">
                    <div className="tech-card-header">
                      <div>
                        <h4>{tech.name}</h4>
                        <p>{tech.jobCount > 0 ? `${tech.jobCount} assigned jobs` : "No assigned jobs"}</p>
                      </div>
                      <button
                        type="button"
                        className={`mini-toggle ${supportTechState[tech.name] ? "mini-toggle-active" : ""}`}
                        onClick={() =>
                          setSupportTechState((current) => ({
                            ...current,
                            [tech.name]: !current[tech.name]
                          }))
                        }
                      >
                        {supportTechState[tech.name] ? "Borrowed tech support on" : "Support / borrowed tech"}
                      </button>
                    </div>
                    <div className="tech-meta-grid">
                      <MetricRow label="Current stage" value={tech.activeStage} />
                      <MetricRow label="Est. completion" value={tech.estimatedCompletion} />
                      <MetricRow label="Total hours on assigned jobs" value={`${tech.totalHours.toFixed(1)} hr`} />
                      <MetricRow label="Blocker" value={tech.blocker} />
                      <MetricRow label="Next queued job" value={tech.nextQueuedJob} />
                    </div>
                    <div className="tech-job-stack">
                      {tech.jobs.slice(0, 2).map((job) => (
                        <div key={job.id} className="tech-job-chip">
                          <span>{job.roNumber}</span>
                          <strong>{job.stage}</strong>
                        </div>
                      ))}
                      {tech.jobCount === 0 ? <p className="muted-copy">No active work assigned yet.</p> : null}
                    </div>
                    {tech.needsBackupQueue ? <p className="tech-warning">No backup queue staged. Advisor/front needs to preload the next move.</p> : null}
                  </article>
                ))}
              </div>
            </section>

            <section className="split-grid">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Forecast</p>
                    <h3>Today and tomorrow</h3>
                  </div>
                </div>
                <div className="metric-list">
                  <MetricRow label="Appointments today" value={String(forecast.appointmentsToday)} />
                  <MetricRow label="Appointments tomorrow" value={String(forecast.appointmentsTomorrow)} />
                  <MetricRow label="Jobs expected to close today" value={String(forecast.closingToday)} />
                  <MetricRow label="Workload snapshot" value={forecast.workloadLabel} />
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Daily Target</p>
                    <h3>Game plan</h3>
                  </div>
                </div>
                <div className="target-block">
                  <MetricRow label="Today&apos;s completion target" value={`${dailyTarget.completionTarget} ROs`} />
                  <MetricRow label="Game plan" value={dailyTarget.gamePlan} />
                  <MetricRow label="Recommended focus" value={dailyTarget.recommendedFocus} />
                </div>
              </section>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Priority / Queue Review</p>
                  <h3>Stage-based production control</h3>
                </div>
                <span>{visibleTickets.length} live ROs</span>
              </div>
              <div className="queue-list">
                {visibleTickets.map((ticket) => (
                  <PriorityCard key={ticket.id} ticket={ticket} />
                ))}
              </div>
            </section>

            <section className="split-grid">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Exception Watchlist</p>
                    <h3>Rules-based production risks</h3>
                  </div>
                  <span>{exceptionFlags.length} flags</span>
                </div>
                <div className="exception-list">
                  {exceptionFlags.length > 0 ? (
                    exceptionFlags.slice(0, 18).map((flag) => (
                      <article key={flag.id} className={`exception-card severity-${flag.severity}`}>
                        <div className="exception-header">
                          <strong>{flag.title}</strong>
                          <span>{flag.roNumber}</span>
                        </div>
                        <p>{flag.detail}</p>
                        <small>Owner: {flag.owner}</small>
                      </article>
                    ))
                  ) : (
                    <EmptyCard title="No active exceptions" body="Morning Brief did not detect any stage, dispatch, or communication exceptions right now." />
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Dispatch Readiness Watch</p>
                    <h3>Approved is not enough</h3>
                  </div>
                </div>
                <div className="dispatch-list">
                  {dispatchWatch.length > 0 ? (
                    dispatchWatch.slice(0, 10).map((ticket) => (
                      <article key={`${ticket.id}-dispatch`} className="dispatch-card">
                        <div className="dispatch-header">
                          <div>
                            <strong>{ticket.roNumber}</strong>
                            <span>{ticket.customerName}</span>
                          </div>
                          <div className={`dispatch-badge ${ticket.dispatchReadiness.ready ? "dispatch-ready" : "dispatch-not-ready"}`}>
                            {ticket.dispatchReadiness.ready ? "Ready to dispatch" : "Dispatch gaps"}
                          </div>
                        </div>
                        <p>{ticket.dispatchReadiness.reason}</p>
                        <ul>
                          {ticket.dispatchReadiness.checks.map((check) => (
                            <li key={`${ticket.id}-${check.label}`} className={check.ok ? "check-ok" : "check-gap"}>
                              {check.ok ? "Ready" : "Gap"}: {check.label}
                            </li>
                          ))}
                        </ul>
                      </article>
                    ))
                  ) : (
                    <EmptyCard title="No dispatch review items" body="No active approved-or-near-dispatch jobs need a dispatch readiness review right now." />
                  )}
                </div>
              </section>
            </section>

            <section className="split-grid">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Follow-Up / Waiting on Parts Watch</p>
                    <h3>Do not let parts status go flat</h3>
                  </div>
                </div>
                <div className="parts-watch-list">
                  {waitingOnPartsWatch.length > 0 ? (
                    waitingOnPartsWatch.map((ticket) => (
                      <article key={`${ticket.id}-parts`} className="parts-watch-card">
                        <div className="dispatch-header">
                          <div>
                            <strong>{ticket.roNumber}</strong>
                            <span>{ticket.customerName}</span>
                          </div>
                          <span>{ticket.stageAgeLabel}</span>
                        </div>
                        <div className="metric-list compact-metrics">
                          <MetricRow label="Blocker" value={ticket.blocker} />
                          <MetricRow label="Backup task queued" value={ticket.nextQueuedJob} />
                          <MetricRow label="Follow-up owner" value="Advisor / Parts" />
                          <MetricRow label="Next action" value={ticket.nextBestAction} />
                        </div>
                      </article>
                    ))
                  ) : (
                    <EmptyCard title="No waiting-on-parts work" body="No current ROs are parked in Waiting Parts." />
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Team Action List</p>
                    <h3>Who needs to move next</h3>
                  </div>
                </div>
                <div className="action-buckets">
                  <ActionBucket title="Advisor follow-ups needed" tickets={teamActionBuckets.advisorFollowUps} />
                  <ActionBucket title="Parts follow-ups needed" tickets={teamActionBuckets.partsFollowUps} />
                  <ActionBucket title="Jobs needing DVI first" tickets={teamActionBuckets.dviFirst} />
                  <ActionBucket title="Jobs ready to build" tickets={teamActionBuckets.readyToBuild} />
                  <ActionBucket title="Jobs ready to close" tickets={teamActionBuckets.readyToClose} />
                  <ActionBucket title="Jobs at risk of stalling" tickets={teamActionBuckets.riskOfStalling} />
                </div>
              </section>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Performance Snapshot</p>
                  <h3>Yesterday and trend</h3>
                </div>
                <span>{performanceSnapshot.indicator} indicator</span>
              </div>
              <div className="performance-grid">
                <StatCard label="Billed Hours Yesterday" value="Not connected" tone="neutral" />
                <StatCard label="Clocked Hours Yesterday" value="Not connected" tone="neutral" />
                <StatCard label="Close Signals Yesterday" value={String(performanceSnapshot.proxyCloseSignalsYesterday)} tone="warning" />
                <StatCard
                  label="Day / Week Trend"
                  value={performanceSnapshot.weekTrend === null ? "N/A" : `${performanceSnapshot.weekTrend}%`}
                  tone={performanceSnapshot.indicator === "Green" ? "good" : performanceSnapshot.indicator === "Yellow" ? "warning" : "critical"}
                />
              </div>
              <p className="performance-note">{performanceSnapshot.challenge}</p>
            </section>

            <section className="print-sheet">
              <div className="print-sheet-header">
                <h3>Morning Brief</h3>
                <p>{formatLongDate(new Date())}</p>
              </div>
              <div className="print-grid">
                <div>
                  <strong>Daily Snapshot</strong>
                  <ul>
                    <li>Open ROs: {snapshot.openRoCount}</li>
                    <li>Hot jobs: {snapshot.hotJobs}</li>
                    <li>Promise-time jobs today: {snapshot.promiseToday}</li>
                    <li>Waiting approval: {snapshot.waitingApproval}</li>
                    <li>Waiting parts: {snapshot.waitingParts}</li>
                    <li>QC risk count: {snapshot.qcRiskCount}</li>
                    <li>Missing customer contact: {snapshot.missingCustomerContact}</li>
                  </ul>
                </div>
                <div>
                  <strong>Team Huddle</strong>
                  <ul>
                    <li>Any problems?</li>
                    <li>Any questions?</li>
                    <li>Anyone waiting on anything?</li>
                    <li>Safety, hydration, housekeeping check.</li>
                  </ul>
                </div>
                <div>
                  <strong>Top Hot Work</strong>
                  <ul>
                    {hotWork.slice(0, 6).map((ticket) => (
                      <li key={`${ticket.id}-print-hot`}>
                        {ticket.roNumber} {ticket.customerName} - {ticket.nextBestAction}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Top Exceptions</strong>
                  <ul>
                    {exceptionFlags.slice(0, 6).map((flag) => (
                      <li key={`${flag.id}-print-flag`}>
                        {flag.roNumber} - {flag.title}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <section className="module-placeholder panel">
            <p className="eyebrow">Next Module</p>
            <h3>{activeModuleInfo.label}</h3>
            <p>{activeModuleInfo.description}</p>
            <div className="placeholder-grid">
              <div className="prompt-card">
                <strong>Shared shell is ready</strong>
                <p>This module now has a dedicated place in the app instead of being mixed into one giant operations screen.</p>
              </div>
              <div className="prompt-card">
                <strong>Morning Brief is first</strong>
                <p>Phase 1 is centered on production recalibration. The next module will inherit the same stage model and shared Supabase data.</p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function buildFallbackTickets(): OperationalTicket[] {
  return starterTickets.map((ticket, index) => {
    const stage = mapStatusToStage(ticket.status, ticket.nextAction, []);
    const stageAgeHours = index + 0.75;
    const dispatchReadiness = buildDispatchReadiness({
      stage,
      summary: ticket.nextAction,
      advisor: ticket.advisor,
      technician: ticket.technician,
      alerts: starterAlerts
        .filter((alert) => alert.ticketId === ticket.id)
        .map(
          (alert): OpenTicketAlertRow => ({
            id: alert.id,
            ticket_id: alert.ticketId,
            alert_type: alert.type,
            severity: alert.severity,
            title: alert.title,
            detail: alert.detail,
            triggered_at: new Date().toISOString()
          })
        ),
      latestDvi: null,
      events: []
    });

    return {
      id: ticket.id,
      roNumber: ticket.roNumber,
      customerName: ticket.customerName,
      vehicleLabel: ticket.vehicleLabel,
      location: ticket.location,
      source: ticket.source,
      currentStatus: ticket.status,
      stage,
      stageIndex: STAGE_FLOW.indexOf(stage),
      priority: ticket.priority,
      priorityScore: 96 - index * 8,
      priorityReason: "Starter Morning Brief demo data.",
      blocker: starterAlerts.find((alert) => alert.ticketId === ticket.id)?.title ?? "No major blocker logged",
      nextBestAction: ticket.nextAction,
      assignedAdvisor: ticket.advisor,
      assignedTechnician: ticket.technician,
      promiseTime: null,
      promiseDate: null,
      contactStatus: "Check daily touchpoint",
      lastContactAt: null,
      summary: ticket.nextAction,
      stageAgeHours,
      stageAgeLabel: formatDurationHours(stageAgeHours),
      totalHoursOnJob: stageAgeHours + 1,
      estimatedCompletion: "Watch today",
      nextCheckpoint: "When you verify this stage, come get me.",
      nextHandoffOwner: inferNextHandoffOwner(stage),
      openAlertCount: starterAlerts.filter((alert) => alert.ticketId === ticket.id).length,
      dispatchReadiness,
      latestDvi: null,
      alerts: [],
      events: [],
      exceptions: [],
      appointmentDate: null,
      queueGroup: ticket.priority === "P1" ? "Do Now" : ticket.priority === "P2" ? "Build Next" : "Follow Up Now",
      nextQueuedJob: "No backup task staged"
    };
  });
}

function buildOperationalTicket(input: {
  row: TicketCurrentStateRow;
  alerts: OpenTicketAlertRow[];
  events: TicketEventRow[];
  latestDvi: DviReviewRow | null;
}): OperationalTicket {
  const { row, alerts, events, latestDvi } = input;
  const roNumber = row.external_ticket_id ? `RO#${row.external_ticket_id}` : "RO# Pending";
  const customerName = row.customer_name ?? "Unknown customer";
  const vehicleLabel = [row.year, row.make, row.model].filter(Boolean).join(" ") || "Vehicle details pending";
  const stage = row.current_stage
    ? ((STAGE_FLOW.includes(row.current_stage as MorningBriefStage) ? row.current_stage : "Unknown") as MorningBriefStage)
    : mapStatusToStage(row.source_status, row.summary, events);
  const stageIndex = Math.max(STAGE_FLOW.indexOf(stage), 0);
  const stageAgeHours = hoursBetween(row.last_activity_at ?? row.opened_at ?? new Date().toISOString(), new Date().toISOString());
  const derivedDispatchReadiness = buildDispatchReadiness({
    stage,
    summary: row.summary ?? "",
    advisor: row.advisor_name,
    technician: row.technician_name,
    alerts,
    latestDvi,
    events
  });
  const dispatchReadiness =
    typeof row.dispatch_ready === "boolean" || row.dispatch_ready_reason
      ? {
          ...derivedDispatchReadiness,
          ready: row.dispatch_ready ?? derivedDispatchReadiness.ready,
          reason: row.dispatch_ready_reason ?? derivedDispatchReadiness.reason
        }
      : derivedDispatchReadiness;

  const contactStatus = deriveContactStatus(row.last_customer_update_at, row.customer_update_due_at, stage);
  const blocker = row.current_blocker ?? deriveBlocker(stage, alerts, latestDvi, row, dispatchReadiness);
  const priority = derivePriority(stage, stageAgeHours, alerts, row, dispatchReadiness, latestDvi, contactStatus);
  const priorityScore = buildPriorityScore(priority.level, stageAgeHours, alerts.length, latestDvi);
  const nextBestAction = row.next_best_action ?? deriveNextBestAction(stage, blocker, dispatchReadiness.ready, latestDvi);
  const appointmentDate = extractAppointmentDate(row.summary, row.source_status);
  const estimatedCompletion = row.approx_completion_eta
    ? formatShortDateTime(row.approx_completion_eta)
    : deriveEstimatedCompletion(stage, stageAgeHours, row.customer_update_due_at);
  const nextCheckpoint = row.next_checkpoint ?? deriveNextCheckpoint(stage, latestDvi);
  const nextHandoffOwner = row.next_handoff_owner ?? inferNextHandoffOwner(stage);
  const totalHoursOnJob = row.opened_at ? hoursBetween(row.opened_at, new Date().toISOString()) : stageAgeHours;
  const exceptions = deriveExceptions({
    row,
    stage,
    stageAgeHours,
    latestDvi,
    alerts,
    contactStatus,
    dispatchReadiness,
    nextBestAction,
    blocker
  });

  return {
    id: row.id,
    roNumber,
    customerName,
    vehicleLabel,
    location: row.location_name,
    source: sourceMap[row.source_code ?? "AUTOFLOW"] ?? "AutoFlow",
    currentStatus: row.source_status ?? "Unknown",
    stage,
    stageIndex,
    priority: priority.level,
    priorityScore,
    priorityReason: priority.reason,
    blocker,
    nextBestAction,
    assignedAdvisor: row.advisor_name ?? "Unassigned",
    assignedTechnician: row.technician_name ?? "Unassigned",
    promiseTime: row.approx_next_stage_eta ?? row.customer_update_due_at,
    promiseDate: row.customer_update_due_at ? new Date(row.customer_update_due_at) : appointmentDate,
    contactStatus,
    lastContactAt: row.last_customer_update_at,
    summary: row.summary ?? "No summary logged",
    stageAgeHours,
    stageAgeLabel: formatDurationHours(stageAgeHours),
    totalHoursOnJob,
    estimatedCompletion,
    nextCheckpoint,
    nextHandoffOwner,
    openAlertCount: row.open_alert_count ?? alerts.length,
    dispatchReadiness,
    latestDvi,
    alerts,
    events,
    exceptions,
    appointmentDate,
    queueGroup: priority.level === "P1" ? "Do Now" : priority.level === "P2" ? "Build Next" : "Follow Up Now",
    nextQueuedJob: row.backup_task_summary ?? "Pending queue review"
  };
}

function mapStatusToStage(
  status: string | null | undefined,
  summary: string | null | undefined,
  events: TicketEventRow[]
): MorningBriefStage {
  const combined = [status, summary, ...events.slice(0, 3).map((event) => event.event_type)].join(" ").toLowerCase();

  if (combined.includes("pickup") || combined.includes("closed")) return "Pickup / Closed";
  if (combined.includes("ready") && combined.includes("customer")) return "Ready / Customer Contacted";
  if (combined.includes("technical signoff") || combined.includes("wo_signoff")) return "Technical Signoff";
  if (combined.includes("qc") || combined.includes("verification")) return "QC / Verification";
  if (combined.includes("in service") || combined.includes("servicing") || combined.includes("repair")) return "In Service";
  if (combined.includes("dispatch")) return "Ready to Dispatch";
  if (combined.includes("waiting parts") || combined.includes("parts")) return "Waiting Parts";
  if (combined.includes("approval")) return "Waiting Approval";
  if (combined.includes("estimate")) return "Estimate Build";
  if (combined.includes("technical review") || combined.includes("technical advisor")) return "Technical Review";
  if (combined.includes("dvi") || combined.includes("inspect") || combined.includes("verify concern")) return "DVI / Verify Concern";
  if (combined.includes("checkin") || combined.includes("check-in") || combined.includes("appointment")) return "Check-In / Interview";
  return "Unknown";
}

function derivePriority(
  stage: MorningBriefStage,
  stageAgeHours: number,
  alerts: OpenTicketAlertRow[],
  row: TicketCurrentStateRow,
  dispatchReadiness: OperationalTicket["dispatchReadiness"],
  latestDvi: DviReviewRow | null,
  contactStatus: string
) {
  const criticalAlert = alerts.some((alert) => alert.severity === "critical");
  const hotIntake = stage === "Check-In / Interview";
  const stalled = stageAgeHours > STAGE_AGE_THRESHOLDS[stage] * 1.4;
  const weakDvi = Boolean(
    latestDvi &&
    (latestDvi.review_status !== "acceptable" ||
      latestDvi.missing_notes ||
      latestDvi.missing_photos ||
      latestDvi.missing_measurements)
  );

  if (criticalAlert || hotIntake || stalled) {
    return {
      level: "P1" as TicketPriority,
      reason: criticalAlert
        ? "Immediate risk or blocker is already open."
        : hotIntake
          ? "New intake, appointment, or quick triage needs an early move."
          : "Stage age is overdue and this job will keep slipping until someone owns it."
    };
  }

  if (
    ["DVI / Verify Concern", "Technical Review", "Estimate Build"].includes(stage) ||
    weakDvi ||
    contactStatus === "Overdue" ||
    dispatchReadiness.ready === false
  ) {
    return {
      level: "P2" as TicketPriority,
      reason: weakDvi
        ? "DVI support is likely to bounce back and needs tighter proof before the next move."
        : dispatchReadiness.ready === false && stage === "Ready to Dispatch"
          ? "Approved work still has dispatch gaps and should not be treated as truly ready."
          : "Advisor needs more information or a tighter handoff before the RO can move cleanly."
    };
  }

  if (["Ready to Dispatch", "In Service", "QC / Verification", "Technical Signoff"].includes(stage)) {
    return {
      level: "P3" as TicketPriority,
      reason: "Work is active or nearly active and should keep moving through production."
    };
  }

  return {
    level: "P4" as TicketPriority,
    reason:
      stage === "Waiting Parts"
        ? "This job is waiting and needs controlled follow-up instead of active bay time."
        : "This RO is in a holding or closeout stage and no longer needs front-of-line production focus."
  };
}

function buildPriorityScore(
  priority: TicketPriority,
  stageAgeHours: number,
  alertCount: number,
  latestDvi: DviReviewRow | null
) {
  const base = priority === "P1" ? 96 : priority === "P2" ? 78 : priority === "P3" ? 61 : 44;
  const ageLift = Math.min(Math.round(stageAgeHours * 2), 12);
  const alertLift = Math.min(alertCount * 3, 9);
  const dviPenalty = latestDvi && latestDvi.review_status !== "acceptable" ? 6 : 0;
  return Math.max(1, Math.min(100, base + ageLift + alertLift - dviPenalty));
}

function buildDispatchReadiness(input: {
  stage: MorningBriefStage;
  summary: string;
  advisor: string | null | undefined;
  technician: string | null | undefined;
  alerts: OpenTicketAlertRow[];
  latestDvi: DviReviewRow | null;
  events: TicketEventRow[];
}) {
  const approvalSignal =
    input.events.some((event) => event.event_type === "ro_approval") ||
    ["Ready to Dispatch", "In Service", "QC / Verification", "Technical Signoff"].includes(input.stage);
  const dviSupported = input.latestDvi ? input.latestDvi.review_status === "acceptable" : input.stage !== "DVI / Verify Concern";
  const directionClear = input.summary.trim().length >= 28;
  const partsKnown = input.stage !== "Waiting Parts";
  const peopleAssigned = Boolean(input.advisor) && Boolean(input.technician);
  const majorItemsCovered = !input.alerts.some((alert) =>
    ["missing", "incomplete", "weak", "bounce back"].some((term) =>
      `${alert.alert_type} ${alert.title} ${alert.detail ?? ""}`.toLowerCase().includes(term)
    )
  );

  const checks: DispatchCheck[] = [
    { label: "Customer approved", ok: approvalSignal },
    { label: "Nothing important appears forgotten", ok: majorItemsCovered },
    { label: "Advisor and technician are both assigned", ok: peopleAssigned },
    { label: "Plan and direction are documented", ok: directionClear },
    { label: "Approximate duration is understood", ok: directionClear && Boolean(input.technician) },
    { label: "Parts status is known", ok: partsKnown },
    { label: "DVI support is strong enough", ok: dviSupported }
  ];

  const score = checks.filter((check) => check.ok).length;
  const ready = checks.every((check) => check.ok);

  return {
    ready,
    score,
    checks,
    reason: ready
      ? "Approved, supported, and aligned. This job is safe to release into dispatch."
      : "Approved alone is not enough. Close the checklist gaps before dispatching."
  };
}

function deriveBlocker(
  stage: MorningBriefStage,
  alerts: OpenTicketAlertRow[],
  latestDvi: DviReviewRow | null,
  row: TicketCurrentStateRow,
  dispatchReadiness: OperationalTicket["dispatchReadiness"]
) {
  const alert = alerts[0];
  if (alert) return alert.title;
  if (stage === "Waiting Parts") return "Parts ETA or vendor follow-up is still controlling the next move.";
  if (latestDvi && latestDvi.review_status !== "acceptable") return "DVI support is weak and may bounce back during estimate build.";
  if (stage === "Ready to Dispatch" && !dispatchReadiness.ready) return "Approved job still has dispatch-readiness gaps.";
  if (!row.technician_name && ["DVI / Verify Concern", "Technical Review", "Ready to Dispatch", "In Service"].includes(stage)) return "Technician assignment is unclear.";
  if (!row.advisor_name && stage !== "Pickup / Closed") return "Advisor assignment is unclear.";
  return "No major blocker logged";
}

function deriveNextBestAction(
  stage: MorningBriefStage,
  blocker: string,
  dispatchReady: boolean,
  latestDvi: DviReviewRow | null
) {
  if (latestDvi && latestDvi.review_status !== "acceptable") {
    return "Tighten tech proof first so the estimate does not bounce back midstream.";
  }

  switch (stage) {
    case "Check-In / Interview":
      return "Lock the customer concern, check quick triage, and stage the first checkpoint.";
    case "DVI / Verify Concern":
      return "Finish the DVI, verify the concern, then pull the advisor in before going deeper.";
    case "Technical Review":
      return "Wrap the technical review and hand the findings to the advisor in clean language.";
    case "Estimate Build":
      return "Build the estimate, protect the major items, and call the customer before this stalls.";
    case "Waiting Approval":
      return "Reach the customer now and close the approval gap instead of waiting on them to call first.";
    case "Waiting Parts":
      return "Confirm ETA, decide keep active or pull, and preload the technician's backup work.";
    case "Ready to Dispatch":
      return dispatchReady
        ? "Dispatch with a clear duration, checkpoint, and handoff plan."
        : "Close dispatch gaps before sending this into the bay.";
    case "In Service":
      return "Track the next checkpoint, catch scope changes early, and keep advisor informed.";
    case "QC / Verification":
      return "Run the forced-pause QC review and verify touched systems before final signoff.";
    case "Technical Signoff":
      return "Capture stage notes, reconcile used parts, and hand the RO back cleanly.";
    case "Ready / Customer Contacted":
      return "Confirm the customer contact and lock the pickup plan.";
    case "Pickup / Closed":
      return "Close the documentation loop and clear the board.";
    default:
      return blocker === "No major blocker logged" ? "Review the RO and assign the next real stage." : "Resolve the blocker, then restage the RO.";
  }
}

function deriveContactStatus(
  lastCustomerUpdateAt: string | null,
  customerUpdateDueAt: string | null,
  stage: MorningBriefStage
) {
  if (stage === "Pickup / Closed") return "Closed";
  if (!lastCustomerUpdateAt) {
    if (customerUpdateDueAt && new Date(customerUpdateDueAt) < new Date()) return "Overdue";
    return "No update logged";
  }
  if (isSameCalendarDay(new Date(lastCustomerUpdateAt), new Date())) return "Updated today";
  if (customerUpdateDueAt && new Date(customerUpdateDueAt) < new Date()) return "Overdue";
  if (customerUpdateDueAt && isSameCalendarDay(new Date(customerUpdateDueAt), new Date())) return "Due today";
  return "Update scheduled";
}

function deriveEstimatedCompletion(stage: MorningBriefStage, stageAgeHours: number, customerUpdateDueAt: string | null) {
  if (customerUpdateDueAt) return formatShortDateTime(customerUpdateDueAt);

  const etaHours =
    stage === "In Service"
      ? Math.max(1, 4 - Math.min(stageAgeHours, 3))
      : stage === "QC / Verification"
        ? 1
        : stage === "Technical Signoff"
          ? 0.75
          : stage === "Ready / Customer Contacted"
            ? 1.5
            : stage === "Waiting Parts"
              ? 8
              : 3;

  const eta = new Date();
  eta.setHours(eta.getHours() + etaHours);
  return formatShortDateTime(eta.toISOString());
}

function deriveNextCheckpoint(stage: MorningBriefStage, latestDvi: DviReviewRow | null) {
  if (latestDvi && latestDvi.review_status !== "acceptable") {
    return "When you tighten the DVI proof, come get me before the estimate is built.";
  }

  switch (stage) {
    case "Check-In / Interview":
      return "When the interview and initial triage are complete, come get me.";
    case "DVI / Verify Concern":
      return "When the concern is verified and the DVI is complete, come get me.";
    case "Technical Review":
      return "When the tech review is organized into recommendations, come get me.";
    case "Estimate Build":
      return "When the estimate is ready and major items are on the table, come get me.";
    case "Waiting Approval":
      return "When the customer approves or pushes back, come get me.";
    case "Waiting Parts":
      return "When the ETA changes or the part lands, come get me.";
    case "Ready to Dispatch":
      return "When dispatch is clear and everyone is aligned, release it to the bay.";
    case "In Service":
      return "When the next scope or completion checkpoint is hit, come get me.";
    case "QC / Verification":
      return "When the touched-area checks and verification are complete, come get me.";
    case "Technical Signoff":
      return "When parts and notes are reconciled, hand it back to the advisor.";
    case "Ready / Customer Contacted":
      return "When the customer confirms pickup timing, close the loop.";
    default:
      return "Assign the next handoff and checkpoint before this sits.";
  }
}

function inferNextHandoffOwner(stage: MorningBriefStage) {
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

function deriveExceptions(input: {
  row: TicketCurrentStateRow;
  stage: MorningBriefStage;
  stageAgeHours: number;
  latestDvi: DviReviewRow | null;
  alerts: OpenTicketAlertRow[];
  contactStatus: string;
  dispatchReadiness: OperationalTicket["dispatchReadiness"];
  nextBestAction: string;
  blocker: string;
}) {
  const { row, stage, stageAgeHours, latestDvi, alerts, contactStatus, dispatchReadiness, blocker } = input;
  const roNumber = row.external_ticket_id ? `RO#${row.external_ticket_id}` : "RO# Pending";
  const flags: ExceptionFlag[] = [];

  if (stageAgeHours > STAGE_AGE_THRESHOLDS[stage]) {
    flags.push({
      id: `${row.id}-stage-old`,
      ticketId: row.id,
      roNumber,
      severity: stage === "Waiting Parts" ? "medium" : "high",
      title: "Stage too old",
      detail: `${roNumber} has been sitting in ${stage} for ${formatDurationHours(stageAgeHours)} without a fresh handoff.`,
      owner: "Advisor / Production"
    });
  }

  if (stage === "Waiting Parts" && stageAgeHours > 24) {
    flags.push({
      id: `${row.id}-parts-long`,
      ticketId: row.id,
      roNumber,
      severity: "high",
      title: "Waiting on parts too long",
      detail: `${roNumber} has no active parts recovery plan visible after ${formatDurationHours(stageAgeHours)}.`,
      owner: "Parts / Advisor"
    });
  }

  if (
    latestDvi &&
    (latestDvi.review_status !== "acceptable" ||
      latestDvi.missing_notes ||
      latestDvi.missing_photos ||
      latestDvi.missing_measurements)
  ) {
    flags.push({
      id: `${row.id}-weak-dvi`,
      ticketId: row.id,
      roNumber,
      severity: latestDvi.review_status === "not_acceptable" ? "high" : "medium",
      title: "Weak DVI likely to bounce back",
      detail:
        latestDvi.findings_summary ??
        "DVI support is missing proof and may cause estimate or approval turbulence.",
      owner: "Technician / Advisor"
    });
  }

  if (contactStatus === "Overdue" || contactStatus === "No update logged") {
    flags.push({
      id: `${row.id}-contact-gap`,
      ticketId: row.id,
      roNumber,
      severity: "high",
      title: "No customer update logged",
      detail: `${roNumber} does not show a recent customer-facing update, and the communication gap is now visible.`,
      owner: "Advisor"
    });
  }

  if (stage === "Estimate Build" && stageAgeHours > 1.5) {
    flags.push({
      id: `${row.id}-estimate-stall`,
      ticketId: row.id,
      roNumber,
      severity: "medium",
      title: "Stalled estimate build",
      detail: `${roNumber} is old enough in Estimate Build that the day can start slipping if nobody owns the next customer call.`,
      owner: "Advisor"
    });
  }

  if (stage === "Ready to Dispatch" && !dispatchReadiness.ready) {
    flags.push({
      id: `${row.id}-dispatch-gap`,
      ticketId: row.id,
      roNumber,
      severity: "high",
      title: "Approved job not truly ready to dispatch",
      detail: `${roNumber} still has dispatch gaps even though it looks close to production.`,
      owner: "Advisor / Dispatch"
    });
  }

  if (
    ["Ready to Dispatch", "In Service", "QC / Verification", "Technical Signoff"].includes(stage) &&
    !row.technician_name
  ) {
    flags.push({
      id: `${row.id}-tech-mismatch`,
      ticketId: row.id,
      roNumber,
      severity: "critical",
      title: "Technician assignment mismatch",
      detail: `${roNumber} is in an active production stage but technician assignment is missing or unclear.`,
      owner: "Advisor / Management"
    });
  }

  if (stage === "Technical Signoff" && !alerts.some((alert) => alert.alert_type.includes("qc"))) {
    flags.push({
      id: `${row.id}-qc-risk`,
      ticketId: row.id,
      roNumber,
      severity: "medium",
      title: "QC risk needs forced pause",
      detail: `${roNumber} is approaching completion and should get a final touched-area review before closeout.`,
      owner: "QC / Technician"
    });
  }

  if (alerts.some((alert) => `${alert.title} ${alert.detail ?? ""}`.toLowerCase().includes("technician changed"))) {
    flags.push({
      id: `${row.id}-sync-risk`,
      ticketId: row.id,
      roNumber,
      severity: "high",
      title: "Technician reassignment sync risk",
      detail:
        "Approved work may need unapprove, reassign, reapprove, and AutoFlow refresh to avoid a technician sync mismatch.",
      owner: "Management / Advisor"
    });
  }

  if (blocker.toLowerCase().includes("assignment")) {
    flags.push({
      id: `${row.id}-owner-gap`,
      ticketId: row.id,
      roNumber,
      severity: "medium",
      title: "Ownership gap",
      detail: `${roNumber} still needs clear people ownership before the next stage can move cleanly.`,
      owner: "Advisor / Dispatch"
    });
  }

  return flags;
}

function groupByTicket<T>(items: T[], getTicketId: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const ticketId = getTicketId(item);
    const current = map.get(ticketId) ?? [];
    current.push(item);
    map.set(ticketId, current);
  }
  return map;
}

function extractAppointmentDate(summary: string | null | undefined, status: string | null | undefined) {
  const combined = `${summary ?? ""} ${status ?? ""}`;
  const match = combined.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/);
  return match ? new Date(match[1].replace(" ", "T")) : null;
}

function hoursBetween(from: string, to: string) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  return Math.max(0, (end - start) / (1000 * 60 * 60));
}

function isSameCalendarDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatLongDate(value: Date) {
  return value.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDurationHours(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} hr`;
}

function severityRank(severity: ExceptionFlag["severity"]) {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "critical" | "warning" | "good" | "neutral" }) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="empty-card">
      <strong>{title}</strong>
      <p>{body}</p>
    </article>
  );
}

function ActionBucket({ title, tickets }: { title: string; tickets: OperationalTicket[] }) {
  return (
    <article className="action-bucket">
      <strong>{title}</strong>
      {tickets.length > 0 ? (
        <ul>
          {tickets.slice(0, 5).map((ticket) => (
            <li key={`${title}-${ticket.id}`}>
              {ticket.roNumber} - {ticket.nextBestAction}
            </li>
          ))}
        </ul>
      ) : (
        <p>None at the moment.</p>
      )}
    </article>
  );
}

function PriorityCard({ ticket, compact = false }: { ticket: OperationalTicket; compact?: boolean }) {
  return (
    <article className={`priority-card ${compact ? "priority-card-compact" : ""}`}>
      <div className="priority-card-top">
        <div className="priority-pills">
          <span className={`priority-chip priority-${ticket.priority.toLowerCase()}`}>{ticket.priority}</span>
          <span className="score-chip">Score {ticket.priorityScore}</span>
          <span className="stage-chip">{ticket.stage}</span>
        </div>
        <span className="ticket-last">{ticket.stageAgeLabel} in stage</span>
      </div>

      <div className="priority-main">
        <div>
          <h4>{ticket.roNumber}</h4>
          <p className="priority-customer">{ticket.customerName}</p>
          <p className="priority-vehicle">{ticket.vehicleLabel}</p>
        </div>
        <div className="priority-status">
          <span>{ticket.location}</span>
          <span>{ticket.source}</span>
        </div>
      </div>

      <div className="priority-grid">
        <MetricRow label="Current stage" value={ticket.stage} />
        <MetricRow label="Current blocker" value={ticket.blocker} />
        <MetricRow label="Next best action" value={ticket.nextBestAction} />
        <MetricRow label="Next checkpoint" value={ticket.nextCheckpoint} />
        <MetricRow label="Assigned advisor" value={ticket.assignedAdvisor} />
        <MetricRow label="Assigned technician" value={ticket.assignedTechnician} />
        <MetricRow label="Promise time" value={ticket.promiseTime ? formatShortDateTime(ticket.promiseTime) : "No promise logged"} />
        <MetricRow label="Contact status" value={ticket.contactStatus} />
      </div>

      {!compact ? (
        <div className="priority-footer">
          <p><strong>Why this priority:</strong> {ticket.priorityReason}</p>
          <p><strong>Next handoff owner:</strong> {ticket.nextHandoffOwner}</p>
        </div>
      ) : null}
    </article>
  );
}

export default App;
