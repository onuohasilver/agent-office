#!/bin/sh
# Installs the package the way a user would — from the packed tarball, into a
# throwaway global prefix — and checks the `agent-office` command works:
# version, doctor, and starting an office that serves and lists projects.
set -eu
APP=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'kill "$PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
PID=

cd "$APP" && npm pack --silent --pack-destination "$TMP" >/dev/null
npm install --silent -g --prefix "$TMP/prefix" "$TMP"/*.tgz
PATH="$TMP/prefix/bin:$PATH"

# A stand-in claude that answers --version and nothing else.
printf '#!/bin/sh\necho "0.0.0 (stand-in)"\n' > "$TMP/claude" && chmod +x "$TMP/claude"
export CLAUDE_BIN="$TMP/claude" STANDUP_AT=off BANTER=off
mkdir -p "$TMP/projects/storefront"

echo "version: $(agent-office --version)"
agent-office doctor --data "$TMP/data" "$TMP/projects"

PORT=$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
agent-office "$TMP/projects" --no-open --port "$PORT" --data "$TMP/data" > "$TMP/run.log" 2>&1 &
PID=$!
i=0
until curl -fs "http://127.0.0.1:$PORT/api/repos" > "$TMP/repos.json" 2>/dev/null; do
  i=$((i + 1)); [ $i -gt 60 ] && { cat "$TMP/run.log"; echo "never came up"; exit 1; }
  sleep 0.5
done
grep -q storefront "$TMP/repos.json" || { echo "project not listed: $(cat "$TMP/repos.json")"; exit 1; }
curl -fs "http://127.0.0.1:$PORT/" | grep -q '<title>Agent Office</title>' || { echo "web app not served"; exit 1; }
# State belongs in --data; an upgrade replaces the package folder.
PKGDIR="$(npm root -g --prefix "$TMP/prefix")/$(node -p "require('$APP/package.json').name")"
[ ! -e "$PKGDIR/data" ] || { echo "the office wrote into its own package folder"; exit 1; }
curl -fs -X POST -H 'content-type: application/json' -d '{"on":false}' "http://127.0.0.1:$PORT/api/voice/replies" > /dev/null
sleep 1
[ -f "$TMP/data/state.json" ] || { echo "state not saved to --data"; ls -la "$TMP/data"; exit 1; }
echo "installed package: all good"
