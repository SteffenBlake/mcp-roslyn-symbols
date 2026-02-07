# MCP Roslyn Symbols

An MCP (Model Context Protocol) server that provides symbol information from C# code using the Roslyn Language Server.

## Prerequisites

Before using this MCP server, you must have:

1. **Roslyn Language Server** (required):
   ```bash
   dotnet tool install --global roslyn-language-server --prerelease
   ```

2. **Node.js** v18 or higher

3. **.NET SDK** 8.0 or higher (for the Roslyn Language Server and test project)

## Installation

```bash
npm install
npm run build
```

## Usage

This MCP server exposes a single powerful tool: `get_symbols_for`

### Tool: get_symbols_for

Gets symbol information for a type at a specific cursor position in a C# file. This retrieves all public methods, properties, fields, events, etc. from the type, even if it's from a NuGet package (through decompilation).

#### Parameters

- `filePath` (required): Absolute path to the C# file
- `line` (required): Line number (0-indexed)
- `character` (required): Character position on the line (0-indexed)
- `symbolType` (optional): Filter symbols by type. One of: `Property`, `Field`, `Event`, `Method`, `Class`, `Interface`, `Enum`
- `signaturesOnly` (optional): Boolean. If true, returns only signatures without additional details

#### Example Usage

Given a C# file with:

```csharp
var foo = 5;
Console.WriteLine(foo); // Cursor on 'foo'
```

The tool would return all methods available on the `int` type (like `ToString`, `GetHashCode`, etc.).

Or with:

```csharp
JsonSerializer.DeserializeAsync(...); // Cursor on 'JsonSerializer'
```

The tool would return all public methods, properties, and fields of the `JsonSerializer` class.

## Running the Server

To start the MCP server:

```bash
node dist/index.js
```

The server uses stdio for communication and follows the Model Context Protocol specification.

## Testing

The project includes a comprehensive test suite:

```bash
npm test
```

Test cases include:
1. Getting symbols for core .NET types (e.g., `int`)
2. Getting symbols for framework types (e.g., `JsonSerializerOptions`)
3. Getting symbols for 3rd party library types (e.g., `JsonConvert` from Newtonsoft.Json)

## Development

### Project Structure

```
.
├── src/
│   ├── index.ts          # Main MCP server
│   ├── lsp-client.ts     # Roslyn LSP client implementation
│   └── roslyn-check.ts   # Checks for Roslyn installation
├── tests/
│   └── *.test.ts         # Test suite
├── test-project/
│   ├── TestProject.slnx  # Solution file (workspace root for LSP)
│   └── TestProject/      # Test C# project
│       ├── TestProject.csproj
│       └── Program.cs
└── dist/                 # Compiled JavaScript output
```

### Building

```bash
npm run build
```

### Running Tests

```bash
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
```

## How It Works

1. On startup, the server checks if `roslyn-language-server` is available
2. When a tool call is made, the server:
   - Finds the workspace root (directory containing .sln or .slnx)
   - Starts the Roslyn Language Server (if not already started)
   - Opens the requested document
   - Gets the type definition at the specified cursor position
   - Retrieves all symbols from the type definition (including decompiled sources)
   - Filters and formats the symbols based on the provided options
   - Returns the symbol information

## For Contributors

If you're an AI agent or developer working on this project, please see [AGENTS.md](AGENTS.md) for detailed development guidelines and requirements.

## License

MIT

