<script setup lang="ts">
import { computed } from 'vue';
import type { NotationFile } from '../lib/types';

const props = defineProps<{
  folderName: string | null;
  needsPermission: boolean;
  files: NotationFile[];
  currentId: string | null;
  supported: boolean;
}>();

const emit = defineEmits<{
  (e: 'pick-folder'): void;
  (e: 'grant-permission'): void;
  (e: 'select', file: NotationFile): void;
  (e: 'new-notation'): void;
  (e: 'delete', file: NotationFile): void;
  (e: 'rename', file: NotationFile): void;
}>();

function relTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `vor ${d} T`;
  return new Date(ts).toLocaleDateString('de-DE');
}

const itemsView = computed(() => props.files.map(f => ({ ...f, rel: relTime(f.modifiedAt) })));
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <h1>notation</h1>
    </div>

    <div class="folder">
      <div class="folder-row">
        <span class="folder-label">{{ folderName ? 'Projektordner' : 'Kein Ordner' }}</span>
        <button class="ghost mini" @click="emit('pick-folder')" :title="folderName ? 'Ordner wechseln' : 'Ordner wählen'">
          {{ folderName ? '⤴' : '+' }}
        </button>
      </div>
      <div v-if="folderName" class="folder-name" :title="folderName">{{ folderName }}</div>

      <button v-if="needsPermission" class="grant" @click="emit('grant-permission')">
        Zugriff erneut erlauben
      </button>

      <p v-if="!supported" class="warn">
        Dieser Browser unterstützt das File System Access API nicht. Bitte Chrome oder Edge nutzen.
      </p>
      <p v-else-if="!folderName" class="muted small">
        Wähle einen Ordner auf deinem Rechner, in dem die <code>.notation</code>-Dateien abgelegt werden.
      </p>
    </div>

    <div class="list-header">
      <span>Stücke</span>
      <button class="primary mini" @click="emit('new-notation')" :disabled="!folderName || needsPermission">
        + Neu
      </button>
    </div>

    <ul class="list">
      <li v-if="folderName && !files.length && !needsPermission" class="empty">
        Noch keine Stücke. „+ Neu" zum Anfangen.
      </li>
      <li
        v-for="f in itemsView"
        :key="f.id"
        :class="['item', { active: f.id === currentId }]"
        @click="emit('select', f)"
      >
        <div class="item-main">
          <div class="item-title">{{ f.title || f.id }}</div>
          <div class="item-meta">{{ f.id }}.notation · {{ f.rel }}</div>
        </div>
        <div class="item-actions">
          <button
            class="icon"
            title="Umbenennen"
            @click.stop="emit('rename', f)"
          >✎</button>
          <button
            class="icon danger"
            title="Löschen"
            @click.stop="emit('delete', f)"
          >×</button>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.sidebar {
  background: #faf6ec;
  border-right: 1px solid var(--line);
  width: 280px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: sticky;
  top: 0;
  align-self: flex-start;
  max-height: 100vh;
  overflow-y: auto;
}

.brand {
  padding: 16px 18px 8px;
}
.brand h1 {
  font-family: "Iowan Old Style", Georgia, serif;
  font-size: 19px;
  font-weight: 600;
  margin: 0;
}

.folder {
  padding: 4px 18px 14px;
  border-bottom: 1px solid var(--line);
}
.folder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.folder-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.folder-name {
  font: 13px "JetBrains Mono", monospace;
  color: var(--ink);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grant {
  margin-top: 10px;
  width: 100%;
  background: #fff;
  border: 1px solid var(--accent);
  color: var(--accent);
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font: 13px inherit;
}
.warn {
  margin-top: 10px;
  background: #fdf2ef;
  border: 1px solid var(--error);
  color: var(--error);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.4;
}
.muted { color: var(--muted); }
.small { font-size: 12px; line-height: 1.45; margin: 8px 0 0; }
code {
  font: 12px "JetBrains Mono", monospace;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 4px;
}

.list-header {
  padding: 14px 18px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.list-header span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

button.mini {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  padding: 3px 9px;
  font: 12px inherit;
  cursor: pointer;
  color: var(--ink);
}
button.ghost {
  background: transparent;
  border-color: transparent;
  color: var(--muted);
}
button.ghost:hover { color: var(--ink); background: rgba(0,0,0,0.04); }
button.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
button.primary:disabled { opacity: 0.4; cursor: not-allowed; }

.list {
  list-style: none;
  margin: 0;
  padding: 0 8px 24px;
  flex: 1;
}
.list .empty {
  padding: 10px 12px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
}
.item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 100ms;
}
.item:hover { background: rgba(0,0,0,0.04); }
.item.active {
  background: var(--accent-soft);
}
.item-main { flex: 1; min-width: 0; }
.item-title {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item.active .item-title { color: var(--accent); }
.item-meta {
  font-size: 11px;
  color: var(--muted);
  font-family: "JetBrains Mono", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 100ms;
}
.item:hover .item-actions { opacity: 1; }
.icon {
  background: transparent;
  border: 0;
  color: var(--muted);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.icon:hover { background: rgba(0,0,0,0.06); color: var(--ink); }
.icon.danger:hover { color: var(--error); background: #fdf2ef; }
</style>
