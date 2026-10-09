# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through a [GitHub security advisory](https://github.com/thiagosbrito/code-factory/security/advisories/new) on this repository. Do not open a public issue. Include the version (`code-factory --version`), what you did and what happened.

## In scope

- Anything that lets another website, local process or account drive the local API or UI without the session link.
- Running code from a project that the user has not trusted.
- Leaking credentials (agent logins, the Linear key) to the project, the API or child processes.
- Writing to or changing the user's checkout, index, branches or Git configuration outside what the README describes.

## Known limitations in 0.x

- A hostile pop-up plus a double-click trick could still land a click on a dangerous button. A UI-side guard is not built yet.
- Path comparisons are case-sensitive, so case-insensitive Windows paths are not handled; `taskkill` is launched by bare name. Windows is untested overall.
- If two runtimes find the same stale `trust.json` lock after a crash, both can take it over.
- Prompt injection is inherent: a ticket or repository files can steer an agent, and with the shell permission an agent can do anything the user can. The trust and permission dialogs say so.
