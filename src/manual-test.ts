import { RoslynLspClient } from './lsp-client.js';
import * as path from 'path';

const testProjectPath = path.resolve(process.cwd(), 'test-project');
const programPath = path.join(testProjectPath, 'Program.cs');

async function test() {
  const client = new RoslynLspClient();
  
  try {
    console.log('Starting LSP...');
    await client.start(testProjectPath);
    console.log('LSP started successfully\n');
    
    console.log('Opening document...');
    await client.openDocument(programPath);
    console.log('Document opened\n');
    
    // Wait for LSP to analyze
    console.log('Waiting for LSP to analyze (15 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    console.log('\n=== Test 1: Search for JsonConvert in workspace ===');
    const jsonConvertSymbols = await client.workspaceSymbol('JsonConvert');
    console.log('JsonConvert workspace symbols:', JSON.stringify(jsonConvertSymbols.slice(0, 5), null, 2));
    
    if (jsonConvertSymbols.length > 0) {
      const symbol = jsonConvertSymbols[0];
      const symbolPath = symbol.location.uri.replace('file://', '');
      console.log('\n=== Test 2: Getting symbols from JsonConvert location ===');
      console.log('Symbol location:', symbolPath);
      
      try {
        await client.openDocument(symbolPath);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const symbols = await client.getDocumentSymbols(symbolPath);
        console.log('Symbols count:', symbols.length);
        console.log('Sample symbols:', JSON.stringify(symbols.slice(0, 10).map(s => ({
          name: s.name,
          kind: s.kind,
          detail: s.detail
        })), null, 2));
      } catch (error) {
        console.log('Could not open symbol file:', error instanceof Error ? error.message : String(error));
      }
    }
    
    console.log('\n=== Test 3: Search for Int32 in workspace ===');
    const intSymbols = await client.workspaceSymbol('Int32');
    console.log('Int32 workspace symbols count:', intSymbols.length);
    if (intSymbols.length > 0) {
      console.log('First Int32 symbol:', JSON.stringify(intSymbols[0], null, 2));
    }
    
    client.stop();
    console.log('\nTest completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    client.stop();
    process.exit(1);
  }
}

test();





