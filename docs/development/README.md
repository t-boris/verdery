# Developer documentation

Documentation for working _in_ this repository. Product meaning lives in
[../technical-specification.md](../technical-specification.md) and system design lives in
[../architecture/](../architecture/); nothing here restates either.

| Document                                                             | Answers                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [local-setup.md](local-setup.md)                                     | How do I get a working checkout and run each surface?                                          |
| [database-migrations.md](database-migrations.md)                     | How do I change the schema without breaking a running deployment?                              |
| [api-contract.md](api-contract.md)                                   | How do I change the API contract and regenerate clients?                                       |
| [ci-gates.md](ci-gates.md)                                           | What does CI check, and how do I reproduce a failure locally?                                  |
| [infrastructure.md](infrastructure.md)                               | How is `verdery-dev` provisioned, and how do I deploy to it?                                   |
| [runbooks.md](runbooks.md)                                           | What do I do when something breaks, and what has actually been exercised?                      |
| [ios-distribution.md](ios-distribution.md)                           | How does an iOS build reach TestFlight and the App Store, and what only the owner can do?      |
| [garden-capability-matrix.md](garden-capability-matrix.md)           | What may an owner, editor, or viewer do on a shared garden, and what does the code enforce?    |
| [deferred-capabilities.md](deferred-capabilities.md)                 | What is deliberately not built yet, and why?                                                   |
| [recommendation-safety-catalog.md](recommendation-safety-catalog.md) | What may the recommendation pipeline generate, and how does a horticultural reviewer sign off? |
| [threat-model.md](threat-model.md)                                   | What can attack this system, what stops it today, and what does the owner sign off on?         |
| [privacy-notice-draft.md](privacy-notice-draft.md)                   | What do we tell users about their data, and which claims are verified against code?            |
| [service-levels.md](service-levels.md)                               | What numbers is this service held to, and what do they cost to meet?                           |
| [load-testing.md](load-testing.md)                                   | How is capacity measured, and why can it not be measured yet?                                  |
| [support-operations.md](support-operations.md)                       | Someone reported a problem — how is it classified, diagnosed, and escalated?                   |
| [ga-checklist.md](ga-checklist.md)                                   | What must pass before a release, and which gates are impossible today?                         |

The repository rules in [../../AGENTS.md](../../AGENTS.md) apply to every change and are not
repeated in these documents.
