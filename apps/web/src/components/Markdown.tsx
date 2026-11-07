import type { ReactNode } from 'react';
import { parseMarkdown, type MdInline } from '../markdown';

function inlines(parts: MdInline[]): ReactNode[] {
  return parts.map((part, index) =>
    part.type === 'code' ? (
      <code key={index} className="md-inline">
        {part.text}
      </code>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

/** Renders a safe subset of Markdown. Children are text nodes, so raw HTML is not executed. */
export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        if (block.type === 'pre') {
          return (
            <pre key={index} className="md-pre">
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'ul' || block.type === 'ol') {
          const Tag = block.type === 'ul' ? 'ul' : 'ol';
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inlines(item)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={index}>{inlines(block.inlines)}</p>;
      })}
    </div>
  );
}
