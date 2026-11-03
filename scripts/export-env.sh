#!/usr/bin/env bash
# Source this script to route your terminal session through the Universal Developer Intelligence proxy:
#   source scripts/export-env.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="$DIR/.data/token"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "[!] Error: No token file found at $TOKEN_FILE. Start the daemon first via: pnpm dev:core"
  return 1 2>/dev/null || exit 1
fi

TOKEN="$(cat "$TOKEN_FILE" | tr -d '[:space:]')"
DAEMON_URL="${UDI_DAEMON_URL:-http://127.0.0.1:4317}"

export OPENAI_BASE_URL="$DAEMON_URL/v1"
export OPENAI_API_KEY="$TOKEN"
export ANTHROPIC_BASE_URL="$DAEMON_URL/v1"
export ANTHROPIC_API_KEY="$TOKEN"
export UDI_TOKEN="$TOKEN"
export UDI_DAEMON_URL="$DAEMON_URL"

echo "✓ Routed environment to Universal Developer Intelligence:"
echo "  OPENAI_BASE_URL    = $OPENAI_BASE_URL"
echo "  ANTHROPIC_BASE_URL = $ANTHROPIC_BASE_URL"
echo "  All OpenAI and Anthropic compatible agent CLIs will now hit the proxy."
