import { RoslynLspClient } from './lsp-client.js';
import * as path from 'path';
import * as fs from 'fs';

const testProjectPath = path.resolve(process.cwd(), 'test-project');
const programPath = path.join(testProjectPath, 'Program.cs');

async function test() {
  const client = new RoslynLspClient();
  
  try {
    console.log('Starting LSP...');
    await client.start(testProjectPath);
    console.log('✓ LSP initialized\n');
    
    console.log('Opening document...');
    await client.openDocument(programPath);
    console.log('✓ Document opened\n');
    
    console.log('Making initial request to trigger BuildHost/project loading...');
    console.log('(This will trigger Roslyn to restore NuGet packages and build workspace - may take 5-30 seconds)');
    // This first request will trigger Roslyn to load the project, restore NuGet packages, etc.
    await client.getHover(programPath, 0, 0).catch(() => null);
    
    // Wait for the loading to complete - look for the completion message
    console.log('\nWaiting for project loading to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log('✓ Project should be loaded now\n');
    
    // Read the file to show context
    const content = fs.readFileSync(programPath, 'utf-8');
    const lines = content.split('\n');
    const targetLine = 18; // Line 19 in 1-indexed
    
    console.log(`Line ${targetLine + 1}: "${lines[targetLine]}"`);
    console.log('');
    
    // Function to show what we're hovering over
    function showContext(line: number, char: number): string {
      const lineText = lines[line];
      const start = Math.max(0, char - 5);
      const end = Math.min(lineText.length, char + 6);
      const before = lineText.substring(start, char);
      const at = lineText[char] || '';
      const after = lineText.substring(char + 1, end);
      return `"${before}[${at}]${after}"`;
    }
    
    // Try different positions
    const positions = [
      { line: 18, char: 23 },
      { line: 18, char: 28 },
      { line: 18, char: 35 },
      { line: 18, char: 36 },
      { line: 18, char: 48 }, // SerializeObject
      { line: 15, char: 30 }, // JsonSerializerOptions on line 16
      { line: 12, char: 12 }, // Console on line 13
    ];
    
    for (const pos of positions) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Position: line ${pos.line}, char ${pos.char}`);
      console.log(`Context: ${showContext(pos.line, pos.char)}`);
      console.log('');
      
      const hover = await client.getHover(programPath, pos.line, pos.char);
      if (hover) {
        console.log('✓ HOVER FOUND:');
        const hoverText = typeof hover.contents === 'string' 
          ? hover.contents 
          : (hover.contents.value || JSON.stringify(hover.contents));
        console.log(hoverText.substring(0, 400));
      } else {
        console.log('✗ No hover info');
      }
      
      const typeDef = await client.getTypeDefinition(programPath, pos.line, pos.char);
      if (typeDef && typeDef.length > 0) {
        console.log('\n✓ TYPE DEFINITION FOUND:');
        const typeDefUri = typeDef[0].uri;
        console.log('  URI:', typeDefUri);
        
        // Check if it's a metadata URI (decompiled type)
        if (typeDefUri.startsWith('csharp:/metadata/') || typeDefUri.startsWith('file://')) {
          console.log('\n  Getting symbols from type URI (may be metadata)...');
          
          // Request symbols directly using the metadata URI
          const symbols = await client.getDocumentSymbolsByUri(typeDefUri);
          console.log(`  Symbols found: ${symbols.length}`);
          if (symbols.length > 0) {
            console.log('  First 10 symbols:');
            symbols.slice(0, 10).forEach(s => {
              console.log(`    - ${s.name} (kind: ${s.kind}) ${s.detail || ''}`);
            });
            console.log('\n🎉 SUCCESS! Found type with symbols from metadata/decompiled source!');
            break;
          }
        }
      } else {
        console.log('\n✗ No type definition');
      }
      
      const def = await client.getDefinition(programPath, pos.line, pos.char);
      if (def && def.length > 0) {
        console.log('\n✓ DEFINITION FOUND:');
        const defUri = def[0].uri;
        console.log('  URI:', defUri);
        
        if (defUri.startsWith('csharp:/metadata/') || (defUri.startsWith('file://') && !defUri.includes(programPath))) {
          console.log('\n  Getting symbols from definition URI...');
          const symbols = await client.getDocumentSymbolsByUri(defUri);
          console.log(`  Symbols found: ${symbols.length}`);
          if (symbols.length > 0) {
            console.log('  First 10 symbols:');
            symbols.slice(0, 10).forEach(s => {
              console.log(`    - ${s.name} (kind: ${s.kind}) ${s.detail || ''}`);
            });
            console.log('\n🎉 SUCCESS! Found definition with symbols!');
            break;
          }
        }
      } else {
        console.log('\n✗ No definition');
      }
    }
    
    client.stop();
    console.log('\nTest completed');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    client.stop();
    process.exit(1);
  }
}

test();

