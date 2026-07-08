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
2. `abcHeader()` in `src/lib/abc.ts` prepends the generated 5-line tune header (`X:1`, `T:`, `M:` from meter, `L:1/8`, `K:` from key) to the body. Meter and key come from the toolbar dropdowns, never from the text. Both callers (`render()` in `Editor.vue`, `onExportSvg()` in `App.vue`) pass `title: ''`, so the `T:` line is always empty — the visible title/subtitle are **contenteditable fields on the rendered page**; `doc.title` drives the filename and that heading, never the ABC score header.
3. `abcjs` renders the ABC string to SVG. **`abcjs` (pinned to 6.4.3, `abcjs-basic-min.js` build) is loaded as a global `ABCJS` from a jsdelivr CDN `<script>` in `index.html`** — it is NOT an npm dependency and NOT imported. Its type is hand-declared in `src/env.d.ts`. Rendering therefore only works in a browser, never in Node.

`src/App.vue` bootstraps the saved folder handle (persisted in IndexedDB via `storage.ts`), handles file CRUD, and auto-saves with a 400 ms debounce. `Editor.vue` re-renders on every change to text/meter/key. `Sidebar.vue` is the file list + folder picker.

File naming and CRUD quirks: filenames come from `slugify()` in `frontmatter.ts` (umlauts mapped ä→ae, ö→oe, ü→ue, ß→ss) with `-2`/`-3` suffixes on collision (`storage.ts`); rename is implemented as copy+delete because the File System Access API has no rename; picking an empty folder auto-seeds `EXAMPLE_DOC` ("African Market", `src/lib/types.ts`); "+ Neu" creates `Neues Stück` with body `z2 z2 z2 z2 |]`; rename/delete use native German `prompt()`/`confirm()` dialogs. Files without a frontmatter block parse as pure ABC body with defaults (meter `4/4`, key `C`).

## UI layout

- `App.vue` renders a sticky top bar (hamburger + wordmark, height `--topbar-h` from `styles.css`) above `Editor.vue`. The hamburger toggles `Sidebar.vue`, which is an **offcanvas panel** (fixed, slides in from the left over a backdrop; closes on backdrop click, ×, Escape, file select, or "+ Neu").
- `Editor.vue` is a **split view**: rendered page (left) and the ABC textarea panel (right), separated by a draggable splitter (pointer capture, min widths 320/280 px). The left-pane ratio persists in localStorage under `notation.splitRatio`. The Volltext button toggles the right panel; when hidden the page takes the full width. Editor's own toolbar sticks below the top bar (`top: var(--topbar-h)`).
- The Editor toolbar holds: `Takt` select (4/4, 3/4, 2/4, 6/8, 12/8), `Tonart` select (C, G, D, A, E, F, Bb, Eb, Ab, Am, Em, Dm, Gm), the save-status pill (`speichert …` / `gespeichert` / `lokal`), `Volltext`, `SVG` (export), and `PDF` (`onPrint()` → `window.print()`). The textarea has a line-number gutter kept in scroll-sync by `updateGutter()`. Title/subtitle on the page are contenteditable (Enter blurs via `@keydown.enter.prevent`).
- Print CSS lives in **scoped component styles, not `styles.css`** (`styles.css` only holds `:root` tokens like `--topbar-h` and a body reset): `Editor.vue` has the `break-inside: avoid` rules; `App.vue` and `Sidebar.vue` hide the top bar / sidebar under `@media print`.
- The sheet renders with `oneSvgPerLine: true` and **without** `responsive: 'resize'`, so `.sheet` contains one `<svg>` per system, scaled purely by CSS (`width: 100%; height: auto`); the `@media print` rule `break-inside: avoid` (in `Editor.vue`) is what makes print-to-PDF break pages between systems instead of through them. Do not reintroduce `responsive: 'resize'` — its JS-driven inline sizing breaks print layout (blank/extra pages, sliced systems).
- `render()` in `Editor.vue` runs a post-render fixup that strips abcjs's inline sizing (fixed pixel heights on `.sheet` and the per-system wrapper divs, `overflow: hidden`, svg `width`/`height` attributes) and converts the wrappers' height surplus (= `%%staffsep` inter-system spacing) into percentage `padding-bottom`. Two hard-won Chromium constraints live here: wrapper `overflow: hidden` makes Chrome skip painting the bottom of a CSS-scaled svg (last voice of a multi-voice system invisible until a repaint), and a percentage **margin** (instead of padding) makes Chrome ignore `break-inside: avoid` and slice systems across print pages.
- SVG export in `App.vue` does NOT read the on-screen DOM (that's multiple SVGs now) — it re-renders the tune off-screen without `oneSvgPerLine` into a single SVG and serializes that.

## Gotcha: warning line numbers

`Editor.vue`'s `cleanWarning()` remaps abcjs `Music Line:N` warnings to body line numbers by subtracting **5** — the exact number of header lines `abcHeader()` generates. If a header line is ever added (e.g. `Q:`), update both or the reported `Zeile N` drifts.
