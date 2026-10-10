---
paths:
  - "src/adapters/**/*.ts"
  - "src/translators/**/*.ts"
---

# Adapter and translator rules

- Implement providers behind `src/adapters/contract.ts`. An adapter owns one
  provider step at a time; it never owns loop scheduling.
- Treat executable discovery, executable identity, authentication, model
  availability, and capabilities as separate facts. Do not infer one from
  another or present fixtures and mocks as live connections.
- Declare unsupported controls explicitly. Expose steering, cancellation,
  recovery, input, or model selection only when the adapter has verified
  support for that connection.
- Parse every provider message and native file at the boundary. Keep protocol
  handling provider-specific and map it into portable events and errors.
- Use provider-owned authentication. Never read, copy, persist, log, or return
  agent credentials.
- Keep native configuration translation separate from execution. Preview
  conflicts and semantic loss, preserve unknown user-owned content, and never
  silently overwrite native agent files.
- Test protocol success and failure, malformed input, cancellation, recovery,
  tool permissions, and preservation with fixtures. A fixture pass is not
  evidence of a live provider connection.
