import { readFileSync } from "node:fs";

import { generateMappings } from "@/lib/engine";
import { parseDictionary, parseRequirements } from "@/lib/inputs";
import { TARGET_FIELDS } from "@/lib/models";
import { buildWorkspace } from "@/lib/review";

export const demoFile = (name: string) => readFileSync(new URL(`../public/demo/${name}`, import.meta.url));

export function demoFiles() {
  return {
    req: parseRequirements("demo_requirements.txt", demoFile("demo_requirements.txt"), "demo"),
    dictionary: parseDictionary("demo_data_dictionary.csv", demoFile("demo_data_dictionary.csv"), "demo"),
  };
}

export async function demoWorkspace() {
  const { req, dictionary } = demoFiles();
  const result = await generateMappings(null, req.text, dictionary.fields, TARGET_FIELDS);
  return buildWorkspace(req, dictionary, TARGET_FIELDS, result);
}
