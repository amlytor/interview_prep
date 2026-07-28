// Small hand-rolled markdown renderer for study notes. Deliberately minimal
// (headings, bold, italic, inline code, lists, paragraphs) plus LaTeX math via
// KaTeX ($...$ inline, $$...$$ display). It emits React elements rather than
// raw HTML, so note content — including AI-generated drafts — can never inject
// script into the page.
import type { ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

function MathTex({ tex, display }: { tex: string; display: boolean }) {
  // katex.renderToString escapes its input; rendering errors show inline in
  // red instead of throwing (throwOnError: false).
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false });
  return (
    <span
      className={display ? "math-display" : "math-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Split a line of text into plain / code / math / bold / italic tokens.
// Precedence: inline code, then math, then bold, then italic.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One combined regex; alternation order sets the precedence.
  const pattern = /(`[^`]+`)|(\$[^$\n]+\$)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${k++}`;
    if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("$")) {
      out.push(<MathTex key={key} tex={token.slice(1, -1)} display={false} />);
    } else if (token.startsWith("**")) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render a markdown string (with $/$$ math) as React elements. */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line — block separator.
    if (trimmed === "") {
      i++;
      continue;
    }

    // Display math: a block starting with $$ and running to the closing $$
    // (which may be on the same line: "$$E = mc^2$$").
    if (trimmed.startsWith("$$")) {
      let tex: string;
      if (trimmed.length > 2 && trimmed.endsWith("$$")) {
        tex = trimmed.slice(2, -2);
        i++;
      } else {
        const buf: string[] = [trimmed.slice(2)];
        i++;
        while (i < lines.length && !lines[i].trim().endsWith("$$")) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          buf.push(lines[i].trim().slice(0, -2));
          i++;
        }
        tex = buf.join("\n");
      }
      blocks.push(
        <div className="md-math-block" key={key++}>
          <MathTex tex={tex} display />
        </div>,
      );
      continue;
    }

    // Headings (## etc.).
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h${key}`);
      const Tag = (`h${Math.min(level + 2, 6)}`) as "h3" | "h4" | "h5" | "h6"; // note h1/h2 map to h3/h4 in-app
      blocks.push(<Tag key={key++}>{content}</Tag>);
      i++;
      continue;
    }

    // Unordered list: consecutive lines starting with "- " or "* ".
    if (/^[-*]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, "");
        items.push(<li key={items.length}>{renderInline(itemText, `li${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    // Paragraph: consecutive non-blank, non-special lines joined together.
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("$$") &&
      !/^#{1,6}\s/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim())
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push(<p key={key++}>{renderInline(buf.join(" "), `p${key}`)}</p>);
  }

  return <div className="md-content">{blocks}</div>;
}
