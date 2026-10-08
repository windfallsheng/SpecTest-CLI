# Product Overview

> What SpecTest is, what it can do, and where its boundaries lie — one page to see it all.

## Positioning

**SpecTest is the testing base of the Spec\* ecosystem** — *Test by Spec, Not by Guess*.

It is not "yet another test framework"; it is the **translator and gatekeeper between specs and tests**:

- Translator: turns the acceptance criteria (AC) produced by SpecCore into structured, professional test cases
- Gatekeeper: turns execution evidence into a hard quality-gate verdict

**It produces neither specs nor code — only "proof"**: proof that every requirement was tested, proof that every quality metric is backed by data.

## The Last of Three Gates

Three bases collaborate, each owning one stretch:

```
┌─────────────┐ gate 1  ┌─────────────┐ gate 2  ┌─────────────┐ gate 3
│  SpecProt   │ ──────→ │  SpecCore   │ ──────→ │  SpecTest   │ ──────→ release
│  product    │ freeze  │  dev base   │ TEST.md │  test base  │ gate
│ vague→solid │ →unitize│ build by sp │  →init  │ test by spec│ →execute check
└─────────────┘         └─────────────┘         └─────────────┘
```

- **Gate 1**: SpecProt freezes a finalized iteration → SpecCore splits it for development
- **Gate 2**: SpecCore emits TEST.md → SpecTest initializes and generates cases
- **Gate 3**: SpecTest's gate verdict flows back into SpecCore's execution gate (fail = no release)

## Capability Map

| Capability | Command | Notes |
|:---|:---|:---|
| Plain language | `ask` | Intent recognition & execution (dictionary-driven; high confidence runs directly, missing params prompt interactively) |
| Set up territory | `init` | Creates `.spectest/` inside a SpecCore project |
| Set strategy | `plan` | Test plan: strategy, risk flags, data prep, timeline |
| Grow cases | `gen` | Generate cases from ACs (skeleton prebuild + AI relay + incremental reuse) |
| API tests | `api` | Generate API tests from API_CONTRACT.yaml (contract side) |
| Find gaps | `gap` | AC ↔ case coverage gap detection |
| Run pipeline | `run` | Three layers: static verify → contract run → host framework; no args = full regression |
| Change regression | `regress` / `impact` | Scope affected cases after a change / impact analysis |
| Record defects | `bug` | Defect record/close/list (code vs spec defects) |
| Hard gate | `gate` | Eight quality checks, a hard verdict |
| Reports | `report` / `summary` | Full report / one-page summary |
| Watch growth | `trend` / `status` | Cross-iteration trends / current status |
| Wrap up | `archive` | Archive iteration data (snapshot includes case copies) |
| Configure | `config` | View/set config.yaml |
| Review visuals | `visual-review` | Visual model review: baseline confirmation / diff analysis / semantic assertions (optional reviewer; honestly reports unavailability) |

## Data Boundaries (single writer)

| Directory | Permission | Notes |
|:---|:---|:---|
| `010-requirements/` | Untouched | SpecProt territory |
| `020-specs/` | Read-only | SpecCore's specs — SpecTest's input |
| `030-tasks/_shared/API_CONTRACT.yaml` | Read-only | Shared contract |
| `.spectest/` | Read/write | SpecTest's own territory |

**Report gaps, never invent**: spec gaps (missing AC / skeleton placeholders), contract gaps (missing response schema), element-identifier gaps, cross-platform flow gaps — always reported and bounced back; AI is forbidden to fill them in.

## Layered Asset Semantics

- **Global layer** `GLOBAL/cases/`: the sole home of case assets, reused across iterations ("what to test" is a project-level long-term asset)
- **Iteration layer** `iterations/{iter}/`: execution facts (matrix, index, run records), booked per iteration ("how it went" is iteration-level fact)

Cross-iteration comparison is computed on the fly by `trend` — not stored, not copied. Archive snapshots include case copies to stay self-contained.

## The Six Iron Rules

1. **CLI does deterministic, AI does generative** — skeleton prebuild → AI coverage → CLI validation write-back
2. **AI relay protocol** — exit code 10 + self-contained prompt + `--apply` resume
3. **Shared predicates across consumers** — gap/impact/regress judgments converge in the single `predicates.ts`
4. **Idempotent writes + causal placement** — case IDs anchor to ACs, no timestamp IDs; reports that depend on AI output land only after write-back
5. **Tri-state switches** — pipeline nodes configurable auto/on/off
6. **Intent recognition truth** — dictionary matching first, LLM fallback is a placeholder

## Boundaries (what it does NOT do)

- No requirement specs (that's SpecProt / SpecCore)
- No business code (that's SpecCore execute)
- No built-in implementation-side test runtime — business-logic tests are scheduled on the host framework (vitest/jest/pytest/playwright); asserting the implementation borrows the host's hands
- No built-in vision model — pixel comparison is Playwright's job; "judging by eye" connects to an external vision model via the OpenAI-compatible protocol, and honestly reports unavailability for manual confirmation when not configured
- No guessing specs — missing ACs are reported, never invented

## Sister Tools at a Glance

| | SpecProt | SpecCore | SpecTest |
|:---|:---|:---|:---|
| Mindset | Objects (vague → verifiable) | Blueprints (build by spec) | Evidence (prove the spec is implemented) |
| Input | One-sentence idea / PRD | Finalized requirements | Test specs (TEST.md) |
| Output | Frozen specs | Code + test specs | Cases + execution evidence + gate verdict |
| Territory | `010-requirements/` | `020-specs/` `030-tasks/` | `.spectest/` |
