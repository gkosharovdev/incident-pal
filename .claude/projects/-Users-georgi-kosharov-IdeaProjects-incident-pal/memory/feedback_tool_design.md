---
name: Tool design preference — focused over broad
description: User prefers narrow, single-responsibility tools over multi-mode "all-powerful" tools
type: feedback
---

Always favour focused, single-responsibility tools over multi-mode tools that combine unrelated operations.

**Why:** Explicitly stated: "favour focused tools instead of all-powerful tools". Consistent with the constitution's Single Responsibility Principle.

**How to apply:** When designing a new tool that could cover multiple distinct operations, split into separate tools registered independently. Flag any proposed multi-mode tool design and recommend splitting before proceeding.
