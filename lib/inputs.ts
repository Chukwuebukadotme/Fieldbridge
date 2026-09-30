/** Parsing of the two supported inputs: a plain-text requirements document and a CSV data dictionary. */

import Papa from "papaparse";

import type { DictionaryField, Requirement } from "./models";

const REQUIRED_COLUMNS = ["field_name", "data_type"] as const;
const OPTIONAL_COLUMNS = ["description", "unit", "sample_value"] as const;
const REQUIREMENT_LINE = /^\s*([A-Z]{1,4}-?\d+)\s*[:.)\-–]\s*(\S.*?)\s*$/;

export interface LoadedFile {
  name: string;
  kind: "requirements" | "dictionary";
  fileType: string;
  origin: "demo" | "upload";
  ok: boolean;
  count: number;
  error: string | null;
  warnings: string[];
  text: string;
  requirements: Requirement[];
  fields: DictionaryField[];
}

type Raw = ArrayBuffer | Uint8Array | string;

function emptyResult(name: string, kind: LoadedFile["kind"], origin: LoadedFile["origin"]): LoadedFile {
  return {
    name,
    kind,
    fileType: kind === "requirements" ? "Plain text (.txt)" : "CSV (.csv)",
    origin,
    ok: false,
    count: 0,
    error: null,
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
  const result = emptyResult(name, "requirements", origin);
  const text = decode(raw);
  if (text === null) return { ...result, error: "The file is not valid UTF-8 text." };
  if (!text.trim()) return { ...result, error: "The file is empty." };

  const lines = text.split("\n");
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const match = REQUIREMENT_LINE.exec(line);
    if (!match) return;
    const [, id, body] = match;
    if (seen.has(id)) {
      result.warnings.push(`Duplicate requirement identifier ${id} on line ${index + 1}; first kept.`);
      return;
    }
    seen.add(id);
    requirements.push({ id, text: body, line: index + 1 });
  });

  if (!requirements.length) {
    // Fall back to one requirement per non-empty line so evidence can still be quoted.
    lines.forEach((line, index) => {
      if (line.trim()) requirements.push({ id: `P${requirements.length + 1}`, text: line.trim(), line: index + 1 });
    });
    result.warnings.push("No 'R1:'-style identifiers found; each non-empty line was treated as a requirement (P1, P2, …).");
  }

  return { ...result, ok: true, text, requirements, count: requirements.length };
}

export function parseDictionary(name: string, raw: Raw, origin: LoadedFile["origin"] = "upload"): LoadedFile {
  const result = emptyResult(name, "dictionary", origin);
  const text = decode(raw);
  if (text === null) return { ...result, error: "The file is not valid UTF-8 text." };
  if (!text.trim()) return { ...result, error: "The file is empty." };

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const quoteError = parsed.errors.find((e) => e.type === "Quotes");
  if (quoteError) {
    return { ...result, error: `The CSV could not be parsed: ${quoteError.message} (row ${(quoteError.row ?? 0) + 2}).` };
  }
  for (const e of parsed.errors.filter((e) => e.type === "FieldMismatch")) {
    result.warnings.push(`Row ${(e.row ?? 0) + 2}: ${e.message}.`);
  }

  const columns = parsed.meta.fields ?? [];
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) {
    return {
      ...result,
      error: `Missing required column(s): ${missing.join(", ")}. Expected: ${[...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(", ")}.`,
    };
  }
  for (const column of OPTIONAL_COLUMNS) {
    if (!columns.includes(column)) result.warnings.push(`Column '${column}' not found; treated as blank.`);
  }

  const fields: DictionaryField[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((row, index) => {
    const rowNo = index + 2;
    const cell = (key: string) => String(row[key] ?? "").trim();
    const fieldName = cell("field_name");
    if (!fieldName) {
      result.warnings.push(`Row ${rowNo} has no field_name and was skipped.`);
      return;
    }
    if (seen.has(fieldName)) {
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

  if (!fields.length) return { ...result, error: "The dictionary contains no field records." };
  return { ...result, ok: true, text, fields, count: fields.length };
}
