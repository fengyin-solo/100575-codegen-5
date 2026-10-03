#!/usr/bin/env bash
# 领域规则测试：不引第三方测试框架。
# 用项目已有的 tsc 把纯 TS 规则代码转成 CommonJS（.cjs 以兼容 "type": "module"），
# 再交给 Node 内置 test runner。
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=".tmp-test"
rm -rf "$OUT"
mkdir -p "$OUT"

node node_modules/typescript/bin/tsc \
  src/data/renovation/ledger-service.ts \
  src/data/renovation/types.ts \
  src/data/renovation/ledger-service.test.ts \
  --outDir "$OUT" \
  --module commonjs --target es2020 \
  --moduleResolution node --esModuleInterop --skipLibCheck --strict

for f in "$OUT"/*.js; do mv "$f" "${f%.js}.cjs"; done
# tsc 产出的是无扩展名的 require("./x")，CommonJS 在 ESM 包内需要显式 .cjs。
sed -i 's#require("\./ledger-service")#require("./ledger-service.cjs")#; s#require("\./types")#require("./types.cjs")#' \
  "$OUT"/ledger-service.cjs "$OUT"/ledger-service.test.cjs

node --test "$OUT"/ledger-service.test.cjs
status=$?

rm -rf "$OUT"
exit $status
