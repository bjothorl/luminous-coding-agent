# Luminous

A terminal coding agent (in the spirit of Claude Code / opencode) built around one idea: **keep every
agent's context small by spreading the work across specialized subagents, each with its own model.**

An orchestrator plans and delegates; explorers scout the codebase; coders implement focused changes in
parallel; a reviewer verifies the result. All agents talk to your own llama.cpp server (or any
OpenAI-compatible endpoint) via LangChain v1's `createAgent`.

```text
                ┌────────────────────────────────────────────┐
                │                Ink TUI                     │
                │  chat pane │ agent status pane │ diff pane │
                └─────────────────────┬──────────────────────┘
                ┌─────────────────────▼──────────────────────┐
                │      Orchestrator agent (createAgent)      │
                │  tools: Read, Grep, Glob, TodoWrite, Task  │
                └───────┬──────────────┬───────────┬─────────┘
                 Task() │ parallel     │           │
            ┌───────────▼──┐  ┌────────▼─────┐  ┌──▼───────────┐
            │  Explorer    │  │   Coder(s)   │  │  Reviewer    │
            │ small model  │  │  mid model   │  │ strong model │
            │ read-only    │  │ read+write   │  │ read + shell │
            └───────┬──────┘  └────────┬─────┘  └──┬───────────┘
                    │ TaskReport       │           │ TaskReport
                    └─────────►(structured handoff)◄┘
```

## Requirements

- Node.js 20+
- A running [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` (or any OpenAI-compatible
  endpoint). For reliable tool calling run it with `--jinja` and a function-calling-capable model
  (Qwen, Llama 3.x, Mistral, ...). For real parallel subagents, give it slots: `--parallel 4`.
- Optional but recommended: [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on PATH.
  The Grep tool falls back to a slower JS scan without it.

## Setup

```bash
npm install
npm run dev            # interactive TUI in the current directory
```

Useful flags:

```bash
npx tsx src/cli.tsx --cwd path/to/project   # work on another project
npx tsx src/cli.tsx -p "fix the build"      # headless one-shot run (auto-approves!)
npx tsx src/cli.tsx --resume                # resume the latest session transcript
```

## Configuration

Global config lives in `~/.luminous/config.json`; per-project overrides in
`<project>/.luminous/config.json` (deep-merged on top). See `config.example.json`:

```json
{
  "baseURL": "http://localhost:8080/v1",
  "apiKey": "sk-local",
  "model": "qwen3-32b",
  "temperature": 0.2,
  "maxSteps": 80,
  "lintCommand": "npx tsc --noEmit",
  "agents": {
    "orchestrator": { "model": "qwen3-32b", "temperature": 0.3 },
    "explorer": { "model": "qwen3-8b" },
    "coder": { "model": "qwen3-14b", "temperature": 0.1 },
    "reviewer": { "baseURL": "http://localhost:8081/v1", "model": "qwen3-32b" }
  }
}
```

Every agent role can override `baseURL`, `model`, `apiKey`, `temperature`, and `maxSteps`, so each role
can target a different llama.cpp instance/model -- or all share one.

## How it works

- **Agents are code.** `OrchestratorAgent`, `ExplorerAgent`, `CoderAgent`, and `ReviewerAgent` extend
  `BaseAgent` (`src/agents/base.ts`), which wraps LangChain's `createAgent` with streaming, step caps,
  token accounting, and event emission for the TUI.
- **Tools are classes.** Every tool extends `LuminousTool` (`src/tools/base.ts`), our base on top of
  LangChain's `StructuredTool`, adding zod validation, session-bus events, approval gating, and
  file-claim checks. Roster: `Read`, `StrReplace`, `Write`, `Grep`, `Glob`, `Shell`, `TodoWrite`,
  `ReadLints`, `Task`.
- **Delegation via `Task`.** The orchestrator passes an array of self-contained task briefs; each spawns
  a *fresh* subagent (isolated context) and they run in parallel. Subagents return a structured
  `TaskReport` (summary, files touched, stats) -- never raw transcripts -- keeping the orchestrator lean.
- **Write-conflict safety.** A file-claim registry rejects writes to files claimed by another live agent,
  so parallel coders must stay on disjoint file sets.
- **Approvals.** Shell commands and writes outside the project root pause for TUI approval
  (`y` once / `a` always / `n` deny). "Always" decisions persist in `.luminous/approvals.json`.
  Headless `-p` mode auto-approves everything -- use it deliberately.

## TUI

- **Left**: conversation with the orchestrator, live-streamed, with tool calls and delegations inline.
- **Right**: running agents (model, current tool, tokens, elapsed), the session todo list, and a live
  diff preview of the most recent file edit.
- **Slash commands**: `/help`, `/agents`, `/model`, `/cost`, `/clear`, `/exit`. `Esc` cancels a run.

## Project layout

```text
src/
├── cli.tsx              # entry: arg parsing, service wiring, TUI/headless boot
├── config/              # zod-validated config loading + per-role resolution
├── providers/           # ChatOpenAI factory + connectivity smoke test
├── tools/               # LuminousTool base + the tool roster
├── agents/              # BaseAgent + orchestrator/explorer/coder/reviewer + registry
├── session/             # event bus, approvals, file claims, todos, usage, persistence
└── tui/                 # Ink components: App, Chat, AgentStatus, DiffView, Approval, StatusBar
```
