# Agent Guidelines

## Engineering Principles

- Create unit tests first for new behavior and meaningful bug fixes where practical.
- Keep the design modular and documented.
- Follow DRY and SOLID principles.
- Prefer small, composable modules with clear responsibilities.

## Documentation Style

- Write code comments only where they add real value.
- Do not add comments for trivial conditions or obvious assignments.
- Keep documentation concise and high signal.
- Favor architecture and module-level documentation over noisy inline commentary.

## Implementation Expectations

- Avoid duplicating provider logic, browser logic, and orchestration logic across layers.
- Keep browser integration, provider behavior, and agent orchestration as separate concerns.
- When adding new modules, make their contract explicit and easy to reuse.
- Preserve maintainability over quick one-off patches.
- Don't build too many abstraction, it should be easily reviewable by humans.
