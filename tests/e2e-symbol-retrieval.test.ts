import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RoslynLspClient } from '../src/lsp-client.js';
import * as path from 'path';
import { execSync } from 'child_process';
import { checkRoslynLanguageServer } from '../src/roslyn-check.js';

/**
 * End-to-End tests for precise symbol retrieval
 * 
 * These tests verify the core functionality of retrieving symbols
 * for specific cursor positions in C# code.
 * 
 * ⚠️  IMPORTANT FOR FUTURE AGENTS:
 * Before running these tests, you MUST install roslyn-language-server:
 * 
 *   dotnet tool install --global roslyn-language-server --prerelease
 * 
 * DO NOT skip this step. The tests will fail without it.
 */

const TEST_PROJECT_ROOT = path.resolve(process.cwd(), 'test-project');
const PROGRAM_FILE = path.join(TEST_PROJECT_ROOT, 'TestProject', 'Program.cs');

// Check if LSP is installed, if not, try to install it
let ROSLYN_AVAILABLE = checkRoslynLanguageServer();

if (!ROSLYN_AVAILABLE) {
  console.log('⚠️  roslyn-language-server not found. Attempting to install...');
  try {
    execSync('dotnet tool install --global roslyn-language-server --prerelease', {
      stdio: 'inherit'
    });
    console.log('✅ roslyn-language-server installed successfully');
    ROSLYN_AVAILABLE = true;
  } catch (error) {
    console.error('❌ Failed to install roslyn-language-server');
    console.error('Please run: dotnet tool install --global roslyn-language-server --prerelease');
    ROSLYN_AVAILABLE = false;
  }
}

describe('E2E Symbol Retrieval', () => {
  let lspClient: RoslynLspClient | null = null;

  beforeAll(async () => {
    if (!ROSLYN_AVAILABLE) {
      console.log('⚠️  Skipping E2E tests - roslyn-language-server not installed');
      return;
    }

    await prepareTestProject();
    lspClient = await initializeLspClient();
    await waitForProjectLoad(lspClient);
  }, 180000); // 3 minute timeout for initial setup

  afterAll(() => {
    if (lspClient) {
      lspClient.stop();
    }
  });

  /**
   * TEST 1: Retrieve symbols for variable 'foo' (int type)
   * 
   * Code: var foo = 5; Console.WriteLine(foo);
   * Target: The 'foo' variable in WriteLine call
   * Expected: Should retrieve symbols for int type (ToString, GetHashCode, etc.)
   */
  it.skipIf(!ROSLYN_AVAILABLE)(
    'should retrieve symbols for variable foo (int type)',
    async () => {
      if (!lspClient) {
        throw new Error('LSP client not initialized');
      }

      // Line 12 (0-indexed), character 26: 'f' in 'foo' inside WriteLine(foo)
      const targetLine = 12;
      const targetChar = 26;

      const symbols = await retrieveSymbolsAtPosition(
        lspClient,
        PROGRAM_FILE,
        targetLine,
        targetChar
      );

      console.log(`Retrieved ${symbols.length} symbols for foo`);
      if (symbols.length > 0) {
        console.log('Symbol names:', symbols.slice(0, 10).map(s => s.name).join(', '));
      }

      // Verify we got symbols
      expect(symbols.length).toBeGreaterThan(0);

      // int type should have methods like ToString, GetHashCode
      const symbolNames = symbols.map(s => s.name);
      const hasExpectedMethods = symbolNames.some(name => 
        name.includes('ToString') || name.includes('GetHashCode') || name.includes('Equals')
      );
      
      console.log('Has expected methods (ToString/GetHashCode/Equals):', hasExpectedMethods);
      expect(hasExpectedMethods).toBe(true);
    },
    60000
  );

  /**
   * TEST 2: Retrieve symbols for JsonSerializerOptions
   * 
   * Code: var options = new JsonSerializerOptions();
   * Target: The 'JsonSerializerOptions' type
   * Expected: Should retrieve symbols from System.Text.Json
   */
  it.skipIf(!ROSLYN_AVAILABLE)(
    'should retrieve symbols for JsonSerializerOptions (framework type)',
    async () => {
      if (!lspClient) {
        throw new Error('LSP client not initialized');
      }

      // Line 15 (0-indexed), character 26: 'J' in 'JsonSerializerOptions'
      const targetLine = 15;
      const targetChar = 26;

      const symbols = await retrieveSymbolsAtPosition(
        lspClient,
        PROGRAM_FILE,
        targetLine,
        targetChar
      );

      // Verify we got symbols
      expect(symbols.length).toBeGreaterThan(0);

      console.log(`Retrieved ${symbols.length} symbols for JsonSerializerOptions`);
    },
    60000
  );

  /**
   * TEST 3: Retrieve symbols for JsonConvert (NuGet package)
   * 
   * Code: var json = JsonConvert.SerializeObject(new { Name = "Test" });
   * Target: The 'JsonConvert' class from Newtonsoft.Json
   * Expected: Should retrieve decompiled symbols from NuGet package
   */
  it.skipIf(!ROSLYN_AVAILABLE)(
    'should retrieve symbols for JsonConvert (3rd party NuGet package)',
    async () => {
      if (!lspClient) {
        throw new Error('LSP client not initialized');
      }

      // Line 18 (0-indexed), character 19: 'J' in 'JsonConvert'
      const targetLine = 18;
      const targetChar = 19;

      const symbols = await retrieveSymbolsAtPosition(
        lspClient,
        PROGRAM_FILE,
        targetLine,
        targetChar
      );

      console.log(`Retrieved ${symbols.length} symbols for JsonConvert`);
      if (symbols.length > 0) {
        console.log('Symbol names:', symbols.slice(0, 10).map(s => s.name).join(', '));
      }

      // Verify we got symbols
      expect(symbols.length).toBeGreaterThan(0);

      // JsonConvert should have SerializeObject and DeserializeObject methods
      const symbolNames = symbols.map(s => s.name);
      const hasExpectedMethods = symbolNames.some(name => 
        name.includes('SerializeObject') || name.includes('DeserializeObject')
      );
      
      console.log('Has expected methods (Serialize/DeserializeObject):', hasExpectedMethods);
      expect(hasExpectedMethods).toBe(true);

      console.log(`Retrieved ${symbols.length} symbols for JsonConvert`);
    },
    60000
  );
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Prepares the test project by running dotnet restore and build
 */
async function prepareTestProject(): Promise<void> {
  console.log('📦 Preparing test project...');
  
  try {
    execSync('dotnet restore', {
      cwd: TEST_PROJECT_ROOT,
      stdio: 'pipe'
    });

    execSync('dotnet build', {
      cwd: TEST_PROJECT_ROOT,
      stdio: 'pipe'
    });

    console.log('✅ Test project ready');
  } catch (error) {
    console.error('❌ Failed to prepare test project:', error);
    throw error;
  }
}

/**
 * Initializes the LSP client and opens the program file
 */
async function initializeLspClient(): Promise<RoslynLspClient> {
  console.log('🚀 Initializing LSP client...');
  
  const client = new RoslynLspClient();
  await client.start(TEST_PROJECT_ROOT);
  
  console.log('📄 Opening program file...');
  await client.openDocument(PROGRAM_FILE);
  
  console.log('✅ LSP client ready');
  return client;
}

/**
 * Waits for the project to fully load using LSP callbacks
 * 
 * NO GUESSING. NO TIMEOUTS. This waits for actual LSP signals.
 */
async function waitForProjectLoad(client: RoslynLspClient): Promise<void> {
  await client.waitForProjectLoad(PROGRAM_FILE);
}

/**
 * Retrieves symbols for a type at a specific cursor position
 * 
 * @param client - The LSP client
 * @param filePath - Path to the source file
 * @param line - Line number (0-indexed)
 * @param character - Character position (0-indexed)
 * @returns Array of document symbols (flattened, including children)
 */
async function retrieveSymbolsAtPosition(
  client: RoslynLspClient,
  filePath: string,
  line: number,
  character: number
): Promise<any[]> {
  // First, get the type definition for the symbol at this position
  const typeDefinitions = await client.getTypeDefinition(filePath, line, character);
  
  if (!typeDefinitions || typeDefinitions.length === 0) {
    // Fallback to regular definition
    const definitions = await client.getDefinition(filePath, line, character);
    
    if (!definitions || definitions.length === 0) {
      return [];
    }
    
    const defUri = definitions[0].uri;
    const symbols = await client.getDocumentSymbolsByUri(defUri);
    return flattenSymbols(symbols);
  }
  
  const typeDefUri = typeDefinitions[0].uri;
  const symbols = await client.getDocumentSymbolsByUri(typeDefUri);
  return flattenSymbols(symbols);
}

/**
 * Flattens hierarchical document symbols into a flat array
 * This is needed because Roslyn returns symbols in a tree structure
 * (namespace > class > members), but we want all members.
 */
function flattenSymbols(symbols: any[]): any[] {
  const flattened: any[] = [];
  
  function traverse(symbol: any) {
    flattened.push(symbol);
    if (symbol.children && symbol.children.length > 0) {
      symbol.children.forEach(traverse);
    }
  }
  
  symbols.forEach(traverse);
  return flattened;
}
