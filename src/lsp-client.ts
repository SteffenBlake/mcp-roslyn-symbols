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

export interface FormattedSymbol {
  name: string;
  kind: string;
  detail?: string;
  range?: {
    start: Position;
    end: Position;
  };
  signature?: string;
}

export type SymbolType = 'Property' | 'Field' | 'Event' | 'Method' | 'Class' | 'Interface' | 'Enum';

export type VerbosityLevel = 'silent' | 'normal' | 'verbose';

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
  private openDocuments = new Set<string>();
  private diagnosticsPromises = new Map<string, { resolve: () => void; reject: (error: any) => void }>();
  private verbosity: VerbosityLevel = 'normal';

  /**
   * Creates a new Roslyn LSP client
   * @param verbosity - Logging verbosity level ('silent' | 'normal' | 'verbose')
   */
  constructor(verbosity: VerbosityLevel = 'normal') {
    this.verbosity = verbosity;
  }

  /**
   * Internal logging method that respects verbosity level
   */
  private log(message: string, level: 'info' | 'verbose' = 'info'): void {
    if (this.verbosity === 'silent') {
      return;
    }
    if (level === 'verbose' && this.verbosity !== 'verbose') {
      return;
    }
    console.error(message);
  }

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
        const message = data.toString();
        // Only log non-empty and non-trace messages in verbose mode
        if (message.trim() && !message.includes('[trace]')) {
          this.log(`LSP stderr: ${message}`, 'verbose');
        }
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
    // Handle server requests (like workspace/configuration)
    if (message.method && message.id !== undefined) {
      this.handleServerRequest(message);
      return;
    }
    
    // Handle notifications
    if (message.method && message.id === undefined) {
      this.handleNotification(message);
      return;
    }
    
    // Handle responses to our requests
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
   * Handles notifications from the server
   */
  private handleNotification(message: any): void {
    if (message.method === 'window/logMessage') {
      const level = message.params?.type || 3;
      const text = message.params?.message || '';
      
      // Log levels: 1=Error, 2=Warning, 3=Info, 4=Log
      if (level <= 2) {
        this.log(`LSP [${level === 1 ? 'ERROR' : 'WARN'}]: ${text}`, 'info');
      } else if (level === 3) {
        this.log(`LSP [INFO]: ${text}`, 'verbose');
      }
      
      // Log if we see TestProject being loaded (not just Canonical)
      if (text.includes('TestProject.csproj') || text.includes('TestProject')) {
        this.log(`🎯 IMPORTANT: TestProject mentioned: ${text}`, 'verbose');
      }
    } else if (message.method === 'textDocument/publishDiagnostics') {
      const uri = message.params?.uri || '';
      const diagnostics = message.params?.diagnostics || [];
      
      this.log(`LSP: Received diagnostics for ${uri} (${diagnostics.length} items)`, 'verbose');
      
      if (diagnostics.length > 0) {
        diagnostics.forEach((d: any) => {
          const severity = d.severity === 1 ? 'ERROR' : d.severity === 2 ? 'WARNING' : d.severity === 3 ? 'INFO' : 'HINT';
          this.log(`  [${severity}] Line ${d.range.start.line + 1}: ${d.message}`, 'verbose');
        });
      }
      
      if (this.diagnosticsPromises.has(uri)) {
        const { resolve } = this.diagnosticsPromises.get(uri)!;
        this.diagnosticsPromises.delete(uri);
        resolve();
      }
    } else if (message.method === '$/progress') {
      const token = message.params?.token;
      const value = message.params?.value;
      
      if (value?.kind === 'begin') {
        this.log(`LSP Progress [${token}]: ${value.title || 'Started'}`, 'verbose');
      } else if (value?.kind === 'end') {
        this.log(`LSP Progress [${token}]: Completed`, 'verbose');
      }
    }
  }

  /**
   * Handles requests from the server
   */
  private handleServerRequest(message: any): void {
    if (message.method === 'workspace/configuration') {
      // Respond with configuration for each item
      const items = message.params?.items || [];
      
      const config = items.map((item: any) => {
        const section = item.section || '';
        
        // Enable decompilation and source navigation
        if (section.includes('dotnet_navigate_to_decompiled_sources')) {
          return true;
        }
        if (section.includes('dotnet_navigate_to_source_link_and_embedded_sources')) {
          return true;
        }
        if (section.includes('dotnet_search_reference_assemblies')) {
          return true;
        }
        
        // Return null for other configs (use defaults)
        return null;
      });
      
      this.sendResponse(message.id, config);
    } else if (message.method === 'client/registerCapability') {
      // Acknowledge capability registration
      this.sendResponse(message.id, null);
    } else if (message.method === 'window/workDoneProgress/create') {
      // Acknowledge progress token creation
      this.sendResponse(message.id, null);
    } else {
      // Send empty response for unknown requests
      this.sendResponse(message.id, null);
    }
  }

  /**
   * Sends a response to a server request
   */
  private sendResponse(id: number, result: any): void {
    const message = {
      jsonrpc: '2.0',
      id,
      result,
    };

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    
    if (this.process?.stdin) {
      this.process.stdin.write(header + content);
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

      // Timeout after 120 seconds (BuildHost reload can take 60-90s)
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.log(`Request ${id} (${method}) timed out after 120s`, 'verbose');
          reject(new Error(`Request timeout after 120s: ${method}`));
        }
      }, 120000);
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
    this.log(`LSP: Initializing with workspace root: ${workspaceRoot}`, 'verbose');
    
    const initOptions: any = {
      processId: process.pid,
      rootUri: `file://${workspaceRoot}`,
      workspaceFolders: [
        {
          uri: `file://${workspaceRoot}`,
          name: path.basename(workspaceRoot),
        },
      ],
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
        workspace: {
          configuration: true,
        },
      },
    };
    
    const result = await this.sendRequest('initialize', initOptions);

    this.sendNotification('initialized', {});
    this.initialized = true;
  }

  /**
   * Opens a document in the LSP
   * 
   * Note: We send didOpen but DO NOT wait for diagnostics, as Roslyn
   * may not send them if there are no errors. Instead, the caller should
   * call waitForProjectLoad() after opening to ensure the project is ready.
   */
  async openDocument(filePath: string): Promise<void> {
    const uri = `file://${filePath}`;
    
    // Don't re-open already opened documents
    if (this.openDocuments.has(uri)) {
      return;
    }
    
    const text = readFileSync(filePath, 'utf-8');

    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'csharp',
        version: 1,
        text,
      },
    });
    
    this.openDocuments.add(uri);
    
    // Give LSP a moment to process the didOpen notification
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Waits for document to be loaded into the real project (not Canonical).
   * 
   * Strategy:
   * 1. Poll using typeDefinition on a known NuGet type (JsonConvert)
   * 2. Check the returned URI:
   *    - Contains "roslyn-canonical-misc" → still in Canonical, retry
   *    - Starts with "csharp:/metadata/" → in real project, success!
   *    - Empty/null → still loading, retry
   * 3. Retry with delay until success or timeout
   * 
   * Based on Roslyn source code:
   * - Canonical projects have filePath containing "roslyn-canonical-misc"
   * - Real projects return metadata URIs like "csharp:/metadata/..." for NuGet types
   * 
   * @param filePath - Path to the document
   * @param maxRetries - Maximum number of retry attempts (default: 60)
   * @param retryDelayMs - Delay between retries in ms (default: 1000)
   */
  async waitForRealProjectLoad(
    filePath: string, 
    maxRetries: number = 60,
    retryDelayMs: number = 1000
  ): Promise<void> {
    this.log('⏳ Waiting for document to load into real project (not Canonical)...', 'info');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use line 18 (0-indexed), character 19 which points to JsonConvert from Newtonsoft.Json
        // This is a NuGet type that won't exist in Canonical but will in real project
        const typeDefResult = await this.getTypeDefinition(filePath, 18, 19);
        
        if (typeDefResult && typeDefResult.length > 0) {
          const resultUri = typeDefResult[0].uri;
          
          // Check if the result URI contains "roslyn-canonical-misc"
          if (resultUri.includes('roslyn-canonical-misc')) {
            this.log(`  [Attempt ${attempt}/${maxRetries}] Still in Canonical project, retrying...`, 'verbose');
          } else if (resultUri.startsWith('csharp:/metadata/')) {
            // Got metadata URI for NuGet package - SUCCESS!
            this.log(`✅ Document loaded into real project (attempt ${attempt})`, 'info');
            this.log(`   Result URI: ${resultUri}`, 'verbose');
            return;
          } else {
            this.log(`  [Attempt ${attempt}/${maxRetries}] Got unexpected URI: ${resultUri}`, 'verbose');
          }
        } else {
          this.log(`  [Attempt ${attempt}/${maxRetries}] No type definition found, project still loading...`, 'verbose');
        }
        
      } catch (error) {
        this.log(`  [Attempt ${attempt}/${maxRetries}] Request failed: ${error}`, 'verbose');
      }
      
      // Wait before retrying
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
    
    throw new Error(
      `Timeout waiting for document to load into real project after ${maxRetries} attempts. ` +
      `Document appears to be stuck in Canonical miscellaneous files project.`
    );
  }

  /**
   * Closes a document in the LSP
   */
  closeDocument(filePath: string): void {
    const uri = `file://${filePath}`;
    
    if (!this.openDocuments.has(uri)) {
      return;
    }

    this.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    });
    
    this.openDocuments.delete(uri);
  }
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
   * Gets document symbols from a URI (including metadata URIs)
   */
  async getDocumentSymbolsByUri(uri: string): Promise<DocumentSymbol[]> {
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

  /**
   * Searches for symbols in the workspace
   */
  async workspaceSymbol(query: string): Promise<any[]> {
    const result = await this.sendRequest('workspace/symbol', {
      query,
    });

    return result || [];
  }

  /**
   * High-level method to get symbols for a type at a specific position
   * 
   * This method encapsulates all orchestration:
   * - Opens document if needed
   * - Waits for project load on first request
   * - Gets type definition or regular definition
   * - Opens the definition URI
   * - Gets document symbols
   * - Flattens hierarchical symbols
   * - Filters by symbolType if provided
   * - Formats with signaturesOnly if provided
   * 
   * @param filePath - Path to the source file
   * @param line - Line number (0-indexed)
   * @param character - Character position (0-indexed)
   * @param options - Optional filtering and formatting options
   * @returns Object with symbols array and source URI
   */
  async getSymbolsFor(
    filePath: string, 
    line: number, 
    character: number, 
    options?: { symbolType?: SymbolType; signaturesOnly?: boolean }
  ): Promise<{ symbols: FormattedSymbol[]; sourceUri?: string }> {
    const uri = `file://${filePath}`;

    // Ensure document is opened
    if (!this.openDocuments.has(uri)) {
      await this.openDocument(filePath);
    }

    // Wait for document to be in real project (not Canonical)
    await this.waitForRealProjectLoad(filePath);

    // Try type definition first
    const typeDefinitions = await this.getTypeDefinition(filePath, line, character);
    
    if (typeDefinitions && typeDefinitions.length > 0) {
      const typeDefUri = typeDefinitions[0].uri;
      
      // Get document symbols from the type definition
      let symbols = await this.getDocumentSymbolsByUri(typeDefUri);
      
      // Flatten hierarchical symbols
      symbols = flattenSymbols(symbols);
      
      // Filter by symbolType if provided
      if (options?.symbolType) {
        symbols = filterSymbolsByType(symbols, options.symbolType);
      }
      
      // Format with signaturesOnly if provided
      const formattedSymbols = formatSymbols(symbols, options?.signaturesOnly || false);
      
      return {
        symbols: formattedSymbols,
        sourceUri: typeDefUri,
      };
    }

    // Fallback to regular definition
    const definitions = await this.getDefinition(filePath, line, character);
    
    if (!definitions || definitions.length === 0) {
      return { symbols: [] };
    }

    const defUri = definitions[0].uri;
    
    // Get document symbols
    let symbols = await this.getDocumentSymbolsByUri(defUri);
    
    // Flatten hierarchical symbols
    symbols = flattenSymbols(symbols);
    
    // Filter by symbolType if provided
    if (options?.symbolType) {
      symbols = filterSymbolsByType(symbols, options.symbolType);
    }
    
    // Format with signaturesOnly if provided
    const formattedSymbols = formatSymbols(symbols, options?.signaturesOnly || false);
    
    return {
      symbols: formattedSymbols,
      sourceUri: defUri,
    };
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
export function formatSymbols(symbols: DocumentSymbol[], signaturesOnly: boolean): FormattedSymbol[] {
  return symbols.map(symbol => {
    const result: FormattedSymbol = {
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

/**
 * Flattens hierarchical document symbols into a flat array
 */
function flattenSymbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
  const flattened: DocumentSymbol[] = [];
  function traverse(symbol: DocumentSymbol) {
    flattened.push(symbol);
    if (symbol.children?.length) {
      symbol.children.forEach(traverse);
    }
  }
  symbols.forEach(traverse);
  return flattened;
}
