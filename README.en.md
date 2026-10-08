# SpecTest — Test by Spec, Not by Guess

> Let requirements grow their own tests: AI generates cases from specs, pipelines run them for you, gates guard your release.

SpecTest is the **testing base** of the Spec\* ecosystem. It takes the test specs produced by SpecCore (`020-specs/` TEST.md, acceptance criteria AC) as its single source of truth, then generates professional test cases, executes them, and enforces quality gates automatically. Testers no longer mine test cases by hand from hundreds of pages of PRD, and regression testing no longer relies on "I remember this needs testing."

**In one sentence**: hand "what to test" to the spec, "how to test" to AI, and "how did it go" to the machine.

---

## Why SpecTest

Traditional testing pains, resolved one by one:

| Pain | SpecTest's answer |
|:---|:---|
| Cases come from memory; missed coverage is a gamble | Cases are **anchored to acceptance criteria (AC)** — every AC gets case evidence; coverage gaps are detected automatically |
| Requirements change but nobody updates the cases | Spec version anchors: AC changes trigger "incremental top-up" automatically; existing assets are never rebuilt |
| Regression relies on memory; old features decay | Case assets live in the **global layer**; `run` with no args is a full regression across iterations — Q2 still runs Q1's cases |
| "Are we done? Can we ship?" — unclear | `gate` gives a hard verdict: eight checks, fail is fail |
| API, UI, and backend tested in silos | One pipeline runs all three layers: static verify → contract run → host framework |

---

## Quick Start (5 minutes)

```bash
# 1. Install globally
npm install -g spectest-cli   # 命令名仍是 spectest

# 2. Initialize inside a SpecCore project
cd your-project
spectest init --iteration Q1

# 3. Generate cases from specs (CLI scaffolds, AI fills in)
spectest gen --iteration Q1
#    → prints [SPECTEST_PROMPT]; the host AI writes case files per the prompt
spectest gen --iteration Q1 --apply   # validate & register into the trace matrix

# 4. Run the test pipeline
spectest run                # no args = full regression, iteration by iteration
spectest run -i Q1          # or a single iteration
spectest run -i Q1 --priority high --env sit   # SIT smoke: P0 contract cases only
spectest run -i Q1 --env sit,uat               # env matrix: SIT/UAT comparison

# 5. Quality gate (the hard verdict for release)
spectest gate --iteration Q1
```

> 💡 **No coding required**: every command speaks plain language — `spectest ask "run the tests"`, `spectest ask "can the gate pass"` — intent is recognized and executed automatically.

---

## Core Concepts (3-minute read)

### Three-Layer Pipeline: light first, stop on failure

```
Layer 1  Static Verify (zero cost)
         └─ spec skeletons, AC coverage, case completeness… catch the cheap problems first
Layer 2  Contract Run (built-in, really runs)
         └─ what an API looks like is defined by spec → real HTTP + assertions, no app code needed
Layer 3  Host Framework (scheduled run)
         └─ how business logic computes is written by devs → schedule the project's vitest/jest/pytest/playwright
```

**Boundary philosophy**: what asserts the spec, SpecTest does itself; what asserts the implementation, it delegates to the host framework. All three layers normalize into one record — light first, fail-fast.

### Global Layer vs Iteration Layer: assets apart from facts

| | Global layer `GLOBAL/cases/` | Iteration layer `iterations/{iter}/` |
|:---|:---|:---|
| Holds | **Case assets** (what to test) | **Execution facts** (how it went) |
| Lifetime | Project-level, reused across iterations | Per-iteration; Q2 keeps its own books |
| Typical files | `SUITE.yaml`, `cases/*.yaml` | `matrix/trace.yaml`, `runs/RUN-*.json` |

Cases sit on a permanent shelf; iterations only record "how this exam went." **A feature built in Q1 stays guarded in Q2** — `gen` reuses existing cases when the spec is unchanged and only tops up incrementally when ACs change.

### How AI Collaborates: the Relay Protocol

The division of labor: **deterministic things are done by the CLI, creative things by AI**. On `gen`, the CLI scans specs and pre-builds skeletons (SUITE.yaml + SCAFFOLD.md + matrix registration), then prints a relay prompt (exit code 10); the host AI writes case files accordingly; `--apply` validates and writes back. Every step is resumable — no progress is lost.

---

## Command Cheat Sheet

| Command | Purpose | Example |
|:---|:---|:---|
| `ask` | Plain-language smart entry | `spectest ask "run the tests"` |
| `init` | Initialize the test workspace | `spectest init --iteration Q1` |
| `plan` | Generate a test plan | `spectest plan -i Q1 --goal "order export"` |
| `gen` | Generate cases from ACs | `spectest gen -i Q1 --type unit` |
| `api` | Generate API tests from contracts | `spectest api -i Q1` |
| `gap` | Detect coverage gaps | `spectest gap -i Q1` |
| `run` | Run the test pipeline | `spectest run` (no args = full regression) |
| `regress` | Scope the regression after a change | `spectest regress --task Task-001` |
| `impact` | Analyze change impact | `spectest impact --task Task-001` |
| `bug` | Record/close/list defects | `spectest bug --case-id TS-xxx-AC-001 --title "amount precision lost"` |
| `gate` | Quality gate check | `spectest gate -i Q1` |
| `visual-review` | Visual model review (optional) |
| `export` | Export case collections (multi-select / all / by owner) | `spectest export -i Q1 --units "A,B" --format md` | `spectest visual-review -i Q1 --image base.png --question "Matches UI_SPEC?"` |
| `report` | Generate a test report | `spectest report -i Q1` |
| `summary` | Generate a test summary | `spectest summary -i Q1` |
| `trend` | Cross-iteration trend analysis | `spectest trend` |
| `archive` | Archive iteration data | `spectest archive -i Q1` |
| `status` | View test status | `spectest status` |
| `config` | View/set configuration | `spectest config set gate.coverageThreshold 85` |

> `spectest --help` shows the full list anytime; `spectest <command> --help` gives detailed options.

### What the Gate Checks

Eight checks: task linkage, coverage, spec completeness, execution completeness, pass rate, P0 cases, spec drift, unfixed defects. Open defects (recorded via `bug`) block the gate — **fix, then `bug close`, and only then the gate passes**.

---

## Directory Layout

```
.spectest/
├── config.yaml                  # gate thresholds etc.
├── environments/{env}.yaml      # environment config (baseUrl etc.)
├── GLOBAL/cases/                # ★ sole home of case assets (cross-iteration reuse)
│   └── {platform}/{unit}/suites/TS-{platform}-{unit}-{type}/
├── iterations/{iteration}/      # ★ execution facts (matrix/index/run records)
├── plans/  bugs/  reports/  templates/  fixtures/  archive/  trend/
```

---

## How It Fits the Spec\* Ecosystem

SpecTest is the last of the three gates, working with its sister tools:

```
SpecProt (product base)      SpecCore (dev base)         SpecTest (test base)
vague intent → solid spec  →  build by spec, emit TEST.md → generate & run cases by spec
      gate 1 freeze → unitize      gate 2 TEST.md → init       gate 3 gate → execute check
```

- **Data boundaries**: reads `020-specs/` (read-only), writes `.spectest/` (its own territory), never touches requirements or code.
- **Report gaps, never invent**: spec gaps, contract gaps, element-identifier gaps — always reported and bounced back; AI is forbidden to make things up.

---

## FAQ

**Q: I can't code. Can I still use it?**
Yes. Install, then one `spectest ask` in plain language; AI generates the cases — you review and run.

**Q: Will old cases be lost when a new iteration starts?**
No. Case assets live in the global layer `GLOBAL/cases`; archiving never takes them away; `run` with no args regresses across iterations automatically.

**Q: What's the difference between `run` and `regress`?**
`run` is a full regression (or a chosen iteration/suite); `regress` first scopes "which cases does this change affect," then runs that subset — ideal for quick post-change verification.

**Q: The gate failed. Now what?**
Look at which check failed: low coverage → add cases; open defects → fix then `spectest bug close`; spec drift → update the spec in SpecCore, then `gen` again.

**Q: Contract tests vs framework tests?**
Contract tests assert "what the API looks like" (defined by spec) — SpecTest runs real HTTP itself. Framework tests assert "how the code computes" (written by devs) — SpecTest schedules the project's own vitest/jest/pytest/playwright.

---

## Docs

| Document | Content |
|:---|:---|
| [docs/quick-start.en.md](docs/quick-start.en.md) | 5-minute onboarding |
| [docs/workflow.en.md](docs/workflow.en.md) | Testing workflow handbook (complete guide for testers, most detailed) |
| [docs/overview.en.md](docs/overview.en.md) | Product overview: positioning, capabilities, boundaries |
| [docs/command-reference.en.md](docs/command-reference.en.md) | Full command reference |
| [docs/workspace-organization.en.md](docs/workspace-organization.en.md) | Directory layout & dual-layer asset semantics |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture design (deep dive) |
| [CHANGELOG.en.md](CHANGELOG.en.md) | Version changelog |

Chinese documents exist as `.md` pairs.

---

## License

MIT
