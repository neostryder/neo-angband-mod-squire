# Security Policy

## Scope

This repository owns the Squire plugin, its capability declarations, its use of the agent view and bound registries, its decision logic, and the commands it emits. It also owns how Squire builds and sends requests to model servers, its telemetry batching and upload queue, the records it keeps in local storage, and how it reads viewers' orders from an address the player enters.

A vulnerability in those components belongs to `neo-angband-mod-squire`.

The core `neo-angband` repository owns mod loading, capability enforcement, controller isolation, the shared agent API, network permissions, secret storage, archive handling, and the general mod trust model. A vulnerability in those components belongs to core. See the [core security policy](https://github.com/neostryder/neo-angband/blob/master/SECURITY.md).

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability.

Send a private report to **strider-angband (at) rpgm.tools**. Identify `neo-angband-mod-squire`, the affected tag or commit, the relevant capability or agent operation, reproduction steps, and the expected impact.

Reports about ordinary gameplay behavior that has no security impact belong in the public issue tracker.
