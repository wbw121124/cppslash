import { ClangdClient, Diagnostic } from './lspClient';
import { getHighlighter, HtmlRendererOptions } from 'shiki';

type RenderOptions = {
  fileName?: string;
  theme?: string;
  clangdPath?: string;
  timeout?: number;
};

type HoverResult = { line: number; column: number; content: string };

function fileToUri(fileName: string) {
  if (fileName.startsWith('/')) return 'file://' + fileName;
  return 'file:///' + fileName;
}

// 更稳的 marker 解析：把注释前最近的非空白字符位置作为 hover 目标
function parseHoverMarkers(code: string) {
  const lines = code.split(/\r?\n/);
  const markers: { line: number; column: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const idx = ln.indexOf('// ^?');
    if (idx !== -1) {
      // 在注释前向左找最后一个非空白字符
      let col = idx - 1;
      while (col > 0 && /\s/.test(ln[col])) col--;
      if (col < 0) col = 0;
      markers.push({ line: i, column: col });
    }
  }
  return markers;
}

export async function render(code: string, options: RenderOptions = {}) {
  const { fileName = 'example.cpp', theme = 'nord', clangdPath = 'clangd', timeout = 1500 } = options;
  const uri = fileToUri('/' + fileName);

  const client = new ClangdClient(clangdPath);
  await client.start();

  const diagnosticsMap: Map<string, Diagnostic[]> = new Map();
  client.onDiagnostics('main', (u, diagnostics) => {
    diagnosticsMap.set(u, diagnostics);
  });

  await client.openDocument(uri, 'cpp', code);

  // wait for diagnostics (or timeout)
  await new Promise<void>((resolve) => {
    const start = Date.now();
    const check = () => {
      if (diagnosticsMap.has(uri)) return resolve();
      if (Date.now() - start > timeout) return resolve();
      setTimeout(check, 50);
    };
    check();
  });

  const markers = parseHoverMarkers(code);
  const hovers: HoverResult[] = [];

  function hoverContentsToString(contents: any): string {
    if (!contents) return '';
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) return contents.map(c => hoverContentsToString(c)).filter(Boolean).join('\n\n');
    if (typeof contents === 'object') {
      if ('kind' in contents && 'value' in contents) return String(contents.value); // MarkupContent
      if ('language' in contents && 'value' in contents) {
        return '```' + (contents.language || '') + '\n' + contents.value + '\n```';
      }
      if ('value' in contents) return String(contents.value);
    }
    try { return JSON.stringify(contents, null, 2); } catch { return String(contents); }
  }

  for (const m of markers) {
    try {
      // clangd expects 0-based positions
      const hover = await client.hover(uri, { line: m.line, character: m.column });
      let content = '';
      if (hover && hover.contents) {
        content = hoverContentsToString(hover.contents);
      }
      hovers.push({ line: m.line, column: m.column, content });
    } catch (e) {
      // ignore hover errors
    }
  }

  // highlight with shiki
  const highlighter = await getHighlighter({ theme });
  const html = highlighter.codeToHtml(code, { lang: 'cpp' });

  // build annotations HTML: diagnostics + hovers
  const diag = diagnosticsMap.get(uri) || [];

  let annotationsHtml = '<div class="cppslash-annotations">\n';
  if (hovers.length) {
    annotationsHtml += '<div class="cppslash-hovers">\n';
    for (const h of hovers) {
      annotationsHtml += `<div class="cppslash-hover"><strong>Hover (line ${h.line + 1}):</strong><pre>${escapeHtml(h.content)}</pre></div>\n`;
    }
    annotationsHtml += '</div>\n';
  }

  if (diag.length) {
    annotationsHtml += '<div class="cppslash-diags"><strong>Diagnostics:</strong>\n<ul>\n';
    for (const d of diag) {
      annotationsHtml += `<li>${escapeHtml(d.message)} (${d.source || ''})</li>\n`;
    }
    annotationsHtml += '</ul></div>\n';
  }
  annotationsHtml += '</div>\n';

  await client.closeDocument(uri);
  await client.stop();

  // wrap html and annotations
  const final = `<div class="cppslash-wrapper">\n${html}\n${annotationsHtml}\n</div>\n`;
  return final;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}