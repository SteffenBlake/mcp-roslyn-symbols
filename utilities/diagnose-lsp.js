#!/usr/bin/env node
/**
 * LSP Diagnostic Utility
 *
 * This utility helps diagnose and debug Roslyn Language Server Protocol (LSP) issues
 * by providing verbose logging of the complete LSP initialization and symbol retrieval process.
 *
 * ## Purpose
 * Use this tool to:
 * - Debug LSP connection and initialization issues
 * - Verify that projects are loading correctly (not stuck in Canonical misc files project)
 * - Test symbol resolution for both BCL types and NuGet package types
 * - Understand timing issues with project loading and symbol availability
 * - Troubleshoot why certain symbols aren't being resolved
 *
 * ## How to Use
 * 1. Build the project: `npm run build`
 * 2. Run the diagnostic: `node dist/utilities/diagnose-lsp.js`
 *
 * The script will:
 * - Start the LSP server with verbose logging enabled
 * - Load the test project and wait for the real project (not Canonical) to initialize
 * - Query symbols for a NuGet package type (JsonConvert from Newtonsoft.Json)
 * - Display detailed timing and result information
 *
 * ## Output
 * - Verbose LSP messages showing initialization sequence
 * - Project loading status and timing
 * - Symbol retrieval results with counts and types
 * - Total execution time
 *
 * ## Common Issues This Helps Debug
 * - "Canonical.cs" project issues (document stuck in misc files project)
 * - NuGet package symbols not resolving
 * - LSP initialization timeouts
 * - Project loading delays
 */
// @ts-ignore - Import path will resolve correctly at runtime after compilation
import { RoslynLspClient } from '../src/lsp-client.js';
import * as path from 'path';
const testProjectRoot = path.join(process.cwd(), 'test-project'); // Workspace root (contains .slnx)
const testProjectPath = path.join(testProjectRoot, 'TestProject'); // Project directory
const programFile = path.join(testProjectPath, 'Program.cs');
console.log('🔍 DIAGNOSTIC: Observing complete LSP loading sequence');
console.log('📁 Workspace Root:', testProjectRoot);
console.log('📁 Project:', testProjectPath);
console.log('📄 File:', programFile);
console.log('─'.repeat(80));
async function diagnose() {
    const client = new RoslynLspClient('verbose'); // Use verbose mode for diagnostics
    try {
        console.log('\n⏱️  [0s] Starting LSP...');
        const startTime = Date.now();
        await client.start(testProjectRoot); // Pass workspace root, not project path
        console.log(`✅ [${((Date.now() - startTime) / 1000).toFixed(1)}s] LSP started`);
        console.log(`\n⏱️  [${((Date.now() - startTime) / 1000).toFixed(1)}s] Opening document...`);
        await client.openDocument(programFile);
        console.log(`✅ [${((Date.now() - startTime) / 1000).toFixed(1)}s] Document opened`);
        // Now try to get symbols for JsonConvert (the critical NuGet test)
        // getSymbolsFor will handle waiting for real project load internally
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n⏱️  [${elapsed}s] Testing JsonConvert (NuGet) symbol retrieval...`);
        console.log('   Position: Line 18, Character 19 (JsonConvert.SerializeObject)');
        const result = await client.getSymbolsFor(programFile, 18, 19);
        console.log(`\n📊 RESULT for JsonConvert:`);
        console.log(`   Symbols found: ${result.symbols.length}`);
        console.log(`   Source URI: ${result.sourceUri || 'Unknown'}`);
        if (result.symbols.length > 0) {
            console.log(`\n✅ SUCCESS! NuGet symbols retrieved!`);
            console.log(`   First 5 symbols:`);
            result.symbols.slice(0, 5).forEach((s) => {
                console.log(`     - ${s.kind}: ${s.name}`);
            });
        }
        else {
            console.log(`\n❌ FAILURE! No symbols retrieved from NuGet package`);
            console.log(`   This means we're not waiting long enough or for the right signal`);
        }
        console.log(`\n⏱️  Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        await client.stop();
    }
    catch (error) {
        console.error('\n❌ ERROR:', error);
        await client.stop();
        process.exit(1);
    }
}
diagnose();
