#!/usr/bin/env bash
#
# End-to-end test for the kubectl context guard package.
#
# Verifies the package is installed (or installs it locally for the duration
# of the run), stashes any conflicting global extension copies while running,
# and restores everything on exit.
#
# Requirements:
#   - pi CLI on PATH with a working default model (pi -p must run)
#   - kubectl binary on PATH (only read-only / client-only commands are run;
#     the allowed-context scenario uses a fake context that exists in no real
#     kubeconfig, so no real cluster is ever contacted)
#
# Usage: bash test/e2e.sh
#
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kcg-e2e.XXXXXX")"
CONFIG="$WORK/config.json"
PROMPT="$WORK/prompt.txt"
STASH_DIR="$WORK/stash"
mkdir -p "$STASH_DIR"

INSTALLED_BY_US=0
PASS=0
FAIL=0
FAILED_NAMES=()

cleanup() {
	# Restore any stashed global extension copies
	for f in "$STASH_DIR"/*; do
		[ -e "$f" ] || continue
		mv -f "$f" "$HOME/.pi/agent/extensions/$(basename "$f")" 2>/dev/null || true
	done
	# Remove the package install only if we added it
	if [ "$INSTALLED_BY_US" = "1" ]; then
		pi remove "$REPO" >/dev/null 2>&1 || true
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT

echo "== kubectl context guard e2e =="
command -v pi >/dev/null || { echo "FAIL: pi CLI not found on PATH"; exit 1; }
command -v kubectl >/dev/null || { echo "FAIL: kubectl binary not found on PATH"; exit 1; }

# ── Ensure the package is installed ─────────────────────────────────────────
if pi list 2>/dev/null | grep -qF "$(basename "$REPO")"; then
	echo "-- package already installed"
else
	echo "-- installing package from $REPO"
	pi install "$REPO" >/dev/null 2>&1 || { echo "FAIL: pi install failed"; exit 1; }
	INSTALLED_BY_US=1
fi

# ── Isolate: stash global copies of this extension (restored on exit) ──────
for f in "$HOME/.pi/agent/extensions/"*context-guard.ts; do
	[ -e "$f" ] || continue
	echo "-- stashing $(basename "$f")"
	mv "$f" "$STASH_DIR/$(basename "$f")"
done

# Test config with a marker context that exists in no real kubeconfig
printf '["fake-e2e-ctx"]\n' > "$CONFIG"
MISSING="$WORK/does-not-exist.json"

run_scenario() {
	# $1=index  $2=PI_KUBECTL_CONTEXTS_FILE value  $3=kubectl command
	local idx="$1" envval="$2" cmd="$3"
	printf 'Run exactly this bash command and report its full output verbatim, including any block or error messages: %s\n' "$cmd" > "$PROMPT"
	PI_KUBECTL_CONTEXTS_FILE="$envval" timeout 180 pi -p "$(cat "$PROMPT")" > "$WORK/out-$idx.txt" 2>&1 || true
}

check() {
	# $1=name  $2=index  $3=pattern that MUST match (ERE)  [$4=pattern that must NOT match]
	local name="$1" idx="$2" must="$3" mustnot="${4:-}"
	local out="$WORK/out-$idx.txt"
	if ! grep -qE "$must" "$out"; then
		echo "FAIL: $name (no match for: $must)"
		FAIL=$((FAIL + 1)); FAILED_NAMES+=("$name")
		return
	fi
	if [ -n "$mustnot" ] && grep -qE "$mustnot" "$out"; then
		echo "FAIL: $name (unexpected match for: $mustnot)"
		FAIL=$((FAIL + 1)); FAILED_NAMES+=("$name")
		return
	fi
	echo "PASS: $name"
	PASS=$((PASS + 1))
}

echo
echo "-- scenario 1: missing config file fails closed"
run_scenario 1 "$MISSING" "kubectl get pods"
check "fail-closed on missing config" 1 \
	"no allowed-contexts config found" \
	"kubectl command blocked: context"

echo "-- scenario 2: config present, no --context"
run_scenario 2 "$CONFIG" "kubectl get pods"
check "blocks missing context and lists allowlist" 2 \
	'context "\(none\)" is not allowed' ""
if grep -q "fake-e2e-ctx" "$WORK/out-2.txt"; then
	echo "PASS: block reason lists marker context from config file"
	PASS=$((PASS + 1))
else
	echo "FAIL: marker context missing from block reason"
	FAIL=$((FAIL + 1)); FAILED_NAMES+=("marker in allowlist")
fi

echo "-- scenario 3: config present, disallowed context"
run_scenario 3 "$CONFIG" "kubectl get pods --context evil-ctx"
check "blocks disallowed context" 3 \
	'context "evil-ctx" is not allowed' ""

echo "-- scenario 4: config present, allowed context passes the guard"
run_scenario 4 "$CONFIG" "kubectl get pods --context fake-e2e-ctx"
check "allowed context is not blocked by the guard" 4 \
	"fake-e2e-ctx" \
	"kubectl command blocked"

echo "-- scenario 5: kubectl version always allowed (no config at all)"
run_scenario 5 "$MISSING" "kubectl version --client"
check "version passes through fail-closed state" 5 \
	"Client Version" \
	"kubectl command blocked"

echo
echo "== results: $PASS passed, $FAIL failed =="
if [ "$FAIL" -gt 0 ]; then
	printf 'failed: %s\n' "${FAILED_NAMES[@]}"
	exit 1
fi
exit 0
