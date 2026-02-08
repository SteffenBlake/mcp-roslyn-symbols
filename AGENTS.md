# Instructions for AI Agents

```
███████████████████████████████████████████████████████████████████
█                                                                 █
█  ⚠️⚠️⚠️  STOP! READ THIS BEFORE DOING ANYTHING ELSE  ⚠️⚠️⚠️  █
█                                                                 █
███████████████████████████████████████████████████████████████████
```

## 🚨 MANDATORY FIRST ACTION: Install Roslyn Language Server 🚨

**THE VERY FIRST COMMAND YOU RUN MUST BE:**

```bash
dotnet tool install --global roslyn-language-server --prerelease
```

**THEN VERIFY IT:**

```bash
which roslyn-language-server && roslyn-language-server --version
```

Expected output: Version 5.5.0 or higher

### Why This is Critical

- ✅ Integration tests will FAIL without this
- ✅ Integration tests will be SKIPPED without this  
- ✅ You cannot verify your work without this
- ✅ The entire purpose of this project depends on this

### Automated Check

The project now includes `scripts/check-lsp.sh` which automatically checks and installs if needed.
This runs automatically before `npm test`.

**BUT YOU SHOULD STILL INSTALL IT MANUALLY FIRST TO VERIFY IT WORKS.**

## Project Setup Requirements

### Working with the .NET Test Project

The test project is located in `test-project/TestProject/`.

**IMPORTANT RULES:**

1. **NEVER manually create or edit .sln or .slnx files**
   - Always use: `dotnet new sln --name <name>`
   - Always use: `dotnet sln add <project.csproj>`
   - See the warning comment in `test-project/TestProject.slnx`

2. **NEVER manually create .csproj files**
   - Always use: `dotnet new console` (or appropriate template)
   - Always use: `dotnet add package <package>` for NuGet packages

3. **Project structure MUST include both .csproj AND solution file**
   - Roslyn LSP requires proper solution context
   - The solution file helps LSP find project references and dependencies

### Testing Requirements

Before running tests:

```bash
# Restore .NET dependencies
cd test-project/TestProject
dotnet restore
cd ../..

# Install npm dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Common Issues

### "LSP not found" Errors
- Install roslyn-language-server (see STEP 1 above)
- Verify it's in your PATH

### "Canonical.cs" Project Issues
- This happens when Roslyn can't find the solution
- Ensure .slnx file exists in workspace root
- Ensure project is added to solution via `dotnet sln add`

### Test Timeouts
- LSP can take 30-60 seconds on first request (NuGet restore + build)
- Don't reduce timeouts below 60 seconds for integration tests
- Wait for actual LSP callbacks, don't guess at timing

## Code Quality Standards

### MANDATORY REQUIREMENTS

1. **ALL TESTS MUST PASS** 
   - ❌ NEVER commit code with failing tests
   - ❌ NEVER dismiss test failures as "unrelated" or "not your problem"
   - ✅ ALWAYS investigate and fix ALL failing tests before committing
   - ✅ If a test is truly unrelated, document WHY and get approval

2. **FOLLOW PROFESSIONAL STANDARDS**
   - ✅ ALWAYS sanity check decisions against industry best practices
   - ✅ Follow standard conventions (e.g., Node.js packages output to `dist/`, not `dist/src/`)
   - ✅ Use proper directory structures that match ecosystem expectations
   - ✅ Don't invent non-standard patterns without strong justification

3. **TECHNICAL EXCELLENCE**
   - **No arbitrary timeouts** - Use LSP callbacks and notifications
   - **No manual file generation** - Use CLI tools
   - **Guard clauses over nesting** - Reduce complexity
   - **Proper error handling** - Don't silently fail
   - **Clean up temporary files** - Remove debugging scripts
   - **Proper output structure** - Follow Node.js package conventions

## LSP Communication

The Roslyn Language Server communicates via JSON-RPC over stdio:

- **Initialize sequence**: initialize → initialized → textDocument/didOpen
- **Wait for diagnostics**: After didOpen, wait for textDocument/publishDiagnostics
- **Project loading**: Watch for window/logMessage with "Completed (re)load"
- **Metadata URIs**: Decompiled sources use file:///tmp/MetadataAsSource/...

## File Structure

```
.
├── src/
│   ├── index.ts          # MCP server main entry
│   ├── lsp-client.ts     # Roslyn LSP client
│   └── roslyn-check.ts   # Installation checker
├── utilities/
│   └── diagnose-lsp.ts   # LSP diagnostic tool (verbose debugging)
├── tests/
│   ├── e2e-symbol-retrieval.test.ts  # Main E2E tests
│   └── *.test.ts         # Unit tests
├── test-project/
│   └── TestProject/
│       ├── TestProject.csproj
│       ├── Program.cs
│       └── ...
│   └── TestProject.slnx  # Solution file (DO NOT EDIT MANUALLY)
└── README.md             # User documentation (for humans)
```

## Utilities Directory

The `utilities/` directory contains diagnostic and testing tools that help debug and verify LSP functionality:

- **diagnose-lsp.ts**: Verbose LSP diagnostic tool for debugging project loading and symbol resolution
- All future "test stuff out" scripts should go in the `utilities/` subdirectory
- These are NOT production code - they are development/debugging tools
- Run utilities from compiled output: `node dist/utilities/<script-name>.js`

## What NOT to Do

❌ Don't create manual test scripts outside the `utilities/` directory
❌ Don't manually create .sln or .slnx files
❌ Don't manually create .csproj files
❌ Don't use arbitrary timeouts instead of callbacks
❌ Don't ignore LSP installation requirements
❌ Don't commit debugging/temporary files to the root directory

## What TO Do

✅ Use dotnet CLI for all .NET project operations
✅ Use LSP callbacks for synchronization
✅ Follow existing test patterns
✅ Place diagnostic/testing scripts in `utilities/` directory
✅ Clean up after debugging
✅ Document significant changes
