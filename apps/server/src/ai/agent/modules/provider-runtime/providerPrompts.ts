import { readFileSync } from "node:fs";

const loadProviderPrompt = (fileName: string): string => {
  return readFileSync(
    new URL(`./prompts/${fileName}`, import.meta.url),
    "utf8",
  ).trim();
};

export const DEFAULT_ASSISTANT_INSTRUCTIONS = loadProviderPrompt(
  "default_assistant_instructions.txt",
);
