#!/bin/bash

# Change to project root directory
cd "$(dirname "$0")/.."

echo "🚀 Starting PigeonFS Electron App..."
echo ""
echo "📦 Building web app..."
npm run build

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build complete!"
    echo "🖥️  Launching Electron..."
    echo ""
    electron .
else
    echo ""
    echo "❌ Build failed. Please fix the errors and try again."
    exit 1
fi
