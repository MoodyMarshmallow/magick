# Magick

Magick is a Codex-first conversation workspace for building provider payloads from a single context tree of user, assistant, tool, and prompt actions. This context keeps the tree, branch, and bookmark language consistent across the server, UI, contracts, and future refactors.

## Language

### Conversation model

**Context Tree**:
The global, canonical tree of nodes used to rebuild API payloads, regenerate frontend history, and preserve minimal debugging context.
_Avoid_: Event log, snapshot, transcript store

**Conversation**:
A single path within the context tree that represents a user-assistant interaction chain.
_Avoid_: Workspace, thread, chat

**Context Node**:
A minimal durable item that reflects a provider-visible user, assistant, tool, or prompt action.
_Avoid_: Event, record, message row

**Trunk**:
The root path of live system-level prompt nodes shared by all branches.
_Avoid_: Prompt version, base thread, global chat

**Branch**:
A path through the **Context Tree** from the **Trunk** to a selected node.
_Avoid_: Thread, chat, session

**Bookmark**:
A named pointer to a specific **Context Node**, usually the current head of a branch.
_Avoid_: Thread, tab, conversation

**Active Bookmark**:
The bookmark whose branch the frontend is currently displaying and appending to.
_Avoid_: Active thread, selected chat

### Conversation actions

**User Message Node**:
A context node containing a user contribution that should appear in the branch and be sent in payload history.
_Avoid_: Prompt, input event

**Assistant Message Node**:
A context node containing one assistant output item, including streamed content accumulated into a single durable node.
_Avoid_: Delta, completion, response chunk

**Tool Call Node**:
A context node containing one assistant-requested tool call and its provider-facing input.
_Avoid_: Tool activity, function event

**Tool Result Node**:
A context node containing the provider-facing output for one completed or failed tool call.
_Avoid_: Tool activity, result preview

### Provider model

**Provider**:
The assistant backend Magick dispatches work to, such as Codex.
_Avoid_: Model, engine

**Provider Session**:
The provider-owned runtime handle used for an active assistant interaction when the provider supports or requires one.
_Avoid_: Thread, chat, branch

**Provider Auth**:
The persisted authentication state Magick uses to access a provider account.
_Avoid_: Login flow, credentials blob

### UI-facing model

**Branch View Model**:
The frontend-ready representation of one **Branch** reconstructed from a bookmark's target node.
_Avoid_: Thread view model, snapshot

**Bookmark Summary**:
The list/menu representation of a **Bookmark**.
_Avoid_: Thread summary, branch summary

## Relationships

- Magick has a single, global **Context Tree**
- A **Conversation** is a path within the **Context Tree**
- A **Context Tree** has exactly one **Trunk**
- A **Trunk** contains one or more live system-level prompt **Context Nodes**
- A **Branch** starts at the **Trunk** and ends at one **Context Node**
- A **Bookmark** points to exactly one **Context Node**
- An **Active Bookmark** is either one **Bookmark** or absent
- A **Branch View Model** is rebuilt by walking from a **Bookmark** target node back to the **Trunk**
- A **User Message Node** appends to the current **Active Bookmark** branch
- An **Assistant Message Node**, **Tool Call Node**, and **Tool Result Node** append sequentially to the same active branch during an assistant turn
- A **Tool Result Node** belongs to exactly one **Tool Call Node** in provider-facing order
- A **Provider Session** may be used while appending provider output to a **Branch**

## Example dialogue

> **Dev:** "When a user selects a **Bookmark**, are they opening a new **Conversation**?"
> **Domain expert:** "No — there is one **Conversation**. The **Bookmark** points to a node, and selecting it displays the **Branch** from the **Trunk** to that node."

## Flagged ambiguities

- "thread" previously meant both a user-visible chat and the storage boundary — resolved: use **Bookmark** for the pointer and **Branch** for the displayed path.
- "workspace" previously acted as a conversation container — resolved: use **Conversation** for assistant history; keep workspace language only for local filesystem concepts when needed.
- "message" can mean any payload item — resolved: use **User Message Node** or **Assistant Message Node** only for user/assistant text, and **Tool Call Node** or **Tool Result Node** for tool items.
- "head" can mean any leaf or selected path endpoint — resolved: a **Bookmark** points to a specific node, and the **Active Bookmark** determines which branch receives new actions.
