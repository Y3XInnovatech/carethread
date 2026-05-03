#!/usr/bin/env bash
set -e

echo ""
echo "  ======================================"
echo "   CareThread - Clinical Digital Twin"
echo "  ======================================"
echo ""

if ! command -v node &>/dev/null; then
    echo "  [ERROR] Node.js is not installed or not in PATH."
    echo "  Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
echo "  Node.js version: $(node -v)"

if [ "$NODE_VERSION" -lt 18 ]; then
    echo "  [WARNING] Node.js 18+ is recommended. You have v${NODE_VERSION}."
fi

echo ""
echo "  [1/2] Installing dependencies..."
npm install

echo ""
echo "  [2/2] Starting CareThread..."
echo ""
echo "  Server:  http://localhost:3001/api/v1"
echo "  Web UI:  http://localhost:5173"
echo "  WS:      ws://localhost:3001/ws"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

npm run dev
