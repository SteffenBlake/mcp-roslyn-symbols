#!/usr/bin/env node
/**
 * Debug script to check if solution loading is working
 * 
 * ACTUAL RESULTS (2024-02-07):
 * - WITHOUT --autoLoadProjects flag:
 *   - LSP initializes successfully
 *   - Waited 30 seconds after init - NO solution loading messages appeared
 *   - Opened document - still no solution loading
 *   - Waited another 30 seconds - still nothing
 *   - Type definition requests return empty arrays []
 *   - BuildHost only starts when we make typeDefinition request
 *   - When it does start, it creates Canonical project, NOT TestProject
 *   - CONCLUSION: Solution is NOT auto-loading even with workspaceFolders set
 * 
 * - WITH --autoLoadProjects flag:
 *   - FIXED! TestProject.csproj loads automatically
 *   - See src/diagnose-lsp.ts (compiled to dist/diagnose-lsp.js) for working version
 */

import { RoslynLspClient } from './dist/lsp-client.js';
import * as path from 'path';

const testProjectRoot = path.join(process.cwd(), 'test-project');
const programFile = path.join(testProjectRoot, 'TestProject', 'Program.cs');

console.log('🔍 DEBUG: Testing solution loading');
console.log('📁 Workspace Root:', testProjectRoot);
console.log('─'.repeat(80));

async function debug() {
  const client = new RoslynLspClient('verbose');
  
  try {
    console.log('\n⏱️  Starting LSP...');
    await client.start(testProjectRoot);
    console.log('✅ LSP started');
    
    console.log('\n⏱️  Waiting 30 seconds to see if solution loads in background...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    console.log('\n⏱️  Now opening document...');
    await client.openDocument(programFile);
    console.log('✅ Document opened');
    
    console.log('\n⏱️  Waiting another 30 seconds...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    console.log('\n⏱️  Trying to get type definition for Console (line 12, char 8)...');
    const consoleDef = await client.getTypeDefinition(programFile, 12, 8);
    console.log('Console type def result:', consoleDef);
    
    console.log('\n⏱️  Trying to get type definition for JsonConvert (line 18, char 19)...');
    const jsonDef = await client.getTypeDefinition(programFile, 18, 19);
    console.log('JsonConvert type def result:', jsonDef);
    
    await client.stop();
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    await client.stop();
    process.exit(1);
  }
}

debug();
