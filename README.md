[![ci](https://github.com/sam-albon-li/pi-guard-kubectl-context/actions/workflows/ci.yml/badge.svg)](https://github.com/sam-albon-li/pi-guard-kubectl-context/actions/workflows/ci.yml)

# pi-guard-kubectl-context

Pi agent extension that blocks `kubectl` commands unless `--context` targets an allowed cluster context.

## Install

```bash
pi install git:github.com/sam-albon-li/pi-guard-kubectl-context@v1.1.0
```

Or without a pinned ref (tracks the default branch until you pin):

```bash
pi install https://github.com/sam-albon-li/pi-guard-kubectl-context
```

Remove with `pi remove git:github.com/sam-albon-li/pi-guard-kubectl-context`.

## Configure allowed contexts

The allowlist lives in a local JSON file so real cluster names stay out of this repository. The search order is:

1. `PI_KUBECTL_CONTEXTS_FILE` environment variable
2. `$CWD/.pi/pi-guard-kubectl-context.config.json`
3. `~/.pi/agent/pi-guard-kubectl-context.config.json` (default)

Create the configuration file (see `pi-guard-kubectl-context.example.json` for the format):

```json
{
  "allowedContexts": [
    "example-staging",
    "example-production"
  ]
}
```

The file is re-read on every kubectl command, so edits apply without restarting pi.

**Fail closed:** if the config file is missing or invalid, all kubectl commands are blocked until it is created.

## Usage

Any bash command containing a `kubectl` invocation is blocked unless it passes `--context <value>` (or `--context=<value>`) with an allowed context. `kubectl config` and `kubectl version` are always allowed.

## Development

Unit tests run with zero dependencies via Node's built-in test runner (Node ≥ 22.19 executes TypeScript natively):

```bash
npm test
```

An end-to-end test drives the installed package through real headless pi sessions. It requires a working default model and a `kubectl` binary on PATH, and uses a fake context so no real cluster is ever contacted:

```bash
npm run test:e2e
```
