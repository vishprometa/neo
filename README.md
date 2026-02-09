<p align="center">
  <img src="assets/neo-logo.svg" width="260" alt="Neo" />
</p>

<p align="center">
  <strong>Your AI coworker that remembers everything.</strong>
  <br />
  Persistent memory. Real tools. Works for everyone.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/gemini_3-flash_&_pro-4285F4?style=flat-square" />
  <img src="https://img.shields.io/badge/tauri-v2-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" />
</p>

---

## What is Neo?

Neo is an **AI coworker** — a desktop app that remembers your projects, files, and conversations. Unlike chatbots that start fresh every time, Neo builds **persistent memory** that grows the more you use it.

Not just for programmers — Neo helps writers, researchers, designers, students, anyone who works with files on their computer.

**Writing** / **Research** / **File management** / **Data work** / **Code** / **Planning** / **Web search** / **Automation**

### Memory

Neo stores AI-generated summaries of your workspace in a `.neomemory/` folder — plain markdown files you can read, edit, or version control. Every session, it already knows your project.

```
your-project/
  .neomemory/
    index.md              # Project overview
    files/
      src-app.tsx.md      # AI summary of each file
    journal/
      2025-02-10.md       # Session notes & decisions
```

## Install

Download the `.dmg` from [Releases](https://github.com/vishprometa/neo/releases). After installing, run once in Terminal:

```bash
xattr -cr /Applications/Neo.app
```

<details>
<summary>Build from source</summary>

Requires [Node.js](https://nodejs.org/) (v18+), [Rust](https://rustup.rs/), and the [Tauri CLI](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/vishprometa/neo.git
cd neo
npm install
npm run tauri dev       # development
npm run tauri build     # release .dmg
```
</details>

## Setup

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey) (free) or [OpenRouter](https://openrouter.ai/keys)
2. Open Neo → **Settings** → paste your key
3. Choose a workspace folder — Neo indexes it and starts building memory

## Features

- **Persistent memory** — `.neomemory/` with AI summaries, project index, daily journal
- **Powered by Gemini 3** — Flash and Pro (direct) or any model via OpenRouter
- **File tools** — read, write, edit, search, organize
- **Web access** — search and fetch pages
- **Shell** — run commands with safety checks
- **Task tracking** — structured todo lists
- **Custom instructions** — reads `NEO.md` from your workspace
- **Dark mode** / **Multi-window**

## How It Works

You send a message. Neo picks the right tools, executes them, and repeats until done. Memory is loaded at every step.

```
You: "Summarize my research notes"
  → [loads memory] → list files → read notes → write summary.md → update memory
Neo: "Done! Created summary.md with the key themes."
```

## Tech Stack

[Tauri v2](https://v2.tauri.app/) · React 19 · TypeScript · TailwindCSS · Gemini 3 · OpenRouter · Vite 7

## License

MIT
