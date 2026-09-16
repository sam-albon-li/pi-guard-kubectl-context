/**
 * Kubectl Context Guard Extension
 *
 * Prevents `kubectl` commands from running unless the `--context` flag
 * targets an allowed cluster context.
 *
 * Allowed contexts are read from a local config file so that real cluster
 * names never need to be committed to this repository:
 *
 *   ~/.pi/agent/pi-guard-kubectl-context.config.json   (default)
 *
 * Format: a JSON object with an "allowedContexts" array of context name
 * strings, e.g.
 *
 *   { "allowedContexts": ["my-staging", "my-production"] }
 *
 * The file location can be overridden with the PI_KUBECTL_CONTEXTS_FILE
 * environment variable.
 *
 * If the config file is missing or invalid, ALL kubectl commands are
 * blocked (fail closed) until the file is created.
 *
 * `kubectl config` and `kubectl version` are always allowed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

interface IConfig {
  allowedContexts: Array<string>
}

function defaultConfigPath(): string {
	return path.join(homedir(), ".pi", "agent", "pi-guard-kubectl-context.config.json");
}

function configPath(): string {
	return process.env.PI_KUBECTL_CONTEXTS_FILE || defaultConfigPath();
}

/**
 * Load allowed contexts from the config file.
 * Returns null when the file is missing or invalid (fail closed).
 */
function loadAllowedContexts(): string[] | null {
	let raw: string;
	try {
		raw = readFileSync(configPath(), "utf8");
	} catch {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}

	const allowedContexts = (parsed as IConfig).allowedContexts;
	if (!Array.isArray(allowedContexts)) {
		return null;
	}

	return allowedContexts.filter((c): c is string => typeof c === "string" && c.length > 0);
}

/**
 * Extract the context value from a kubectl command string.
 * Handles --context=<value> and --context <value>.
 */
function extractContext(command: string): string | null {
	const longFlagMatch = command.match(
		/--context\s*[\s=]\s*(\S+)/i,
	);
	if (longFlagMatch) return longFlagMatch[1];

	return null;
}

export default function (pi: ExtensionAPI) {
	// Always-allow list: `kubectl config` and `kubectl version` need no context
	const kubectlSafeRegex = /kubectl\s+(config|version)/;

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;

		if (kubectlSafeRegex.test(command) || !command.includes("kubectl")) return undefined;

		const allowed = loadAllowedContexts();

		if (!allowed) {
			return {
				block: true,
				reason: `kubectl command blocked: no allowed-contexts config found at ${configPath()}.\n\nCreate it as a JSON object with an "allowedContexts" array, e.g. {"allowedContexts": ["my-staging"]}, or set PI_KUBECTL_CONTEXTS_FILE to point at your config file.`,
			};
		}

		const context = extractContext(command);

		if (context && allowed.includes(context)) {
			return undefined; // Allowed — proceed
		}

		return {
			block: true,
			reason: `kubectl command blocked: context "${context ?? "(none)"}" is not allowed.\n\nAllowed contexts:\n  - ${allowed.join("\n  - ")}`,
		};
	});
}
