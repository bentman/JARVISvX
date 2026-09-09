#!/usr/bin/env bash
set -e

TARGET_DIR="${1:-$HOME/.local/bin}"
JARVIS_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_ENTRY="$JARVIS_REPO_ROOT/bin/jarvis.mjs"

if [[ ! -f "$CLI_ENTRY" ]]; then
  echo "JARVIS CLI entrypoint not found at '$CLI_ENTRY'." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

SHIM_PATH="$TARGET_DIR/jarvis"
cat > "$SHIM_PATH" << EOF
#!/usr/bin/env bash
exec node "$CLI_ENTRY" "\$@"
EOF

chmod +x "$SHIM_PATH"

echo "Created standalone JARVIS CLI shim at: $SHIM_PATH"

if [[ ":$PATH:" != *":$TARGET_DIR:"* ]]; then
  echo "NOTE: '$TARGET_DIR' is not in your current PATH."
  echo "Add it to your shell configuration (e.g. ~/.bashrc or ~/.zshrc):"
  echo "  export PATH=\"\$PATH:$TARGET_DIR\""
else
  echo "'$TARGET_DIR' is on your PATH. You can run 'jarvis' from any terminal."
fi
