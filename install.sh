#!/bin/bash

# Installation script for MCP Roslyn Symbols
# This script MUST be run before testing or running the server

set -e

echo "=================================================="
echo "MCP Roslyn Symbols - Installation Script"
echo "=================================================="
echo ""

# Step 1: Install Roslyn Language Server
echo "Step 1: Installing Roslyn Language Server..."
if command -v roslyn-language-server &> /dev/null; then
    echo "✅ roslyn-language-server is already installed"
    roslyn-language-server --version
else
    echo "Installing roslyn-language-server..."
    dotnet tool install --global roslyn-language-server --prerelease
    echo "✅ roslyn-language-server installed"
fi
echo ""

# Step 2: Install npm dependencies
echo "Step 2: Installing npm dependencies..."
npm install
echo "✅ npm dependencies installed"
echo ""

# Step 3: Restore and build test project
echo "Step 3: Preparing test project..."
cd test-project
dotnet restore
dotnet build
cd ..
echo "✅ Test project ready"
echo ""

# Step 4: Build TypeScript
echo "Step 4: Building TypeScript..."
npm run build
echo "✅ TypeScript built"
echo ""

echo "=================================================="
echo "✅ Installation complete!"
echo "=================================================="
echo ""
echo "You can now run:"
echo "  npm test                 # Run all tests"
echo "  node dist/index.js       # Start the MCP server"
echo ""
