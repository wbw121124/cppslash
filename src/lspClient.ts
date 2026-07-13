import { spawn, ChildProcess } from 'child_process';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  Message
} from 'vscode-jsonrpc/node';
import {
  InitializeParams,
  InitializeResult,
  InitializeRequest,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  PublishDiagnosticsNotification,
  HoverRequest,
  Position,
  TextDocumentItem
} from 'vscode-languageserver-protocol';

import { Readable, Writable } from 'stream';

export type Diagnostic = {
  range: any;
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
};

export class ClangdClient {
  private clangdPath: string;
  private process?: ChildProcess;
  private connection: ReturnType<typeof createMessageConnection> | null = null;
  private diagnosticsHandlers: Map<string, (uri: string, diagnostics: Diagnostic[]) => void> = new Map();

  constructor(clangdPath = 'clangd') {
    this.clangdPath = clangdPath;
  }

  async start(rootUri?: string): Promise<InitializeResult> {
    // spawn clangd with extra args so it picks up compile_commands.json and logs stderr
    this.process = spawn(this.clangdPath, ['--background-index=false', '--compile-commands-dir=.', '--log=verbose'], { stdio: 'pipe' });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to spawn clangd with stdio pipes');
    }

    const reader = new StreamMessageReader(this.process.stdout as Readable);
    const writer = new StreamMessageWriter(this.process.stdin as Writable);

    this.connection = createMessageConnection(reader, writer, console as any);
    this.connection.listen();

    const params: InitializeParams = {
      processId: process.pid || null,
      rootUri: rootUri || null,
      capabilities: {},
      workspaceFolders: null
    };

    const init = await this.connection.sendRequest(InitializeRequest.type, params) as InitializeResult;
    // notify initialized
    this.connection.sendNotification('initialized', {});

    // subscribe diagnostics
    this.connection.onNotification(PublishDiagnosticsNotification.type.method, (params: any) => {
      const { uri, diagnostics } = params;
      for (const h of this.diagnosticsHandlers.values()) {
        h(uri, diagnostics);
      }
    });

    return init;
  }

  onDiagnostics(id: string, handler: (uri: string, diagnostics: Diagnostic[]) => void) {
    this.diagnosticsHandlers.set(id, handler);
  }

  offDiagnostics(id: string) {
    this.diagnosticsHandlers.delete(id);
  }

  async openDocument(uri: string, languageId: string, text: string) {
    if (!this.connection) throw new Error('Not started');
    const doc: TextDocumentItem = {
      uri,
      languageId,
      version: 1,
      text
    };
    this.connection.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: doc });
  }

  async changeDocument(uri: string, version: number, text: string) {
    if (!this.connection) throw new Error('Not started');
    this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    });
  }

  async closeDocument(uri: string) {
    if (!this.connection) throw new Error('Not started');
    this.connection.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } });
  }

  async hover(uri: string, pos: Position) {
    if (!this.connection) throw new Error('Not started');
    const res = await this.connection.sendRequest(HoverRequest.type, { textDocument: { uri }, position: pos });
    return res;
  }

  async stop() {
    if (!this.connection) return;
    try {
      this.connection.dispose();
    } catch { }
    if (this.process) {
      this.process.kill();
    }
    this.connection = null;
    this.process = undefined;
  }
}