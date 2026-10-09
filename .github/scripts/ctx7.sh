#!/usr/bin/env bash
# ctx7.sh — Query Context7 library documentation from the CLI.
# Wraps the Context7 REST API (the same endpoints the MCP server uses).
#
# Usage:
#   ctx7.sh search <library_name>              Search for libraries
#   ctx7.sh query  <library_id> <topic>        Query docs for a known library ID
#   ctx7.sh docs   <library_name> <topic>      Search + query in one shot (auto-selects top result)

set -euo pipefail

CONTEXT7_BASE_URL="https://context7.com/api"
KEY_FILE=".context7.key"

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not installed." >&2
  echo "Install it with: brew install jq" >&2
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "Error: curl is required but not installed." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# API key (optional — reads from .context7.key file or CONTEXT7_API_KEY env var)
# ---------------------------------------------------------------------------

resolve_api_key() {
  # Env var takes precedence
  if [[ -n "${CONTEXT7_API_KEY:-}" ]]; then
    echo "$CONTEXT7_API_KEY"
    return
  fi

  # Walk up from cwd looking for .context7.key
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/$KEY_FILE" ]]; then
      local key
      key="$(tr -d '[:space:]' < "$dir/$KEY_FILE")"
      if [[ -n "$key" ]]; then
        echo "$key"
        return
      fi
    fi
    dir="$(dirname "$dir")"
  done
}

build_auth_header() {
  local key
  key="$(resolve_api_key)"
  if [[ -n "${key:-}" ]]; then
    echo "Authorization: Bearer $key"
  fi
}

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

api_get() {
  local url="$1"
  local auth_header
  auth_header="$(build_auth_header)"

  local -a curl_args=(-sS)
  if [[ -n "$auth_header" ]]; then
    curl_args+=(-H "$auth_header")
  fi

  local tmp
  tmp="$(mktemp)" || {
    echo "Error: Failed to create temporary file." >&2
    exit 1
  }

  local http_code
  http_code="$(curl "${curl_args[@]}" -o "$tmp" -w '%{http_code}' "$url")" || {
    rm -f "$tmp"
    echo "Error: Failed to reach Context7 API." >&2
    exit 1
  }

  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    cat "$tmp"
  else
    echo "Context7 API error (HTTP $http_code):" >&2
    cat "$tmp" >&2
    rm -f "$tmp"
    exit 1
  fi

  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

# URL-encode a string using jq (no python3 needed)
urlencode() { printf '%s' "$1" | jq -sRr @uri; }

cmd_search() {
  local library_name="${1:?Usage: ctx7.sh search <library_name>}"
  local encoded
  encoded="$(urlencode "$library_name")"

  local url="${CONTEXT7_BASE_URL}/v2/libs/search?query=${encoded}&libraryName=${encoded}"
  local response
  response="$(api_get "$url")"

  local count
  count="$(echo "$response" | jq '.results | length')"

  if [[ "$count" -eq 0 ]]; then
    echo "No libraries found for: $library_name" >&2
    exit 1
  fi

  echo "$response" | jq -r '.results[] | "ID: \(.id)\nTitle: \(.title)\nDescription: \(.description // "")\nSnippets: \(.totalSnippets // "n/a")\n"'
}

cmd_query() {
  local library_id="${1:?Usage: ctx7.sh query <library_id> <topic>}"
  local query="${2:?Usage: ctx7.sh query <library_id> <topic>}"

  local encoded_query encoded_id
  encoded_query="$(urlencode "$query")"
  encoded_id="$(urlencode "$library_id")"

  local url="${CONTEXT7_BASE_URL}/v2/context?query=${encoded_query}&libraryId=${encoded_id}&type=txt"
  api_get "$url"
}

cmd_docs() {
  local library_name="${1:?Usage: ctx7.sh docs <library_name> <topic>}"
  local query="${2:?Usage: ctx7.sh docs <library_name> <topic>}"

  # Step 1: Search for the library
  local encoded
  encoded="$(urlencode "$library_name")"

  local search_url="${CONTEXT7_BASE_URL}/v2/libs/search?query=${encoded}&libraryName=${encoded}"
  local search_response
  search_response="$(api_get "$search_url")"

  local count
  count="$(echo "$search_response" | jq '.results | length')"

  if [[ "$count" -eq 0 ]]; then
    echo "No libraries found for: $library_name" >&2
    exit 1
  fi

  # Auto-select top result
  local library_id
  library_id="$(echo "$search_response" | jq -r '.results[0].id')"
  local library_title
  library_title="$(echo "$search_response" | jq -r '.results[0].title')"

  echo "# Using: $library_title ($library_id)" >&2
  echo "" >&2

  # Step 2: Query docs
  cmd_query "$library_id" "$query"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

usage() {
  cat >&2 <<'EOF'
ctx7.sh — Query Context7 library documentation from the CLI.

Usage:
  ctx7.sh search <library_name>              Search for libraries
  ctx7.sh query  <library_id> <topic>        Query docs for a known library ID
  ctx7.sh docs   <library_name> <topic>      Search + query in one shot

Examples:
  ctx7.sh search react
  ctx7.sh query /vercel/next.js "app router setup"
  ctx7.sh docs langchain "how to create a chain"
EOF
  exit 1
}

case "${1:-}" in
  search) shift; cmd_search "$@" ;;
  query)  shift; cmd_query "$@"  ;;
  docs)   shift; cmd_docs "$@"   ;;
  *)      usage ;;
esac
