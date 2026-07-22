# Developer documentation

Documentation for working _in_ this repository. Product meaning lives in
[../technical-specification.md](../technical-specification.md) and system design lives in
[../architecture/](../architecture/); nothing here restates either.

| Document                                             | Answers                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| [local-setup.md](local-setup.md)                     | How do I get a working checkout and run each surface?              |
| [database-migrations.md](database-migrations.md)     | How do I change the schema without breaking a running deployment?  |
| [api-contract.md](api-contract.md)                   | How do I change the API contract and regenerate clients?           |
| [ci-gates.md](ci-gates.md)                           | What does CI check, and how do I reproduce a failure locally?      |
| [deferred-capabilities.md](deferred-capabilities.md) | Why can I not deploy anything, and what has to exist before I can? |

The repository rules in [../../AGENTS.md](../../AGENTS.md) apply to every change and are not
repeated in these documents.
