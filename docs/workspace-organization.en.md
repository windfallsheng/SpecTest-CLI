# Workspace Organization

> How the `.spectest/` territory is laid out, where everything lives, and why.

## Overview

```
.spectest/
├── config.yaml                  # gate thresholds etc.
├── local/context.json           # context (current iteration / last action)
├── environments/{env}.yaml      # environment config (baseUrl/auth/cleanup)
├── fixtures/                    # test data
├── templates/                   # platform-specific prompt templates (relay injection)
├── reports/                     # test reports
├── plans/                       # test plans (plan output)
├── bugs/                        # defects (code/spec kinds, bug command)
├── GLOBAL/cases/                # ★ global layer: sole home of case assets
├── iterations/{iteration}/      # ★ iteration layer: execution facts
├── archive/                     # archive snapshots
└── trend/                       # cross-iteration trend baselines
```

## The Core: Dual-Layer Asset Semantics

SpecTest separates test data into two kinds, each with its own home:

| | Global layer | Iteration layer |
|:---|:---|:---|
| Path | `GLOBAL/cases/` | `iterations/{iter}/` |
| Semantics | **Case assets** — what to test | **Execution facts** — how it went |
| Lifetime | Project-level, permanent | Follows the iteration |
| Written by | `gen` prebuild + AI relay | `run`/`gate` write-back after execution |

**Why**: old features must not lose their tests when a new iteration starts — Q2 may not touch booking, but Q2's regression still runs booking's cases. Storing cases per iteration would let them "fall" after Q1 is archived; storing execution results globally would mix the books between iterations. Hence: **assets live permanently in the global layer; facts are booked per iteration**.

## Global Layer Details

```
GLOBAL/cases/
└── {platform}/                   # dimension 1: platform (h5-mobile/admin-web/booking-service/…)
    └── {unit}/                   # dimension 2: unit (booking/user/…)
        └── suites/               # dimension 3: suite type
            └── TS-{platform}-{unit}-{type}/
                ├── SUITE.yaml    # suite metadata
                │   ├── id / name / platform / unit / type
                │   ├── bornIteration   ← origin iteration (asset provenance)
                │   ├── iteration       ← most recent prebuild/write-back iteration
                │   ├── testCaseIds     ← registered cases (filled by apply)
                │   └── specSource      ← spec version anchor (contentHash drives incrementality)
                ├── SCAFFOLD.md   # skeleton notes (for humans & resumed sessions)
                └── cases/
                    └── TS-{platform}-{unit}-{type}-AC-{no}.yaml   # case assets
```

- **Case IDs anchor to ACs**: `TS-{platform}-{unit}-{type}-AC-{no}`, no timestamp IDs — a case for the same AC never changes its name across iterations.
- **gen's three incremental states**:
  1. Cases exist + spec anchor unchanged → **reuse**, global assets untouched
  2. Spec anchor changed → **incremental top-up** (relay list marks "AC changed")
  3. New suite → **full prebuild** + relay

## Iteration Layer Details

```
iterations/{iteration}/
├── {platform}/{unit}/
│   └── matrix/trace.yaml        # unit-level trace matrix
│       ├── traces: AC list (acId/description/scenario/priority)
│       ├── cases: case execution status (caseId/status/lastRun/lastResult)
│       └── caseIds: AC ↔ case coverage facts, both directions
├── matrix/
│   ├── index.yaml               # master index (CLI-rebuilt idempotently, never hand-edit)
│   └── runs/RUN-*.json          # run records (structured facts)
```

- The matrix is the **single source of truth for verdicts**: gap (coverage holes), impact (blast radius), gate (coverage/pass rate) all read the matrix — never computing separately.
- Older versions stored suites in the iteration layer; `migrateLegacySuites` migrates them idempotently to the global layer (move; on both-sides conflicts the old dir is backed up as `.legacy-*`, nothing lost).

## Quasi-Global Assets (flat config directories)

| Directory | Purpose |
|:---|:---|
| `environments/{env}.yaml` | Contract-run environments (baseUrl/auth/cleanup), shared across iterations |
| `templates/` | Platform-specific case templates & relay prompts, shared across iterations |
| `config.yaml` | Gate thresholds, pipeline tri-state switches, etc. |
| `fixtures/` | Test data |

## Archive & Trend

- **archive**: `spectest archive -i Q1` snapshots the iteration's facts, **bundling copies of the involved units' global cases** (`GLOBAL-cases/`) — the archive is self-contained, readable years later without depending on live assets.
- **trend**: cross-iteration comparison is computed on the fly by `trend` (pass-rate curve, coverage growth) — trends are calculated, not stored.

## Relation to Other Directories

| Directory | Owner | SpecTest permission |
|:---|:---|:---|
| `010-requirements/` | SpecProt | Untouched |
| `020-specs/{unit}/{platform}/` | SpecCore | Read-only (input to the spec-reader scan index) |
| `030-tasks/_shared/API_CONTRACT.yaml` | SpecCore | Read-only (input to contract-side cases) |
| `.spectest/` | SpecTest | Read/write (sole territory) |

Dimension note: SpecCore organizes specs as "unit → platform"; SpecTest organizes cases as "platform → unit → type" — a **dimension transpose**, bridged by the spec-reader's "unit × platform" scan index. Each side keeps its own mental model.
