/** Parsing of the two supported inputs: a plain-text requirements document and a CSV data dictionary. */

import Papa from "papaparse";

import type { DictionaryField, Requirement } from "./models";

const REQUIRED_COLUMNS = ["field_name", "data_type"] as const;
const OPTIONAL_COLUMNS = ["description", "unit", "sample_value"] as const;
const REQUIREMENT_LINE = /^\s*([A-Z]{1,4}-?\d+)\s*[:.)\-–]\s*(\S.*?)\s*$/;
export const KNOWN_DATA_TYPES = ["number", "integer", "string", "date", "datetime", "boolean"] as const;
export const DICTIONARY_COLUMNS = { required: REQUIRED_COLUMNS, optional: OPTIONAL_COLUMNS };

/** One deterministic upload check, shown as a checklist row on the file card. */
export interface FileCheck {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface LoadedFile {
  name: string;
  kind: "requirements" | "dictionary";
  fileType: string;
  origin: "demo" | "upload";
  ok: boolean;
  count: number;
  size: number; // bytes
  error: string | null;
  checks: FileCheck[];
  warnings: string[];
  text: string;
  requirements: Requirement[];
  fields: DictionaryField[];
}

type Raw = ArrayBuffer | Uint8Array | string;

function byteLength(raw: Raw): number {
  return typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.byteLength;
}

const list = (items: string[]) => items.join(", ");

function emptyResult(name: string, kind: LoadedFile["kind"], origin: LoadedFile["origin"], raw: Raw = ""): LoadedFile {
  return {
    name,
    kind,
    fileType: kind === "requirements" ? "Plain text (.txt)" : "CSV (.csv)",
    origin,
    ok: false,
    count: 0,
    size: byteLength(raw),
    error: null,
    checks: [],
    warnings: [],
    text: "",
    requirements: [],
    fields: [],
  };
}

/** Strict UTF-8 decode (BOM stripped) with normalised line endings. Returns null for invalid bytes. */
function decode(raw: Raw): string | null {
  let text: string;
  if (typeof raw === "string") {
    text = raw.replace(/^﻿/, "");
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      return null;
    }
  }
  return text.replace(/\r\n?/g, "\n");
}

export function parseRequirements(name: string, raw: Raw, origin: LoadedFile["origin"] = "upload"): LoadedFile {
  const result = emptyResult(name, "requirements", origin, raw);
  const text = decode(raw);
  if (text === null) return failed(result, "Readable UTF-8 text", "The file is not valid UTF-8 text.");
  if (!text.trim()) return failed(result, "Readable UTF-8 text", "The file is empty.");
  result.checks.push({ label: "Readable UTF-8 text", status: "pass", detail: `${text.split("\n").length} lines` });

  const lines = text.split("\n");
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  lines.forEach((line, index) => {
    const match = REQUIREMENT_LINE.exec(line);
    if (!match) return;
    const [, id, body] = match;
    if (seen.has(id)) {
      duplicates.push(id);
      result.warnings.push(`Duplicate requirement identifier ${id} on line ${index + 1}; first kept.`);
      return;
    }
    seen.add(id);
    requirements.push({ id, text: body, line: index + 1 });
  });

  if (requirements.length) {
    result.checks.push({
      label: "Requirement identifiers found",
      status: "pass",
      detail: `${list(requirements.map((r) => r.id))} on lines ${list(requirements.map((r) => String(r.line)))}`,
    });
  } else {
    // Fall back to one requirement per non-empty line so evidence can still be quoted.
    lines.forEach((line, index) => {
      if (line.trim()) requirements.push({ id: `P${requirements.length + 1}`, text: line.trim(), line: index + 1 });
    });
    result.warnings.push("No 'R1:'-style identifiers found; each non-empty line was treated as a requirement (P1, P2, …).");
    result.checks.push({
      label: "Requirement identifiers found",
      status: "warn",
      detail: "No “R1:”-style identifiers, so each line was numbered P1, P2, …",
    });
  }
  result.checks.push(
    duplicates.length
      ? { label: "Identifiers are unique", status: "warn", detail: `Repeated: ${list([...new Set(duplicates)])}. The first of each was kept.` }
      : { label: "Identifiers are unique", status: "pass", detail: "No repeats" },
  );

  return { ...result, ok: true, text, requirements, count: requirements.length };
}

export function parseDictionary(name: string, raw: Raw, origin: LoadedFile["origin"] = "upload"): LoadedFile {
  const result = emptyResult(name, "dictionary", origin, raw);
  const text = decode(raw);
  if (text === null) return failed(result, "Readable UTF-8 CSV", "The file is not valid UTF-8 text.");
  if (!text.trim()) return failed(result, "Readable UTF-8 CSV", "The file is empty.");

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const quoteError = parsed.errors.find((e) => e.type === "Quotes");
  if (quoteError) {
    return failed(result, "Readable UTF-8 CSV", `The CSV could not be parsed: ${quoteError.message} (row ${(quoteError.row ?? 0) + 2}).`);
  }
  const mismatched = parsed.errors.filter((e) => e.type === "FieldMismatch");
  for (const e of mismatched) result.warnings.push(`Row ${(e.row ?? 0) + 2}: ${e.message}.`);
  result.checks.push(
    mismatched.length
      ? { label: "Readable UTF-8 CSV", status: "warn", detail: `${mismatched.length} row(s) have the wrong number of columns` }
      : { label: "Readable UTF-8 CSV", status: "pass", detail: `${parsed.data.length} data rows` },
  );

  const columns = parsed.meta.fields ?? [];
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) {
    return failed(
      result,
      "Required columns present",
      `Missing required column(s): ${missing.join(", ")}. Expected: ${[...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(", ")}.`,
      `Missing: ${list([...missing])}`,
    );
  }
  result.checks.push({ label: "Required columns present", status: "pass", detail: list([...REQUIRED_COLUMNS]) });
  const missingOptional = OPTIONAL_COLUMNS.filter((c) => !columns.includes(c));
  for (const column of missingOptional) result.warnings.push(`Column '${column}' not found; treated as blank.`);
  result.checks.push(
    missingOptional.length
      ? { label: "Optional columns present", status: "warn", detail: `Missing: ${list([...missingOptional])} (treated as blank)` }
      : { label: "Optional columns present", status: "pass", detail: list([...OPTIONAL_COLUMNS]) },
  );

  const fields: DictionaryField[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  parsed.data.forEach((row, index) => {
    const rowNo = index + 2;
    const cell = (key: string) => String(row[key] ?? "").trim();
    const fieldName = cell("field_name");
    if (!fieldName) {
      result.warnings.push(`Row ${rowNo} has no field_name and was skipped.`);
      return;
    }
    if (seen.has(fieldName)) {
      duplicates.push(fieldName);
      result.warnings.push(`Duplicate field '${fieldName}' on row ${rowNo}; first kept.`);
      return;
    }
    seen.add(fieldName);
    fields.push({
      field_name: fieldName,
      data_type: cell("data_type").toLowerCase(),
      description: cell("description"),
      unit: cell("unit"),
      sample_value: cell("sample_value"),
    });
  });

  if (!fields.length) return failed(result, "Field records found", "The dictionary contains no field records.", "No rows with a field_name");
  result.checks.push(
    duplicates.length
      ? { label: "Field names are unique", status: "warn", detail: `Repeated: ${list([...new Set(duplicates)])}. The first of each was kept.` }
      : { label: "Field names are unique", status: "pass", detail: `${fields.length} fields` },
  );
  const unknownTypes = fields.filter((f) => !(KNOWN_DATA_TYPES as readonly string[]).includes(f.data_type));
  result.checks.push(
    unknownTypes.length
      ? {
          label: "Data types recognised",
          status: "warn",
          detail: `Unrecognised: ${list(unknownTypes.map((f) => `${f.field_name} (${f.data_type || "blank"})`))}. Type checks will block these.`,
        }
      : { label: "Data types recognised", status: "pass", detail: list([...new Set(fields.map((f) => f.data_type))]) },
  );
  const noSample = fields.filter((f) => !f.sample_value);
  result.checks.push(
    noSample.length
      ? { label: "Sample values present", status: "warn", detail: `Missing for ${list(noSample.map((f) => f.field_name))}. Previews can't run for these.` }
      : { label: "Sample values present", status: "pass", detail: `${fields.length} of ${fields.length} fields` },
  );
  return { ...result, ok: true, text, fields, count: fields.length };
}

/** Record a failing check and stop: later checks depend on this one passing. */
function failed(result: LoadedFile, label: string, error: string, detail = error): LoadedFile {
  return { ...result, ok: false, error, checks: [...result.checks, { label, status: "fail", detail }] };
}

/** A file refused before parsing (wrong extension or too large). */
export function rejectedFile(name: string, kind: LoadedFile["kind"], size: number, label: string, error: string): LoadedFile {
  return { ...emptyResult(name, kind, "upload"), size, error, checks: [{ label, status: "fail", detail: error }] };
}
