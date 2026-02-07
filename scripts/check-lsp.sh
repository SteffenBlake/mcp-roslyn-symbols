#!/bin/bash
# This script checks if roslyn-language-server is installed
# and installs it if missing

set -e

echo "🔍 Checking for roslyn-language-server..."

if command -v roslyn-language-server &> /dev/null; then
    echo "✅ roslyn-language-server is installed"
    roslyn-language-server --version
    exit 0
fi

echo "❌ roslyn-language-server is NOT installed"
echo ""
echo "Installing roslyn-language-server..."
echo "This is REQUIRED for integration tests to run."
echo ""

dotnet tool install --global roslyn-language-server --prerelease

echo ""
echo "✅ roslyn-language-server installed successfully"
roslyn-language-server --version
