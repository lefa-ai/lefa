# Vision

## Facts

- AI-native developers increasingly supervise several coding agents, but today this is
  fragmented across chats, terminals, worktrees, models, and machines.
- Models differ in intelligence, speed, specialization, and cost. The best system will
  combine them rather than depend on one model.
- The founder is an extreme AI-coding power user. His strongest stack is TypeScript with
  application-level Rust—not OS, kernel, or native desktop internals.
- The project can start open source without an immediate business model. Adoption,
  technical importance, and an exceptional product come first.

## Overall goals

- Build something deeply agentic, technically ambitious, modern, and fun to work on.
- Create visible engineering depth that attracts excellent TypeScript, Rust, product,
  and agent engineers.
- Keep the hard work transferable: agent harnesses, protocols, distributed state,
  orchestration, Git, processes, and cloud execution.
- Move with the scope and velocity of a small, AI-native team while maintaining a
  coherent product—not a collection of agent features.
- Stay open and provider-neutral wherever possible.

## Big vision

Build the best coding app in the world: an open operating environment for AI software
engineers.

Every task owns a persistent, branchable workspace containing its agents, context,
files, processes, browser, checkpoints, artifacts, and diffs. Work can start locally,
continue in a cloud VM, and be supervised from desktop or mobile without losing state.

The system eventually includes a first-party universal agent harness. A frontier model
can coordinate the work while faster, cheaper, or specialized models execute parallel
subtasks and independent models review them. Coding is the first market; the architecture
can later support any work an agent can perform through tools and a computer.

## Specific goals

1. **Desktop:** deliver the best single-agent experience for starting, steering, and
   reviewing coding work.
2. **Workspaces:** add durable checkpoints, forks, task trees, artifacts, and an excellent
   diff viewer.
3. **Orchestration:** let a coordinator delegate to multiple models based on capability,
   speed, and cost, then integrate their work coherently.
4. **Cloud:** run persistent, isolated workspaces in real VMs after the user's laptop
   closes.
5. **Mobile:** provide a focused surface for monitoring, steering, approving, and
   reviewing agents from anywhere.
6. **Harness:** build a provider-neutral first-party agent runtime while remaining
   compatible with existing agents and open standards.

## Boundaries

- Do not build custom hypervisors, Linux desktop control, or macOS internals.
- Do not make evals, observability, or enterprise controls the product.
- Do not lead with “an agent that does anything.” Earn breadth through the best coding
  workflow first.
- Use Rust where it creates a durable systems advantage and TypeScript where iteration,
  product quality, and ecosystem reach matter most.
