# ADR-0003: Fastify Modular Monolith and REST/OpenAPI

> Status: Accepted  
> Date: July 21, 2026

## Context

Grow Garden has multiple domain areas, but the initial product does not have independent teams or scaling evidence that justifies microservices. Native Swift and TypeScript clients need a stable, language-neutral API contract.

## Decision

Implement the interactive backend as a TypeScript modular monolith using Fastify. Organize code by domain module with explicit public application interfaces. Expose a versioned REST API described by OpenAPI and generate or validate client contracts from that definition.

## Consequences

- Cross-module transactions remain possible where justified.
- Deployment and local development remain simple.
- Module boundaries must be enforced through code organization and tests rather than network calls.
- REST commands require idempotency and explicit concurrency semantics.
- A module is extracted only after demonstrating a different scaling, security, reliability, runtime, or ownership need.

## Rejected Alternatives

- Microservices were rejected as premature operational complexity.
- GraphQL was rejected as the primary API because offline commands, file workflows, versioned resources, and Swift client generation benefit from explicit REST contracts.
- tRPC was rejected because it would couple the API contract to TypeScript and does not serve the native Swift client equally.
