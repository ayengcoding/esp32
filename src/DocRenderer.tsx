/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Copy, Check, FileText } from 'lucide-react';

interface DocRendererProps {
  content: string;
  isDark: boolean;
}

export const DocRenderer: React.FC<DocRendererProps> = ({ content, isDark }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Helper to parse inline styles (bold, code, links)
  const renderInline = (text: string) => {
    // Split by inline code blocks `code`
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        const code = part.slice(1, -1);
        return (
          <code
            key={i}
            className={`font-mono text-xs px-1.5 py-0.5 rounded font-semibold ${
              isDark
                ? 'bg-slate-800 text-cyan-300 border border-slate-700'
                : 'bg-slate-100 text-cyan-700 border border-slate-300'
            }`}
          >
            {code}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong
            key={i}
            className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}
          >
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  // Split into raw blocks (code blocks vs text blocks)
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let i = 0;
  let codeBlockCounter = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Multiline Code Block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const fullCode = codeLines.join('\n');
      const curIdx = codeBlockCounter++;

      elements.push(
        <div key={`code-${curIdx}`} className="my-4 rounded-xl overflow-hidden border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900 border-b border-slate-800 text-xs">
            <span className="font-mono text-[11px] text-slate-400 uppercase font-semibold">
              {lang || 'code'}
            </span>
            <button
              onClick={() => handleCopyCode(fullCode, curIdx)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-all active:scale-95"
            >
              {copiedIndex === curIdx ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-3.5 sm:p-4 bg-slate-950 text-slate-200 font-mono text-[11px] sm:text-xs leading-relaxed overflow-x-auto">
            <code>{fullCode}</code>
          </pre>
        </div>
      );
      continue;
    }

    // Markdown Table
    if (line.startsWith('|') && line.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|') && lines[i].endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }

      if (tableLines.length >= 2) {
        const headerCols = tableLines[0]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        // line 1 is separator |:---|:---|
        const rowLines = tableLines.slice(2);

        elements.push(
          <div
            key={`table-${i}`}
            className={`my-4 overflow-x-auto rounded-xl border ${
              isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-white shadow-sm'
            }`}
          >
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className={isDark ? 'bg-slate-800/80 border-b border-slate-700' : 'bg-slate-100 border-b border-slate-200'}>
                  {headerCols.map((h, hIdx) => (
                    <th
                      key={hIdx}
                      className={`px-3 sm:px-4 py-2.5 font-bold uppercase tracking-wider text-[11px] ${
                        isDark ? 'text-slate-200' : 'text-slate-800'
                      }`}
                    >
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 dark:divide-slate-800">
                {rowLines.map((r, rIdx) => {
                  const cols = r
                    .split('|')
                    .slice(1, -1)
                    .map((c) => c.trim());
                  return (
                    <tr
                      key={rIdx}
                      className={
                        isDark
                          ? 'border-b border-slate-800/60 hover:bg-slate-800/30'
                          : 'border-b border-slate-100 hover:bg-slate-50'
                      }
                    >
                      {cols.map((col, cIdx) => (
                        <td
                          key={cIdx}
                          className={`px-3 sm:px-4 py-2.5 leading-relaxed ${
                            isDark ? 'text-slate-300' : 'text-slate-700'
                          }`}
                        >
                          {renderInline(col)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Horizontal Rule
    if (line.trim() === '---') {
      elements.push(
        <hr
          key={`hr-${i}`}
          className={`my-5 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}
        />
      );
      i++;
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(
        <h1
          key={`h1-${i}`}
          className={`text-lg sm:text-xl md:text-2xl font-extrabold tracking-tight mt-4 mb-3 pb-2.5 border-b ${
            isDark ? 'text-slate-100 border-slate-800' : 'text-slate-900 border-slate-200'
          }`}
        >
          {renderInline(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      elements.push(
        <h2
          key={`h2-${i}`}
          className={`text-base sm:text-lg font-bold mt-5 mb-2.5 flex items-center gap-2 ${
            isDark ? 'text-cyan-400' : 'text-cyan-700'
          }`}
        >
          <span className="w-1.5 h-4 rounded-full bg-cyan-500 inline-block" />
          <span>{renderInline(line.slice(3))}</span>
        </h2>
      );
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3
          key={`h3-${i}`}
          className={`text-sm sm:text-base font-bold mt-4 mb-2 ${
            isDark ? 'text-slate-200' : 'text-slate-800'
          }`}
        >
          {renderInline(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }

    // Bullet points
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const listItems: string[] = [];
      while (
        i < lines.length &&
        (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))
      ) {
        listItems.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-2.5 space-y-1.5 pl-4 sm:pl-5 list-disc marker:text-cyan-500">
          {listItems.map((item, idx) => (
            <li
              key={idx}
              className={`text-xs sm:text-sm leading-relaxed ${
                isDark ? 'text-slate-300' : 'text-slate-700'
              }`}
            >
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-2.5 space-y-1.5 pl-4 sm:pl-5 list-decimal marker:text-cyan-600 font-medium">
          {listItems.map((item, idx) => (
            <li
              key={idx}
              className={`text-xs sm:text-sm leading-relaxed ${
                isDark ? 'text-slate-300' : 'text-slate-700'
              }`}
            >
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Standard paragraph
    elements.push(
      <p
        key={`p-${i}`}
        className={`my-2 text-xs sm:text-sm leading-relaxed ${
          isDark ? 'text-slate-300' : 'text-slate-700'
        }`}
      >
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-1">{elements}</div>;
};
