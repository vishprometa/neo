<p align="center">
  <img src="assets/neo-logo.svg" width="260" alt="Neo" />
</p>

<p align="center">
  <strong>An AI coworking agent that learns your codebase.</strong>
  <br />
  Persistent memory. File-based learning. Full tool access.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/version-0.1.0-green?style=flat-square" />
  <img src="https://img.shields.io/badge/tauri-v2-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" />
</p>

---

## What is Neo?

Neo is an **AI coworking agent** — a desktop app that sits alongside your editor, learns your project through persistent memory, and helps you build. Think of it as a coworker who never forgets your codebase.

Unlike chat-based AI tools that start fresh every conversation, Neo builds and maintains a **semantic memory** of your project inside a `.neomemory/` directory. Every time you work together, Neo indexes your files, generates AI-powered summaries, and stores context that persists across sessions. The more you use it, the better it understands your code.

### How memory works

```
your-project/
  .neomemory/
    index.md              # Project overview & architecture summary
    files/
      src-app.tsx.md      # AI summary of src/App.tsx
      src-utils.md        # AI summary of src/utils/
      ...                 # Every indexed file gets a summary
    journal/
      2025-02-10.md       # Daily session notes & decisions
```

When Neo indexes your workspace, it reads your files and uses LLM-based summarization to generate rich semantic descriptions — not just file listings, but actual understanding of what each file does, how components relate, and what patterns your codebase uses. These summaries are stored as plain markdown files you can read, edit, or version control.

Before every response, Neo loads this memory context so it already knows your project structure, naming conventions, and recent decisions — **no need to explain your codebase every session.**

### What Neo can do

- **Read, write, and edit files** — with 6-level smart fuzzy matching so edits land even with whitespace differences
- **Run shell commands** — full terminal access in your project directory with safety checks
- **Search your code** — glob patterns and regex search across your entire workspace
- **Browse the web** — fetch docs, search for solutions, read API references
- **Remember everything** — persistent `.neomemory/` that grows as you work together
- **Track tasks** — structured todo lists for complex multi-step work

## Features

| Feature | Description |
|---|---|
| **Persistent memory** | `.neomemory/` directory with LLM-generated file summaries, project index, and daily journal |
| **Semantic indexing** | AI reads and summarizes every file so it understands your architecture |
| **30+ tools** | File I/O, shell, grep, glob, web fetch, memory, todos, skills |
| **Multi-model** | Gemini Flash (direct) or any model via OpenRouter |
| **Custom instructions** | Reads `NEO.md`, `AGENTS.md`, `.cursorrules` from your workspace |
| **3-tier context** | Global instructions (~/.neo/NEO.md) + project instructions + JIT file memory |
| **Smart editing** | 6-level fuzzy matching — exact, line-trimmed, block-anchor, whitespace-normalized, no-indent, empty-line |
| **Parallel execution** | Read-only tools run concurrently for speed |
| **Loop detection** | Catches repetitive tool calls and oscillation patterns, auto-recovers |
| **Conversation compression** | Automatically summarizes long conversations to stay in context |
| **Dark mode** | Native macOS dark mode support |
| **Multi-window** | Open multiple workspaces in separate windows |

## Installation

### Download

Grab the latest `.dmg` from [Releases](https://github.com/vishprometa/neo/releases).

### macOS Gatekeeper

Since Neo is not signed with an Apple Developer certificate, macOS will block it the first time. After installing, run this in Terminal:

```bash
xattr -cr /Applications/Neo.app
```

Then open Neo normally. You only need to do this once.

> **Why?** macOS quarantines apps downloaded from the internet that aren't notarized by Apple. The `xattr -cr` command removes the quarantine flag so the system treats it as a trusted app.

### Build from Source

Requires [Node.js](https://nodejs.org/) (v18+), [Rust](https://rustup.rs/), and the [Tauri CLI](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/vishprometa/neo.git
cd neo
npm install
npm run tauri dev       # development
npm run tauri build     # release .dmg
```

The built `.dmg` will be in `src-tauri/target/release/bundle/dmg/`.

## Setup

1. **Get an API key** from [Google AI Studio](https://aistudio.google.com/apikey) (Gemini) or [OpenRouter](https://openrouter.ai/keys)
2. Open Neo and go to **Settings** (gear icon)
3. Paste your API key and select your provider
4. Choose a workspace folder — Neo will index it and start building memory

## How It Works

Neo runs an **agent loop**. You send a message, the LLM decides which tools to call, executes them, reads the results, and repeats until the task is done (up to 20 iterations). Memory context is injected at every turn so the model always has project awareness.

```
You: "Add a dark mode toggle to the settings page"
         |
         v
   [Neo loads .neomemory context]
         |
   [LLM thinks] --> read settings.tsx
                --> read theme context
                --> edit settings.tsx (add toggle)
                --> edit theme.ts (add logic)
                --> bash: npm run build (verify)
                --> write_memory: "Added dark mode toggle"
         |
         v
   Neo: "Done! I added a toggle component that..."
   (memory updated for next session)
```

### Tool Categories

| Category | Tools |
|---|---|
| **File** | `read`, `write`, `edit`, `multiedit`, `glob`, `grep`, `ls` |
| **Shell** | `bash` — safety checks, login env sourcing, 2min timeout |
| **Web** | `web_fetch`, `web_search` |
| **Memory** | `sync_memory`, `read_memory`, `write_memory`, `search_memory`, `list_memory` |
| **Tasks** | `todowrite`, `todoread` |
| **Skills** | `list_skills`, `use_skill` |
| **UX** | `question` — ask the user structured questions |

## Project Structure

```
neo/
  src/
    components/           # UI — titlebar, chat input, memory browser
    views/                # Welcome, Chat, Logs views
    lib/
      agent/              # Runtime, tool registry, system prompt, loop detection
      llm/                # Gemini (direct) & OpenRouter (proxy) clients
      memory/             # 3-tier context manager, semantic indexing, journal
  src-tauri/
    src/lib.rs            # Tauri commands — API keys, FS scope, app icons
    capabilities/         # Shell & filesystem permissions
```

## Tech Stack

- **Runtime** — [Tauri v2](https://v2.tauri.app/) (Rust + WebView)
- **Frontend** — React 19, TypeScript 5.8, TailwindCSS
- **LLM** — Google GenAI SDK, OpenRouter API
- **Build** — Vite 7, Cargo

## License

MIT
