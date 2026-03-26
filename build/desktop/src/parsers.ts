export interface ParsedBoardTicket {
  roNumber: string;
  location: "Country Club" | "Apache";
  boardColumn: string;
  customerName: string;
  phone: string | null;
  vehicleLabel: string;
  createdAge: string | null;
  amountLabel: string | null;
  paymentLabel: string | null;
  rawAssignees: string[];
}

export interface ParsedSalesInvoice {
  invoiceNumber: string;
  location: "Country Club" | "Apache" | "Unknown";
  date: string | null;
  customerName: string;
  shopName: string | null;
  vehicleLabel: string;
  serviceWriter: string | null;
  labor: string | null;
  parts: string | null;
  sublet: string | null;
  fees: string | null;
  discounts: string | null;
  taxCollected: string | null;
  totalSales: string | null;
  refund: boolean;
}

export interface ParsedWorkflowRow {
  rowNumber: number;
  customerName: string;
  vehicleName: string;
  status: string;
  invoiceNumber: string | null;
  location: "Country Club" | "Apache" | "Unknown";
  serviceWriter: string | null;
  techs: string | null;
  etc: string | null;
  usedAutoUpdate: boolean | null;
  totalElapsedTime: string | null;
}

export interface ParsedImportResult {
  parser: string;
  summary: string;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export type ImportKind =
  | "tekmetric_job_board"
  | "tekmetric_sales_details"
  | "autoflow_workflow_report";

export function parseImportText(kind: ImportKind, input: string): ParsedImportResult {
  switch (kind) {
    case "tekmetric_job_board":
      return parseTekmetricJobBoard(input);
    case "tekmetric_sales_details":
      return parseTekmetricSalesDetails(input);
    case "autoflow_workflow_report":
      return parseAutoflowWorkflowReport(input);
  }
}

export function parseTekmetricJobBoard(input: string): ParsedImportResult {
  const lines = normalizeLines(input);
  const sections = ["Estimates", "Work-In-Progress", "Completed"];
  const rows: ParsedBoardTicket[] = [];
  let currentColumn = "Unknown";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (sections.includes(line)) {
      currentColumn = line;
      continue;
    }

    if (!line.startsWith("RO#")) {
      continue;
    }

    const entryLines: string[] = [line];
    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor].startsWith("RO#") && !sections.includes(lines[cursor])) {
      entryLines.push(lines[cursor]);
      cursor += 1;
    }
    index = cursor - 1;
    rows.push(parseTekmetricBoardEntry(entryLines, currentColumn));
  }

  return {
    parser: "tekmetric_job_board",
    summary: `Parsed ${rows.length} board rows from Tekmetric job board text.`,
    rows: toPlainRows(rows)
  };
}

export function parseTekmetricSalesDetails(input: string): ParsedImportResult {
  const lines = normalizeLines(input);
  const rows: ParsedSalesInvoice[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#")) {
      continue;
    }

    const invoiceNumber = line.replace("#", "").trim();
    const entryLines: string[] = [line];
    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor].startsWith("#")) {
      entryLines.push(lines[cursor]);
      cursor += 1;
    }
    index = cursor - 1;
    rows.push(parseSalesEntry(invoiceNumber, entryLines));
  }

  return {
    parser: "tekmetric_sales_details",
    summary: `Parsed ${rows.length} invoice rows from Tekmetric sales details text.`,
    rows: toPlainRows(rows)
  };
}

export function parseAutoflowWorkflowReport(input: string): ParsedImportResult {
  const lines = normalizeLines(input);
  const rows: ParsedWorkflowRow[] = [];

  for (const line of lines) {
    const match = line.match(
      /^(\d+)\t(.+?)\t(.+?)\t(?:.+?)?\t(.+?)\t(\d{4,5})?\t(.*?)\t(.*?)\t.*?\t(Yes|No)?\t.*?\t(.+)$/
    );

    if (!match) {
      continue;
    }

    const invoiceNumber = match[5] || null;
    rows.push({
      rowNumber: Number(match[1]),
      customerName: cleanupField(match[2]),
      vehicleName: cleanupField(match[3]),
      status: cleanupField(match[4]),
      invoiceNumber,
      location: inferLocationFromInvoice(invoiceNumber),
      serviceWriter: cleanupNullableField(match[6]),
      techs: cleanupNullableField(match[7]),
      etc: extractEtcFromWorkflowLine(line),
      usedAutoUpdate: line.includes("\tYes\t") ? true : line.includes("\tNo\t") ? false : null,
      totalElapsedTime: extractElapsedTime(line)
    });
  }

  return {
    parser: "autoflow_workflow_report",
    summary: `Parsed ${rows.length} workflow rows from AutoFlow workflow report text.`,
    rows: toPlainRows(rows)
  };
}

function toPlainRows<T extends object>(rows: T[]): Array<Record<string, string | number | boolean | null>> {
  return rows.map((row) => {
    const plain: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(row)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        plain[key] = value;
      } else if (Array.isArray(value)) {
        plain[key] = value.join(", ");
      } else {
        plain[key] = String(value);
      }
    }
    return plain;
  });
}

function parseTekmetricBoardEntry(entryLines: string[], boardColumn: string): ParsedBoardTicket {
  const roNumber = entryLines[0].trim();
  const createdAge = entryLines.find((line) => line.startsWith("Created")) ?? null;
  const phone = entryLines.find((line) => /\(\d{3}\)/.test(line)) ?? null;
  const amountLine = [...entryLines].reverse().find((line) => line.startsWith("$")) ?? null;
  const paymentLabel = entryLines.find((line) => line === "Paid" || line === "Partially Paid" || line === "Balance Due") ?? null;
  const assigneeLines = entryLines.filter((line) => /^[A-Z]{2}$/.test(line));
  const customerLineIndex = entryLines.findIndex((line) => line === "•");
  const customerName =
    customerLineIndex > 0 ? entryLines[customerLineIndex - 1] : firstMeaningfulName(entryLines.slice(1));
  const vehicleLabel = phone
    ? entryLines[entryLines.indexOf(phone) + 1] ?? "Unknown vehicle"
    : fallbackVehicleLine(entryLines);

  return {
    roNumber,
    location: inferLocationFromRo(roNumber),
    boardColumn,
    customerName,
    phone,
    vehicleLabel,
    createdAge,
    amountLabel: amountLine,
    paymentLabel,
    rawAssignees: assigneeLines
  };
}

function parseSalesEntry(invoiceNumber: string, entryLines: string[]): ParsedSalesInvoice {
  const date = entryLines.find((line) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) ?? null;
  const refund = entryLines.some((line) => line.includes("Refund Invoice"));
  const customerShopLine = entryLines.find((line) => line.includes(" - ")) ?? "";
  const [customerName, shopName] = customerShopLine
    .split(" - ")
    .map((value) => value.trim())
    .slice(0, 2);
  const vehicleLabel = nextNonNumericLine(entryLines, customerShopLine);
  const moneyLines = entryLines.filter((line) => /^-?\$[\d,]+\.\d{2}$/.test(line));

  return {
    invoiceNumber,
    location: inferLocationFromInvoice(invoiceNumber),
    date,
    customerName: customerName || "Unknown customer",
    shopName: shopName || null,
    vehicleLabel,
    serviceWriter: findServiceWriter(entryLines),
    labor: moneyLines[0] ?? null,
    parts: moneyLines[1] ?? null,
    sublet: moneyLines[2] ?? null,
    fees: moneyLines[3] ?? null,
    discounts: moneyLines[4] ?? null,
    taxCollected: moneyLines[5] ?? null,
    totalSales: moneyLines[6] ?? null,
    refund
  };
}

function inferLocationFromRo(roNumber: string): "Country Club" | "Apache" {
  const digits = roNumber.replace(/\D/g, "");
  return digits.length === 4 ? "Apache" : "Country Club";
}

function inferLocationFromInvoice(invoiceNumber: string | null): "Country Club" | "Apache" | "Unknown" {
  if (!invoiceNumber) {
    return "Unknown";
  }

  const digits = invoiceNumber.replace(/\D/g, "");
  if (digits.length === 4) {
    return "Apache";
  }
  if (digits.length === 5) {
    return "Country Club";
  }
  return "Unknown";
}

function normalizeLines(input: string): string[] {
  return input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstMeaningfulName(lines: string[]): string {
  const candidate = lines.find(
    (line) =>
      !line.startsWith("Created") &&
      !line.startsWith("$") &&
      !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(line) &&
      !/^[A-Z]{1,2}$/.test(line)
  );
  return candidate ?? "Unknown customer";
}

function fallbackVehicleLine(lines: string[]): string {
  const candidate = lines.find((line) => /^\d{4}\s/.test(line));
  return candidate ?? "Unknown vehicle";
}

function cleanupField(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanupNullableField(value: string): string | null {
  const cleaned = cleanupField(value);
  return cleaned && cleaned !== "N/A" ? cleaned : null;
}

function extractEtcFromWorkflowLine(line: string): string | null {
  const match = line.match(/(\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}\s(?:am|pm))/i);
  return match ? match[1] : null;
}

function extractElapsedTime(line: string): string | null {
  const match = line.match(/(\d+\sday\(s\)\s\d+\shour\(s\)\s\d+\smin\(s\)|\d+\shour\(s\)\s\d+\smin\(s\)|\d+\smin\(s\))$/i);
  return match ? match[1] : null;
}

function nextNonNumericLine(lines: string[], afterLine: string): string {
  const index = lines.indexOf(afterLine);
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!/^[$#-]/.test(line) && !/\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) {
      return line;
    }
  }
  return "Unknown vehicle";
}

function findServiceWriter(lines: string[]): string | null {
  return (
    lines.find(
      (line) =>
        !line.includes(" - ") &&
        !/\d{1,2}\/\d{1,2}\/\d{4}/.test(line) &&
        !/^[$#-]/.test(line) &&
        !/^\d{4}\s/.test(line) &&
        /[A-Za-z]/.test(line)
    ) ?? null
  );
}
