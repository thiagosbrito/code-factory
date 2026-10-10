---
paths:
  - "src/ui/**/*.{ts,tsx,css}"
---

# UI rules

- Keep application composition in `app/` and `factory/`, feature behavior in
  `features/{runs,loops,setup}/`, and reusable UI and API helpers in `shared/`.
- A feature may import `shared/` and domain code, but not another feature or the
  app shell. `shared/` imports no feature or shell code. The UI reaches runtime
  behavior through the local API, not runtime implementation imports.
- Keep server state authoritative. Do not duplicate scheduler ownership in
  React state or simulate provider acknowledgments and capabilities.
- Keep local state near the component that owns it. Use reducers for complex
  editor transitions, hooks for data and handlers, and small presentational
  components with explicit typed props.
- Reuse controls from `src/ui/shared/components/` and follow existing Tailwind
  and Radix patterns. Keep focus, keyboard behavior, labels, status text, and
  error recovery accessible.
- Preserve the packaged Content Security Policy: do not introduce inline
  scripts, eval-like code, or remote-resource assumptions.
- Test visible behavior and user interactions with Testing Library rather than
  component internals. Cover loading, empty, error, disabled, and recovery
  states affected by the change.
