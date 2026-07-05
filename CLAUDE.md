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

1. A `.notation` file is YAML-ish frontmatter (`title`, `subtitle`, `meter`, `key`) + a body of **raw ABC notation** (tune body only, no header lines). Parsed/serialized by `src/lib/frontmatter.ts` into a `NotationDoc` (`src/lib/types.ts`). Unknown frontmatter keys (e.g. `mode:` from older files) are ignored on parse and dropped on the next save.
2. `abcHeader()` in `src/lib/abc.ts` prepends the generated 5-line tune header (`X:1`, `T:`, `M:` from meter, `L:1/8`, `K:` from key) to the body. Meter and key come from the toolbar dropdowns, never from the text.
3. `abcjs` renders the ABC string to SVG. **`abcjs` is loaded as a global `ABCJS` from a CDN `<script>` in `index.html`** — it is NOT an npm dependency and NOT imported. Its type is hand-declared in `src/env.d.ts`. Rendering therefore only works in a browser, never in Node.

`src/App.vue` bootstraps the saved folder handle (persisted in IndexedDB via `storage.ts`), handles file CRUD, and auto-saves with a 400 ms debounce. `Editor.vue` re-renders on every change to text/meter/key. `Sidebar.vue` is the file list + folder picker.

## UI layout

- `App.vue` renders a sticky top bar (hamburger + wordmark, height `--topbar-h` from `styles.css`) above `Editor.vue`. The hamburger toggles `Sidebar.vue`, which is an **offcanvas panel** (fixed, slides in from the left over a backdrop; closes on backdrop click, ×, Escape, file select, or "+ Neu").
- `Editor.vue` is a **split view**: rendered page (left) and the ABC textarea panel (right), separated by a draggable splitter (pointer capture, min widths 320/280 px). The left-pane ratio persists in localStorage under `notation.splitRatio`. The Volltext button toggles the right panel; when hidden the page takes the full width. Editor's own toolbar sticks below the top bar (`top: var(--topbar-h)`).
- SVG export in `App.vue` reads the DOM via the selector `.editor .sheet svg` — keep that DOM path intact.

## Gotcha: warning line numbers

`Editor.vue`'s `cleanWarning()` remaps abcjs `Music Line:N` warnings to body line numbers by subtracting **5** — the exact number of header lines `abcHeader()` generates. If a header line is ever added (e.g. `Q:`), update both or the reported `Zeile N` drifts.
