#!/bin/zsh
cd -- "${0:A:h}" || exit 1
AI_SETUP_NODE="$(command -v node)"
if [[ -z "$AI_SETUP_NODE" ]]; then
  AI_SETUP_NODE="/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
"$AI_SETUP_NODE" scripts/setup-ai.mjs
read "?按回车关闭窗口…"
