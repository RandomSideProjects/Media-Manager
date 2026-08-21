#!/usr/bin/env bash

set -Eeuo pipefail

# The td CLI is installed separately from this repository. Keep the
# maintenance-specific compatibility patch idempotent and re-apply it after a
# td update or a service reinstall.
bundle_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
td_root="${TOODRIVE_SOURCE_ROOT:-${HOME:?HOME must be set}/.local/share/toodrive-cli}"
source_dir="${td_root}/src"

if [[ ! -d "$source_dir" ]]; then
  printf 'Toodrive source directory not found; leaving td unchanged: %s\n' "$source_dir" >&2
  exit 0
fi

apply_patch_once() {
  local target="$1"
  local patch_file="$2"
  local marker="$3"
  local target_path="${source_dir}/${target}"

  [[ -f "$target_path" ]] || {
    printf 'Toodrive compatibility target not found: %s\n' "$target_path" >&2
    return 1
  }
  if grep -Fq "$marker" "$target_path"; then
    return 0
  fi
  cp -n "$target_path" "${target_path}.before-media-manager-compatibility" 2>/dev/null || true
  patch --batch --forward -p1 -d "$td_root" < "${bundle_root}/${patch_file}"
}

apply_patch_once "cmd-torrent.ts" "td-cmd-torrent.patch" "MP4_TEXT_SUBTITLE_CODECS"
apply_patch_once "schema.ts" "td-schema.patch" "audioStreamCount: Type.Optional"
apply_patch_once "upload.ts" "td-upload.patch" "const DEFAULT_CONCURRENCY = 1"

printf 'Toodrive compatibility patches are current: %s\n' "$td_root"
