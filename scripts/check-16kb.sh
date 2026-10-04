#!/usr/bin/env bash
# Checks that every 64-bit native library in an APK or AAB is aligned for
# 16 KB memory pages (Google Play requirement). Usage:
#   scripts/check-16kb.sh path/to/app.apk|app.aab
# Needs ANDROID_HOME (or the default Windows SDK path) with an NDK installed.
set -euo pipefail

archive="${1:?usage: check-16kb.sh <apk|aab>}"
sdk="${ANDROID_HOME:-${LOCALAPPDATA:-}/Android/Sdk}"
readelf="$(ls -d "$sdk"/ndk/*/toolchains/llvm/prebuilt/*/bin/llvm-readelf* 2>/dev/null | sort -V | tail -1)"
if [[ -z "$readelf" ]]; then
  echo "llvm-readelf not found under $sdk/ndk" >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# Extract by explicit name: unzip wildcards are unreliable in Git Bash on Windows.
{ unzip -Z1 "$archive" | grep '\.so$' || true; } | tr '\n' '\0' |
  xargs -0 -r unzip -q -o "$archive" -d "$work"

failed=0
checked=0
while IFS= read -r -d '' lib; do
  case "$lib" in
    */arm64-v8a/*|*/x86_64/*) ;;
    *) continue ;; # 32-bit ABIs are not subject to the 16 KB requirement
  esac
  checked=$((checked + 1))
  # Every LOAD segment's alignment (last column, hex) must be >= 0x4000.
  # Converted with bash arithmetic rather than gawk's strtonum, for mawk/CI.
  bad=""
  while read -r align; do
    if (( align < 16384 )); then bad+="$align "; fi
  done < <("$readelf" -lW "$lib" | awk '$1 == "LOAD" { print $NF }')
  name="${lib#"$work"/}"
  if [[ -n "$bad" ]]; then
    echo "FAIL  $name  (LOAD align: $bad)"
    failed=$((failed + 1))
  else
    echo "OK    $name"
  fi
done < <(find "$work" -name '*.so' -print0)

echo "checked=$checked failed=$failed"
if [[ "$checked" -eq 0 ]]; then
  echo "No 64-bit native libraries found in $archive" >&2
  exit 2
fi
[[ "$failed" -eq 0 ]]
