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

## Building company value

This is not a side project or a demo — the goal is a **real company** built on top of
open computer use. But the company should not be judged first by short-term monetization.
At this stage, the signal that matters is whether Lefa becomes the obvious open-source
layer for giving agents eyes and hands on Linux machines.

The growth metrics are developer traction: **GitHub stars, real usage, downloads,
integrations, repeat users, and visible adoption by teams building agents**. Those are the
signals that prove the product matters, the market is pulling, and the work is becoming
part of the agent infrastructure conversation.

The return path is building something strategically valuable enough to be acquired: an
amazing product, amazing traction, and an amazing team solving a hard problem that larger
AI, developer tooling, cloud, or infrastructure companies will need. Customer commitments
can validate production demand later, but they are not the north star.

The company and the depth are the same bet. Shallow wrappers get commoditized; the team
that owns the hardest parts of the stack — capture, a11y, input, permissions, latency,
reliability on real desktops — wins trust, adoption, and strategic value. We optimize for
**technical credibility** as much as feature checklists: blog posts that teach, traces you
can replay, benchmarks on hard tasks, and code that senior engineers respect when they
read it.

That depth is also how we **hire**. The best systems people want hard problems, visible
craft, and a mission that isn’t another CRUD app. Lefa should feel like the kind of
project you’d join to spend a year inside the Linux desktop stack and agent control
plane — and be proud of what you shipped.

## What we’re optimizing for

**Maximum agent control.** Not a narrow automation API — full parity with human interaction.
If you can click it, type it, copy it, or read it, the agent should be able to as well.

**Human-like interaction.** Same input paths, same UI affordances, same failure modes.
Vision-only hacks are a fallback; native desktop plumbing is the foundation.

**Depth on purpose.** We choose the hard path when it teaches something real: Wayland
portals, AT-SPI round trips, sandbox boundaries, headless displays, agent grounding.
Interesting engineering isn’t a tax — it’s the product story, the moat, and the reason
strong candidates pay attention.

**Learning that transfers.** Building Lefa is a deliberate education in systems that
matter beyond this company: OS interfaces, D-Bus, display servers, accessibility,
IPC, security models, and agent architecture. If the business doesn’t work, the
founder and the team should walk away with skills that plug directly into platform
engineering, infra, security, robotics, or the next agent startup — not shelfware and
regret.

**Open by default.** Source, protocol, and implementation visible. No vendor lock-in on
the control plane. Open source builds trust with developers; the company value comes from
becoming the default, deeply credible layer that teams already use before they ever talk
to us.

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

6. **Write it down.** Architecture notes, failure postmortems, and “how this works under
   the hood” content aren’t marketing fluff — they recruit engineers, earn design partners,
   and force clarity before the code ossifies.

## Goals

| Goal              | Meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| **Parity**        | Agent can complete real desktop tasks a human would do the same way              |
| **Portability**   | Runs on common Linux setups — local, VM, cloud, headless with a virtual display  |
| **Composability** | MCP tools any model or agent framework can drive without custom glue             |
| **Teachability**  | Code and docs explain *why*, not just *what* — suitable for deep technical study |
| **Trust**         | Explicit permissions, observable actions, and a clear security story             |
| **Company**       | A company-quality product, traction, and team with obvious strategic acquisition value |
| **Magnetism**     | Hard, legible problems that excite senior engineers and make hiring a strength   |

## What success looks like

- An agent on a Linux machine can browse, edit, install, configure, and debug software
  through the same UI you would — with traces you can inspect and replay.
- The stack is the default open-source answer to “how do I give my agent a computer?”
- GitHub stars, usage, downloads, and integrations show that developers are choosing
  Lefa because it solves a real problem.
- The company has clear strategic acquisition value: a hard technical product, visible
  traction, and a team capable of owning computer use infrastructure.
- Strong engineers reach out because the work looks **worth doing** — and staying is
  easy because the problems stay hard and the craft stays visible.
- Contributors and founders leave knowing how desktops, a11y, agents, and production
  infra fit together — whether or not Lefa is the company they’re still at in five years.

## If this company doesn’t work

That outcome is planned for, not feared. The point of going deep is that failure is
**expensive in time, not in capability**. You will have touched display servers, a11y
stacks, input injection, agent loops, MCP, cloud sandboxes, and the gap between “demo”
and “production.” That transfers cleanly into platform roles, security, devtools,
robotics, or the next agent company — with a public body of work that proves you did
the hard thing.

## Non-goals (for now)

- Beating every closed product on day one in benchmark scores
- Supporting every OS equally from the start
- Hiding complexity behind a magic black box — the complexity is part of the point
- Shallow breadth to chase every agent trend; we go deep on computer use first

---

*Lefa — open computer use for the machines agents actually run on.*
