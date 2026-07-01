<script setup lang="ts">
import { ref, reactive, watch, computed, nextTick, onMounted } from 'vue';
import { toAbc } from '../lib/converter';
import type { NotationDoc } from '../lib/types';

const props = defineProps<{
  doc: NotationDoc;
  saving?: boolean;
  hasFolder?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:doc', value: NotationDoc): void;
  (e: 'save'): void;
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
const popInputRef = ref<HTMLInputElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const titleRef = ref<HTMLHeadingElement | null>(null);
const subtitleRef = ref<HTMLDivElement | null>(null);

// --- State --------------------------------------------------------------
const errors = ref<string[]>([]);
const drawerOpen = ref(false);
const editingIdx = ref<number | null>(null);
const previewBody = ref<string | null>(null);
const popoverVisible = ref(false);
const popoverPos = reactive({ top: '0px', left: '0px' });
const popoverInput = ref('');
const popoverLabel = ref('');
let lastAbc = '';
let visualToSource: number[] = [];

interface MeasureRef { lineIdx: number; body: string }
function getMeasureRefs(): MeasureRef[] {
  const lines = local.text.split('\n');
  const refs: MeasureRef[] = [];
  lines.forEach((line, idx) => {
    const stripped = line.replace(/%.*$/, '').trim();
    if (!stripped) return;
    refs.push({ lineIdx: idx, body: stripped });
  });
  return refs;
}

// Returns N if the line is an Nx multi-measure rest (mirroring the parser),
// otherwise 0. Tolerates surrounding bar/volta markers.
function multiRestN(body: string): number {
  const toks = body.split(/\s+/).filter(Boolean);
  while (toks.length && (toks[0] === '|' || toks[0] === '|:' || /^\[[12]$/.test(toks[0]))) toks.shift();
  while (toks.length && (toks[toks.length - 1] === '|' || toks[toks.length - 1] === ':|' || toks[toks.length - 1] === '|]')) toks.pop();
  if (toks.length !== 1) return 0;
  const m = toks[0].match(/^(\d+)x$/);
  return m ? parseInt(m[1], 10) : 0;
}

function measureFromStartChar(abcSrc: string, startChar?: number): number {
  if (typeof startChar !== 'number') return -1;
  let count = 0;
  for (let i = 0; i < startChar && i < abcSrc.length; i++) {
    if (abcSrc.charCodeAt(i) === 124) count++;
  }
  return count;
}

// --- Rendering ----------------------------------------------------------
function render() {
  if (!sheetRef.value) return;
  let textForRender = local.text;
  if (editingIdx.value !== null && previewBody.value !== null) {
    const refs = getMeasureRefs();
    if (editingIdx.value < refs.length) {
      const lines = local.text.split('\n');
      lines[refs[editingIdx.value].lineIdx] = previewBody.value;
      textForRender = lines.join('\n');
    }
  }
  const result = toAbc(textForRender, {
    title: '',
    meter: local.meter,
    key: local.key,
  });
  lastAbc = result.abc;
  errors.value = result.errors;
  visualToSource = [];
  result.measures.forEach((m, srcIdx) => {
    const span = m.multiRest ?? 1;
    for (let k = 0; k < span; k++) visualToSource.push(srcIdx);
  });
  ABCJS.renderAbc(sheetRef.value, result.abc, {
    responsive: 'resize',
    staffwidth: 1140,
    scale: 1.15,
    paddingtop: 4,
    paddingbottom: 4,
    clickListener: (
      abcElem: any,
      _tn: number,
      _classes: string,
      _analysis: any,
      _drag: any,
      mouseEvent: MouseEvent
    ) => {
      if (!abcElem) return;
      const visualIdx = measureFromStartChar(lastAbc, abcElem.startChar);
      if (visualIdx < 0 || visualIdx >= visualToSource.length) return;
      const srcIdx = visualToSource[visualIdx];
      const refs = getMeasureRefs();
      if (srcIdx >= refs.length) return;
      if (mouseEvent && typeof mouseEvent.clientY === 'number') {
        popoverPos.top = `${window.scrollY + mouseEvent.clientY + 16}px`;
        popoverPos.left = `${Math.max(8, window.scrollX + mouseEvent.clientX - 20)}px`;
      }
      openPopover(srcIdx);
    },
  });
}

// Re-render whenever the doc / meter / key change.
watch(
  () => [local.text, local.meter, local.key],
  () => render(),
  { flush: 'post' }
);

// --- Popover ------------------------------------------------------------
function openPopover(idx: number) {
  const refs = getMeasureRefs();
  if (idx >= refs.length) return;
  editingIdx.value = idx;
  previewBody.value = null;
  // m-numbering accounts for Nx blocks in earlier rows.
  let startBar = 1;
  for (let k = 0; k < idx; k++) {
    startBar += multiRestN(refs[k].body) || 1;
  }
  const span = multiRestN(refs[idx].body) || 1;
  popoverLabel.value = span > 1 ? `m${startBar}-m${startBar + span - 1}` : `m${startBar}`;
  popoverInput.value = refs[idx].body;
  popoverVisible.value = true;
  nextTick(() => {
    popInputRef.value?.focus();
    popInputRef.value?.select();
  });
}

function closePopover() {
  popoverVisible.value = false;
  editingIdx.value = null;
  previewBody.value = null;
  render();
}

function commitPopover() {
  if (editingIdx.value === null) return;
  const idx = editingIdx.value;
  const refs = getMeasureRefs();
  if (idx < refs.length) {
    const lines = local.text.split('\n');
    lines[refs[idx].lineIdx] = popoverInput.value.trim();
    local.text = lines.join('\n');
    emitUpdate();
    updateGutter();
  }
  previewBody.value = null;
  editingIdx.value = null;
  popoverVisible.value = false;
  render();
}

function deleteCurrentMeasure() {
  if (editingIdx.value === null) return;
  if (!confirm(`Takt ${popoverLabel.value} löschen?`)) return;
  const refs = getMeasureRefs();
  const idx = editingIdx.value;
  if (idx < refs.length) {
    const lines = local.text.split('\n');
    lines.splice(refs[idx].lineIdx, 1);
    local.text = lines.join('\n');
    emitUpdate();
    updateGutter();
  }
  previewBody.value = null;
  editingIdx.value = null;
  popoverVisible.value = false;
  render();
}

function onPopoverInput() {
  if (editingIdx.value === null) return;
  previewBody.value = popoverInput.value;
  render();
}

function onPopoverKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') { e.preventDefault(); commitPopover(); }
  else if (e.key === 'Escape') closePopover();
  else if (e.key === 'Tab') {
    e.preventDefault();
    const curr = editingIdx.value;
    commitPopover();
    const refs = getMeasureRefs();
    if (!refs.length || curr === null) return;
    const next = (curr + 1) % refs.length;
    setTimeout(() => openPopover(next), 60);
  }
}

function onDocMousedown(e: MouseEvent) {
  if (!popoverVisible.value) return;
  const t = e.target as Node;
  if (popoverRef.value?.contains(t)) return;
  if (sheetRef.value?.contains(t)) return;
  closePopover();
}

// --- Drawer / gutter ----------------------------------------------------
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

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value;
  if (drawerOpen.value) nextTick(() => { updateGutter(); onBulkScroll(); });
}

function onPrint() {
  if (popoverVisible.value) closePopover();
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
  document.addEventListener('mousedown', onDocMousedown);
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
const measureCount = computed(() =>
  getMeasureRefs().reduce((acc, r) => acc + (multiRestN(r.body) || 1), 0)
);
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
      <button :class="['toggle', drawerOpen ? 'on' : '']" @click="toggleDrawer">Volltext</button>
      <button @click="emit('export-svg')">SVG</button>
      <button class="primary" @click="onPrint">PDF</button>
    </header>

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
      <div class="hint">
        Auf einen Takt klicken zum Bearbeiten ·
        <kbd>Tab</kbd> springt zum nächsten ·
        <kbd>Enter</kbd> speichert ·
        <kbd>Esc</kbd> schließt ·
        <span class="meta">{{ measureCount }} Takte</span>
      </div>
    </article>

    <section class="drawer" v-show="drawerOpen">
      <h3>Volltext · eine Zeile pro Takt</h3>
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
        Leere Zeilen und Kommentare (<code>%</code>) werden ignoriert.
      </div>
    </section>

    <div class="errors" v-show="errors.length">
      <div v-for="(e, i) in errors" :key="i">{{ e }}</div>
    </div>

    <div
      ref="popoverRef"
      class="popover"
      v-show="popoverVisible"
      :style="{ top: popoverPos.top, left: popoverPos.left }"
    >
      <span class="label">{{ popoverLabel }}</span>
      <input
        ref="popInputRef"
        v-model="popoverInput"
        type="text"
        spellcheck="false"
        @input="onPopoverInput"
        @keydown="onPopoverKeydown"
      />
      <div class="actions">
        <span class="hint-inline">↵ speichern · ⇥ nächster · Esc abbrechen</span>
        <button class="danger" @click="deleteCurrentMeasure">Löschen</button>
        <button @click="closePopover">Abbrechen</button>
        <button class="primary" @click="commitPopover">Speichern</button>
      </div>
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
  top: 0;
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

.page {
  width: min(100%, 1240px);
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

.sheet { margin-top: 22px; cursor: pointer; }
.sheet :deep(svg) { width: 100%; height: auto; display: block; }
.sheet :deep(.abcjs-note_selected) { fill: var(--accent); }

.hint {
  margin-top: 18px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.hint kbd {
  font: 12px "JetBrains Mono", monospace;
  background: #efece4;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 6px;
}
.hint .meta { margin-left: 12px; }

.drawer {
  width: min(100%, 1240px);
  margin: 0 auto 60px;
  padding: 0 44px;
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
  width: min(100%, 1240px);
  margin: 0 auto 18px;
  padding: 8px 12px;
  border: 1px solid var(--error);
  background: #fdf2ef;
  border-radius: 6px;
  color: var(--error);
  font: 12px/1.5 "JetBrains Mono", monospace;
  white-space: pre-wrap;
}

.popover {
  position: absolute;
  z-index: 30;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(20, 20, 20, 0.16);
  padding: 14px 16px 12px;
  min-width: 360px;
}
.popover::before {
  content: '';
  position: absolute;
  top: -7px; left: 24px;
  width: 12px; height: 12px;
  background: #fff;
  border-left: 1px solid var(--line);
  border-top: 1px solid var(--line);
  transform: rotate(45deg);
}
.popover .label {
  font: 600 12px "JetBrains Mono", monospace;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
  padding: 3px 7px;
  display: inline-block;
}
.popover input {
  width: 100%;
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 9px 10px;
  font: 14px "JetBrains Mono", "SF Mono", Menlo, monospace;
  outline: 0;
}
.popover input:focus { border-color: var(--accent); }
.popover .actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  align-items: center;
}
.popover .hint-inline {
  flex: 1;
  color: var(--muted);
  font-size: 11px;
}
.popover button {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font: 12px inherit;
}
.popover button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.popover button.danger { color: var(--error); }
.popover button.danger:hover { background: #fdf2ef; border-color: var(--error); }

@media print {
  .editor-header, .drawer, .popover, .hint, .errors { display: none !important; }
  .page { box-shadow: none; border: 0; max-width: none; margin: 0; padding: 12mm; }
  .sheet { cursor: default; }
  body { background: #fff; }
}
</style>
