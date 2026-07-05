import { DEFAULT_DOC, type NotationDoc } from './types';

export function parse(content: string): NotationDoc {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fm) {
    return { ...DEFAULT_DOC, text: content.replace(/\r\n/g, '\n') };
  }
  const meta: Record<string, string> = {};
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2];
  }
  return {
    title: meta.title ?? '',
    subtitle: meta.subtitle ?? '',
    meter: meta.meter || '4/4',
    key: meta.key || 'C',
    mode: meta.mode === 'abc' ? 'abc' : 'custom',
    text: fm[2].replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, ''),
  };
}

export function serialize(doc: NotationDoc): string {
  return [
    '---',
    `title: ${doc.title}`,
    `subtitle: ${doc.subtitle}`,
    `meter: ${doc.meter}`,
    `key: ${doc.key}`,
    `mode: ${doc.mode}`,
    '---',
    doc.text.replace(/\n+$/, ''),
    '',
  ].join('\n');
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

export function slugify(title: string): string {
  const base = title.toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'unbenannt';
}
