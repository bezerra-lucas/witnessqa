#!/bin/sh
set -eu
node -e 'require("http").createServer((req,res)=>res.end("<h1>Container ready</h1>")).listen(8080,"0.0.0.0")' &
fixture_pid=$!
trap 'kill "$fixture_pid"' EXIT
printf '%s\n' 'name: container' 'app: http://127.0.0.1:8080' 'ready: h1' 'steps:' '  - goto: /' '  - expectText: Container ready' > scenario.yaml
witnessqa doctor --base-url http://127.0.0.1:8080 --ready h1
witnessqa run scenario.yaml --out evidence
test -f evidence/REPORT.html
test -d evidence/REPORT.assets
