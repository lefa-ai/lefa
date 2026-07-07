# Vision

## North star

Build the best **computer use** system in the world — open source, deeply technical, and
available to anyone running Unix-like machines. An agent using Lefa should be able to do
anything a human can do on a computer, interacting through the same surfaces humans use:
screens, accessibility trees, keyboard, mouse, clipboard, and windows.

## Why this exists

Codex Computer Use showed what’s possible when an agent gets native eyes and hands on a
desktop. It’s the reference architecture — but it’s closed, tied to the Codex app, and
Mac-only. That leaves out the machines where most serious agent work will actually run.

Lefa exists to fill that gap: **open computer use for the platforms agents will live on.**

## What we’re optimizing for

**Maximum agent control.** Not a narrow automation API — full parity with human interaction.
If you can click it, type it, copy it, or read it, the agent should be able to as well.

**Human-like interaction.** Same input paths, same UI affordances, same failure modes.
Vision-only hacks are a fallback; native desktop plumbing is the foundation.

**Learning that transfers.** This project is a deep dive into operating systems, display
servers, accessibility stacks, IPC, security boundaries, and agent loops. Even if the
product doesn’t pan out, the skills should carry into systems programming, platform
engineering, and agent infrastructure elsewhere.

**Open by default.** Source, protocol, and implementation visible. No vendor lock-in on
the control plane.

## Platform bet: Linux first

We build on **Linux** because the future of coding looks like a cloud-connected machine
running a Unix environment — laptop, server, VM, or remote desktop in a container. That’s
where agents need computer use to work reliably, at scale, and without a Mac in the loop.

The tool surface should stay **OS-agnostic at the schema level** (screenshot, tree,
click, type, …) so other platforms can plug in later. The roadmap is Linux-first: X11 and
Wayland, AT-SPI2, portals, and the real-world messiness of modern desktops.

## How we approach it

1. **Study the best, then open it up.** Reverse-engineer what makes Codex Computer Use
   work — perception daemon, action injection, MCP boundary, permissions — and map each
   piece to its Linux equivalent.

2. **Native daemon, thin protocol.** A Rust core (`lefad`) owns screenshot capture,
   accessibility introspection, and input injection. Agents talk to it over MCP (`lefa mcp`),
   not over ad-hoc shell and screenshots alone.

3. **Hybrid perception.** Combine accessibility trees (structure, labels, actions) with
   vision (layout, canvas, games, broken a11y) so agents aren’t blind when the tree lies.

4. **Embrace hard problems early.** X11 vs Wayland, portal permissions, sandboxed apps,
   coordinate mapping, and latency — that’s where the transferable learning lives.

5. **Ship incrementally, learn in public.** Placeholder crates and a landing page today;
   a working loop on a real Linux desktop tomorrow; benchmarks and safety rails as it
   matures.

## Goals

| Goal              | Meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| **Parity**        | Agent can complete real desktop tasks a human would do the same way              |
| **Portability**   | Runs on common Linux setups — local, VM, cloud, headless with a virtual display  |
| **Composability** | MCP tools any model or agent framework can drive without custom glue             |
| **Teachability**  | Code and docs explain *why*, not just *what* — suitable for deep technical study |
| **Trust**         | Explicit permissions, observable actions, and a clear security story             |

## What success looks like

- An agent on a Linux machine can browse, edit, install, configure, and debug software
  through the same UI you would — with traces you can inspect and replay.
- The stack is the default open-source answer to “how do I give my agent a computer?”
- Contributors leave knowing how desktops, a11y, and agents fit together — whether or
  not Lefa becomes the final product they use in production.

## Non-goals (for now)

- Beating every closed product on day one in benchmark scores
- Supporting every OS equally from the start
- Hiding complexity behind a magic black box — the complexity is part of the point

---

*Lefa — open computer use for the machines agents actually run on.*
