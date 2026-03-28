# Frontend implementation plan: Markdown editor with invisible anchor directives and comment threads

## Goal

Build the frontend for a collaborative word-processing app where the canonical document is Markdown, but users can interact with it through a rich editor that supports:

* normal text editing
* hidden anchor artifacts embedded in the Markdown source
* comment threads attached to anchored text
* AI-generated comments and suggestions
* a UI that feels closer to Google Docs or Word than to a raw Markdown textarea

This plan assumes the app controls the editing environment and can use app-specific Markdown directives such as `::anchor[id]{}` or `{{anchor:id}}` as invisible structural artifacts.

---

## Product decision

Use **paired inline anchor directives in the Markdown source** to define the exact start and end of each commented span, and do **not** expose those directives in the normal editor UI.

Example persisted Markdown:

```md
This paragraph introduces the ::comment-start[a1b2c3]{}main idea::comment-end[a1b2c3]{}.
```

Interpretation:

* `a1b2c3` identifies one commentable span
* the start and end markers define the exact range associated with that anchor ID
* the markers are invisible and non-editable in the rich editor UI

The editor should parse these directives into internal inline anchor boundary nodes or metadata, render the prose normally, and overlay comment highlights and comment indicators in the UI.

The user should interact with highlighted text and comment chips, not with the raw anchor syntax.

This plan assumes the app controls the editing environment strongly enough to make anchor markers invisible and non-editable, while still allowing normal edits to the text inside and around the anchored span.

---

## Scope of the frontend

The frontend is responsible for:

1. loading Markdown
2. parsing anchor directives into editor state
3. rendering a rich text editing surface
4. allowing a user to select text and create comments
5. creating anchors in the underlying Markdown when needed
6. rendering existing comments and their attached ranges
7. maintaining stable mappings between editor selections and anchor IDs
8. exposing hooks for AI actions such as “comment on this section” or “suggest a rewrite”

The frontend is not responsible for long-term anchor recovery logic beyond local editing sessions; backend reattachment and version reconciliation can be layered in later.

---

## Recommended frontend stack

Use:

* **React** for UI
* **TipTap** as the editor framework
* **ProseMirror extensions** underneath TipTap for custom anchor behavior
* **Zustand** or React context for local editor/comment UI state

Why this stack:

* TipTap is much easier to productize than building directly on raw ProseMirror
* ProseMirror’s document model and decorations are well suited for comments, annotations, and hidden metadata
* custom nodes/marks/extensions are straightforward to define

---

## Key frontend design choice

There should be **two representations** of the same document in the frontend:

### 1. Persisted representation

Markdown string with embedded custom anchor directives.

### 2. Interactive editor representation

A structured editor document where anchors are represented as hidden metadata, invisible inline nodes, or marks.

The app should never treat the raw Markdown string as the live editing model.

Flow:

```text
Markdown from storage
-> parse into TipTap / ProseMirror doc
-> user edits in rich editor
-> serialize back to Markdown with anchor directives preserved
```

---

## Anchor model

Use anchor IDs as stable identifiers for commented spans.

Each anchor should have:

* `id`: unique string
* `start`: invisible start boundary in the editor model
* `end`: invisible end boundary in the editor model
* `commentIds`: optional list of attached threads in frontend cache

The frontend should use **inline span anchors only**.

### Inline start/end anchor pair

Used for comments attached to an exact phrase or span inside normal text.

Persisted Markdown example:

```md
This paragraph introduces the ::comment-start[a1b2c3]{}main idea::comment-end[a1b2c3]{}.
```

Interpretation:

* anchor `a1b2c3` is defined by a matched start and end marker pair
* the text between the markers is the canonical commented span
* the editor should render that span as a highlightable range
* the markers themselves should be invisible and not directly editable by the user

This is the core model for the frontend. There are no block anchors in the initial implementation.

---

## Strong recommendation for MVP

For the first version, implement **paired inline span anchors only**.

Reason:

* the user interaction model is simple and close to Word/Docs comments
* a comment clearly owns a span of text rather than a vague attachment point
* the start/end pair makes serialization unambiguous
* the editor can keep the anchor boundaries hidden and protected

This is viable as long as the editor owns the editing behavior around anchor boundaries.

That means the frontend must explicitly handle:

* inserting a new matched pair when a comment is created
* preserving matched pairs during ordinary typing
* preventing users from directly deleting or editing only one boundary marker
* repairing or rejecting invalid states if a start/end pair becomes mismatched during transforms

This is more frontend editing logic than block anchors would require, but it is still very doable in TipTap/ProseMirror because those editors already let you intercept transactions and define protected inline atoms.

---

## Editor extension plan

Implement three custom TipTap/ProseMirror extensions.

### 1. Anchor extension

Purpose:

* represent invisible paired start/end anchors in the document model
* preserve them during parse/serialize
* expose commands to insert, query, and maintain them

Responsibilities:

* parse `::comment-start[id]{}` and `::comment-end[id]{}` from Markdown
* convert them into internal inline boundary nodes or metadata tokens
* keep both markers invisible in the editor rendering
* make both markers non-editable directly by the user
* serialize internal anchor boundaries back to Markdown
* validate that start/end pairs remain matched

Implementation direction:

* use two inline atom node types, one for start and one for end, each carrying the same `anchorId`
* render them as zero-width invisible elements in the editor
* prevent cursor placement inside the atoms when possible
* use transaction hooks to protect against deleting only one side of a pair

The key rule is that the markers are persistence artifacts and structural boundaries, not user-editable text.

### 2. Comment highlight extension

Purpose:

* display anchored text/block highlights
* show selection state, hover state, and active thread state

Responsibilities:

* render decorations for commented ranges or blocks
* show inline marker or margin chip when comments exist
* support clicking a highlight to open the related thread

### 3. Comment interaction extension

Purpose:

* map editor selections to anchor operations
* add commands for creating comments and attaching them to anchors

Responsibilities:

* on “Add comment”, determine whether the current selection maps to an existing anchor
* if no anchor exists, create one
* emit a structured payload to the app state/backend

---

## Parsing and serialization plan

The frontend needs a controlled Markdown pipeline.

### Parsing

On load:

1. parse Markdown into an AST
2. detect `::comment-start[id]{}` and `::comment-end[id]{}` directives
3. validate that anchor pairs are well formed
4. convert anchor boundaries into editor metadata or inline atom nodes
5. build TipTap document

Important rules:

* the raw directive syntax should not appear in the visible editing surface
* invalid or unmatched pairs should be surfaced as recoverable parsing errors, not silently ignored

### Serialization

On save:

1. walk the editor document
2. emit Markdown
3. write `::comment-start[id]{}` before the anchored span
4. write `::comment-end[id]{}` after the anchored span
5. preserve IDs exactly

Important rules:

* the serializer must not generate duplicate IDs for different spans
* every start must have exactly one matching end with the same ID
* the frontend should refuse to save obviously corrupt anchor structure unless it can safely repair it

Codex should treat parsing, validation, and serialization as critical infrastructure, not as an afterthought.

---

## How comment creation should work

When a user selects text and clicks “Add comment”:

1. generate a fresh anchor ID
2. insert `start` and `end` anchor boundaries around the selected range in the editor model
3. create a comment thread attached to that anchor ID
4. render the selected range as a commented highlight
5. open the thread in the sidebar

The comment should attach to the anchor ID, not to raw editor offsets alone.

### Editing behavior around anchored spans

The frontend should enforce a few rules.

#### Typing inside the span

* allowed
* the anchor continues to wrap the edited text

#### Expanding or shrinking the span intentionally

* can be supported later with explicit commands such as “adjust commented range”
* should not happen accidentally from ordinary typing logic

#### Deleting the entire span

* if both boundaries are removed together through a valid delete action, the frontend should mark the related thread as orphaned or deleted

#### Deleting only one boundary

* should be blocked or repaired automatically by transaction logic

This is the core reason the approach is viable: the user does not edit the anchor syntax itself, and the editor owns boundary integrity.

---

## UI layout

Recommended layout:

### Main areas

* top toolbar
* central document editor
* right sidebar for comment threads
* optional left gutter for block comment indicators

### Toolbar actions

* add comment
* resolve comment
* ask AI to review selection
* ask AI to rewrite selection
* show/hide comments

### Editor behavior

* hovered commented region gets a stronger highlight
* selected comment thread scrolls the editor to the anchor
* clicking highlighted text opens the corresponding thread
* block comments can show a bubble in the margin

### Left Sidebar behaviour

Left sidebar should be a file directory navigator for the user. Much like that of VSCode or Obsidian.

### Right Sidebar behavior

Each thread shows:

* author
* timestamp
* comment content
* anchor preview text
* replies
* resolve button

AI-authored comments should be visually differentiated, but not in a distracting way.

---

## Frontend state model

Use three categories of state.

### Editor document state

Managed by TipTap / ProseMirror.

### Collaboration/comment state

Managed in app state, for example with Zustand:

```ts
CommentThread = {
  id: string
  docId: string
  anchorId: string
  anchorKind: 'inline'
  selectedText?: string
  status: 'open' | 'resolved'
  comments: Array<{
    id: string
    author: 'human' | 'ai'
    body: string
    createdAt: string
  }>
}
```

### UI state

Examples:

* active thread ID
* hovered anchor ID
* comment sidebar open/closed
* selected AI action

Keep the editor document model and comment thread state separate. The editor should know about anchors; the app store should know about threads.

---

## Commands Codex should implement

Create explicit editor commands rather than scattering logic around components.

Suggested commands:

* `insertCommentAnchorPair(from, to, anchorId)`
* `getAnchorForSelection()`
* `createCommentFromSelection(commentBody)`
* `removeAnchorPair(anchorId)`
* `repairAnchorPair(anchorId)`
* `focusThread(threadId)`
* `scrollToAnchor(anchorId)`
* `serializeDocumentToMarkdown()`
* `parseMarkdownToEditorDoc(markdown)`
* `validateAnchorPairs()`

These commands should live close to the editor extension layer, not inside random React click handlers.

---

## AI integration points

The frontend should not hardcode LLM logic into the editor. Instead, expose actions that pass selected content and anchor metadata to an AI service.

Example flows:

### Ask AI to comment on selection

1. user selects text
2. frontend inserts or resolves the current inline anchor pair
3. frontend sends:

   * document ID
   * anchor ID
   * selected text
   * surrounding text context
4. backend returns a proposed comment
5. frontend inserts it into the corresponding thread as an AI-authored message

### Ask AI to rewrite selection

1. user selects text
2. frontend resolves the corresponding inline span
3. backend returns suggested rewrite
4. frontend shows diff or suggestion card in sidebar
5. user accepts or rejects

Keep AI proposals reviewable. Do not silently rewrite document text in the MVP.

---

## UX constraints Codex should respect

### 1. Anchor syntax must remain invisible in normal editing

The user should not see `::anchor[id]{}` while writing in the rich editor.

### 2. The app must feel like a document editor, not like source-code editing

Avoid exposing implementation artifacts in the editing surface.

### 3. Comment boundaries must remain structurally valid

The user should be able to edit the text naturally, but should not be able to directly corrupt the start/end anchor syntax. Boundary markers must stay invisible, protected, and matched.

### 4. Creating a comment should feel fast

User selects text, clicks comment, thread appears. No complex dialog should be required.

### 5. Comment navigation should be bidirectional

Clicking a highlight opens the thread; clicking a thread scrolls to the anchor.

---

## Edge cases the frontend should handle

### Deleting text across one boundary

If a user selection partially crosses into an anchored span and would remove only one side of the pair:

* intercept the transaction
* either expand the delete to remove the full anchor pair intentionally or reject/repair the edit
* never leave one orphan boundary in the live editor state

### Deleting the full anchored span

If a user deletes the full range including both boundaries:

* remove the pair together
* emit an event so the app can mark the thread as orphaned, removed, or pending confirmation

### Editing inside the anchored span

If a user rewrites text between the boundaries:

* preserve the same anchor ID
* keep the comment thread attached
* update the rendered highlight to the new span contents

### Splitting text near a boundary

If enter/backspace or similar editing splits a text node adjacent to a boundary:

* preserve the boundary nodes
* keep ordering as start -> content -> end

### Copy/paste within editor

If content containing an anchored span is duplicated:

* the duplicate must receive fresh anchor IDs if it becomes a separate live commented range
* do not allow two live spans in one document to share the same anchor ID

### Pasting external Markdown

If pasted Markdown contains unknown or malformed comment-anchor syntax:

* sanitize or normalize it
* preserve only valid supported directives

### Mismatched pairs after complex transforms

If a complex edit produces invalid pairing:

* detect it immediately with validation
* repair automatically when safe
* otherwise surface a controlled error state rather than silently corrupting the document

---

## Implementation sequence for Codex

### Phase 1: skeleton editor

* set up React + TipTap editor shell
* render Markdown content
* add toolbar and comment sidebar layout

### Phase 2: anchor parsing and serialization

* define the `::comment-start[id]{}` / `::comment-end[id]{}` syntax contract
* implement Markdown parser support
* implement serializer support
* keep anchors invisible in editor UI
* validate that all pairs are matched

### Phase 3: inline comment flow

* add command to insert an anchor pair for the current selection

* create comment thread from selection

* render inline highlights and open thread in sidebar

* protect boundary markers from direct editing

* add command to ensure block anchor for current selection

* create comment thread from selection

* render block highlights and open thread in sidebar

### Phase 4: thread interactions

* reply to thread
* resolve/unresolve thread
* click highlight to focus thread
* click thread to scroll to anchor

### Phase 5: AI hooks

* add UI actions for AI comment and AI rewrite request
* show AI messages in thread UI
* keep all AI changes suggestion-first

### Phase 6: hardening

* handle block split/merge/delete cases
* prevent duplicate anchor IDs
* improve copy/paste normalization

---

## What Codex should avoid

* do not build the editor as a raw Markdown textarea with manual DOM overlays
* do not store comments purely as character offsets in the frontend
* do not expose literal anchor directive strings during ordinary editing
* do not tightly couple comment thread rendering to raw document positions
* do not attempt full Google Docs-grade real-time conflict resolution in the first frontend pass

---

## Deliverables expected from Codex

Codex should produce:

1. a TipTap-based editor shell
2. a custom anchor extension
3. Markdown parse/serialize utilities for `::anchor[id]{}`
4. a comment sidebar UI
5. commands for comment creation and anchor lookup
6. highlight/decorations for anchored comments
7. clear interfaces for backend integration

---

## Final direction

The frontend should treat paired inline anchor directives as **invisible persistence artifacts**, not as visible text. The visible experience should be a normal document editor with highlighted commented spans and a thread sidebar. The hidden anchor syntax exists only to make Markdown persistence and exact span attachment possible.

This approach is reasonable and implementable as long as the editor owns the integrity of the start/end markers. The hard part is not parsing the syntax; it is making boundary markers invisible, non-editable, and resilient under normal text editing. That is still a very workable frontend problem in TipTap/ProseMirror and should be treated as a core part of the editor extension layer, not as a minor UI detail.
