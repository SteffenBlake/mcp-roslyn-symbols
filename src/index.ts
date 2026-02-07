#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { checkRoslynLanguageServer, printInstallationInstructions } from './roslyn-check.js';
import {
  RoslynLspClient,
  SymbolType,
  filterSymbolsByType,
  formatSymbols,
  DocumentSymbol,
} from './lsp-client.js';

// Check if roslyn-language-server is installed
if (!checkRoslynLanguageServer()) {
  printInstallationInstructions();
  process.exit(1);
}

const GetSymbolsForSchema = z.object({
  filePath: z.string().describe('Absolute path to the C# file'),
  line: z.number().describe('Line number (0-indexed)'),
  character: z.number().describe('Character position on the line (0-indexed)'),
  symbolType: z
    .enum(['Property', 'Field', 'Event', 'Method', 'Class', 'Interface', 'Enum'])
    .optional()
    .describe('Filter symbols by type'),
  signaturesOnly: z.boolean().optional().describe('Return only signatures without additional details'),
});

type GetSymbolsForArgs = z.infer<typeof GetSymbolsForSchema>;

/**
 * MCP Server for Roslyn Language Server symbol information
 */
class RoslynSymbolsServer {
  private server: Server;
  private lspClient: RoslynLspClient | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-roslyn-symbols',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'get_symbols_for',
          description:
            'Gets symbol information for a type at a specific cursor position in a C# file. ' +
            'Retrieves all public methods, properties, fields, events, etc. from the type. ' +
            'Works with both local types and types from NuGet packages.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Absolute path to the C# file',
              },
              line: {
                type: 'number',
                description: 'Line number (0-indexed)',
              },
              character: {
                type: 'number',
                description: 'Character position on the line (0-indexed)',
              },
              symbolType: {
                type: 'string',
                enum: ['Property', 'Field', 'Event', 'Method', 'Class', 'Interface', 'Enum'],
                description: 'Optional: Filter symbols by type',
              },
              signaturesOnly: {
                type: 'boolean',
                description: 'Optional: Return only signatures without additional details',
              },
            },
            required: ['filePath', 'line', 'character'],
          },
        },
      ];

      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'get_symbols_for') {
        return await this.handleGetSymbolsFor(request.params.arguments as GetSymbolsForArgs);
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  private async handleGetSymbolsFor(args: GetSymbolsForArgs) {
    try {
      const { filePath, line, character, symbolType, signaturesOnly = false } = args;

      // Validate file exists
      if (!fs.existsSync(filePath)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: File not found: ${filePath}`,
            },
          ],
          isError: true,
        };
      }

      // Find the workspace root (directory containing .sln or .slnx)
      const workspaceRoot = this.findWorkspaceRoot(filePath);
      if (!workspaceRoot) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Could not find workspace root (no .sln or .slnx file found in parent directories)`,
            },
          ],
          isError: true,
        };
      }

      // Start LSP if not already started
      if (!this.lspClient) {
        this.lspClient = new RoslynLspClient();
        await this.lspClient.start(workspaceRoot);
      }

      // Open the document
      await this.lspClient.openDocument(filePath);

      // Get type definition at the cursor position
      const typeDefinitions = await this.lspClient.getTypeDefinition(filePath, line, character);
      
      if (!typeDefinitions || typeDefinitions.length === 0) {
        // Try regular definition if type definition doesn't work
        const definitions = await this.lspClient.getDefinition(filePath, line, character);
        
        if (!definitions || definitions.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No symbol found at line ${line}, character ${character}`,
              },
            ],
          };
        }
        
        // Use the first definition
        const def = definitions[0];
        const defPath = def.uri.replace('file://', '');
        
        // Open the definition file and get its symbols
        await this.lspClient.openDocument(defPath);
        let symbols = await this.lspClient.getDocumentSymbols(defPath);
        
        // Filter and format symbols
        if (symbolType) {
          symbols = filterSymbolsByType(symbols, symbolType);
        }
        
        const formattedSymbols = formatSymbols(symbols, signaturesOnly);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                definitionFile: defPath,
                symbols: formattedSymbols,
              }, null, 2),
            },
          ],
        };
      }

      // Get the type definition file
      const typeDef = typeDefinitions[0];
      const typeDefPath = typeDef.uri.replace('file://', '');

      // Open the type definition file
      await this.lspClient.openDocument(typeDefPath);

      // Get document symbols from the type definition
      let symbols = await this.lspClient.getDocumentSymbols(typeDefPath);

      // Filter symbols if symbolType is specified
      if (symbolType) {
        symbols = filterSymbolsByType(symbols, symbolType);
      }

      // Format the symbols
      const formattedSymbols = formatSymbols(symbols, signaturesOnly);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              typeDefinitionFile: typeDefPath,
              symbols: formattedSymbols,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private findWorkspaceRoot(startPath: string): string | null {
    let currentDir = path.dirname(startPath);
    
    // Walk up the directory tree to find .sln or .slnx
    while (currentDir !== path.dirname(currentDir)) {
      const slnFiles = fs.readdirSync(currentDir).filter(f => f.endsWith('.sln') || f.endsWith('.slnx'));
      if (slnFiles.length > 0) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Cleanup on exit
    process.on('SIGINT', () => {
      if (this.lspClient) {
        this.lspClient.stop();
      }
      process.exit(0);
    });
  }
}

// Start the server
const server = new RoslynSymbolsServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
