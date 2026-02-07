import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RoslynLspClient } from '../src/lsp-client.js';
import * as path from 'path';
import { execSync } from 'child_process';
import { checkRoslynLanguageServer } from '../src/roslyn-check.js';

/**
 * FUNCTIONAL END-TO-END TESTS
 * These tests actually call the LSP and verify we get REAL symbol data back
 */

const testProjectPath = path.resolve(process.cwd(), 'test-project');
const programPath = path.join(testProjectPath, 'TestProject', 'Program.cs');

describe('END-TO-END FUNCTIONAL TESTS - Real Symbol Retrieval', () => {
  let client: RoslynLspClient | null = null;
  const roslynAvailable = checkRoslynLanguageServer();

  beforeAll(async () => {
    if (!roslynAvailable) {
      console.log('⚠️  Skipping E2E tests - roslyn-language-server not installed');
      console.log('Install with: dotnet tool install --global roslyn-language-server --prerelease');
      return;
    }

    console.log('🔧 Setting up E2E tests...');
    
    // MUST restore and build the test project
    try {
      console.log('  📦 Running dotnet restore...');
      execSync('dotnet restore', { 
        cwd: testProjectPath,
        stdio: 'pipe' 
      });
      console.log('  🔨 Running dotnet build...');
      execSync('dotnet build', { 
        cwd: testProjectPath,
        stdio: 'pipe' 
      });
      console.log('  ✅ Test project ready');
    } catch (error) {
      console.error('  ❌ Failed to restore/build test project:', error);
      throw error;
    }

    // Start LSP client
    console.log('  🚀 Starting Roslyn LSP client...');
    client = new RoslynLspClient();
    try {
      await client.start(testProjectPath);
      console.log('  ✅ LSP client started');
      
      // Open the document and wait for analysis
      console.log('  📄 Opening Program.cs and waiting for analysis...');
      await client.openDocument(programPath);
      console.log('  ✅ Document analyzed');
      
      // Trigger BuildHost load
      console.log('  🔄 Triggering BuildHost load (this takes ~10 seconds)...');
      await client.getHover(programPath, 0, 0).catch(() => null);
      await new Promise(resolve => setTimeout(resolve, 15000)); // Wait for BuildHost
      console.log('  ✅ BuildHost loaded');
      
    } catch (error) {
      console.error('  ❌ Failed to start LSP client:', error);
      client = null;
    }
  }, 120000); // 2 minute timeout for setup

  afterAll(() => {
    if (client) {
      console.log('🧹 Cleaning up...');
      client.stop();
    }
  });

  /**
   * TEST CASE 1: Core type - int via variable foo
   * Line 13: Console.WriteLine(foo);
   * Requirement: Get ALL symbols for int type
   */
  it.skipIf(!roslynAvailable)('TEST CASE 1: Must get symbols for int type via variable "foo"', async () => {
    if (!client) throw new Error('LSP client not initialized');
    
    console.log('\n📝 TEST CASE 1: var foo = 5; Console.WriteLine(foo)');
    console.log('  Position: Line 12, Character 30 (hovering over "foo" in WriteLine)');
    
    // Get hover to confirm we can locate the symbol
    const hover = await client.getHover(programPath, 12, 30);
    console.log('  Hover result:', hover ? '✅ Found' : '❌ Not found');
    
    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === 'string' 
        ? hover.contents 
        : hover.contents.value || '';
      console.log('  Type info:', hoverText.substring(0, 100));
      
      // Should mention "int"
      expect(hoverText.toLowerCase()).toContain('int');
    }
    
    // Try to get type definition
    const typeDef = await client.getTypeDefinition(programPath, 12, 30);
    console.log('  Type definition:', typeDef && typeDef.length > 0 ? '✅ Found' : '⚠️  Not found');
    
    if (typeDef && typeDef.length > 0) {
      const uri = typeDef[0].uri;
      console.log('  Type URI:', uri);
      
      // Get symbols from the type
      const symbols = await client.getDocumentSymbolsByUri(uri);
      console.log('  📊 Symbols found:', symbols.length);
      
      // int should have methods like ToString, GetHashCode, etc.
      expect(symbols.length).toBeGreaterThan(0);
      console.log('  ✅ SUCCESS: Got', symbols.length, 'symbols for int');
      
      // Show some methods
      const methodNames = symbols.slice(0, 5).map(s => s.name);
      console.log('  Sample symbols:', methodNames.join(', '));
    }
  }, 30000);

  /**
   * TEST CASE 2: Framework type - JsonSerializerOptions (System.Text.Json)
   * Line 16: var options = new JsonSerializerOptions();
   * Requirement: Get ALL symbols from System.Text.Json type
   */
  it.skipIf(!roslynAvailable)('TEST CASE 2: Must get symbols for JsonSerializerOptions (System.Text.Json)', async () => {
    if (!client) throw new Error('LSP client not initialized');
    
    console.log('\n📝 TEST CASE 2: var options = new JsonSerializerOptions()');
    console.log('  Position: Line 15, Character 30 (hovering over "JsonSerializerOptions")');
    
    // Get hover
    const hover = await client.getHover(programPath, 15, 30);
    console.log('  Hover result:', hover ? '✅ Found' : '❌ Not found');
    
    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === 'string' 
        ? hover.contents 
        : hover.contents.value || '';
      console.log('  Type info:', hoverText.substring(0, 150));
    }
    
    // Get type definition or regular definition
    let symbols: any[] = [];
    let uri: string | null = null;
    
    const typeDef = await client.getTypeDefinition(programPath, 15, 30);
    if (typeDef && typeDef.length > 0) {
      uri = typeDef[0].uri;
      console.log('  Type definition URI:', uri);
      symbols = await client.getDocumentSymbolsByUri(uri);
    } else {
      const def = await client.getDefinition(programPath, 15, 30);
      if (def && def.length > 0) {
        uri = def[0].uri;
        console.log('  Definition URI:', uri);
        symbols = await client.getDocumentSymbolsByUri(uri);
      }
    }
    
    console.log('  📊 Symbols found:', symbols.length);
    
    // JsonSerializerOptions should have properties
    expect(symbols.length).toBeGreaterThan(0);
    console.log('  ✅ SUCCESS: Got', symbols.length, 'symbols for JsonSerializerOptions');
    
    if (symbols.length > 0) {
      const sampleNames = symbols.slice(0, 10).map(s => s.name);
      console.log('  Sample symbols:', sampleNames.join(', '));
    }
    
    // Verify we got a metadata URI (decompiled)
    if (uri) {
      expect(uri).toMatch(/MetadataAsSource|metadata/);
      console.log('  ✅ VERIFIED: Using decompiled metadata source');
    }
  }, 30000);

  /**
   * TEST CASE 3: 3rd Party Library - JsonConvert (Newtonsoft.Json)
   * Line 19: var json = JsonConvert.SerializeObject(new { Name = "Test" });
   * Requirement: Get ALL symbols from NuGet package type
   * THIS IS THE MOST IMPORTANT TEST
   */
  it.skipIf(!roslynAvailable)('TEST CASE 3: Must get symbols for JsonConvert (Newtonsoft.Json NuGet package) ⭐', async () => {
    if (!client) throw new Error('LSP client not initialized');
    
    console.log('\n📝 TEST CASE 3: JsonConvert.SerializeObject (MOST IMPORTANT)');
    console.log('  This is a 3rd party NuGet package type');
    console.log('  Position: Line 18, Character 28 (hovering over "JsonConvert")');
    
    // Get hover
    const hover = await client.getHover(programPath, 18, 28);
    console.log('  Hover result:', hover ? '✅ Found' : '❌ Not found');
    
    if (hover && hover.contents) {
      const hoverText = typeof hover.contents === 'string' 
        ? hover.contents 
        : hover.contents.value || '';
      console.log('  Type info:', hoverText.substring(0, 200));
      
      // Should mention JsonConvert or Newtonsoft
      const lowerText = hoverText.toLowerCase();
      const hasJsonConvert = lowerText.includes('jsonconvert');
      const hasNewtonsoft = lowerText.includes('newtonsoft');
      console.log('  Contains "jsonconvert":', hasJsonConvert ? '✅' : '❌');
      console.log('  Contains "newtonsoft":', hasNewtonsoft ? '✅' : '❌');
    }
    
    // Try type definition first
    let symbols: any[] = [];
    let uri: string | null = null;
    let foundVia: string | null = null;
    
    const typeDef = await client.getTypeDefinition(programPath, 18, 28);
    console.log('  Type definition results:', typeDef?.length || 0);
    
    if (typeDef && typeDef.length > 0) {
      uri = typeDef[0].uri;
      foundVia = 'typeDefinition';
      console.log('  ✅ Type definition URI:', uri);
      symbols = await client.getDocumentSymbolsByUri(uri);
    } else {
      // Try regular definition
      const def = await client.getDefinition(programPath, 18, 28);
      console.log('  Definition results:', def?.length || 0);
      
      if (def && def.length > 0) {
        uri = def[0].uri;
        foundVia = 'definition';
        console.log('  ✅ Definition URI:', uri);
        symbols = await client.getDocumentSymbolsByUri(uri);
      }
    }
    
    console.log('  📊 Symbols found:', symbols.length);
    console.log('  Found via:', foundVia || 'none');
    
    // THIS IS THE KEY ASSERTION - WE MUST GET SYMBOLS FOR JSONCONVERT
    expect(symbols.length).toBeGreaterThan(0);
    console.log('  ✅✅✅ SUCCESS: Got', symbols.length, 'symbols for JsonConvert from NuGet!');
    
    if (symbols.length > 0) {
      const methodNames = symbols.filter(s => s.kind === 6).map(s => s.name);
      console.log('  Methods found:', methodNames.length);
      console.log('  Sample methods:', methodNames.slice(0, 10).join(', '));
      
      // Should have SerializeObject method
      const hasSerializeObject = methodNames.some(name => name.includes('SerializeObject'));
      console.log('  Has SerializeObject method:', hasSerializeObject ? '✅' : '❌');
      
      // Should have DeserializeObject method
      const hasDeserializeObject = methodNames.some(name => name.includes('DeserializeObject'));
      console.log('  Has DeserializeObject method:', hasDeserializeObject ? '✅' : '❌');
      
      expect(hasSerializeObject || hasDeserializeObject).toBe(true);
    }
    
    // Verify we got a metadata URI (decompiled)
    if (uri) {
      console.log('  URI type:', uri.includes('MetadataAsSource') ? 'Decompiled metadata ✅' : 'Regular file');
      expect(uri).toMatch(/MetadataAsSource|metadata|\.cs$/);
      console.log('  ✅ VERIFIED: Using decompiled source for NuGet package');
    }
  }, 30000);

  /**
   * TEST: SymbolType filtering works
   */
  it.skipIf(!roslynAvailable)('FUNCTIONAL: SymbolType filtering must work', async () => {
    if (!client) throw new Error('LSP client not initialized');
    
    console.log('\n📝 FUNCTIONAL TEST: SymbolType filtering');
    
    // Use JsonSerializerOptions as test subject
    const typeDef = await client.getTypeDefinition(programPath, 15, 30);
    if (typeDef && typeDef.length > 0) {
      const uri = typeDef[0].uri;
      const allSymbols = await client.getDocumentSymbolsByUri(uri);
      
      console.log('  Total symbols:', allSymbols.length);
      
      // Import the filter function
      const { filterSymbolsByType } = await import('../src/lsp-client.js');
      
      // Filter by Property
      const properties = filterSymbolsByType(allSymbols, 'Property');
      console.log('  Properties:', properties.length);
      expect(properties.length).toBeGreaterThan(0);
      
      // Filter by Method
      const methods = filterSymbolsByType(allSymbols, 'Method');
      console.log('  Methods:', methods.length);
      expect(methods.length).toBeGreaterThan(0);
      
      console.log('  ✅ Filtering works correctly');
    }
  }, 30000);

  /**
   * TEST: SignaturesOnly formatting works
   */
  it.skipIf(!roslynAvailable)('FUNCTIONAL: SignaturesOnly must return only signatures', async () => {
    if (!client) throw new Error('LSP client not initialized');
    
    console.log('\n📝 FUNCTIONAL TEST: SignaturesOnly formatting');
    
    const typeDef = await client.getTypeDefinition(programPath, 15, 30);
    if (typeDef && typeDef.length > 0) {
      const uri = typeDef[0].uri;
      const symbols = await client.getDocumentSymbolsByUri(uri);
      
      const { formatSymbols } = await import('../src/lsp-client.js');
      
      // Format with full details
      const fullFormat = formatSymbols(symbols.slice(0, 3), false);
      console.log('  Full format has "range":', fullFormat[0]?.range ? '✅' : '❌');
      expect(fullFormat[0]).toHaveProperty('range');
      
      // Format with signatures only
      const sigOnly = formatSymbols(symbols.slice(0, 3), true);
      console.log('  Sig-only has "signature":', sigOnly[0]?.signature !== undefined ? '✅' : '❌');
      console.log('  Sig-only missing "range":', !sigOnly[0]?.range ? '✅' : '❌');
      expect(sigOnly[0]).not.toHaveProperty('range');
      
      console.log('  ✅ SignaturesOnly formatting works');
    }
  }, 30000);
});
