#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf 'Source this helper instead of executing it: source scripts/use-jarvis.sh\n' >&2
  exit 2
fi

_jarvis_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

jarvis() {
  if ! command -v node >/dev/null 2>&1; then
    printf "node was not found. Install Node.js, then try again.\n" >&2
    return 127
  fi
  local cli_path="$_jarvis_repo_root/bin/jarvis.mjs"
  if [[ ! -f "$cli_path" ]]; then
    printf "JARVIS CLI entrypoint not found at '%s'.\n" "$cli_path" >&2
    return 127
  fi
  node "$cli_path" "$@"
}

printf 'JARVIS CLI loaded for this shell session: jarvis\n'
