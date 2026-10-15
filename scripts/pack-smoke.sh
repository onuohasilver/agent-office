#!/bin/sh
# Installs the package the way a user would — from the packed tarball, into a
# throwaway global prefix — and checks the `agentoffice` command works:
# version, starting an office that serves and lists projects behind its key,
# --link, and state kept in OFFICE_DATA rather than the package folder.
set -eu
APP=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
PID=
# agentoffice runs the server under a supervisor, which passes SIGTERM on and
# exits with it. Killing the server directly would only get it restarted.
trap '[ -n "$PID" ] && { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }; rm -rf "$TMP"' EXIT

cd "$APP" && npm pack --silent --pack-destination "$TMP" >/dev/null
npm install --silent -g --prefix "$TMP/prefix" "$TMP"/*.tgz
PATH="$TMP/prefix/bin:$PATH"

# A stand-in claude that answers --version and nothing else.
printf '#!/bin/sh\necho "0.0.0 (stand-in)"\n' > "$TMP/claude" && chmod +x "$TMP/claude"
export CLAUDE_BIN="$TMP/claude" STANDUP_AT=off BANTER=off
export OFFICE_ROOT="$TMP/projects" OFFICE_DATA="$TMP/data"
mkdir -p "$OFFICE_ROOT/storefront"

echo "version: $(agentoffice --version)"
[ "$(agentstudio --version)" = "$(agentoffice --version)" ] || { echo "agentstudio is not the same command"; exit 1; }

PORT=$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
BASE="http://127.0.0.1:$PORT"
agentoffice --port "$PORT" > "$TMP/run.log" 2>&1 &
PID=$!
i=0
until [ -f "$OFFICE_DATA/office-key" ] && curl -s -o /dev/null "$BASE/"; do
  i=$((i + 1)); [ $i -gt 60 ] && { cat "$TMP/run.log"; echo "never came up"; exit 1; }
  sleep 0.5
done
KEY=$(cat "$OFFICE_DATA/office-key")
COOKIE="office_key_$PORT=$KEY"

# The key keeps everyone else out.
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/repos")" = 401 ] || { echo "the API answered without the key"; exit 1; }
curl -fs -H "cookie: $COOKIE" "$BASE/api/repos" > "$TMP/repos.json"
grep -q storefront "$TMP/repos.json" || { echo "project not listed: $(cat "$TMP/repos.json")"; exit 1; }
curl -fs -H "cookie: $COOKIE" "$BASE/" | grep -q '<title>Office</title>' || { echo "web app not served"; exit 1; }
agentoffice --link | grep -q "?key=$KEY" || { echo "--link did not print the key"; exit 1; }

# State belongs in OFFICE_DATA; an upgrade replaces the package folder.
PKGDIR="$(npm root -g --prefix "$TMP/prefix")/$(node -p "require('$APP/package.json').name")"
[ ! -e "$PKGDIR/data" ] || { echo "the office wrote into its own package folder"; exit 1; }
curl -fs -X POST -H "cookie: $COOKIE" -H "origin: $BASE" -H 'content-type: application/json' -d '{"on":false}' "$BASE/api/voice/replies" > /dev/null
sleep 1
[ -f "$OFFICE_DATA/state.json" ] || { echo "state not saved to OFFICE_DATA"; ls -la "$OFFICE_DATA"; exit 1; }
echo "installed package: all good"
