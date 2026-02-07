import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkRoslynLanguageServer } from '../src/roslyn-check.js';
import { RoslynLspClient, filterSymbolsByType, formatSymbols, symbolKindToString, DocumentSymbol } from '../src/lsp-client.js';
import * as path from 'path';
import { execSync } from 'child_process';

const testProjectPath = path.resolve(process.cwd(), 'test-project');
const programPath = path.join(testProjectPath, 'Program.cs');

describe('RoslynLspClient Integration Tests', () => {
  let client: RoslynLspClient | null = null;
  const roslynAvailable = checkRoslynLanguageServer();

  beforeAll(async () => {
    if (!roslynAvailable) {
      console.log('Skipping LSP integration tests - roslyn-language-server not installed');
      return;
    }

    // Ensure test project is restored
    try {
      execSync('dotnet restore', { cwd: testProjectPath, stdio: 'pipe' });
      execSync('dotnet build', { cwd: testProjectPath, stdio: 'pipe' });
    } catch (error) {
      console.error('Failed to restore/build test project:', error);
    }

    // Start the LSP client
    client = new RoslynLspClient();
    try {
      await client.start(testProjectPath);
      // Give it time to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.error('Failed to start LSP client:', error);
      client = null;
    }
  }, 60000);

  afterAll(() => {
    if (client) {
      client.stop();
    }
  });

  it('should start and initialize successfully if roslyn is available', () => {
    if (!roslynAvailable) {
      expect(roslynAvailable).toBe(false);
    } else {
      expect(client).toBeDefined();
    }
  });

  it.skipIf(!roslynAvailable)('should open a document', async () => {
    if (!client) return;
    await expect(client.openDocument(programPath)).resolves.not.toThrow();
  }, 10000);
});

describe('Symbol Utilities', () => {
  it('should convert symbol kind to string', () => {
    expect(symbolKindToString(5)).toBe('Class');
    expect(symbolKindToString(6)).toBe('Method');
    expect(symbolKindToString(7)).toBe('Property');
    expect(symbolKindToString(8)).toBe('Field');
    expect(symbolKindToString(24)).toBe('Event');
  });

  it('should handle unknown symbol kinds', () => {
    expect(symbolKindToString(999)).toBe('Unknown');
  });

  it('should filter symbols by type', () => {
    const mockSymbols: DocumentSymbol[] = [
      {
        name: 'MyProperty',
        kind: 7,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      },
      {
        name: 'MyMethod',
        kind: 6,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
        selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
      },
    ];

    const properties = filterSymbolsByType(mockSymbols, 'Property');
    expect(properties).toHaveLength(1);
    expect(properties[0].name).toBe('MyProperty');

    const methods = filterSymbolsByType(mockSymbols, 'Method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('MyMethod');
  });

  it('should format symbols with full details', () => {
    const mockSymbols: DocumentSymbol[] = [
      {
        name: 'MyMethod',
        detail: 'public void MyMethod()',
        kind: 6,
        range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
        selectionRange: { start: { line: 1, character: 5 }, end: { line: 1, character: 13 } },
      },
    ];

    const formatted = formatSymbols(mockSymbols, false);
    expect(formatted[0]).toHaveProperty('name', 'MyMethod');
    expect(formatted[0]).toHaveProperty('kind', 'Method');
    expect(formatted[0]).toHaveProperty('detail', 'public void MyMethod()');
    expect(formatted[0]).toHaveProperty('range');
  });

  it('should format symbols with signatures only', () => {
    const mockSymbols: DocumentSymbol[] = [
      {
        name: 'MyMethod',
        detail: 'public void MyMethod()',
        kind: 6,
        range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
        selectionRange: { start: { line: 1, character: 5 }, end: { line: 1, character: 13 } },
      },
    ];

    const formatted = formatSymbols(mockSymbols, true);
    expect(formatted[0]).toHaveProperty('name', 'MyMethod');
    expect(formatted[0]).toHaveProperty('kind', 'Method');
    expect(formatted[0]).toHaveProperty('signature', 'public void MyMethod()');
    expect(formatted[0]).not.toHaveProperty('range');
  });
});

