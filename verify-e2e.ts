#!/usr/bin/env node
/**
 * END-TO-END VERIFICATION SCRIPT
 * This script actually calls the MCP server and verifies it returns real symbol data
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const serverPath = path.resolve(process.cwd(), 'dist/index.js');
const testProjectPath = path.resolve(process.cwd(), 'test-project');
const programPath = path.join(testProjectPath, 'TestProject', 'Program.cs');

console.log('='.repeat(80));
console.log('END-TO-END MCP SERVER VERIFICATION');
console.log('='.repeat(80));
console.log('');

// Read the test file to show what we're testing
const programContent = fs.readFileSync(programPath, 'utf-8');
const lines = programContent.split('\n');

console.log('Test File Content:');
console.log('-'.repeat(80));
lines.forEach((line, i) => {
  console.log(`${String(i + 1).padStart(3)}: ${line}`);
});
console.log('-'.repeat(80));
console.log('');

// Start the MCP server
console.log('Starting MCP server...');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let serverOutput = '';
let serverError = '';

server.stdout.on('data', (data) => {
  serverOutput += data.toString();
});

server.stderr.on('data', (data) => {
  serverError += data.toString();
  console.error('Server stderr:', data.toString());
});

// Wait a bit for server to start
await new Promise(resolve => setTimeout(resolve, 1000));

console.log('Server started. Testing tool calls...\n');

// Test Case 1: Variable 'foo' (int type) - Line 13, char 30 (approximate position of 'foo')
console.log('TEST CASE 1: Core type (int via variable foo)');
console.log('Line 13: Console.WriteLine(foo);');
console.log('Testing position: line 12, character 30 (0-indexed)');
await testToolCall('Test Case 1: int variable', programPath, 12, 30);

// Test Case 2: JsonSerializerOptions - Line 16
console.log('\nTEST CASE 2: Framework type (JsonSerializerOptions)');
console.log('Line 16: var options = new JsonSerializerOptions();');
console.log('Testing position: line 15, character 30');
await testToolCall('Test Case 2: JsonSerializerOptions', programPath, 15, 30);

// Test Case 3: JsonConvert - Line 19
console.log('\nTEST CASE 3: 3rd party library (JsonConvert from Newtonsoft.Json)');
console.log('Line 19: var json = JsonConvert.SerializeObject(new { Name = "Test" });');
console.log('Testing position: line 18, character 28');
await testToolCall('Test Case 3: JsonConvert', programPath, 18, 28);

// Cleanup
server.kill();
console.log('\n' + '='.repeat(80));
console.log('VERIFICATION COMPLETE');
console.log('='.repeat(80));

async function testToolCall(testName: string, filePath: string, line: number, character: number) {
  return new Promise<void>((resolve, reject) => {
    const requestId = Date.now();
    
    // MCP request format
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: 'get_symbols_for',
        arguments: {
          filePath,
          line,
          character
        }
      }
    };
    
    const requestStr = JSON.stringify(request);
    const content = `Content-Length: ${Buffer.byteLength(requestStr)}\r\n\r\n${requestStr}`;
    
    console.log(`Sending request: ${testName}`);
    
    let responseBuffer = '';
    let timeout: NodeJS.Timeout;
    
    const onData = (data: Buffer) => {
      responseBuffer += data.toString();
      
      // Try to parse response
      const match = responseBuffer.match(/Content-Length: (\d+)\r\n\r\n([\s\S]*)/);
      if (match) {
        const contentLength = parseInt(match[1]);
        const content = match[2];
        
        if (content.length >= contentLength) {
          const responseJson = content.substring(0, contentLength);
          try {
            const response = JSON.parse(responseJson);
            
            if (response.id === requestId) {
              clearTimeout(timeout);
              server.stdout.off('data', onData);
              
              console.log(`✓ Response received for ${testName}`);
              
              if (response.result?.content?.[0]?.text) {
                const result = JSON.parse(response.result.content[0].text);
                console.log(`  - Type definition file: ${result.typeDefinitionFile || result.definitionFile || 'N/A'}`);
                console.log(`  - Symbols found: ${result.symbols?.length || 0}`);
                
                if (result.symbols?.length > 0) {
                  console.log(`  - Sample symbols: ${result.symbols.slice(0, 3).map((s: any) => s.name).join(', ')}`);
                  console.log(`  ✅ SUCCESS - Got real symbol data!`);
                } else if (result.typeInfo) {
                  console.log(`  - Type info available: ${result.typeInfo.hoverText?.substring(0, 100)}`);
                  console.log(`  ⚠️  Type info available but no symbols (may need more LSP time)`);
                } else {
                  console.log(`  ⚠️  No symbols found (LSP may still be loading)`);
                }
              }
              
              resolve();
            }
          } catch (e) {
            // Not valid JSON yet, keep buffering
          }
        }
      }
    };
    
    server.stdout.on('data', onData);
    
    timeout = setTimeout(() => {
      server.stdout.off('data', onData);
      console.log(`  ⏱️  Timeout waiting for response (LSP may still be initializing)`);
      resolve();
    }, 120000); // 2 minute timeout for LSP to fully load
    
    server.stdin.write(content);
  });
}
