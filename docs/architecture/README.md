# Architecture

Part of [the documentation index](../README.md).

## Overview

[System overview, repository map and data flows](overview.md) and
[consistency, security, background work and where to make changes](overview-boundaries.md).

## AI Pipeline

[Interview and boundaries](ai-pipeline.md), [variant generation](ai-pipeline-variants.md) and
[text routing, images, reliability and cost](ai-pipeline-routing.md).

## Data Model

[Tables and relationships](data-model.md), [leads, authority, RPCs and storage](data-model-access.md)
and the [migration map](migrations.md).

## Channels

[Channels](channels/README.md): one page of current facts per ad channel, starting with [Meta](channels/meta.md).

## Decisions (ADRs)

An architecture decision record (ADR) holds one decision that shapes code across
features: why it was made, what was chosen and what it costs. Code and briefs
link to the ADR rather than restating it.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-001](adr-001-multi-channel.md) | Multi-channel architecture: channel-neutral core, one adapter per ad platform (#1792) | Accepted (CEO, Oct 29; #1805) |

## Writing an ADR

1. Copy [the template](adr-template.md) to `adr-NNN-short-name.md`, using the next number.
2. Fill in context, decision and consequences; set the status to **proposed**.
3. Add its row above in the same PR. The CTO accepts it; the CEO decides when
   it changes money or priorities (`decision` label).
4. Never rewrite an accepted ADR: a later ADR supersedes it, and both rows say so.
