// ABC tune header. NOTE: exactly 5 lines — Editor.vue's cleanWarning()
// remaps abcjs "Music Line:N" warnings to body lines by subtracting 5.
export function abcHeader(o: { title: string; meter: string; key: string }): string {
  return `X:1\nT:${o.title}\nM:${o.meter}\nL:1/8\nK:${o.key}\n`;
}
