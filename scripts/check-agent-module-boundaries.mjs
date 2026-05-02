// Enforces the five agent Module boundaries: cross-module imports must use
// interface files, and concrete module implementations may only be imported by
// the composition root or same-module tests.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const serverRoot = resolve(repoRoot, "apps/server/src");
const agentRoot = resolve(serverRoot, "ai/agent");
const modulesRoot = resolve(agentRoot, "modules");

const modules = new Set([
  "context-core",
  "assistant-turn-engine",
  "provider-runtime",
  "tool-runtime",
  "transport",
]);

const compositionRoots = new Set([resolve(serverRoot, "index.ts")]);
const allowedCrossModuleFiles = new Set([
  "contextCoreInterface.ts",
  "assistantTurnEngineInterface.ts",
  "providerRuntimeInterface.ts",
  "toolRuntimeInterface.ts",
  "agentTransportInterface.ts",
]);

const concreteModuleEntryFiles = new Set([
  resolve(modulesRoot, "context-core/contextCore.ts"),
  resolve(modulesRoot, "assistant-turn-engine/assistantTurnEngine.ts"),
  resolve(modulesRoot, "provider-runtime/providerRuntime.ts"),
  resolve(modulesRoot, "tool-runtime/toolRuntime.ts"),
  resolve(modulesRoot, "transport/wsServer.ts"),
]);

const sourceFiles = [];

const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      sourceFiles.push(path);
    }
  }
};

walk(serverRoot);

const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

const resolveImport = (importer, specifier) => {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base = resolve(importer, "..", specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
  ]) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Candidate does not exist.
    }
  }
  return null;
};

const moduleForPath = (path) => {
  const moduleRelativePath = relative(modulesRoot, path);
  if (moduleRelativePath.startsWith("..")) {
    return null;
  }
  const [moduleName] = moduleRelativePath.split("/");
  return modules.has(moduleName) ? moduleName : null;
};

const isSameModuleTestImport = (importer, target) => {
  return (
    importer.endsWith(".test.ts") &&
    moduleForPath(importer) === moduleForPath(target)
  );
};

const isCompositionRoot = (path) => compositionRoots.has(path);

const relativeToRepo = (path) => relative(repoRoot, path);

const violations = [];

for (const file of sourceFiles) {
  const contents = readFileSync(file, "utf8");
  const importerModule = moduleForPath(file);

  for (const match of contents.matchAll(importPattern)) {
    const specifier = match[1];
    const target = resolveImport(file, specifier);
    if (!target) {
      continue;
    }

    const targetModule = moduleForPath(target);

    if (
      concreteModuleEntryFiles.has(target) &&
      !isCompositionRoot(file) &&
      !isSameModuleTestImport(file, target)
    ) {
      violations.push(
        `${relativeToRepo(file)} imports concrete module implementation ${relativeToRepo(target)}. Import the module interface instead.`,
      );
    }

    if (
      importerModule &&
      targetModule &&
      importerModule !== targetModule &&
      !allowedCrossModuleFiles.has(target.split("/").at(-1))
    ) {
      violations.push(
        `${relativeToRepo(file)} imports across module boundary from ${relativeToRepo(target)}. Cross-module imports must use the target module interface file.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Agent module boundary violations:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Agent module boundaries OK");
