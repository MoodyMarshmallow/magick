import { readFileSync } from "node:fs";

export const loadToolDescription = (fileName: string): string => {
  return readFileSync(
    new URL(`./descriptions/${fileName}`, import.meta.url),
    "utf8",
  ).trim();
};
