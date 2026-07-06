<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import Sidebar from './components/Sidebar.vue';
import Editor from './components/Editor.vue';
import {
  isSupported,
  getSavedFolder,
  hasPermission,
  requestPermission,
  pickFolder,
  listNotations,
  readNotation,
  writeNotation,
  createNotation,
  deleteNotation,
  renameNotation,
} from './lib/storage';
import { abcHeader } from './lib/abc';
import { EXAMPLE_DOC, type NotationDoc, type NotationFile } from './lib/types';

const supported = isSupported();
const folder = ref<FileSystemDirectoryHandle | null>(null);
const needsPermission = ref(false);
const files = ref<NotationFile[]>([]);
const currentFile = ref<NotationFile | null>(null);
const doc = reactive<NotationDoc>({ ...EXAMPLE_DOC });
const saving = ref(false);
const dirty = ref(false);
const menuOpen = ref(false);

const folderName = computed(() => folder.value?.name ?? null);
const currentId = computed(() => currentFile.value?.id ?? null);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// --- Bootstrap ----------------------------------------------------------

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) menuOpen.value = false;
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown);
  if (!supported) return;
  const saved = await getSavedFolder();
  if (!saved) return;
  folder.value = saved;
  const ok = await hasPermission(saved);
  if (!ok) {
    needsPermission.value = true;
    return;
  }
  await refreshList();
  await openMostRecent();
});

async function refreshList() {
  if (!folder.value) return;
  files.value = await listNotations(folder.value);
}

async function openMostRecent() {
  if (files.value.length) {
    await openFile(files.value[0]);
  }
}

// --- Folder picker ------------------------------------------------------

async function onPickFolder() {
  try {
    const handle = await pickFolder();
    folder.value = handle;
    needsPermission.value = false;
    await refreshList();
    if (!files.value.length) {
      // First-time: seed with the African Market example.
      const created = await createNotation(handle, { ...EXAMPLE_DOC });
      files.value = [created, ...files.value];
      await openFile(created);
    } else {
      await openMostRecent();
    }
  } catch (err) {
    // User cancelled — ignore.
    console.warn('pickFolder cancelled or failed', err);
  }
}

async function onGrantPermission() {
  if (!folder.value) return;
  const ok = await requestPermission(folder.value);
  if (!ok) return;
  needsPermission.value = false;
  await refreshList();
  await openMostRecent();
}

// --- Open / new / delete / rename ---------------------------------------

async function openFile(file: NotationFile) {
  const parsed = await readNotation(file);
  currentFile.value = file;
  Object.assign(doc, parsed);
  dirty.value = false;
}

async function onNew() {
  if (!folder.value) return;
  menuOpen.value = false;
  const blank: NotationDoc = {
    title: 'Neues Stück',
    subtitle: '',
    meter: '4/4',
    key: 'C',
    text: 'z2 z2 z2 z2 |]',
  };
  const created = await createNotation(folder.value, blank);
  files.value = [created, ...files.value];
  await openFile(created);
}

async function onSelect(file: NotationFile) {
  menuOpen.value = false;
  await openFile(file);
}

async function onDelete(file: NotationFile) {
  if (!folder.value) return;
  if (!confirm(`„${file.title || file.id}" löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
  await deleteNotation(folder.value, file);
  files.value = files.value.filter(f => f.id !== file.id);
  if (currentFile.value?.id === file.id) {
    currentFile.value = null;
    if (files.value.length) await openFile(files.value[0]);
    else Object.assign(doc, { ...EXAMPLE_DOC });
  }
}

async function onRename(file: NotationFile) {
  if (!folder.value) return;
  const newTitle = prompt('Neuer Titel:', file.title);
  if (!newTitle || newTitle.trim() === file.title) return;
  const updated = await renameNotation(folder.value, file, newTitle.trim());
  files.value = files.value.map(f => (f.id === file.id ? updated : f));
  if (currentFile.value?.id === file.id) {
    currentFile.value = updated;
    doc.title = updated.title;
  }
}

// --- Auto-save ----------------------------------------------------------

function scheduleSave() {
  if (!currentFile.value || !folder.value) return;
  dirty.value = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!currentFile.value) return;
    saving.value = true;
    try {
      await writeNotation(currentFile.value, { ...doc });
      // Reflect new title in the sidebar
      files.value = files.value.map(f =>
        f.id === currentFile.value!.id
          ? { ...f, title: doc.title || f.id, modifiedAt: Date.now() }
          : f
      );
      dirty.value = false;
    } finally {
      saving.value = false;
    }
  }, 400);
}

function onDocUpdate(next: NotationDoc) {
  Object.assign(doc, next);
  scheduleSave();
}

// --- SVG export ---------------------------------------------------------

function onExportSvg() {
  // The on-screen sheet is one SVG per system (for print pagination), so
  // re-render the whole tune off-screen into a single SVG for the file.
  const abc = abcHeader({ title: '', meter: doc.meter, key: doc.key }) + doc.text + '\n';
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  document.body.appendChild(host);
  try {
    ABCJS.renderAbc(host, abc, {
      staffwidth: 1140,
      scale: 1.15,
      paddingtop: 4,
      paddingbottom: 4,
    });
    const svg = host.querySelector('svg');
    if (!svg) return;
    const serialized = new XMLSerializer().serializeToString(svg);
    const blob = new Blob(
      [`<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`],
      { type: 'image/svg+xml;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (doc.title || 'notation').replace(/[^a-z0-9_-]+/gi, '_');
    a.download = `${slug}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    host.remove();
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <button
        class="hamburger"
        aria-label="Menü"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >☰</button>
      <h1 class="brand">notation</h1>
    </header>
    <Sidebar
      :open="menuOpen"
      :folder-name="folderName"
      :needs-permission="needsPermission"
      :files="files"
      :current-id="currentId"
      :supported="supported"
      @close="menuOpen = false"
      @pick-folder="onPickFolder"
      @grant-permission="onGrantPermission"
      @select="onSelect"
      @new-notation="onNew"
      @delete="onDelete"
      @rename="onRename"
    />
    <main class="main">
      <Editor
        :doc="doc"
        :saving="saving || dirty"
        :has-folder="!!currentFile"
        @update:doc="onDocUpdate"
        @export-svg="onExportSvg"
      />
    </main>
  </div>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  background: #faf6ec;
  border-bottom: 1px solid var(--line);
}
.hamburger {
  border: 0;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--ink);
}
.hamburger:hover { background: rgba(0, 0, 0, 0.05); }
.brand {
  font-family: "Iowan Old Style", Georgia, serif;
  font-size: 19px;
  font-weight: 600;
  margin: 0;
}
.main {
  min-width: 0;
}

@media print {
  .topbar { display: none !important; }
}
</style>
