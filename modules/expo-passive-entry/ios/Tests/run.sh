#!/usr/bin/env bash
# Build and run the Foundation-only Swift tests for the passive-entry module on the
# Mac (no simulator). Add a test by listing its source file and the files it needs.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -parse-as-library -o "$out/peer-removed-backoff" \
  "$here/../PeerRemovedBackoff.swift" "$here/PeerRemovedBackoffTests.swift"
"$out/peer-removed-backoff"
