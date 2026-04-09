import {
  getCodeBlockLanguage,
  isMermaidLanguage,
} from "./milkdownMarkdownDialect";

describe("milkdownMarkdownDialect", () => {
  it("extracts fenced code block languages from class names", () => {
    expect(getCodeBlockLanguage("hljs language-ts")).toBe("ts");
  });

  it("detects Mermaid language fences case-insensitively", () => {
    expect(isMermaidLanguage("Mermaid")).toBe(true);
    expect(isMermaidLanguage("ts")).toBe(false);
  });
});
