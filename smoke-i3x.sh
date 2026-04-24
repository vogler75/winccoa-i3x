#!/usr/bin/env bash
# smoke-i3x.sh — end-to-end smoke test for the i3X v1 server.
#
# Usage:   BASE=http://debian:8080/i3x/v1 AUTH=admin:password ./smoke-i3x.sh
# Prereqs: curl, jq. Requires a running server with WinCC OA data.
#
# Exits non-zero on the first failure. Each section prints the endpoint, the
# HTTP status, and asserts the v1 envelope (`success: true`) where applicable.

set -euo pipefail

BASE="${BASE:-http://localhost:8080/i3x/v1}"
AUTH="${AUTH:-admin:password}"
JQ="${JQ:-jq}"

pass=0
fail=0

hit() {
  # hit <label> <curl-args...>
  local label="$1"; shift
  echo "─── $label"
  local body status
  body=$(curl -sS -w $'\n__STATUS__%{http_code}' "$@")
  status="${body##*__STATUS__}"
  body="${body%$'\n'__STATUS__*}"
  echo "  status: $status"
  echo "  body:   $(echo "$body" | head -c 400)"
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "  ✓ HTTP ok"; pass=$((pass+1))
  else
    echo "  ✗ HTTP $status"; fail=$((fail+1))
  fi
  echo "$body"
}

expect_success() {
  # expect_success <body>
  local ok
  ok=$(echo "$1" | "$JQ" -r '.success // false')
  if [ "$ok" = "true" ]; then
    echo "  ✓ success: true"; pass=$((pass+1))
  else
    echo "  ✗ success != true"; fail=$((fail+1))
  fi
}

# ── 1. /info (unauthenticated) ────────────────────────────────────────────
body=$(hit "GET /info (no auth)" "$BASE/info")
expect_success "$body"
spec=$(echo "$body" | "$JQ" -r '.result.specVersion')
echo "  specVersion: $spec"

# ── 2. /namespaces ────────────────────────────────────────────────────────
body=$(hit "GET /namespaces" -u "$AUTH" "$BASE/namespaces")
expect_success "$body"

# ── 3. /objecttypes + /objecttypes/query ──────────────────────────────────
body=$(hit "GET /objecttypes" -u "$AUTH" "$BASE/objecttypes")
expect_success "$body"
first_type=$(echo "$body" | "$JQ" -r '.result[0].elementId // empty')
if [ -n "$first_type" ]; then
  body=$(hit "POST /objecttypes/query" -u "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"elementIds\":[\"$first_type\",\"__missing__\"]}" "$BASE/objecttypes/query")
  expect_success "$body"
fi

# ── 4. /relationshiptypes + /relationshiptypes/query ──────────────────────
body=$(hit "GET /relationshiptypes" -u "$AUTH" "$BASE/relationshiptypes")
expect_success "$body"
body=$(hit "POST /relationshiptypes/query" -u "$AUTH" -H 'Content-Type: application/json' \
  -d '{"elementIds":["HasParent","__missing__"]}' "$BASE/relationshiptypes/query")
expect_success "$body"

# ── 5. /objects ───────────────────────────────────────────────────────────
body=$(hit "GET /objects" -u "$AUTH" "$BASE/objects")
expect_success "$body"
first_obj=$(echo "$body" | "$JQ" -r '.result[0].elementId // empty')
if [ -n "$first_obj" ]; then
  body=$(hit "POST /objects/list" -u "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"elementIds\":[\"$first_obj\"],\"includeMetadata\":true}" "$BASE/objects/list")
  expect_success "$body"
  body=$(hit "POST /objects/related" -u "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"elementIds\":[\"$first_obj\"]}" "$BASE/objects/related")
  expect_success "$body"
  body=$(hit "POST /objects/value" -u "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"elementIds\":[\"$first_obj\"],\"maxDepth\":2}" "$BASE/objects/value")
  expect_success "$body"
fi

# ── 6. /subscriptions flow ────────────────────────────────────────────────
body=$(hit "POST /subscriptions (create)" -u "$AUTH" -H 'Content-Type: application/json' \
  -d '{"displayName":"smoke"}' "$BASE/subscriptions")
expect_success "$body"
SUB=$(echo "$body" | "$JQ" -r '.result.subscriptionId')
echo "  subscriptionId: $SUB"

if [ -n "$first_obj" ] && [ -n "$SUB" ]; then
  body=$(hit "POST /subscriptions/register" -u "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"subscriptionId\":\"$SUB\",\"elementIds\":[\"$first_obj\"],\"maxDepth\":2}" \
    "$BASE/subscriptions/register")
  expect_success "$body"
fi

body=$(hit "POST /subscriptions/list" -u "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"subscriptionIds\":[\"$SUB\",\"no-such-sub\"]}" "$BASE/subscriptions/list")
expect_success "$body"

body=$(hit "POST /subscriptions/sync" -u "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"subscriptionId\":\"$SUB\",\"lastSequenceNumber\":0}" "$BASE/subscriptions/sync")
expect_success "$body"

body=$(hit "POST /subscriptions/delete" -u "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"subscriptionIds\":[\"$SUB\"]}" "$BASE/subscriptions/delete")
expect_success "$body"

echo
echo "===================================="
echo "Smoke test: $pass passed, $fail failed"
echo "===================================="
[ "$fail" -eq 0 ]
