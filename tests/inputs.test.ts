import { expect, it } from "vitest";

import { parseDictionary, parseRequirements, rejectedFile } from "@/lib/inputs";

import { demoFile } from "./helpers";

const bytes = (text: string) => new TextEncoder().encode(text);

it.each([
  [bytes(""), "empty"],
  [new Uint8Array([0xff, 0xfe, 0x00, 0x62]), "UTF-8"],
  [bytes("name,type\nincome,number\n"), "Missing required column"],
  [bytes('field_name,data_type\n"unterminated,number\n'), "could not be parsed"],
])("fails a malformed dictionary with a message instead of crashing (%#)", (raw, message) => {
  const result = parseDictionary("bad.csv", raw);
  expect(result.ok).toBe(false);
  expect(result.error).toContain(message);
});

it("falls back to line identifiers when requirements have none", () => {
  const result = parseRequirements("notes.txt", bytes("Income must be monthly.\n\nAge is needed.\n"));
  expect(result.ok).toBe(true);
  expect(result.requirements.map((r) => r.id)).toEqual(["P1", "P2"]);
  expect(result.warnings.length).toBeGreaterThan(0);
});

it("passes every upload check for the demo files", () => {
  const req = parseRequirements("demo_requirements.txt", demoFile("demo_requirements.txt"), "demo");
  const dict = parseDictionary("demo_data_dictionary.csv", demoFile("demo_data_dictionary.csv"), "demo");
  expect(req.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass"]);
  expect(req.checks[1].detail).toBe("R1, R2, R3 on lines 1, 3, 5");
  expect(dict.checks.every((c) => c.status === "pass")).toBe(true);
  expect(dict.checks.map((c) => c.label)).toContain("Sample values present");
  expect(dict.size).toBeGreaterThan(0);
});

it("warns about unknown data types, missing samples and missing optional columns", () => {
  const dict = parseDictionary("odd.csv", bytes("field_name,data_type\namount,decimal\nage,integer\n"));
  expect(dict.ok).toBe(true);
  const status = Object.fromEntries(dict.checks.map((c) => [c.label, c.status]));
  expect(status["Optional columns present"]).toBe("warn");
  expect(status["Data types recognised"]).toBe("warn");
  expect(status["Sample values present"]).toBe("warn");
  expect(dict.checks.find((c) => c.label === "Data types recognised")!.detail).toContain("amount (decimal)");
});

it("records the failing check for a malformed or refused file", () => {
  const bad = parseDictionary("bad.csv", bytes("name,type\nincome,number\n"));
  expect(bad.checks.at(-1)).toMatchObject({ label: "Required columns present", status: "fail" });
  const refused = rejectedFile("big.csv", "dictionary", 2_000_000, "Within size limit", "The file is larger than 1 MB.");
  expect(refused.ok).toBe(false);
  expect(refused.checks).toEqual([{ label: "Within size limit", status: "fail", detail: "The file is larger than 1 MB." }]);
});
