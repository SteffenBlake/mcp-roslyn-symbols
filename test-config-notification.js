#!/usr/bin/env node
/**
 * Test: Try triggering solution load with workspace/didChangeConfiguration
 * 
 * TESTING IF: Sending workspace config notification triggers solution loading
 */

import { RoslynLspClient } from './dist/lsp-client.js';
import * as path from 'path';

const testProjectRoot = path.join(process.cwd(), 'test-project');
const programFile = path.join(testProjectRoot, 'TestProject', 'Program.cs');

console.log('🔍 TEST: Try triggering with didChangeConfiguration');
console.log('─'.repeat(80));

async function test() {
  // We need to access private methods, so we'll create a custom test
  const { spawn } = await import('child_process');
  
  const process = spawn('roslyn-language-server', ['--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  
  let messageId = 0;
  let buffer = '';
  
  const sendRequest = (method, params) => {
    const id = ++messageId;
    const message = { jsonrpc: '2.0', id, method, params };
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    process.stdin.write(header + content);
    console.log(`→ Sent ${method}`);
  };
  
  const sendNotification = (method, params) => {
    const message = { jsonrpc: '2.0', method, params };
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    process.stdin.write(header + content);
    console.log(`→ Sent ${method} (notification)`);
  };
  
  process.stdout.on('data', (data) => {
    buffer += data.toString();
    // Just log that we got data
    console.log(`← Received ${data.length} bytes`);
  });
  
  process.stderr.on('data', (data) => {
    console.log('LSP:', data.toString().trim());
  });
  
  try {
    console.log('\n⏱️  Step 1: Initialize with workspaceFolders...');
    sendRequest('initialize', {
      processId: global.process.pid,
      rootUri: `file://${testProjectRoot}`,
      workspaceFolders: [
        {
          uri: `file://${testProjectRoot}`,
          name: path.basename(testProjectRoot),
        },
      ],
      capabilities: {
        workspace: {
          configuration: true,
          didChangeConfiguration: {
            dynamicRegistration: true,
          },
        },
      },
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n⏱️  Step 2: Send initialized notification...');
    sendNotification('initialized', {});
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n⏱️  Step 3: Send workspace/didChangeConfiguration...');
    sendNotification('workspace/didChangeConfiguration', {
      settings: {},
    });
    
    console.log('\n⏱️  Step 4: Waiting 30 seconds to see if solution loads...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    console.log('\n⏱️  Done. Check logs above for TestProject loading messages.');
    
    process.kill();
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    process.kill();
  }
}

test();
