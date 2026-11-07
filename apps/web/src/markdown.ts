export type MdInline = { type: 'text'; text: string } | { type: 'code'; text: string };

export type MdBlock =
  | { type: 'p'; inlines: MdInline[] }
  | { type: 'pre'; text: string }
  | { type: 'ul'; items: MdInline[][] }
  | { type: 'ol'; items: MdInline[][] };

function parseInlines(text: string): MdInline[] {
  const parts: MdInline[] = [];
  const pattern = /`([^`\n]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: 'text', text: text.slice(last, index) });
    parts.push({ type: 'code', text: match[1] ?? '' });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  if (parts.length === 0) parts.push({ type: 'text', text: '' });
  return parts;
}

/** Block parser for the small Markdown subset the timeline renders. Tags stay text. */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'pre', text: body.join('\n') });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        items.push(parseInlines((lines[i] ?? '').replace(/^[-*]\s+/, '')));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? '')) {
        items.push(parseInlines((lines[i] ?? '').replace(/^\d+\.\s+/, '')));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (
        current.trim() === '' ||
        current.startsWith('```') ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break;
      }
      para.push(current);
      i += 1;
    }
    blocks.push({ type: 'p', inlines: parseInlines(para.join('\n')) });
  }
  return blocks;
}
