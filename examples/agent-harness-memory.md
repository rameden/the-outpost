# How Agent Harnesses Handle Memory

Most agent harnesses split memory into two parts: working state for the current session, and persistent state that carries across sessions. Persistence usually takes one of two forms: human-readable files (Claude Code, Cursor, OpenHands) or a database with embeddings (Letta, Mem0, LangGraph stores, CrewAI). The harnesses differ most on who writes memory, who decides when to read it, and how updates work.

## Comparison

| Harness | Memory kinds | Storage | Who writes | How retrieved |
|---|---|---|---|---|
| Claude Code | CLAUDE.md (AGENTS.md fallback); auto memory | Markdown. Auto memory in `~/.claude/projects/<project>/memory/` (`MEMORY.md` index + topic files), one dir per git repo | You (CLAUDE.md); Claude (auto memory, from corrections/preferences) | CLAUDE.md and the MEMORY.md index load at session start; topic notes are opened on demand with file tools |
| Cursor | Project, User and Team Rules; AGENTS.md | `.cursor/rules` (`.mdc` with `description`/`globs`/`alwaysApply` frontmatter) | You (a 1.0 agent-written Memories feature reportedly later removed; unverified) | Rules attach by the frontmatter settings; nested AGENTS.md applies by directory; Agent chat only |
| Aider | Repo map; CONVENTIONS.md; chat history | Repo map rebuilt each request, not stored; transcript in `.aider.chat.history.md` | Automatic (map, summaries); you (conventions) | Map is graph-ranked to a token budget (`--map-tokens`, default 1k); conventions loaded read-only |
| OpenHands | Condensed event history; microagents (legacy), skills, AGENTS.md | Event log (`CondensationEvent`); markdown + YAML frontmatter files | Automatic (condensers); you (microagents/skills) | Default `LLMSummarizingCondenser` fires when event count exceeds `max_size`; keyword-triggered microagents; AGENTS.md in the initial system prompt |
| LangGraph | Short-term (checkpointers); long-term (stores) | Checkpoints per thread; JSON documents in namespaces, optional embedding search | Checkpointer: automatic once attached. Store: developer, explicitly | Thread state by thread ID; store by namespace lookup or semantic search |
| Letta/MemGPT | Core (in context), recall (history), archival | Core blocks in context; archival in PostgreSQL + pgvector | The agent, via function calls (self-editing) | Core always in context; the agent queries recall/archival through tools |
| Mem0 (memory layer, not a harness) | Extracted facts | Vector DB + entity store + SQL history | Background pipeline: async, single-pass LLM extraction after each response | Semantic search, boosted by entity links |
| CrewAI | Older: short-term, long-term, entity, contextual. Current: unified `Memory` | Older: ChromaDB, SQLite | LLM infers scope, categories and importance on save | Blend of semantic similarity, recency and importance; `remember`/`recall`/`forget` |
| OpenAI Agents SDK Sessions | Conversation items | e.g. `SQLiteSession` | The SDK appends items; you can `add_items`/`pop_item`/`clear_session` | Most recent N items (`SessionSettings(limit=N)`); `session_input_callback` customizes merging; `OpenAIResponsesCompactionSession` compacts |
| ChatGPT | Saved memories; chat-history insights | Not documented officially | The model and the user | You can disable either kind, use Temporary Chat, and view/delete under Manage Memory |

## Common patterns

- **Two tiers.** A small slice is always loaded (CLAUDE.md, rules, Letta core blocks), and a larger store is read on demand.
- **Files for instructions, databases for facts.** Rules and conventions live in version-controlled Markdown. Learned facts go to vector stores.
- **Compaction for working state.** Aider, OpenHands and the OpenAI SDK summarize or compact history rather than drop it.
- **Memory is context, not enforcement.** Claude Code treats instructions as context; its hooks enforce.

## Key design differences

- **Who writes.** You (CLAUDE.md, Cursor rules), the agent through tools (Letta, Claude auto memory), a background pipeline (Mem0), the developer (LangGraph stores), or an LLM-assisted save (CrewAI).
- **Who retrieves.** Static always-on loading (rules, AGENTS.md), the agent through tool calls (Letta, Claude topic files), or the harness through search (Mem0, CrewAI, LangGraph stores). Letta's quality and latency depend on the agent's tool-call decisions.
- **Update semantics.** Mem0 is ADD-only; old facts aren't silently rewritten. Letta edits in place. Cursor-style rules change only when you edit them: predictable and shareable, but hand-maintained, with an always-on context cost.
- **Scope.** Claude Code scopes auto memory to one git repo, shared across worktrees, and it is machine-local. Put team rules in a committed CLAUDE.md. Cursor has user, project and team scopes. LangGraph scopes by thread (short-term) and namespace (long-term).

## Open problems

- **Extraction quality.** One independent paper calls it the bottleneck for Mem0-style pipelines. Failures are silent.
- **Forgetting and conflicts.** Flat vector stores can't easily expire or retract facts (single source), and ADD-only designs leave stale facts behind.
- **Reliability of agent-driven memory.** Agent-managed memory depends on the agent choosing to read and write.
- **Advisory versus enforced.** Memory shapes behavior but guarantees nothing.
- **Security.** Malicious or injected memories are a risk (see the arXiv paper in Sources). Cross-machine sharing and evaluation are also thin: most benchmarks are from vendors or single preprints.

## Caveats

Unverified or single-source items:

- **AutoGen:** not covered; not researched reliably.
- **Claude Code:** the ~200 line/25KB `MEMORY.md` load cap is from a secondary source. Context compaction is not verified.
- **Cursor:** removal of Memories in 2.1.x rests on secondary sources.
- **Aider:** no cross-session agent-written memory found; this is absence of evidence. The history limit is soft and can be exceeded.
- **OpenHands:** `ObservationMasking` and `RecentEvents` condensers come from secondary sources.
- **LangGraph:** explicit developer writes come from a third-party tutorial. LangMem adds extraction. In-memory savers lose data on exit; production needs e.g. `PostgresSaver`.
- **Letta/MemGPT:** the source is secondary (vectorize.io). The finding that it has no soft-delete comes from one benchmark.
- **Mem0:** the extraction and expiry claims come from a single independent paper.
- **CrewAI:** the source is a non-crewai.com host, so treat it as secondary.
- **OpenAI SDK:** the open bugs (limit window starting mid-response; compaction with limit replacing the whole store) come from single GitHub issues. That the default in-memory DB is lost on exit is an assumption.
- **ChatGPT:** the mechanics (bio tool, summary in system prompt rather than vector DB) are third-party reverse-engineering and unverified. Deleting a chat doesn't delete memories (official).

## Sources

- Claude Code: https://code.claude.com/docs/en/memory
- Cursor: https://cursor.com/docs/rules, https://cursor.com/changelog/1-0
- Aider: https://aider.chat/docs/repomap.html, https://aider.chat/docs/usage/conventions.html, https://aider.chat/docs/config/options.html
- OpenHands: https://docs.openhands.dev/sdk/arch/condenser, https://docs.openhands.dev/openhands/usage/microagents/microagents-overview
- LangGraph: https://docs.langchain.com/oss/python/langgraph/persistence, https://docs.langchain.com/oss/python/concepts/memory
- Letta/MemGPT (secondary): https://vectorize.io/articles/mem0-vs-letta
- Mem0: https://docs.mem0.ai/core-concepts/how-it-works
- CrewAI: https://crewai.ubitools.com/concepts/memory/
- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/sessions/
- ChatGPT: https://openai.com/index/memory-and-new-controls-for-chatgpt/
- Memory security: https://arxiv.org/pdf/2601.07004
