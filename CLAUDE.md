# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (defaults to port 5173).
- `npm run build` — type-checks with `vue-tsc -b --noEmit`, then `vite build`. This is also the only type-check step; run it to validate types.
- `npm run preview` — serve the production build.

There is no test runner and no linter configured.

## What this is

A local-first, browser-only **music notation editor**. There is no backend (the repo is the "client"). A user picks a folder on their own disk; the app reads and writes `.notation` files there directly. Chrome/Edge only, because it depends on the **File System Access API** (`window.showDirectoryPicker`), guarded by `isSupported()` in `src/lib/storage.ts`. UI text is in German.

Stack: Vue 3 (`<script setup>`) + TypeScript + Vite. No router, no state-management library — `src/App.vue` is the single orchestrator that owns all state and passes props/events to two components.

## Core data flow

The heart of the app is a pipeline, not a component tree:

1. A `.notation` file is YAML-ish frontmatter (`title`, `subtitle`, `meter`, `key`) + a body of **custom text notation**, one measure per line. Parsed/serialized by `src/lib/frontmatter.ts` into a `NotationDoc` (`src/lib/types.ts`).
2. `src/lib/converter.ts` (`toAbc()`) converts that custom notation body into **ABC notation** — the real, complex work of this codebase.
3. `abcjs` renders the ABC string to SVG. **`abcjs` is loaded as a global `ABCJS` from a CDN `<script>` in `index.html`** — it is NOT an npm dependency and NOT imported. Its type is hand-declared in `src/env.d.ts`. Rendering therefore only works in a browser, never in Node.

`src/App.vue` bootstraps the saved folder handle (persisted in IndexedDB via `storage.ts`), handles file CRUD, and auto-saves with a 400 ms debounce. `Editor.vue` re-runs `toAbc()` on every change to text/meter/key and re-renders. `Sidebar.vue` is the file list + folder picker.

## The custom notation grammar (`converter.ts`)

Base duration unit is the eighth note (ABC `L:1/8`). Understanding this grammar is essential before touching the converter:

- **Note token**: `[duration][pitch][accidental][octave]`, regex `NOTE_RE`. E.g. `4.b` = dotted quarter B, `8g` = eighth G, `16c#2` = sixteenth C-sharp in the higher octave.
  - Duration: `1 2 4 8 16 32`; trailing `.`/`..` = 1.5×/1.75×.
  - Pitch: `a`–`g`; `p` = rest (→ ABC `z`).
  - Accidental: `#`, `##`, `b`, `bb`, `!` (natural).
  - Octave digit: `0`=kleine, `1`=eingestrichene (default), `2`=zweigestrichene, `3+`.
- **Duration carry-over**: a duration prefix persists to following bare pitches until changed (tracked via `durRef`).
- **Ties**: underscore, e.g. `4a_8a`. **Triplets**: `trio8(g g b)`. **Multi-measure rest**: `Nx`, e.g. `15x` → ABC `ZN`.
- **Bar/volta markers** are stripped from the ends of a line by `stripBarMarkers`: `|` `|:` (opening), `|` `:|` `|]` (closing), `[1`/`[2` (volta).
- `%` starts a comment; blank lines are skipped. Auto-beaming is grouped by beat via `beatUnitsFromMeter`.

## Gotcha: duplicated parsing logic

The canonical parsers live in `converter.ts` (`MULTIREST_RE`, `stripBarMarkers`). `Editor.vue` re-implements a stripped-down copy in `multiRestN()` (~line 72) to compute measure numbers/labels and to map clicked SVG measures back to source lines (`visualToSource`, since one `Nx` rest spans multiple rendered measures). **If you change multi-rest or bar-marker syntax, update both files** or the visual measure-to-source mapping will drift.
