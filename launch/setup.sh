#!/bin/sh
# Resets the launch-video SANDBOX (port 4399, /tmp/office-demo) to a known
# starting state. Never touches the live office on 4317 or the repo's data/.
set -eu
DEMO=/tmp/office-demo
APP=$DEMO/app
ROOT=$DEMO/root
HERE=$(cd "$(dirname "$0")" && pwd)

# 1. Stop the sandbox, by PID, and only if that PID really is the sandbox.
if [ -f $DEMO/pid ]; then
  PID=$(cat $DEMO/pid)
  if /bin/ps -p "$PID" -o command= 2>/dev/null | grep -q 'node server/index.js'; then
    CWD=$(/usr/sbin/lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$CWD" in
      /tmp/office-demo/app|/private/tmp/office-demo/app) kill "$PID" ;;
      *) echo "PID $PID is not the sandbox (cwd $CWD); refusing to kill" >&2; exit 1 ;;
    esac
    while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
  fi
fi

# 2. Scratch projects: small git repos the stub really edits.
rm -rf "$ROOT" $DEMO/gate
mkdir -p "$ROOT" $DEMO/gate
mk() { mkdir -p "$ROOT/$1/$(dirname "$2")"; printf '%s' "$3" > "$ROOT/$1/$2"; }
mk storefront src/components/CheckoutBar.css '.checkout-bar {
  display: flex;
  gap: 12px;
  padding: 16px;
}

.checkout-button {
  width: 360px;
  padding: 14px 20px;
  border-radius: 12px;
  white-space: nowrap;
}
'
mk storefront src/components/CheckoutBar.jsx 'export function CheckoutBar({ total }) {
  return (
    <div className="checkout-bar">
      <span className="total">{total}</span>
      <button className="checkout-button">Continue to secure checkout</button>
    </div>
  );
}
'
mk storefront package.json '{ "name": "storefront", "private": true }
'
mk payments-api src/webhooks/sender.js 'import { post } from "../http.js";

export async function send(url, body) {
  return post(url, body);
}
'
mk payments-api package.json '{ "name": "payments-api", "private": true }
'
mk docs-site CHANGELOG.md '# Changelog

## 2.3.1

- Faster search on the docs home page.
'
for p in storefront payments-api docs-site; do
  (cd "$ROOT/$p" && git init -q && git add -A && git -c user.name=Demo -c user.email=demo@example.invalid commit -qm init)
done

# 3. A fresh office: no jobs, no chat, the two default channels.
NOW=$(node -e 'console.log(Date.now())')
cat > $APP/data/state.json <<EOF
{"xp":0,"jobs":[],"chat":[],"channels":[{"id":"general","name":"general","createdAt":$NOW},{"id":"chill-room","name":"chill-room","purpose":"Whatever the office talks about that is not the work.","createdAt":$NOW}],"chiefCost":0,"dismissed":[],"profiles":{}}
EOF

# 4. The stub stands in for claude (CLAUDE_BIN stays /tmp/office-demo/stub.sh).
printf '#!/bin/sh\nexec node %s "$@"\n' "$HERE/stub.mjs" > $DEMO/stub.sh
chmod +x $DEMO/stub.sh

# 5. Start it again with the same environment as before.
cd $APP
OFFICE_ROOT=$ROOT PORT=4399 CLAUDE_BIN=$DEMO/stub.sh BANTER=off STANDUP_AT=none \
  nohup node server/index.js > $DEMO/server.log 2>&1 &
echo $! > $DEMO/pid
for i in $(seq 1 50); do
  curl -s -o /dev/null http://localhost:4399/ && break
  sleep 0.2
done
echo "sandbox up, PID $(cat $DEMO/pid)"
