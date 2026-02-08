import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';
const SymbolKindMap = {
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
    process = null;
    messageId = 0;
    pendingRequests = new Map();
    buffer = '';
    initialized = false;
    openDocuments = new Set();
    diagnosticsPromises = new Map();
    verbosity = 'normal';
    /**
     * Creates a new Roslyn LSP client
     * @param verbosity - Logging verbosity level ('silent' | 'normal' | 'verbose')
     */
    constructor(verbosity = 'normal') {
        this.verbosity = verbosity;
    }
    /**
     * Internal logging method that respects verbosity level
     */
    log(message, level = 'info') {
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
    async start(workspaceRoot) {
        return new Promise((resolve, reject) => {
            const logDir = process.env.HOME ? `${process.env.HOME}/.local/var/log/roslyn-lsp` : '/tmp/roslyn-lsp';
            this.process = spawn('roslyn-language-server', [
                '--stdio',
                '--logLevel',
                'Information',
                '--extensionLogDirectory',
                logDir,
                '--autoLoadProjects', // Auto-discover and load projects from workspace folders
            ], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            if (!this.process.stdout || !this.process.stdin) {
                reject(new Error('Failed to start Roslyn Language Server'));
                return;
            }
            this.process.stdout.on('data', (data) => {
                this.handleData(data);
            });
            this.process.stderr?.on('data', (data) => {
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
    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
    /**
     * Handles incoming data from the LSP
     */
    handleData(data) {
        this.buffer += data.toString();
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1)
                break;
            const headers = this.buffer.substring(0, headerEnd);
            const contentLengthMatch = headers.match(/Content-Length: (\d+)/);
            if (!contentLengthMatch)
                break;
            const contentLength = parseInt(contentLengthMatch[1], 10);
            const messageStart = headerEnd + 4;
            const messageEnd = messageStart + contentLength;
            if (this.buffer.length < messageEnd)
                break;
            const messageContent = this.buffer.substring(messageStart, messageEnd);
            this.buffer = this.buffer.substring(messageEnd);
            try {
                const message = JSON.parse(messageContent);
                this.handleMessage(message);
            }
            catch (error) {
                console.error('Failed to parse LSP message:', error);
            }
        }
    }
    /**
     * Handles an LSP message
     */
    handleMessage(message) {
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
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);
            if (message.error) {
                reject(new Error(message.error.message));
            }
            else {
                resolve(message.result);
            }
        }
    }
    /**
     * Handles notifications from the server
     */
    handleNotification(message) {
        if (message.method === 'window/logMessage') {
            const level = message.params?.type || 3;
            const text = message.params?.message || '';
            // Log levels: 1=Error, 2=Warning, 3=Info, 4=Log
            if (level <= 2) {
                this.log(`LSP [${level === 1 ? 'ERROR' : 'WARN'}]: ${text}`, 'info');
            }
            else if (level === 3) {
                this.log(`LSP [INFO]: ${text}`, 'verbose');
            }
            // Log if we see TestProject being loaded (not just Canonical)
            if (text.includes('TestProject.csproj') || text.includes('TestProject')) {
                this.log(`🎯 IMPORTANT: TestProject mentioned: ${text}`, 'verbose');
            }
        }
        else if (message.method === 'textDocument/publishDiagnostics') {
            const uri = message.params?.uri || '';
            const diagnostics = message.params?.diagnostics || [];
            this.log(`LSP: Received diagnostics for ${uri} (${diagnostics.length} items)`, 'verbose');
            if (diagnostics.length > 0) {
                diagnostics.forEach((d) => {
                    let severity = 'HINT';
                    if (d.severity === 1)
                        severity = 'ERROR';
                    else if (d.severity === 2)
                        severity = 'WARNING';
                    else if (d.severity === 3)
                        severity = 'INFO';
                    this.log(`  [${severity}] Line ${d.range.start.line + 1}: ${d.message}`, 'verbose');
                });
            }
            if (this.diagnosticsPromises.has(uri)) {
                const { resolve } = this.diagnosticsPromises.get(uri);
                this.diagnosticsPromises.delete(uri);
                resolve();
            }
        }
        else if (message.method === '$/progress') {
            const token = message.params?.token;
            const value = message.params?.value;
            if (value?.kind === 'begin') {
                this.log(`LSP Progress [${token}]: ${value.title || 'Started'}`, 'verbose');
            }
            else if (value?.kind === 'end') {
                this.log(`LSP Progress [${token}]: Completed`, 'verbose');
            }
        }
    }
    /**
     * Handles requests from the server
     */
    handleServerRequest(message) {
        if (message.method === 'workspace/configuration') {
            // Respond with configuration for each item
            const items = message.params?.items || [];
            const config = items.map((item) => {
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
        }
        else if (message.method === 'client/registerCapability') {
            // Acknowledge capability registration
            this.sendResponse(message.id, null);
        }
        else if (message.method === 'window/workDoneProgress/create') {
            // Acknowledge progress token creation
            this.sendResponse(message.id, null);
        }
        else {
            // Send empty response for unknown requests
            this.sendResponse(message.id, null);
        }
    }
    /**
     * Sends a response to a server request
     */
    sendResponse(id, result) {
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
    sendRequest(method, params) {
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
    sendNotification(method, params) {
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
    async initialize(workspaceRoot) {
        this.log(`LSP: Initializing with workspace root: ${workspaceRoot}`, 'verbose');
        const initOptions = {
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
    async openDocument(filePath) {
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
     * 1. Poll using typeDefinition on the actual position being queried
     * 2. Check the returned URI:
     *    - Contains "roslyn-canonical-misc" → still in Canonical project, retry
     *    - Does NOT contain "roslyn-canonical-misc" → in real project, success!
     *    - Empty/null → might be loading OR symbol doesn't support typeDefinition
     * 3. After enough attempts without a Canonical result, assume real project loaded
     *
     * The key insight is that Canonical project URIs ALWAYS contain "roslyn-canonical-misc".
     * If we get no result or a non-Canonical result repeatedly, the real project has likely loaded.
     *
     * Based on Roslyn source code:
     * - Canonical projects have filePath containing "roslyn-canonical-misc"
     * - Real projects return normal file URIs or metadata URIs without this pattern
     * - Some symbols (especially in complex expressions) might not have typeDefinition available
     *
     * @param filePath - Path to the document
     * @param line - Line number to check (0-indexed)
     * @param character - Character position to check (0-indexed)
     * @param maxRetries - Maximum number of retry attempts (default: 60)
     * @param retryDelayMs - Delay between retries in ms (default: 1000)
     */
    async waitForRealProjectLoad(filePath, line, character, maxRetries = 60, retryDelayMs = 1000) {
        this.log('⏳ Waiting for document to load into real project (not Canonical)...', 'info');
        let consecutiveNonCanonicalAttempts = 0;
        const minConsecutiveNonCanonical = 3; // If we get 3 non-Canonical results in a row, we're good
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Check the actual position being queried by the user
                const typeDefResult = await this.getTypeDefinition(filePath, line, character);
                if (typeDefResult && typeDefResult.length > 0) {
                    const resultUri = typeDefResult[0].uri;
                    // Check if the result URI contains "roslyn-canonical-misc" (still in Canonical)
                    if (resultUri.includes('roslyn-canonical-misc')) {
                        this.log(`  [Attempt ${attempt}/${maxRetries}] Still in Canonical project, retrying...`, 'verbose');
                        consecutiveNonCanonicalAttempts = 0; // Reset counter
                    }
                    else {
                        // URI does NOT contain "roslyn-canonical-misc" - we're in the real project!
                        this.log(`✅ Document loaded into real project (attempt ${attempt})`, 'info');
                        this.log(`   Result URI: ${resultUri}`, 'verbose');
                        return;
                    }
                }
                else {
                    // No type definition found - could be still loading OR symbol doesn't support typeDefinition
                    // Count this as a non-Canonical result
                    consecutiveNonCanonicalAttempts++;
                    if (consecutiveNonCanonicalAttempts >= minConsecutiveNonCanonical && attempt > 10) {
                        // We've tried enough times and never seen a Canonical result recently
                        // Likely the real project has loaded and this symbol just doesn't have typeDefinition
                        this.log(`✅ Document likely in real project (${consecutiveNonCanonicalAttempts} consecutive ` +
                            `non-Canonical attempts after ${attempt} total attempts)`, 'info');
                        return;
                    }
                    this.log(`  [Attempt ${attempt}/${maxRetries}] No type definition found, ` +
                        `project still loading... (${consecutiveNonCanonicalAttempts} consecutive non-Canonical)`, 'verbose');
                }
            }
            catch (error) {
                this.log(`  [Attempt ${attempt}/${maxRetries}] Request failed: ${error}`, 'verbose');
                consecutiveNonCanonicalAttempts++; // Count errors as non-Canonical too
            }
            // Wait before retrying
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        }
        throw new Error(`Timeout waiting for document to load into real project after ${maxRetries} attempts. ` +
            `Document appears to be stuck in Canonical miscellaneous files project.`);
    }
    /**
     * Closes a document in the LSP
     */
    closeDocument(filePath) {
        const uri = `file://${filePath}`;
        if (!this.openDocuments.has(uri)) {
            return;
        }
        this.sendNotification('textDocument/didClose', {
            textDocument: { uri },
        });
        this.openDocuments.delete(uri);
    }
    async getDefinition(filePath, line, character) {
        const uri = `file://${filePath}`;
        const result = await this.sendRequest('textDocument/definition', {
            textDocument: { uri },
            position: { line, character },
        });
        if (!result)
            return [];
        return Array.isArray(result) ? result : [result];
    }
    /**
     * Gets the type definition of a symbol at a position
     */
    async getTypeDefinition(filePath, line, character) {
        const uri = `file://${filePath}`;
        const result = await this.sendRequest('textDocument/typeDefinition', {
            textDocument: { uri },
            position: { line, character },
        });
        if (!result)
            return [];
        return Array.isArray(result) ? result : [result];
    }
    /**
     * Gets document symbols from a file
     */
    async getDocumentSymbols(filePath) {
        const uri = `file://${filePath}`;
        const result = await this.sendRequest('textDocument/documentSymbol', {
            textDocument: { uri },
        });
        return result || [];
    }
    /**
     * Gets document symbols from a URI (including metadata URIs)
     */
    async getDocumentSymbolsByUri(uri) {
        const result = await this.sendRequest('textDocument/documentSymbol', {
            textDocument: { uri },
        });
        return result || [];
    }
    /**
     * Gets hover information at a position
     */
    async getHover(filePath, line, character) {
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
    async workspaceSymbol(query) {
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
    async getSymbolsFor(filePath, line, character, options) {
        const uri = `file://${filePath}`;
        // Ensure document is opened
        if (!this.openDocuments.has(uri)) {
            await this.openDocument(filePath);
        }
        // Wait for document to be in real project (not Canonical)
        // Check the actual position being queried to detect project transition
        await this.waitForRealProjectLoad(filePath, line, character);
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
export function symbolKindToString(kind) {
    return SymbolKindMap[kind] || 'Unknown';
}
/**
 * Filters symbols by type
 */
export function filterSymbolsByType(symbols, symbolType) {
    const kindMap = {
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
export function formatSymbols(symbols, signaturesOnly) {
    return symbols.map(symbol => {
        const result = {
            name: symbol.name,
            kind: symbolKindToString(symbol.kind),
        };
        if (!signaturesOnly) {
            result.detail = symbol.detail;
            result.range = symbol.range;
        }
        else if (symbol.detail) {
            result.signature = symbol.detail;
        }
        return result;
    });
}
/**
 * Flattens hierarchical document symbols into a flat array
 */
function flattenSymbols(symbols) {
    const flattened = [];
    function traverse(symbol) {
        flattened.push(symbol);
        if (symbol.children?.length) {
            symbol.children.forEach(traverse);
        }
    }
    symbols.forEach(traverse);
    return flattened;
}
