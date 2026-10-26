#!/usr/bin/env bash
set -eu
mkdir -p src
cat > src/money.mjs <<'J'
export function addCents(a, b) {
  return a + b;
}
export function formatCents(c) {
  return (c / 100).toFixed(2);
}
J
cat > pr.diff <<'D'
--- a/src/money.mjs
+++ b/src/money.mjs
@@ -1,6 +1,8 @@
 export function addCents(a, b) {
-  return a + b;
+  return Number(a) + Number(b);
 }
-export function formatCents(c) {
-  return (c / 100).toFixed(2);
+export function formatCents(c) {
+  if (c < 0) return '-' + (c / 100).toFixed(2);
+  return (c / 100).toFixed(2);
 }
D
git init -q -b main && git add -f -A && git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm "fixture"
