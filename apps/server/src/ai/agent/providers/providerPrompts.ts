import { readFileSync } from "node:fs";

import { maxThreadTitleLength } from "@magick/shared/threadTitle";

const loadProviderPrompt = (fileName: string): string => {
  return readFileSync(
    new URL(`./prompts/${fileName}`, import.meta.url),
    "utf8",
  ).trim();
};

export const DEFAULT_ASSISTANT_INSTRUCTIONS = loadProviderPrompt(
  "default_assistant_instructions.txt",
);

export const DEFAULT_THREAD_TITLE_INSTRUCTIONS = `Generate a concise chat title from the user's first message. Return only the title text with no quotes, markdown, prefix, or explanation. Keep it under ${maxThreadTitleLength} characters.`;
