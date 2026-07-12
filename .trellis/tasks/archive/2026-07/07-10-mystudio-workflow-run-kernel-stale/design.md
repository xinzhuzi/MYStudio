# Design

## Problem

MYStudio has visible workflow outputs but no durable run ledger. A node can appear complete because output exists, even when there is no evidence of the run that produced it. Upstream edits also preserve downstream media and candidates without marking them stale.

## Scope

This task adds a minimal run kernel inside the existing project-scoped `studio-workflow-store`:

- persisted `agentRuns`
- run lifecycle actions
- input fingerprint and output refs on each run
- stale metadata on storyboards, production tracks, and video candidates
- parity report checks that require run/writeback evidence

## Data Model

`StudioAgentRun` remains the public run record and is extended compatibly:

- `id`
- `key`
- `phase`
- `status`: `queued | running | success | failed | canceled | stale`
- `inputSummary`
- `inputFingerprint`
- `outputRef`
- `outputRefs`
- `errorReason`
- `retryOf`
- `retryCount`
- `checkpointRef`
- `startedAt`
- `finishedAt`

Stale metadata is optional:

- `stale?: boolean`
- `staleReason?: string`
- `staleSince?: number`
- `sourceRunId?: string`
- `sourceFingerprint?: string`
- `outputVersion?: number`

## Store Boundary

Use the existing `studio-workflow-store` because it is already project-scoped through `createProjectScopedStorage("studio-workflow-store")`. No global store or root-level file is introduced.

## Stale Rules

- Replacing or updating upstream storyboard content preserves user media but marks existing storyboard media evidence stale.
- Rebuilding tracks preserves old candidates and selected video ids, but marks tracks and linked candidates stale when the new track fingerprint differs from the stored fingerprint.
- Applying a new image workflow result clears stale metadata for that storyboard.
- Adding or updating a video candidate clears stale metadata for that candidate.

## Parity Report

`buildWorkflowParityReport()` accepts optional `agentRuns`. Node action/writeback/report evidence must use successful run records when runs are present. Outputs without successful run evidence become issues.

## Compatibility

Old projects load with `agentRuns: []` and optional stale fields absent. No destructive migration is needed.
