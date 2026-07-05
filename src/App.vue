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
import { EXAMPLE_DOC, type NotationDoc, type NotationFile } from './lib/types';

const supported = isSupported();
const folder = ref<FileSystemDirectoryHandle | null>(null);
const needsPermission = ref(false);
const files = ref<NotationFile[]>([]);
const currentFile = ref<NotationFile | null>(null);
const doc = reactive<NotationDoc>({ ...EXAMPLE_DOC });
const saving = ref(false);
const dirty = ref(false);

const folderName = computed(() => folder.value?.name ?? null);
const currentId = computed(() => currentFile.value?.id ?? null);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// --- Bootstrap ----------------------------------------------------------

onMounted(async () => {
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
  const blank: NotationDoc = {
    title: 'Neues Stück',
    subtitle: '',
    meter: '4/4',
    key: 'C',
    mode: 'custom',
    text: '4p p p p',
  };
  const created = await createNotation(folder.value, blank);
  files.value = [created, ...files.value];
  await openFile(created);
}

async function onSelect(file: NotationFile) {
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
  const svg = document.querySelector('.editor .sheet svg') as SVGElement | null;
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGElement;
  const serialized = new XMLSerializer().serializeToString(clone);
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
}
</script>

<template>
  <div class="layout">
    <Sidebar
      :folder-name="folderName"
      :needs-permission="needsPermission"
      :files="files"
      :current-id="currentId"
      :supported="supported"
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
.layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 100vh;
}
.main {
  min-width: 0;
  min-height: 100vh;
}

@media print {
  .layout { grid-template-columns: 1fr; }
  aside { display: none !important; }
}
</style>
