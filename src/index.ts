import * as fs from 'fs';
import * as path from 'path';
import { ClangdClient, Diagnostic } from './lspClient';
import { getHighlighter, HtmlRendererOptions } from 'shiki';

type RenderOptions = {
  fileName?: string;
  theme?: string;
  clangdPath?: string;
  timeout?: number;
};

type HoverResult = { line: number; column: number; content: string };

type Range = { start: number; end: number };

type Marker = { start: number; end: number; kind: 'hover' | 'error' };

function fileToUri(fileName: string) {
  const absPath = path.isAbsolute(fileName) ? fileName : path.resolve(fileName);
  const normalized = absPath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function findCompileCommandsDir(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, 'compile_commands.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseHoverMarkers(code: string) {
  const lines = code.split(/\r?\n/);
  const markers: { line: number; column: number }[] = [];
  const tokenChar = /[A-Za-z0-9_]/;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const idx = ln.indexOf('// ^?');
    if (idx !== -1) {
      let col = idx - 1;
      while (col > 0 && /\s/.test(ln[col])) col--;
      while (col > 0 && !tokenChar.test(ln[col])) col--;
      if (col < 0) col = 0;
      markers.push({ line: i, column: col });
    }
  }
  return markers;
}

function tokenRangeAt(line: string, column: number): Range {
  const tokenChar = /[A-Za-z0-9_]/;
  if (column < 0) column = 0;
  if (column >= line.length) column = line.length - 1;
  let pos = column;
  while (pos > 0 && !tokenChar.test(line[pos])) pos--;
  if (!tokenChar.test(line[pos])) {
    return { start: pos, end: pos + 1 };
  }
  let start = pos;
  while (start > 0 && tokenChar.test(line[start - 1])) start--;
  let end = pos + 1;
  while (end < line.length && tokenChar.test(line[end])) end++;
  return { start, end };
}

function addMarkersToCode(code: string, markersByLine: Map<number, Marker[]>): string {
  const lines = code.split(/\r?\n/);
  const hoverStart = '__CPP_SLASH_HOVER_START__';
  const hoverEnd = '__CPP_SLASH_HOVER_END__';
  const errorStart = '__CPP_SLASH_ERROR_START__';
  const errorEnd = '__CPP_SLASH_ERROR_END__';

  return lines.map((line, index) => {
    const markers = markersByLine.get(index);
    if (!markers || !markers.length) return line;
    const inserts: Record<number, string[]> = {};
    for (const marker of markers) {
      const startText = marker.kind === 'hover' ? hoverStart : errorStart;
      const endText = marker.kind === 'hover' ? hoverEnd : errorEnd;
      inserts[marker.start] = inserts[marker.start] || [];
      inserts[marker.start].push(startText);
      inserts[marker.end] = inserts[marker.end] || [];
      inserts[marker.end].unshift(endText);
    }
    let result = '';
    for (let i = 0; i <= line.length; i++) {
      if (inserts[i]) {
        result += inserts[i].join('');
      }
      if (i < line.length) result += line[i];
    }
    return result;
  }).join('\n');
}

function insertMetaLines(html: string, diagMap: Map<number, string[]>): string {
  if (!diagMap.size) return html;
  const parts = html.split(/(<span class="line">)/);
  let lineIndex = -1;
  let result = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '<span class="line">') {
      lineIndex += 1;
      result += part;
      continue;
    }
    if (lineIndex >= 0) {
      result += part;
      const messages = diagMap.get(lineIndex);
      if (messages) {
        for (const message of messages) {
          result += `<div class="twoslash-meta-line twoslash-error-line vp-copy-ignore">${escapeHtml(message)}</div>`;
        }
      }
      lineIndex = -1;
      continue;
    }
    result += part;
  }
  return result;
}

export async function render(code: string, options: RenderOptions = {}) {
  const { fileName = 'example.cpp', theme = 'nord', clangdPath = 'clangd', timeout = 1500 } = options;
  const absPath = path.isAbsolute(fileName) ? fileName : path.resolve(fileName);
  const uri = fileToUri(absPath);
  const compileCommandsDir = findCompileCommandsDir(path.dirname(absPath)) || process.cwd();
  const client = new ClangdClient(clangdPath, compileCommandsDir);
  await client.start(fileToUri(compileCommandsDir));

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

  const markers = new Map<number, Marker[]>();
  const diagnostics = diagnosticsMap.get(uri) || [];
  const diagMessages = new Map<number, string[]>();

  for (const d of diagnostics) {
    if (!d.range || !d.range.start || !d.range.end) continue;
    const start = d.range.start;
    const end = d.range.end;
    const line = start.line;
    const message = d.message || '';
    if (!diagMessages.has(line)) diagMessages.set(line, []);
    diagMessages.get(line)!.push(message);
    if (start.line === end.line) {
      const lineText = code.split(/\r?\n/)[line] || '';
      const rangeStart = Math.min(Math.max(start.character, 0), lineText.length);
      const rangeEnd = Math.min(Math.max(end.character, rangeStart), lineText.length);
      const list = markers.get(line) || [];
      if (rangeEnd > rangeStart) {
        list.push({ start: rangeStart, end: rangeEnd, kind: 'error' });
      }
      markers.set(line, list);
    }
  }

  const hoverMarkers = parseHoverMarkers(code);
  for (const m of hoverMarkers) {
    const lineText = code.split(/\r?\n/)[m.line] || '';
    const range = tokenRangeAt(lineText, m.column);
    const list = markers.get(m.line) || [];
    list.push({ start: range.start, end: range.end, kind: 'hover' });
    markers.set(m.line, list);
  }

  function hoverContentsToString(contents: any): string {
    if (!contents) return '';
    if (typeof contents === 'string') return contents;
    if (Array.isArray(contents)) return contents.map(c => hoverContentsToString(c)).filter(Boolean).join('\n\n');
    if (typeof contents === 'object') {
      if ('kind' in contents && 'value' in contents) return String(contents.value);
      if ('language' in contents && 'value' in contents) {
        return '```' + (contents.language || '') + '\n' + contents.value + '\n```';
      }
      if ('value' in contents) return String(contents.value);
    }
    try { return JSON.stringify(contents, null, 2); } catch { return String(contents); }
  }

  const highlighter = await getHighlighter({ theme });
  const decoratedCode = addMarkersToCode(code, markers);
  let html = highlighter.codeToHtml(decoratedCode, { lang: 'cpp' });
  html = html
    .replace(/__CPP_SLASH_HOVER_START__/g, '<div class="v-popper v-popper--theme-twoslash v-popper--theme-dropdown twoslash-hover"><span>')
    .replace(/__CPP_SLASH_HOVER_END__/g, '</span></div>')
    .replace(/__CPP_SLASH_ERROR_START__/g, '<span class="twoslash-error"><span>')
    .replace(/__CPP_SLASH_ERROR_END__/g, '</span></span>');

  html = insertMetaLines(html, diagMessages);

  try {
    await client.stop();
  } catch {
    // ignore stop errors for broken pipes
  }

  const final = `<div class="cppslash-wrapper">\n${html}\n</div>\n`;
  return final;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}