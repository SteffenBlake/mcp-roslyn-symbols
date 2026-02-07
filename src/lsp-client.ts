import { spawn, ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';

export interface Position {
  line: number;
  character: number;
}

export interface Location {
  uri: string;
  range: {
    start: Position;
    end: Position;
  };
}

export interface SymbolInformation {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: {
    start: Position;
    end: Position;
  };
  selectionRange: {
    start: Position;
    end: Position;
  };
  children?: DocumentSymbol[];
}

export type SymbolType = 'Property' | 'Field' | 'Event' | 'Method' | 'Class' | 'Interface' | 'Enum';

const SymbolKindMap: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter',
};

/**
 * LSP client for interacting with Roslyn Language Server
 */
export class RoslynLspClient {
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
  private buffer = '';
  private initialized = false;

  /**
   * Starts the Roslyn Language Server
   */
  async start(workspaceRoot: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const logDir = process.env.HOME ? `${process.env.HOME}/.local/var/log/roslyn-lsp` : '/tmp/roslyn-lsp';
      
      this.process = spawn('roslyn-language-server', [
        '--stdio',
        '--logLevel',
        'Information',
        '--extensionLogDirectory',
        logDir,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.process.stdout || !this.process.stdin) {
        reject(new Error('Failed to start Roslyn Language Server'));
        return;
      }

      this.process.stdout.on('data', (data: Buffer) => {
        this.handleData(data);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('LSP stderr:', data.toString());
      });

      this.process.on('error', (error) => {
        reject(error);
      });

      // Initialize the LSP
      this.initialize(workspaceRoot)
        .then(() => resolve())
        .catch(reject);
    });
  }

  /**
   * Stops the Roslyn Language Server
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Handles incoming data from the LSP
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const headers = this.buffer.substring(0, headerEnd);
      const contentLengthMatch = headers.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) break;

      const messageContent = this.buffer.substring(messageStart, messageEnd);
      this.buffer = this.buffer.substring(messageEnd);

      try {
        const message = JSON.parse(messageContent);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse LSP message:', error);
      }
    }
  }

  /**
   * Handles an LSP message
   */
  private handleMessage(message: any): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    }
  }

  /**
   * Sends an LSP request
   */
  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const content = JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
      
      if (!this.process?.stdin) {
        reject(new Error('LSP process not started'));
        return;
      }

      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(header + content);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Sends an LSP notification (no response expected)
   */
  private sendNotification(method: string, params: any): void {
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    
    if (this.process?.stdin) {
      this.process.stdin.write(header + content);
    }
  }

  /**
   * Initializes the LSP
   */
  private async initialize(workspaceRoot: string): Promise<void> {
    await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: `file://${workspaceRoot}`,
      capabilities: {
        textDocument: {
          hover: {
            contentFormat: ['plaintext', 'markdown'],
          },
          definition: {
            linkSupport: true,
          },
          typeDefinition: {
            linkSupport: true,
          },
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
        },
      },
    });

    this.sendNotification('initialized', {});
    this.initialized = true;
  }

  /**
   * Opens a document in the LSP
   */
  async openDocument(filePath: string): Promise<void> {
    const uri = `file://${filePath}`;
    const text = readFileSync(filePath, 'utf-8');

    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'csharp',
        version: 1,
        text,
      },
    });

    // Give the LSP time to process the document
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Gets the definition of a symbol at a position
   */
  async getDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
    const uri = `file://${filePath}`;
    
    const result = await this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    });

    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  /**
   * Gets the type definition of a symbol at a position
   */
  async getTypeDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
    const uri = `file://${filePath}`;
    
    const result = await this.sendRequest('textDocument/typeDefinition', {
      textDocument: { uri },
      position: { line, character },
    });

    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  }

  /**
   * Gets document symbols from a file
   */
  async getDocumentSymbols(filePath: string): Promise<DocumentSymbol[]> {
    const uri = `file://${filePath}`;
    
    const result = await this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    });

    return result || [];
  }

  /**
   * Gets hover information at a position
   */
  async getHover(filePath: string, line: number, character: number): Promise<any> {
    const uri = `file://${filePath}`;
    
    const result = await this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    });

    return result;
  }
}

/**
 * Converts a symbol kind number to a string
 */
export function symbolKindToString(kind: number): string {
  return SymbolKindMap[kind] || 'Unknown';
}

/**
 * Filters symbols by type
 */
export function filterSymbolsByType(symbols: DocumentSymbol[], symbolType: SymbolType): DocumentSymbol[] {
  const kindMap: Record<SymbolType, number[]> = {
    Property: [7],
    Field: [8],
    Event: [24],
    Method: [6, 9], // Method and Constructor
    Class: [5],
    Interface: [11],
    Enum: [10],
  };

  const allowedKinds = kindMap[symbolType] || [];
  
  return symbols.filter(symbol => {
    if (allowedKinds.includes(symbol.kind)) {
      return true;
    }
    return false;
  });
}

/**
 * Formats symbols for output
 */
export function formatSymbols(symbols: DocumentSymbol[], signaturesOnly: boolean): any[] {
  return symbols.map(symbol => {
    const result: any = {
      name: symbol.name,
      kind: symbolKindToString(symbol.kind),
    };

    if (!signaturesOnly) {
      result.detail = symbol.detail;
      result.range = symbol.range;
    } else if (symbol.detail) {
      result.signature = symbol.detail;
    }

    return result;
  });
}
