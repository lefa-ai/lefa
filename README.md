# Lefa

**The Agent IDE.** A desktop app for orchestrating coding agents, running on our own harness — the power of a CLI harness, designed as a real product instead of a terminal.

> **Early days.** We're building Lefa in the open and it's still rough. Watch the repo, or join the waitlist at [lefa.ai](https://lefa.ai) to get one email when it ships.

## The idea

Every task gets its own workspace — one you can checkpoint, fork, and leave running in the cloud after your laptop closes. Open source and model-neutral.

Three bets, in order:

- **Multi-model orchestration.** Several models with different roles inside a single chat: a frontier orchestrator delegating to cheaper or specialized executors, with subagents anyone can define as a system prompt plus a model.
- **Code review that works.** We're all reviewing less of the code we ship. The agent should tell you what deserves your attention and make reading it fast.
- **Cloud continuity.** Persistent workspaces in real VMs, with local↔cloud handoff that keeps state. Closing the laptop shouldn't stop the work.

The harness is first-party, provider-neutral, deliberately minimal, and **permissive by default** — the agent gets full access, and restriction is opt-in.

See [`VISION.md`](VISION.md) for the long version.

## What's here today

- [`packages/harness/`](packages/harness/) — the TypeScript agent harness: bash, read, edit, and write tools over the Vercel AI SDK
- [`apps/desktop/`](apps/desktop/) — the Electron desktop app
- [`apps/site/`](apps/site/) — the [lefa.ai](https://lefa.ai) landing page and waitlist API

Local execution, macOS first. Everything else waits until it's needed.

## Development

```bash
pnpm install
pnpm dev
```

`pnpm test`, `pnpm typecheck`, and `pnpm lint` run across the workspace.

## Follow along

- X: [@lefa_ai](https://x.com/lefa_ai)
- Site: [lefa.ai](https://lefa.ai)

## Security

Found a vulnerability? Email [security@lefa.ai](mailto:security@lefa.ai).
