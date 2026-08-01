# Vision

## Big vision

Build the best coding app in the world: a **desktop app for orchestrating coding agents**,
running on our own harness. Think Cursor's successor, or Conductor with a first-party
harness instead of a wrapped CLI — the power of OpenCode/Claude Code, but designed as a
desktop product rather than a terminal one.

Coding is the first market. The architecture should later support any work an agent can do
through tools and a computer.

## Principles

1. **Our own harness.** First-party, provider-neutral, and deliberately minimal. The
   harness is the durable asset; the app is how people meet it.
2. **Desktop-app first.** Every serious harness today is CLI-first with a UI bolted on.
   Ours is the inverse: the UI is the product, and the harness is built to be driven by it.
3. **Best of everything.** Take the strongest ideas from every harness and every agent app,
   and combine them into one coherent product instead of a pile of features.
4. **Permissive by default.** Other harnesses interrupt for approval on nearly every action.
   Ours allows everything by default and gives the agent maximum access. Right defaults,
   fully customizable — restriction is opt-in, not the starting point.

## The three differentiators

### 1. Multi-model orchestration (highest-potential bet)

Multiple models, with different roles, **inside a single chat**. Models are getting more
expensive, so the winning pattern is a strong orchestrator delegating to cheaper or
specialized executors.

- A frontier planner/orchestrator (e.g. Fable 5) drives; a cheaper executor subagent
  (e.g. Grok 4.5) does the volume work; a model chosen for design or review handles its
  specialty.
- **Modular subagents:** anyone can define a subagent as a system prompt + a model. Ship
  excellent defaults; let everything be swapped.
- The orchestrator picks by capability, speed, and cost, then integrates the results
  coherently.

### 2. Code review that actually works

We are reviewing less and less of the code we ship, and review is not a solved problem.
The agent should tell you **what deserves your attention** and make reviewing it fast.

- Triage by risk and blast radius: skip the React components, read the core runtime.
- Review UX built for reading agent-authored diffs, not for line-by-line human diffs.

### 3. Cloud continuity

There is no reliable way to run agents in the cloud the way you run them on your own
machine. Closing the laptop should not stop the work.

- Persistent, isolated workspaces in real VMs, with local↔cloud handoff that keeps state.
- Supervise, steer, and approve from anywhere — desktop first, mobile as the remote.

## Supporting capabilities

- **Workspaces:** every task owns a persistent, branchable workspace — agents, context,
  files, processes, browser, checkpoints, artifacts, diffs.
- **Checkpoints, forks, and task trees**, plus an excellent diff viewer.

## Facts

- AI-native developers already supervise several agents, fragmented across chats,
  terminals, worktrees, models, and machines.
- Models differ in intelligence, speed, specialization, and cost. The best system combines
  them rather than betting on one.
- The founder is an extreme AI-coding power user. Strongest stack: TypeScript, with
  application-level Rust — not OS, kernel, or native desktop internals.
- Can start open source with no immediate business model. Adoption, technical importance,
  and an exceptional product come first.

## Overall goals

- Build something deeply agentic, technically ambitious, modern, and fun to work on.
- Create visible engineering depth that attracts excellent TypeScript, Rust, product, and
  agent engineers.
- Keep the hard work transferable: harnesses, protocols, distributed state, orchestration,
  Git, processes, cloud execution.
- Move with the scope and velocity of a small AI-native team while keeping one coherent
  product.
- Stay open and provider-neutral wherever possible.

## Order of work

1. **Harness + desktop:** the best single-agent experience for starting, steering, and
   reviewing coding work.
2. **Workspaces:** checkpoints, forks, task trees, artifacts, diff viewer.
3. **Orchestration:** multi-model coordination and user-defined subagents.
4. **Review:** agent-guided review triage and the review surface.
5. **Cloud:** persistent workspaces in real VMs after the laptop closes.
6. **Mobile:** a focused surface for monitoring, steering, and approving.

## Boundaries

- No custom hypervisors, Linux desktop control, or macOS internals.
- Evals, observability, and enterprise controls are not the product.
- Don't lead with "an agent that does anything." Earn breadth through the best coding
  workflow first.
- Rust where it creates a durable systems advantage; TypeScript where iteration, product
  quality, and ecosystem reach matter most.
- Don't restrict the agent to feel safe. Defaults stay permissive.
