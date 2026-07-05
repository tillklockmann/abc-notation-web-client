<script setup lang="ts">
import { ref, reactive, watch, computed, nextTick, onMounted } from 'vue';
import { abcHeader } from '../lib/abc';
import type { NotationDoc } from '../lib/types';

const props = defineProps<{
  doc: NotationDoc;
  saving?: boolean;
  hasFolder?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:doc', value: NotationDoc): void;
  (e: 'export-svg'): void;
}>();

// Local mirror of the document for fine-grained reactivity.
const local = reactive<NotationDoc>({ ...props.doc });

watch(
  () => props.doc,
  (next) => {
    local.title = next.title;
    local.subtitle = next.subtitle;
    local.meter = next.meter;
    local.key = next.key;
    local.text = next.text;
    nextTick(() => { updateGutter(); onBulkScroll(); });
  },
  { deep: true }
);

function emitUpdate() {
  emit('update:doc', { ...local });
}

// --- Refs ---------------------------------------------------------------
const sheetRef = ref<HTMLDivElement | null>(null);
const bulkRef = ref<HTMLTextAreaElement | null>(null);
const gutterRef = ref<HTMLDivElement | null>(null);
const titleRef = ref<HTMLHeadingElement | null>(null);
const subtitleRef = ref<HTMLDivElement | null>(null);
const splitRef = ref<HTMLDivElement | null>(null);

// --- State --------------------------------------------------------------
const errors = ref<string[]>([]);
const panelOpen = ref(true);
const splitRatio = ref(loadSplitRatio());
const dragging = ref(false);

const MIN_LEFT = 320;
const MIN_RIGHT = 280;
const RATIO_KEY = 'notation.splitRatio';

function loadSplitRatio(): number {
  const v = Number(localStorage.getItem(RATIO_KEY));
  return Number.isFinite(v) && v >= 0.2 && v <= 0.85 ? v : 0.6;
}

// --- Rendering ----------------------------------------------------------
// abcjs warnings embed HTML (a <span> around the offending character,
// entity-encoded context); the errors block renders escaped text.
// Line numbers count the 5 generated header lines, so remap to body lines.
function cleanWarning(w: string): string {
  return w
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/^Music Line:(\d+)/, (m, l) => {
      const n = Number(l) - 5;
      return n >= 1 ? `Zeile ${n}` : m;
    });
}

function render() {
  if (!sheetRef.value) return;
  const abc = abcHeader({ title: '', meter: local.meter, key: local.key }) + local.text + '\n';
  try {
    const tunes = ABCJS.renderAbc(sheetRef.value, abc, {
      responsive: 'resize',
      staffwidth: 1140,
      scale: 1.15,
      paddingtop: 4,
      paddingbottom: 4,
    });
    errors.value = (tunes ?? []).flatMap((t) => t?.warnings ?? []).map(cleanWarning);
  } catch (err) {
    errors.value = [`ABC-Fehler: ${err instanceof Error ? err.message : String(err)}`];
  }
}

// Re-render whenever the doc / meter / key change.
watch(
  () => [local.text, local.meter, local.key],
  () => render(),
  { flush: 'post' }
);

// --- Text panel / gutter --------------------------------------------------
function updateGutter() {
  if (!gutterRef.value) return;
  const count = local.text.split('\n').length || 1;
  const out: string[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = String(i + 1);
  gutterRef.value.textContent = out.join('\n');
}

function onBulkInput(e: Event) {
  const v = (e.target as HTMLTextAreaElement).value;
  local.text = v;
  emitUpdate();
  updateGutter();
}

function onBulkScroll() {
  if (!gutterRef.value || !bulkRef.value) return;
  gutterRef.value.style.marginTop = `-${bulkRef.value.scrollTop}px`;
}

function togglePanel() {
  panelOpen.value = !panelOpen.value;
  if (panelOpen.value) nextTick(() => { updateGutter(); onBulkScroll(); });
}

// --- Splitter -------------------------------------------------------------
function onSplitterDown(e: PointerEvent) {
  dragging.value = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onSplitterMove(e: PointerEvent) {
  if (!dragging.value || !splitRef.value) return;
  const rect = splitRef.value.getBoundingClientRect();
  if (rect.width < MIN_LEFT + MIN_RIGHT + 8) return;
  const min = MIN_LEFT / rect.width;
  const max = 1 - MIN_RIGHT / rect.width;
  splitRatio.value = Math.min(max, Math.max(min, (e.clientX - rect.left) / rect.width));
}

function onSplitterUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  localStorage.setItem(RATIO_KEY, String(splitRatio.value));
}

function onPrint() {
  window.print();
}

// --- Title / subtitle (contenteditable) ---------------------------------
function onTitleInput() {
  if (!titleRef.value) return;
  local.title = titleRef.value.textContent || '';
  emitUpdate();
}
function onSubtitleInput() {
  if (!subtitleRef.value) return;
  local.subtitle = subtitleRef.value.textContent || '';
  emitUpdate();
}

// --- Meter / key --------------------------------------------------------
function onMeterChange(e: Event) {
  local.meter = (e.target as HTMLSelectElement).value;
  emitUpdate();
}
function onKeyChange(e: Event) {
  local.key = (e.target as HTMLSelectElement).value;
  emitUpdate();
}

// --- Boot ---------------------------------------------------------------
onMounted(() => {
  // Initial population of contenteditable text and gutter
  if (titleRef.value) titleRef.value.textContent = local.title;
  if (subtitleRef.value) subtitleRef.value.textContent = local.subtitle;
  updateGutter();
  render();
});

watch(
  () => [props.doc.title, props.doc.subtitle],
  () => {
    nextTick(() => {
      if (titleRef.value && titleRef.value.textContent !== local.title) {
        titleRef.value.textContent = local.title;
      }
      if (subtitleRef.value && subtitleRef.value.textContent !== local.subtitle) {
        subtitleRef.value.textContent = local.subtitle;
      }
    });
  }
);

const titleEmpty = computed(() => !local.title);
const subtitleEmpty = computed(() => !local.subtitle);
</script>

<template>
  <div class="editor">
    <header class="editor-header">
      <span class="field">Takt
        <select :value="local.meter" @change="onMeterChange">
          <option value="4/4">4/4</option>
          <option value="3/4">3/4</option>
          <option value="2/4">2/4</option>
          <option value="6/8">6/8</option>
          <option value="12/8">12/8</option>
        </select>
      </span>
      <span class="field">Tonart
        <select :value="local.key" @change="onKeyChange">
          <option>C</option><option>G</option><option>D</option><option>A</option><option>E</option>
          <option>F</option><option>Bb</option><option>Eb</option><option>Ab</option>
          <option>Am</option><option>Em</option><option>Dm</option><option>Gm</option>
        </select>
      </span>
      <span class="status" :class="{ on: saving }">
        {{ saving ? 'speichert …' : (hasFolder ? 'gespeichert' : 'lokal') }}
      </span>
      <span class="spacer"></span>
      <button :class="['toggle', panelOpen ? 'on' : '']" @click="togglePanel">Volltext</button>
      <button @click="emit('export-svg')">SVG</button>
      <button class="primary" @click="onPrint">PDF</button>
    </header>

    <div class="split" ref="splitRef">
      <div
        class="pane-page"
        :class="{ constrained: panelOpen }"
        :style="panelOpen ? { flexBasis: (splitRatio * 100) + '%' } : undefined"
      >
        <article class="page">
          <h2
            ref="titleRef"
            class="title"
            contenteditable="true"
            spellcheck="false"
            :data-empty="titleEmpty"
            data-placeholder="Titel"
            @input="onTitleInput"
            @keydown.enter.prevent="($event.target as HTMLElement).blur()"
          ></h2>
          <div
            ref="subtitleRef"
            class="subtitle"
            contenteditable="true"
            spellcheck="false"
            :data-empty="subtitleEmpty"
            data-placeholder="Untertitel"
            @input="onSubtitleInput"
            @keydown.enter.prevent="($event.target as HTMLElement).blur()"
          ></div>
          <div ref="sheetRef" class="sheet"></div>
        </article>
        <div class="errors" v-show="errors.length">
          <div v-for="(e, i) in errors" :key="i">{{ e }}</div>
        </div>
      </div>

      <div
        class="splitter"
        v-show="panelOpen"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ansicht teilen"
        @pointerdown="onSplitterDown"
        @pointermove="onSplitterMove"
        @pointerup="onSplitterUp"
        @pointercancel="onSplitterUp"
      ></div>

      <section class="drawer" v-show="panelOpen">
        <h3>Volltext · ABC-Notation</h3>
        <div class="code-block">
          <div class="gutter"><div ref="gutterRef" class="gutter-inner"></div></div>
          <textarea
            ref="bulkRef"
            :value="local.text"
            spellcheck="false"
            wrap="off"
            @input="onBulkInput"
            @scroll="onBulkScroll"
          ></textarea>
        </div>
        <div class="hint">
          Roh-ABC (Tune-Body) · Kommentare mit <code>%</code> · Leerzeilen beenden das Stück.
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: var(--bg);
}

.editor-header {
  padding: 10px 22px;
  background: rgba(255, 253, 246, 0.92);
  backdrop-filter: saturate(140%) blur(6px);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: var(--topbar-h);
  z-index: 20;
}
.editor-header .field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}
.editor-header select {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--ink);
}
.editor-header .status {
  font-size: 12px;
  color: var(--muted);
  background: var(--accent-soft);
  padding: 3px 8px;
  border-radius: 999px;
}
.editor-header .status.on { background: #fff4d9; color: #8a6b18; }
.editor-header .spacer { flex: 1; }
.editor-header button {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font: 13px inherit;
  cursor: pointer;
}
.editor-header button.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.editor-header button.toggle.on {
  background: var(--ink);
  color: #fff;
  border-color: var(--ink);
}

.split {
  display: flex;
  align-items: stretch;
}
.pane-page {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 22px;
}
.pane-page.constrained { flex: 0 0 auto; }

.splitter {
  flex: 0 0 6px;
  cursor: col-resize;
  border-left: 1px solid var(--line);
  transition: background 100ms;
  touch-action: none;
}
.splitter:hover { background: var(--accent-soft); }

.page {
  max-width: 1240px;
  margin: 22px auto 30px;
  padding: 32px 44px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 2px 18px rgba(40, 35, 20, 0.05);
}
.title {
  font-family: "Iowan Old Style", Georgia, serif;
  font-size: 26px;
  font-weight: 600;
  text-align: center;
  margin: 0;
  outline: 0;
  border-radius: 4px;
  padding: 2px 6px;
}
.subtitle {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  margin-top: 4px;
  font-style: italic;
  outline: 0;
  border-radius: 4px;
  padding: 2px 6px;
}
.title:focus, .subtitle:focus { background: var(--accent-soft); }
.title[data-empty="true"]::before,
.subtitle[data-empty="true"]::before {
  content: attr(data-placeholder);
  color: #c8c4b8;
}

.sheet { margin-top: 22px; }
.sheet :deep(svg) { width: 100%; height: auto; display: block; }

.hint {
  margin-top: 18px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.drawer {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
  padding: 22px 22px 60px;
}
.drawer h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0 0 10px;
}

.code-block {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  font: 13px/1.55 "JetBrains Mono", "SF Mono", Menlo, monospace;
  overflow: hidden;
}
.code-block .gutter {
  flex: 0 0 46px;
  background: #f5f1e6;
  color: #a8a294;
  border-right: 1px solid var(--line);
  overflow: hidden;
  padding: 12px 0;
  user-select: none;
}
.code-block .gutter-inner {
  padding: 0 10px 0 0;
  text-align: right;
  white-space: pre;
  line-height: 1.55;
  font-variant-numeric: tabular-nums;
}
.code-block textarea {
  flex: 1;
  min-height: 240px;
  border: 0;
  padding: 12px 14px;
  background: transparent;
  outline: 0;
  resize: vertical;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
  font: inherit;
  line-height: 1.55;
  color: var(--ink);
  tab-size: 2;
}

.errors {
  max-width: 1240px;
  margin: 0 auto 18px;
  padding: 8px 12px;
  border: 1px solid var(--error);
  background: #fdf2ef;
  border-radius: 6px;
  color: var(--error);
  font: 12px/1.5 "JetBrains Mono", monospace;
  white-space: pre-wrap;
}

@media print {
  .editor-header, .drawer, .splitter, .hint, .errors { display: none !important; }
  .split { display: block; }
  .pane-page { flex: none; width: 100% !important; padding: 0; }
  .page { box-shadow: none; border: 0; max-width: none; margin: 0; padding: 12mm; }
  body { background: #fff; }
}
</style>
