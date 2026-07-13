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
  private cwd: string;
  private process?: ChildProcess;
  private connection: ReturnType<typeof createMessageConnection> | null = null;
  private diagnosticsHandlers: Map<string, (uri: string, diagnostics: Diagnostic[]) => void> = new Map();

  constructor(clangdPath = 'clangd', cwd = process.cwd()) {
    this.clangdPath = clangdPath;
    this.cwd = cwd;
  }

  async start(rootUri?: string): Promise<InitializeResult> {
    // spawn clangd with extra args so it picks up compile_commands.json and logs stderr
    this.process = spawn(this.clangdPath, ['--background-index=false', '--compile-commands-dir=.', '--log=verbose'], { stdio: 'pipe', cwd: this.cwd });

    if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
      throw new Error('Failed to spawn clangd with stdio pipes');
    }

    this.process.stderr.on('data', (chunk: Buffer) => {
      console.error('[clangd]', chunk.toString());
    });
    this.process.stdin.on('error', () => {
      // swallow EPIPE when clangd exits before writes finish
    });
    this.process.stdout.on('error', () => {
      // swallow stream errors from clangd shutdown
    });
    this.process.stderr.on('error', () => {
      // swallow stderr pipe errors as well
    });

    const reader = new StreamMessageReader(this.process.stdout as Readable);
    const writer = new StreamMessageWriter(this.process.stdin as Writable);
    const originalWriter = writer.write.bind(writer);
    writer.write = async (msg: any) => {
      try {
        return await originalWriter(msg);
      } catch (error: any) {
        if (error && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')) {
          return;
        }
        throw error;
      }
    };

    this.connection = createMessageConnection(reader, writer, console as any);
    this.connection.onError((error) => {
      // ignore broken pipe / write errors when clangd exits unexpectedly
    });
    this.connection.onClose(() => {
      // connection closed by clangd
    });
    this.connection.listen();

    const params: InitializeParams = {
      processId: process.pid || null,
      rootUri: rootUri || null,
      capabilities: {},
      workspaceFolders: null
    };

    const init = await this.connection.sendRequest(InitializeRequest.type, params) as InitializeResult;
    // notify initialized
    await this.connection.sendNotification('initialized', {});

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
    await this.connection.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: doc });
  }

  async changeDocument(uri: string, version: number, text: string) {
    if (!this.connection) throw new Error('Not started');
    await this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    });
  }

  async closeDocument(uri: string) {
    if (!this.connection) throw new Error('Not started');
    await this.connection.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } });
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