# pi-guard-kubectl-context

Pi agent extension that blocks `kubectl` commands unless `--context` targets an allowed cluster context.

## Install

```bash
pi install git:github.com/sam-albon-li/pi-guard-kubectl-context@v1.0.0
```

Or without a pinned ref (tracks the default branch until you pin):

```bash
pi install https://github.com/sam-albon-li/pi-guard-kubectl-context
```

Remove with `pi remove git:github.com/sam-albon-li/pi-guard-kubectl-context`.

## Configure allowed contexts

The allowlist lives in a local JSON file so real cluster names stay out of this repository. Create `~/.pi/agent/kubectl-contexts.json` (see `kubectl-contexts.example.json` for the format):

```json
[
  "my-staging",
  "my-production"
]
```

The location can be overridden with the `PI_KUBECTL_CONTEXTS_FILE` environment variable. The file is re-read on every kubectl command, so edits apply without restarting pi.

**Fail closed:** if the config file is missing or invalid, all kubectl commands are blocked until it is created.

## Usage

Any bash command containing a `kubectl` invocation is blocked unless it passes `--context <value>` (or `--context=<value>`) with an allowed context. `kubectl config` and `kubectl version` are always allowed.
