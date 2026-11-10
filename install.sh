#!/usr/bin/env bash
# OhMyDots account service installer. Downloads only official runtime packages.
set -euo pipefail
umask 077
dest="${HOME}/.ohmydots"
source_dir=''
dry_run=false
setup_args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir|--source-dir)
      [ "$#" -ge 2 ] || { echo "Missing $1 value" >&2; exit 1; }
      if [ "$1" = --dir ]; then dest="$2"; else source_dir="$2"; fi
      shift 2 ;;
    --dry-run) dry_run=true; setup_args+=(--dry-run); shift ;;
    --mode|--input|--public-url|--port|--engine|--legacy-dir)
      [ "$#" -ge 2 ] || { echo "Missing $1 value" >&2; exit 1; }
      setup_args+=("$1" "$2"); shift 2 ;;
    --non-interactive|--no-start) setup_args+=("$1"); shift ;;
    --help|-h)
      cat <<'HELP'
OhMyDots account service installer
  curl -fsSL https://raw.githubusercontent.com/omdots/oh-my-dots/refs/heads/main/install.sh | bash

Options:
  --dir /absolute/path        Installation folder (default ~/.ohmydots)
  --mode foreground|systemd|docker
  --public-url URL            Public HTTPS URL, or loopback HTTP URL
  --port PORT                 Local published port (default 3420)
  --engine opencode|grok      OpenCode default; Grok requires separately installed source
  --input /private/setup.json Noninteractive wizard answers (keep mode 0600)
  --legacy-dir /path          Attach existing dots.sqlite to first admin only
  --non-interactive           Use input/defaults; create admin later at /setup
  --no-start                  Prepare files without starting any services
  --dry-run                   Show plan without writing/downloading anything
  --source-dir /export        Install a local source export into a new folder
HELP
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
case "$dest" in /*) ;; *) echo '--dir must be absolute.' >&2; exit 1 ;; esac
if "$dry_run"; then
  printf 'Install into %s\nPrepare Node 24.22.1 / OpenCode 2.0.32 only when compatible binaries are absent.\nInstall locked dependencies and build UI.\nRun account/provider/server setup; existing data is preserved.\n' "$dest"
  exit 0
fi
for binary in curl tar; do command -v "$binary" >/dev/null || { echo "Required: $binary" >&2; exit 1; }; done
repo='https://github.com/omdots/oh-my-dots.git'
if [ -n "$source_dir" ]; then
  [ -f "$source_dir/package.json" ] && [ -f "$source_dir/tools/service-setup.mjs" ] || { echo 'Invalid source export.' >&2; exit 1; }
  source_dir=$(cd "$source_dir" && pwd -P)
  dest_parent=$(cd "$(dirname "$dest")" && pwd -P) || { echo 'For --source-dir, the destination parent must exist.' >&2; exit 1; }
  dest_name=$(basename "$dest")
  case "$dest_name" in .|..) echo 'Choose a new destination folder name.' >&2; exit 1 ;; esac
  dest="$dest_parent/$dest_name"
  case "$dest/" in "$source_dir/"*) echo 'The destination cannot be inside the source directory.' >&2; exit 1 ;; esac
  [ ! -e "$dest" ] || { echo '--source-dir needs a new destination.' >&2; exit 1; }
  mkdir -p "$dest"
  if command -v git >/dev/null && git -C "$source_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$source_dir" ls-files -z --cached --others --exclude-standard -- . ':!experiments/**' ':!docs/research/**' | tar -C "$source_dir" --null -T - -cf - | tar -C "$dest" -xf -
  else
    (cd "$source_dir" && tar --exclude=.git --exclude=node_modules --exclude=.data --exclude=.local --exclude=dist --exclude=.env --exclude='.env.*' --exclude=experiments --exclude=docs/research -cf - .) | (cd "$dest" && tar -xf -)
  fi
elif [ -e "$dest" ]; then
  command -v git >/dev/null && [ -d "$dest/.git" ] || { echo 'Destination already exists. Use a fresh --dir or update that installation explicitly.' >&2; exit 1; }
  case "$(git -C "$dest" remote get-url origin)" in
    "$repo"|https://github.com/hyuntroll/oh-my-dots.git) ;;
    *) echo 'Destination has a different remote.' >&2; exit 1 ;;
  esac
  [ "$(git -C "$dest" branch --show-current)" = main ] || { echo 'Destination must be on main.' >&2; exit 1; }
  [ -z "$(git -C "$dest" status --porcelain)" ] || { echo 'Save local changes before updating; nothing was reset.' >&2; exit 1; }
  git -C "$dest" pull --ff-only </dev/null
else
  task_tmp=$(mktemp -d)
  trap 'rm -rf "$task_tmp"' EXIT
  curl -fL --retry 3 -o "$task_tmp/source.tar.gz" https://github.com/omdots/oh-my-dots/archive/refs/heads/main.tar.gz
  mkdir -p "$dest"
  tar -xzf "$task_tmp/source.tar.gz" --strip-components=1 -C "$dest"
  rm -rf "$task_tmp"
  trap - EXIT
fi
[ -f "$dest/tools/service-setup.mjs" ] || { echo 'This revision does not contain account service setup.' >&2; exit 1; }
runtime_dir="$dest/.data/setup-runtime"
mkdir -p "$runtime_dir"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>24||(a===24&&b>=15)?0:1)' >/dev/null 2>&1 || ! command -v npm >/dev/null; then
  case "$(uname -s)" in Darwin) runtime_os=darwin ;; Linux) runtime_os=linux ;; *) echo 'Use Linux or macOS, or the Docker deployment files.' >&2; exit 1 ;; esac
  if [ "$runtime_os" = linux ] && command -v ldd >/dev/null && ldd --version 2>&1 | grep -qi musl; then
    echo 'On Alpine/musl, install Node.js 24.15+ with your package manager before running this installer.' >&2
    exit 1
  fi
  case "$(uname -m)" in arm64|aarch64) runtime_arch=arm64 ;; x86_64|amd64) runtime_arch=x64 ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;; esac
  case "$runtime_os-$runtime_arch" in
    darwin-arm64) runtime_sha=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7 ;;
    darwin-x64) runtime_sha=d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035 ;;
    linux-arm64) runtime_sha=33c37be234ba8bee041961047b19160f4d7d0f164e8e246f78bdd10feff148b3 ;;
    linux-x64) runtime_sha=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c ;;
  esac
  archive="node-v24.22.1-$runtime_os-$runtime_arch.tar.gz"
  curl -fL --retry 3 -o "$runtime_dir/$archive" "https://nodejs.org/dist/v24.22.1/$archive"
  if command -v sha256sum >/dev/null; then actual_sha=$(sha256sum "$runtime_dir/$archive" | awk '{print $1}'); elif command -v shasum >/dev/null; then actual_sha=$(shasum -a 256 "$runtime_dir/$archive" | awk '{print $1}'); else echo 'Required for Node download verification: sha256sum or shasum.' >&2; exit 1; fi
  [ "$actual_sha" = "$runtime_sha" ] || { echo 'Node.js archive checksum mismatch.' >&2; exit 1; }
  tar -xzf "$runtime_dir/$archive" -C "$runtime_dir"
  export PATH="$runtime_dir/node-v24.22.1-$runtime_os-$runtime_arch/bin:$PATH"
fi
opencode_binary="${OPENCODE_BIN:-}"
if [ -z "$opencode_binary" ]; then opencode_binary=$(command -v opencode || true); fi
if [ -z "$opencode_binary" ] && [ -x "$HOME/.opencode/bin/opencode" ]; then opencode_binary="$HOME/.opencode/bin/opencode"; fi
if [ -z "$opencode_binary" ] || ! "$opencode_binary" --version 2>/dev/null | grep -Eq '(^|[[:space:]])v?2\.'; then
  npm install --prefix "$runtime_dir/opencode" --no-audit --no-fund --save-exact --registry=https://registry.npmjs.org @opencode/cli@2.0.32 </dev/null
  opencode_binary="$runtime_dir/opencode/node_modules/.bin/opencode"
fi
"$opencode_binary" --version | grep -Eq '(^|[[:space:]])v?2\.' || { echo 'OpenCode 2 is required.' >&2; exit 1; }
export OPENCODE_BIN="$opencode_binary"
cd "$dest"
npm ci </dev/null
npm run original:verify </dev/null
npm run assets:verify </dev/null
npm run build </dev/null
exec node tools/service-setup.mjs "${setup_args[@]}"
