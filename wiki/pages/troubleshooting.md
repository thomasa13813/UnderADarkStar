---
title: Troubleshooting
description: Fixes for slow, choppy or broken Under a Dark Star games - browser, GPU and hardware acceleration checks, and where to report a bug.
section: Reference
order: 4
related: controls, interface
---

## The diagnostics panel

The game has a built-in diagnostics panel that shows your browser, operating system, GPU and how
the game is being drawn, with a button to copy it all.

**[Open the diagnostics panel](/#modal=troubleshooting)**

## If the game is slow or choppy

- **Use a Chromium-based browser** (Chrome, Edge, Brave, Opera). Under a Dark Star runs best on
  them.
- **Turn on hardware acceleration** in your browser's settings. Without it the game is drawn by
  the processor instead of the graphics card, which is far slower. If the diagnostics panel shows
  _Software rendering_, this is the problem.
- **Check the GPU.** On a laptop with two graphics chips, make sure the panel shows the dedicated
  one, if you have one.
- **Turn off power saving** in your browser and, on a laptop, plug in. Power saving mode slows the
  game down.
- Press <kbd>Alt</kbd> + <kbd>R</kbd> in game to reset the graphics settings.

## Still stuck?

Copy the diagnostics panel's information and tell us what happened:

- on the [Discord server]({{discord}}), the place for bug reports;
- or by email at [{{email}}](mailto:{{email}}).
