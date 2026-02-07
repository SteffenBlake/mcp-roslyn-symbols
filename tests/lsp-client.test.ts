import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RoslynLspClient, filterSymbolsByType, formatSymbols, symbolKindToString } from '../src/lsp-client.js';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

const testProjectPath = path.resolve(process.cwd(), 'test-project');
const programPath = path.join(testProjectPath, 'Program.cs');

describe('RoslynLspClient', () => {
  let client: RoslynLspClient;

  beforeAll(async () => {
    // Ensure test project is restored
    try {
      execSync('dotnet restore', { cwd: testProjectPath, stdio: 'pipe' });
    } catch (error) {
      console.error('Failed to restore test project:', error);
      throw error;
    }

    // Start the LSP client
    client = new RoslynLspClient();
    await client.start(testProjectPath);
    
    // Give it some time to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  }, 60000); // 60 second timeout for setup

  afterAll(() => {
    if (client) {
      client.stop();
    }
  });

  it('should start and initialize successfully', () => {
    expect(client).toBeDefined();
  });

  it('should open a document', async () => {
    await expect(client.openDocument(programPath)).resolves.not.toThrow();
  }, 10000);

  it('should get symbols for int variable (foo)', async () => {
    // Test case 1: var foo = 5;
    // Line 11: var foo = 5; (0-indexed: line 10)
    // Character position of 'foo' around position 16-19
    await client.openDocument(programPath);
    
    const typeDefinitions = await client.getTypeDefinition(programPath, 11, 32); // position on "foo" in Console.WriteLine(foo)
    
    expect(typeDefinitions).toBeDefined();
    expect(typeDefinitions.length).toBeGreaterThan(0);
    
    if (typeDefinitions.length > 0) {
      const typeDef = typeDefinitions[0];
      const typeDefPath = typeDef.uri.replace('file://', '');
      
      await client.openDocument(typeDefPath);
      const symbols = await client.getDocumentSymbols(typeDefPath);
      
      expect(symbols).toBeDefined();
      expect(symbols.length).toBeGreaterThan(0);
      
      // int should have methods like ToString, GetHashCode, etc.
      const methodSymbols = filterSymbolsByType(symbols, 'Method');
      expect(methodSymbols.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('should get symbols for JsonSerializerOptions type', async () => {
    // Test case 2: JsonSerializerOptions (System.Text.Json)
    // Line 14: var options = new JsonSerializerOptions();
    // Position on "JsonSerializerOptions"
    await client.openDocument(programPath);
    
    const typeDefinitions = await client.getTypeDefinition(programPath, 14, 35); // position on "JsonSerializerOptions"
    
    expect(typeDefinitions).toBeDefined();
    expect(typeDefinitions.length).toBeGreaterThan(0);
    
    if (typeDefinitions.length > 0) {
      const typeDef = typeDefinitions[0];
      const typeDefPath = typeDef.uri.replace('file://', '');
      
      await client.openDocument(typeDefPath);
      const symbols = await client.getDocumentSymbols(typeDefPath);
      
      expect(symbols).toBeDefined();
      expect(symbols.length).toBeGreaterThan(0);
      
      // JsonSerializerOptions should have properties
      const propertySymbols = filterSymbolsByType(symbols, 'Property');
      expect(propertySymbols.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('should get symbols for JsonConvert (Newtonsoft.Json)', async () => {
    // Test case 3: JsonConvert from Newtonsoft.Json (3rd party library)
    // Line 17: var json = JsonConvert.SerializeObject(new { Name = "Test" });
    // Position on "JsonConvert"
    await client.openDocument(programPath);
    
    const typeDefinitions = await client.getTypeDefinition(programPath, 17, 24); // position on "JsonConvert"
    
    expect(typeDefinitions).toBeDefined();
    expect(typeDefinitions.length).toBeGreaterThan(0);
    
    if (typeDefinitions.length > 0) {
      const typeDef = typeDefinitions[0];
      const typeDefPath = typeDef.uri.replace('file://', '');
      
      await client.openDocument(typeDefPath);
      const symbols = await client.getDocumentSymbols(typeDefPath);
      
      expect(symbols).toBeDefined();
      expect(symbols.length).toBeGreaterThan(0);
      
      // JsonConvert should have methods like SerializeObject
      const methodSymbols = filterSymbolsByType(symbols, 'Method');
      expect(methodSymbols.length).toBeGreaterThan(0);
      
      // Check that SerializeObject is in the methods
      const serializeObjectMethods = methodSymbols.filter(s => s.name.includes('SerializeObject'));
      expect(serializeObjectMethods.length).toBeGreaterThan(0);
    }
  }, 30000);

  it('should filter symbols by type', async () => {
    await client.openDocument(programPath);
    
    const typeDefinitions = await client.getTypeDefinition(programPath, 17, 24);
    
    if (typeDefinitions.length > 0) {
      const typeDef = typeDefinitions[0];
      const typeDefPath = typeDef.uri.replace('file://', '');
      
      await client.openDocument(typeDefPath);
      const allSymbols = await client.getDocumentSymbols(typeDefPath);
      
      const methodSymbols = filterSymbolsByType(allSymbols, 'Method');
      const propertySymbols = filterSymbolsByType(allSymbols, 'Property');
      
      // All filtered symbols should be of the correct kind
      methodSymbols.forEach(symbol => {
        const kind = symbolKindToString(symbol.kind);
        expect(kind === 'Method' || kind === 'Constructor').toBe(true);
      });
      
      propertySymbols.forEach(symbol => {
        expect(symbolKindToString(symbol.kind)).toBe('Property');
      });
    }
  }, 30000);

  it('should format symbols with signatures only', async () => {
    await client.openDocument(programPath);
    
    const typeDefinitions = await client.getTypeDefinition(programPath, 17, 24);
    
    if (typeDefinitions.length > 0) {
      const typeDef = typeDefinitions[0];
      const typeDefPath = typeDef.uri.replace('file://', '');
      
      await client.openDocument(typeDefPath);
      const symbols = await client.getDocumentSymbols(typeDefPath);
      
      const methodSymbols = filterSymbolsByType(symbols, 'Method');
      const formatted = formatSymbols(methodSymbols, true);
      
      // With signaturesOnly, should not have 'detail' but may have 'signature'
      formatted.forEach(symbol => {
        expect(symbol).toHaveProperty('name');
        expect(symbol).toHaveProperty('kind');
        expect(symbol).not.toHaveProperty('range');
      });
    }
  }, 30000);

  it('should format symbols with full details', async () => {
    await client.openDocument(programPath);
    
    const typeDefinitions = await client.getTypeDefinition(programPath, 17, 24);
    
    if (typeDefinitions.length > 0) {
      const typeDef = typeDefinitions[0];
      const typeDefPath = typeDef.uri.replace('file://', '');
      
      await client.openDocument(typeDefPath);
      const symbols = await client.getDocumentSymbols(typeDefPath);
      
      const methodSymbols = filterSymbolsByType(symbols, 'Method').slice(0, 5);
      const formatted = formatSymbols(methodSymbols, false);
      
      // With full details, should have range
      formatted.forEach(symbol => {
        expect(symbol).toHaveProperty('name');
        expect(symbol).toHaveProperty('kind');
        expect(symbol).toHaveProperty('range');
      });
    }
  }, 30000);
});

describe('Symbol utilities', () => {
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
});
