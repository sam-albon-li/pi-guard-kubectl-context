/**
 * Unit tests for the kubectl context guard extension.
 *
 * Runs with zero dependencies via Node's built-in test runner and native
 * TypeScript type stripping (Node >= 22.19):
 *
 *   node --test test/extension.test.ts
 *
 * The ExtensionAPI is mocked; no pi session or kubectl binary is needed.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import extension from "../index.ts";

// ── Mock ExtensionAPI ───────────────────────────────────────────────────────

type ToolCallHandler = (
	event: { toolName: string; input: Record<string, unknown> },
	ctx: unknown,
) => unknown;

function loadExtension() {
	const handlers: Record<string, ToolCallHandler[]> = {};
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			(handlers[name] ??= []).push(handler);
		},
	};

	extension(pi as never);

	const toolCall = handlers["tool_call"]?.[0];
	assert.ok(toolCall, "extension should register a tool_call handler");

	return {
		/** Fire a synthetic tool_call event and return the handler result. */
		fire: async (command: string, toolName = "bash") =>
			await toolCall({ toolName, input: { command } }, {}),
	};
}

// ── Isolated HOME + config file helpers ─────────────────────────────────────

const savedEnv: { home?: string; cfg?: string } = {
	home: process.env.HOME,
	cfg: process.env.PI_KUBECTL_CONTEXTS_FILE,
};

let tmpHome: string;

beforeEach(() => {
	tmpHome = mkdtempSync(path.join(tmpdir(), "kcg-test-"));
	process.env.HOME = tmpHome;
	delete process.env.PI_KUBECTL_CONTEXTS_FILE;
});

afterEach(() => {
	rmSync(tmpHome, { recursive: true, force: true });
	process.env.HOME = savedEnv.home;
	if (savedEnv.cfg === undefined) delete process.env.PI_KUBECTL_CONTEXTS_FILE;
	else process.env.PI_KUBECTL_CONTEXTS_FILE = savedEnv.cfg;
});

/** Write a config file inside the temp HOME and return its path. */
function writeConfig(contents: string): string {
	const p = path.join(tmpHome, "cfg.json");
	writeFileSync(p, contents);
	return p;
}

/** Point PI_KUBECTL_CONTEXTS_FILE at a config with the given contexts. */
function useContexts(contexts: string[]): void {
	process.env.PI_KUBECTL_CONTEXTS_FILE = writeConfig(
		JSON.stringify({ allowedContexts: contexts }),
	);
}

/** Write the default-path config (~/.pi/agent/pi-guard-kubectl-context.config.json) in tmp HOME. */
function useDefaultContexts(contexts: string[]): void {
	const dir = path.join(tmpHome, ".pi", "agent");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "pi-guard-kubectl-context.config.json"),
		JSON.stringify({ allowedContexts: contexts }),
	);
}

function isBlocked(result: unknown): result is { block: true; reason: string } {
	if (typeof result !== "object" || result === null) return false;
	const r = result as Record<string, unknown>;
	return r.block === true && typeof r.reason === "string";
}

// ── Pass-through behavior ───────────────────────────────────────────────────

test("ignores non-bash tools", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-a"]);
	assert.equal(await fire("kubectl get pods", "read_file"), undefined);
});

test("ignores bash commands that do not contain kubectl", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-a"]);
	assert.equal(await fire("ls -la"), undefined);
	assert.equal(await fire("echo hello && git status"), undefined);
});

test("always allows kubectl config without a context", async () => {
	const { fire } = loadExtension();
	// no config file at all — must still pass through
	assert.equal(await fire("kubectl config view"), undefined);
	assert.equal(await fire("kubectl config current-context"), undefined);
});

test("always allows kubectl version without a context", async () => {
	const { fire } = loadExtension();
	assert.equal(await fire("kubectl version --client"), undefined);
});

// ── Fail closed ─────────────────────────────────────────────────────────────

test("blocks all kubectl commands when the config file is missing (default path)", async () => {
	const { fire } = loadExtension();
	// tmpHome has no .pi/agent/pi-guard-kubectl-context.config.json
	const result = await fire("kubectl get pods");
	assert.ok(isBlocked(result), "expected block, got: " + JSON.stringify(result));
	assert.match(result.reason, /no allowed-contexts config found/);
	assert.match(
		result.reason,
		new RegExp(path.join(".pi", "agent", "pi-guard-kubectl-context.config.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);
});

test("blocks when the config file is invalid JSON", async () => {
	const { fire } = loadExtension();
	process.env.PI_KUBECTL_CONTEXTS_FILE = writeConfig("{not json");
	const result = await fire("kubectl get pods --context ctx-a");
	assert.ok(isBlocked(result));
	assert.match(result.reason, /no allowed-contexts config found/);
});

test("blocks when the config object has no allowedContexts key", async () => {
	const { fire } = loadExtension();
	process.env.PI_KUBECTL_CONTEXTS_FILE = writeConfig('{"allowed": ["ctx-a"]}');
	const result = await fire("kubectl get pods");
	assert.ok(isBlocked(result));
	assert.match(result.reason, /no allowed-contexts config found/);
});

test("blocks when the config is a bare JSON array (old format)", async () => {
	const { fire } = loadExtension();
	process.env.PI_KUBECTL_CONTEXTS_FILE = writeConfig('["ctx-a"]');
	const result = await fire("kubectl get pods --context ctx-a");
	assert.ok(isBlocked(result));
	assert.match(result.reason, /no allowed-contexts config found/);
});

test("blocks when allowedContexts is not an array", async () => {
	const { fire } = loadExtension();
	process.env.PI_KUBECTL_CONTEXTS_FILE = writeConfig('{"allowedContexts": "ctx-a"}');
	const result = await fire("kubectl get pods");
	assert.ok(isBlocked(result));
	assert.match(result.reason, /no allowed-contexts config found/);
});

test("blocks everything when allowedContexts is empty", async () => {
	const { fire } = loadExtension();
	useContexts([]);
	const result = await fire("kubectl get pods --context ctx-a");
	assert.ok(isBlocked(result));
	assert.match(result.reason, /is not allowed/);
});

// ── Context enforcement ─────────────────────────────────────────────────────

test("blocks kubectl commands without --context and lists allowed contexts", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-a", "ctx-b"]);
	const result = await fire("kubectl get pods");
	assert.ok(isBlocked(result));
	assert.match(result.reason, /context "\(none\)" is not allowed/);
	assert.match(result.reason, /ctx-a/);
	assert.match(result.reason, /ctx-b/);
});

test("blocks kubectl commands with a disallowed context", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-a"]);
	const result = await fire("kubectl get pods --context evil-ctx");
	assert.ok(isBlocked(result));
	assert.match(result.reason, /context "evil-ctx" is not allowed/);
});

test("allows --context <value> with an allowed context", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-a"]);
	assert.equal(await fire("kubectl get pods --context ctx-a"), undefined);
});

test("allows --context=<value> with an allowed context", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-b"]);
	assert.equal(await fire("kubectl get pods --context=ctx-b"), undefined);
});

test("allows the context flag in any position of the command", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-a"]);
	assert.equal(await fire("kubectl --context ctx-a get pods -n foo"), undefined);
	assert.equal(await fire("kubectl get --context=ctx-a pods"), undefined);
});

test("context flag matching is case-insensitive", async () => {
	const { fire } = loadExtension();
	useContexts(["ctx-a"]);
	assert.equal(await fire("kubectl get pods --CONTEXT ctx-a"), undefined);
});

test("ignores extra object keys and filters non-string entries", async () => {
	const { fire } = loadExtension();
	process.env.PI_KUBECTL_CONTEXTS_FILE = writeConfig(
		JSON.stringify({ allowedContexts: ["ctx-a", 42, "", null], note: "extra" }),
	);
	assert.equal(await fire("kubectl get pods --context ctx-a"), undefined);
});

// ── Config resolution ───────────────────────────────────────────────────────

test("resolves the default config path lazily so HOME changes after import are respected", async () => {
	const { fire } = loadExtension();
	useDefaultContexts(["ctx-a"]);
	assert.equal(await fire("kubectl get pods --context ctx-a"), undefined);
});

test("PI_KUBECTL_CONTEXTS_FILE overrides the default path", async () => {
	const { fire } = loadExtension();
	// Default path allows ctx-a; the override file only allows ctx-b.
	useDefaultContexts(["ctx-a"]);
	useContexts(["ctx-b"]);
	assert.equal(await fire("kubectl get pods --context ctx-b"), undefined);
	const result = await fire("kubectl get pods --context ctx-a");
	assert.ok(isBlocked(result), "override file should win over the default path");
});
