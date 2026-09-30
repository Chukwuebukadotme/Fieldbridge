import { expect, it } from "vitest";

import { parseDictionary, parseRequirements } from "@/lib/inputs";

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
