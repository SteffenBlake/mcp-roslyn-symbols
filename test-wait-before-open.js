#!/usr/bin/env node
/**
 * Test: Wait for solution to load BEFORE opening document
 * 
 * ACTUAL RESULTS (2024-02-07):
 * - WITHOUT --autoLoadProjects flag:
 *   - LSP initializes successfully with workspaceFolders set
 *   - Waited 120 seconds after init - NO log messages about TestProject.csproj loading
 *   - NO background solution loading occurred at all
 *   - When document opened after 120s wait, still no TestProject loading
 *   - Type definition for JsonConvert returns empty []
 *   - BuildHost only starts when typeDefinition request is made
 *   - When it does start, creates Canonical project, NOT TestProject
 *   - CONCLUSION: workspaceFolders alone does NOT trigger solution auto-loading
 *   - The solution is NOT being discovered/loaded automatically
 * 
 * - WITH --autoLoadProjects flag:
 *   - FIXED! TestProject.csproj loads automatically
 *   - See src/diagnose-lsp.ts (compiled to dist/diagnose-lsp.js) for working version
 */

import { RoslynLspClient } from './dist/lsp-client.js';
import * as path from 'path';

const testProjectRoot = path.join(process.cwd(), 'test-project');
const programFile = path.join(testProjectRoot, 'TestProject', 'Program.cs');

console.log('🔍 TEST: Wait for solution load before opening document');
console.log('─'.repeat(80));

async function test() {
  const client = new RoslynLspClient('verbose');
  
  try {
    console.log('\n⏱️  Step 1: Starting LSP...');
    await client.start(testProjectRoot);
    console.log('✅ LSP started');
    
    console.log('\n⏱️  Step 2: Waiting 120 seconds for background solution loading...');
    console.log('(Looking for log messages about TestProject.csproj loading)');
    await new Promise(resolve => setTimeout(resolve, 120000));
    
    console.log('\n⏱️  Step 3: NOW opening document (solution should be loaded)...');
    await client.openDocument(programFile);
    console.log('✅ Document opened');
    
    console.log('\n⏱️  Step 4: Trying to get type definition for JsonConvert...');
    const jsonDef = await client.getTypeDefinition(programFile, 18, 19);
    console.log('JsonConvert type def result:', jsonDef);
    
    if (jsonDef && jsonDef.length > 0) {
      console.log('\n✅ SUCCESS! Got type definition:');
      console.log('   URI:', jsonDef[0].uri);
      if (jsonDef[0].uri.includes('roslyn-canonical-misc')) {
        console.log('   ❌ BUT it\'s from Canonical project!');
      } else if (jsonDef[0].uri.startsWith('csharp:/metadata/')) {
        console.log('   ✅ From real project metadata!');
      }
    } else {
      console.log('\n❌ FAILED: No type definition found');
    }
    
    await client.stop();
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    await client.stop();
    process.exit(1);
  }
}

test();
