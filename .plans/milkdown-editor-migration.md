## Summary

Migrate the workspace editor from the current TipTap-plus-custom-Markdown-conversion approach to a Milkdown-based Markdown-first WYSIWYG editor. The new editor should treat Markdown as the canonical document format, render and edit that Markdown through a ProseMirror-based WYSIWYG surface, and preserve broad Markdown compatibility including CommonMark, GitHub Flavored Markdown features, LaTeX math, and Mermaid diagram rendering.

## Motivation

The current editor stack is split across two different concerns that are not aligned:

- `EditorSurface` uses TipTap as a rich-text editor surface.
- `RenderedMarkdown` uses a separate Markdown rendering pipeline for read-only display.
- `commentAnchors.ts` currently owns custom Markdown import and export logic between the editor and stored Markdown.

That split creates three long-term problems:

- The editor is not naturally Markdown-native. It requires custom conversion logic at every boundary.
- Round-tripping is fragile. As soon as the supported syntax grows beyond plain paragraphs and basic formatting, the custom serializer and parser become difficult to trust.
- The read-only renderer and the editing renderer can drift apart, producing different interpretations of the same Markdown.

Milkdown is a better architectural fit because it is explicitly designed for Markdown-first WYSIWYG editing on top of ProseMirror. It gives Magick a richer foundation for keeping Markdown as the source of truth while still presenting a direct-manipulation editor surface.

## Scope

This plan covers:

- `apps/web` editor architecture changes needed to replace TipTap with Milkdown in the workspace editor
- Markdown parsing and serialization strategy for stored document content
- feature coverage for major Markdown structures, LaTeX math, and Mermaid diagrams
- integration with Magick's existing workspace state, file save flow, and UI toolbar model
- testing and validation required to trust round-trip editing behavior

This plan does not cover:

- collaborative editing
- comments or anchors inside the document body unless they are required to preserve current editor behavior
- server-side Markdown rendering changes outside the editor surface
- desktop file I/O changes unrelated to editor integration

## Proposed Changes

### Architecture goals

- Markdown should remain the canonical persisted format for workspace documents.
- The editor should render directly from Markdown and serialize directly back to Markdown without ad hoc HTML shims.
- The read-only renderer and the editor should share one clearly defined Markdown dialect.
- The editor feature set should be driven by the Markdown dialect Magick commits to support, not by whatever happens to be easy to bolt onto the current TipTap surface.
- Unsupported syntax should degrade predictably rather than being silently dropped or corrupted.

### Define the canonical Markdown dialect first

- Before implementation begins, document the exact Markdown contract Magick will treat as first-class.
- The recommended initial contract is:
  - CommonMark base semantics
  - GitHub Flavored Markdown features: tables, task lists, autolinks, strikethrough, fenced code blocks
  - inline math with `$...$`
  - block math with `$$...$$`
  - Mermaid fenced code blocks, with ` ```mermaid ` preserved as the canonical source form
  - syntax-highlighted fenced code blocks with language identifiers preserved
- Explicitly defer unsupported or ambiguous dialect features such as MDX, Obsidian embeds, wiki-links, or arbitrary Markdown-it plugin syntax unless product requirements demand them.
- Write the dialect down in code comments or a short docs file so renderer behavior, tests, and UX choices stay aligned.

### Replace TipTap with a Milkdown editor boundary

- Remove `EditorSurface`'s dependency on `@tiptap/react` and `@tiptap/starter-kit`.
- Introduce a new Milkdown-backed editor surface component that owns:
  - editor creation and destruction
  - Markdown input hydration
  - Markdown output change notifications
  - selection and formatting state projection for the workspace toolbar
- Preserve the external component contract where possible so the rest of the workspace shell does not need to be rewritten all at once.
- The current `EditorSurface` public responsibilities that should remain intact are:
  - receive `markdown`
  - call `onMarkdownChange(markdown)`
  - call `onSelectionChange(...)`
  - call `onFormatStateChange(...)`
  - expose imperative toolbar commands through a ref or a replacement command bridge

### Introduce a dedicated Milkdown integration module

- Do not scatter Milkdown setup directly inside the React component body.
- Add a focused integration layer under `apps/web/src/features/document/editor/` to own:
  - editor creation
  - plugin and preset registration
  - command wiring
  - schema and parser configuration
  - selection and active-format extraction
- Suggested module layout:
  - `apps/web/src/features/document/editor/milkdownEditor.ts`
  - `apps/web/src/features/document/editor/milkdownSchema.ts`
  - `apps/web/src/features/document/editor/milkdownCommands.ts`
  - `apps/web/src/features/document/editor/milkdownFormatState.ts`
  - `apps/web/src/features/document/editor/milkdownMarkdownDialect.ts`
- Keep this boundary narrow so future editor changes do not leak Milkdown implementation details throughout the app.

### Replace the custom Markdown conversion utilities

- Retire the current custom import and export logic in `commentAnchors.ts` for the editor path.
- Replace it with Milkdown's Markdown parser and serializer pipeline so the editor no longer relies on handcrafted Markdown-to-HTML and JSON-to-Markdown transforms.
- Preserve only any utility logic that is independent from the editor engine itself.
- If comment-anchor-specific logic still matters later, reintroduce it as explicit Markdown extensions or editor plugins rather than embedding it inside a generic serializer.

### Align read-only rendering and edit rendering

- `RenderedMarkdown` and the Milkdown editor should use the same dialect assumptions.
- Audit the existing read-only Markdown renderer and make sure its behavior matches the editor for:
  - headings
  - lists
  - task lists
  - tables
  - blockquotes
  - inline code and fenced code blocks
  - links
  - math
- If the read-only pipeline and Milkdown parse the same source differently, decide which one is authoritative and close the gap intentionally.
- The likely direction is to keep `RenderedMarkdown` as the presentation renderer while ensuring its remark and rehype plugins mirror the Milkdown-supported syntax contract.

### Support LaTeX explicitly instead of incidentally

- Math should be a first-class supported feature rather than a rendering afterthought.
- The editor must preserve inline `$...$` and block `$$...$$` math without escaping or flattening them incorrectly.
- The WYSIWYG experience for math should be decided explicitly:
  - either edit raw math delimiters in place with rendered preview nearby
  - or use a node or mark view that renders KaTeX while preserving the original source
- Prefer the option that keeps Markdown round-tripping simplest and most debuggable.
- Validation must include editing, saving, reopening, and re-rendering math content without syntax corruption.

### Support Mermaid as a first-class diagram format

- Mermaid should be treated as part of the canonical Markdown authoring contract, not as a generic code-block enhancement.
- The canonical stored representation should remain fenced Markdown code blocks with the `mermaid` language identifier.
- The editor should support a clear editing experience for Mermaid blocks:
  - preserve the raw Mermaid source exactly enough for reliable round-tripping
  - render a visual preview when feasible
  - degrade safely to editable source if Mermaid rendering fails
- The implementation should explicitly choose between:
  - source-first editing with adjacent rendered preview
  - a custom Milkdown node view that renders Mermaid while still exposing editable source
- Prefer the option that keeps source fidelity and failure handling easiest to understand.
- Mermaid rendering failures must be visible and non-destructive. An invalid diagram should not erase or rewrite the source block.
- Read-only markdown rendering and editor rendering must agree on how Mermaid blocks are detected and rendered.

### Rebuild the toolbar and format-state bridge on Milkdown commands

- The current editor toolbar logic assumes TipTap command names and active-state checks.
- Replace that with a Milkdown command bridge that maps Magick UI actions to Milkdown commands.
- Existing UI behaviors that should continue to work:
  - set paragraph
  - toggle heading levels
  - toggle bullet and ordered lists
  - toggle blockquote
  - toggle bold, italic, strike, and inline code
- If Milkdown supports a different command model, keep the adaptation local to the editor integration layer so the workspace toolbar does not become editor-engine-specific.

### Preserve workspace save semantics

- The editor migration should not change the file ownership model or save timing unexpectedly.
- The editor should continue to emit canonical Markdown strings into the existing workspace save flow.
- Existing save and draft behavior should be retested with the new editor because WYSIWYG editors often emit frequent updates or normalize whitespace differently.
- Explicitly decide whether the editor should preserve trailing newlines, fence spacing, and list indentation exactly or allow normalized output. The rule must be stable and tested.

### Add a phased migration path instead of a flag day rewrite

- Phase 1: define the Markdown dialect and build a Milkdown spike component in isolation
  - prove Markdown load, edit, save, and basic toolbar commands
  - prove math and fenced code blocks round-trip correctly
- Phase 2: add a compatibility wrapper that matches the current `EditorSurface` API
  - swap the workspace editor over without rewriting surrounding workspace components
- Phase 3: port the formatting toolbar, selection state, and any keyboard shortcut expectations
- Phase 4: remove TipTap dependencies and delete obsolete conversion utilities
- Phase 5: harden behavior with regression tests and Playwright verification for real editing flows

### Suggested implementation steps

- Add Milkdown dependencies and any required presets or plugins for the chosen Markdown dialect.
- Build a standalone prototype under `apps/web/src/features/document/editor/` that accepts Markdown input and emits Markdown output.
- Verify the prototype covers the minimum syntax set before integrating it into the workspace shell.
- Replace the current `EditorSurface` implementation with the Milkdown wrapper while preserving its external props and imperative control surface as much as possible.
- Update `WorkspaceSurface` and any toolbar consumers only where the adapter boundary requires it.
- Remove no-longer-needed TipTap packages, custom Markdown conversion glue, and editor-specific tests that only validate the old shim behavior.

### Suggested test matrix

- Markdown load and render:
- headings
- nested lists
- tables
- task lists
- blockquotes
- inline code
- fenced code blocks with languages
- inline math
- block math
- Mermaid fenced diagrams
- Round-trip fidelity:
  - Markdown -> editor -> Markdown for each supported syntax area
  - repeated open, edit, save, reopen cycles
  - mixed documents containing prose, code, math, and Mermaid together
- Editing behavior:
  - toolbar formatting actions
  - keyboard shortcuts where supported
  - cursor movement through code and math regions
  - deleting or splitting blocks around complex nodes
- Integration behavior:
  - opening a file from the workspace tree
  - editing and saving it
  - reopening the file and confirming preserved content
  - rendering the saved Markdown in any read-only view consistently

## Risks

- Milkdown is a better Markdown-first fit, but it is still a substantial editor-engine migration. The workspace editor, toolbar state, and tests will all need adjustment.
- If the Markdown dialect is not explicitly constrained, the migration can turn into an open-ended attempt to support every flavor of Markdown, which is not realistic.
- LaTeX support may require deliberate node or plugin decisions rather than assuming a default preset will behave exactly how Magick wants.
- Mermaid rendering introduces an additional source-versus-preview tradeoff. A visually rich diagram block can still become a poor authoring experience if raw source editing is obscured or if render failures are hard to debug.
- WYSIWYG normalization can change source formatting even when semantic meaning is preserved. If Magick needs stable source formatting, that expectation must be defined early.
- The read-only renderer and Milkdown may still diverge subtly unless they are validated against the same syntax examples and fixtures.
- Copy-paste behavior from external sources can introduce HTML structures that do not serialize back to the desired Markdown cleanly unless paste handling is bounded.

## Validation

- Unit tests should cover the Milkdown adapter layer, command bridge, active-format extraction, and Markdown round-trip behavior for supported syntax.
- Regression tests should include representative Markdown fixtures for CommonMark, GFM extensions, and math content.
- Regression tests should include representative Mermaid fixtures, including both valid diagrams and intentionally invalid diagrams.
- Component tests should cover:
  - loading Markdown into the editor
  - toggling formatting from the workspace toolbar
  - receiving updated Markdown after edits
  - preserving selection and format state updates where the UI depends on them
- Playwright checks should verify both structure and visual output for:
  - headings and lists rendering in the editor
  - code block editing
  - inline math and block math rendering
  - Mermaid diagram rendering and invalid Mermaid fallback behavior
  - saving a file and reopening it with preserved Markdown
- Read-only renderer parity checks should confirm the same Markdown fixture renders consistently in both the editor workflow and `RenderedMarkdown`.
- Required implementation validation commands should pass before migration work is considered complete: `bun fmt`, `bun lint`, `bun typecheck`, `bun knip`, and `bun run test`.

## Completion Criteria

- The workspace editor is powered by Milkdown rather than TipTap.
- Markdown remains the canonical persisted document format.
- The editor supports the agreed first-class dialect: CommonMark base behavior, key GFM features, LaTeX math, and Mermaid fenced diagrams.
- The editor loads Markdown into a WYSIWYG surface and serializes back to Markdown without relying on handcrafted HTML shim logic.
- The workspace toolbar and editor command flow work correctly through a stable adapter boundary.
- Representative Markdown fixtures round-trip without semantic loss across load, edit, save, and reopen flows.
- Read-only Markdown rendering and editor rendering follow the same documented syntax contract.
- All required validation commands from `AGENTS.md` pass: `bun fmt`, `bun lint`, `bun typecheck`, `bun knip`, and `bun run test`.
