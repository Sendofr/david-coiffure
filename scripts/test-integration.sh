#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Creates and removes only uniquely named local Docker containers; no project credentials.
node --test --test-concurrency=1 tests/integration/*.test.mjs
