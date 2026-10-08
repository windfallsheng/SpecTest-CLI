# Testing Workflow Handbook (Complete Guide for Testers)

> Written for **testers**: no coding required — follow each section and you can complete a full test cycle.
> From "requirements become cases" to "the report lands on your desk": seven stages, every command, parameter and artifact is here.
>
> For a 5-minute run-through, start with [quick-start.en.md](quick-start.en.md); this document is the full-depth walkthrough.

## Contents

1. [Lifecycle of a Test Cycle (Big Picture)](#lifecycle-of-a-test-cycle-big-picture)
2. [Stage 1: Set Up Territory — init](#stage-1-set-up-territory--init)
3. [Stage 2: Grow Cases — gen (AI relay)](#stage-2-grow-cases--gen-ai-relay)
4. [Stage 3: Run Three Layers — run](#stage-3-run-three-layers--run)
5. [Stage 4: Switch Environments (SIT/UAT)](#stage-4-switch-environments-situat)
6. [Stage 5: Enforce the Gate — gate](#stage-5-enforce-the-gate--gate)
7. [Stage 6: Close Defects — bug](#stage-6-close-defects--bug)
8. [Stage 7: Deliver Answers — report / summary / trend](#stage-7-deliver-answers--report--summary--trend)
9. [Complete Example: One Full Cycle](#complete-example-one-full-cycle)
10. [FAQ](#faq)

---

## Lifecycle of a Test Cycle (Big Picture)

```
Set up        Grow cases            Run 3 layers        Enforce gate    Close defects   Deliver answers
  │               │                     │                  │                │                │
init ────────→ gen (AI relay) ────→ run -i Q1 ────────→ gate ───────→ bug ──────────→ report
  │               │                     │                  │                │                │
.spectest/     GLOBAL/cases/       three layers,       eight checks,    record→close    REPORT.md
directory      case assets         light first,        fail is fail     index tracks    summary/trend
skeleton       land on disk        stop on failure                     everything
```

**Two key ideas** (they shape everything):

- **Case assets live apart from execution facts**: cases live permanently in `.spectest/GLOBAL/cases/` (reused across iterations — Q2 inherits Q1); every run's results are booked in `.spectest/iterations/{iteration}/` (each iteration keeps its own books).
- **Three layers, light first**: static verify (zero cost) → contract run (built-in real HTTP) → host framework (schedules the project's own tests). One layer failing stops the chain.

---

## Stage 1: Set Up Territory — init

Inside a SpecCore project root, carve out a dedicated test territory:

```bash
cd your-project
spectest init --iteration Q1        # Q1 = iteration name, matching the SpecCore iteration
```

init creates the `.spectest/` skeleton: `local/` (local state), `tests/{iteration}/`, `reports/` (reports), `templates/` (templates).

**Note**: the environment config directory `environments/` is *not* auto-created — create it by hand when needed (see [Stage 4](#stage-4-switch-environments-situat)).

---

## Stage 2: Grow Cases — gen (AI relay)

### 2.1 One command grows cases

```bash
spectest gen --iteration Q1
```

gen does three things:

1. **Scans specs**: reads the SpecCore iteration's `020-specs/` (acceptance criteria AC in TEST.md, TECH.md, etc.), sliced by platform → unit → type
2. **Pre-builds skeletons**: writes `SUITE.yaml` (suite info) and `SCAFFOLD.md` (generation guide) under `GLOBAL/cases/{platform}/{unit}/suites/TS-.../`, and registers the trace matrix
3. **Prints the relay list**: outputs a full prompt marked `[SPECTEST_PROMPT]` and exits with **exitCode 10** — the signal to the host AI: write case files for each listed suite

### 2.2 Relay and write-back (who writes the cases)

gen only builds skeletons — **the host AI fills in case content**. Division of labor: deterministic work for the CLI, creative work for AI:

```
spectest gen -i Q1          # CLI scans specs, builds skeletons, prints relay list (exitCode 10)
        ↓ host AI receives the relay prompt
AI writes cases/*.yaml      # each case: idempotent ID + anchored AC + four-scenario coverage
        ↓
spectest gen -i Q1 --apply  # validate & write back: format checks + matrix registration (AC ↔ case)
```

Case file conventions (given in full inside the relay prompt):

- **Idempotent case IDs**: `TS-{platform}-{unit}-{type}-AC-{number}`, immutable once created — matrix registration, defect linkage, single-case reruns all rely on it
- **Anchored to AC**: every case must link at least one acceptance criterion (the `relatedAC` field); a case with no AC is an orphan and the gate will stop it
- **Four-scenario coverage**: each AC is covered across happy / error / boundary / edge
- **Frontend platforms get visual regression**: UI cases for h5-mobile / admin-web etc. must emit Playwright visual regression tests alongside (`toHaveScreenshot` pixel assertions); baselines can be confirmed via `visual-review` with a vision model (see 3.4)

### 2.3 Three states of regeneration (re-running gen is safe)

| Scenario | What gen does |
|:---|:---|
| Spec unchanged & cases on disk | **Reuse**: global-layer assets untouched; suite skipped in the relay list |
| Spec changed (ACs added/removed) | **Incremental**: relay list marks "AC changed, top-up incrementally" — only the delta is requested |
| New suite | **Full**: complete skeleton pre-built, enters the relay list |

### 2.4 Fine-grained control

```bash
spectest gen -i Q1 -p h5-mobile          # relay only one platform
spectest gen -i Q1 -u booking            # relay only one unit
spectest gen -i Q1 --type e2e            # only one case type (unit/integration/e2e/api/performance/security)
spectest api -i Q1                       # generate contract-side cases from API_CONTRACT.yaml alone
```

---

## Stage 3: Run Three Layers — run

### 3.1 One command runs three layers

```bash
spectest run -i Q1
```

run is the pipeline executor, pushing through layers light-first, stop-on-failure:

```
┌─ Layer 1/3 Static Verify (zero cost) ──────────────────┐
│  Document-level checks: AC format, case evidence,        │
│  completeness, contract consistency — catches the cheap  │
│  problems in seconds                                     │
├─ Layer 2/3 Contract Run (built-in, really hits APIs) ──┤
│  Real HTTP + status-code assertions on "what the API     │
│  looks like" — needs no app code; auto-skips when no     │
│  environment is configured                               │
├─ Layer 3/3 Host Framework (schedules project tests) ───┤
│  Detects vitest/jest/pytest/playwright and schedules     │
│  them — "how business logic computes" is the devs' tests │
└─────────────────────────────────────────────────────────┘
```

- **Static verify** is the only zero-cost self-check: AC format errors and unanchored cases are caught here
- **Contract run** verifies the API contract surface — after SIT deploys, running it is the fastest main-path probe
- **Host framework** tests were emitted alongside cases during the relay (test names carry caseIds); results flow back into the matrix by caseId

### 3.2 Choose what to run (five-level filter)

```bash
spectest run -i Q1 -s TS-h5-mobile-booking-e2e           # one suite only
spectest run -i Q1 --priority high                       # P0 only (smoke)
spectest run -i Q1 --case TS-xxx-EP-001,TS-xxx-EP-002    # specific cases (rerun failures)
spectest run -i Q1 --retry 2                             # auto-retry failures twice (anti-flaky)
spectest run -i Q1 --args "--grep" "login"               # pass extra args to the host framework
```

`--priority` / `--case` / `--retry` apply to the contract layer (the surface the built-in executor controls); for the host-framework layer use `--args` to pass through the framework's own filtering.

### 3.3 Full regression and change regression

```bash
spectest run                      # no args = full regression: all iterations, layer by layer
spectest regress --task Task-001  # post-change regression: scope affected cases first, then run the subset
spectest impact --task Task-001   # change impact analysis: which cases does one task touch
```

Full regression is the insurance policy: before a Q2 release, a no-args `run` re-verifies Q1's cases too — old features stay guarded.

### 3.4 Visual regression (frontend platforms)

Frontend UI cases emitted Playwright visual regression tests during the relay; layer 3 schedules them, and Playwright does the pixel comparison. For the "needs eyes" parts (baseline confirmation, failure diff analysis), a vision model fills in:

```bash
# Enable a vision model (OpenAI-compatible protocol, any vendor; key via env var, never on disk)
spectest config set visual.enabled true
spectest config set visual.apiKey '${VISUAL_API_KEY}'
spectest config set visual.baseUrl 'https://api.openai.com/v1'

# Baseline confirmation / failure diff analysis
spectest visual-review -i Q1 --image baseline.png --question "Does this screenshot match UI_SPEC?"
spectest visual-review -i Q1 --image base.png --image diff.png --question "Is the diff acceptable?"
```

Without a vision model configured, visual regression still runs (pixel comparison doesn't need AI) — only baseline confirmation becomes manual. **Report the gap, never invent.**

---

### 3.5 The full testing landscape (more than smoke & visuals)

SpecTest's testing landscape is a matrix of "six types × three layers × many scenarios" — smoke and visual are just the two most visible players.

**① Test types (chosen at generation)**: six `gen --type` values — unit / integration / e2e / api / performance / security, plus `spectest api` to emit contract-side cases straight from API_CONTRACT.yaml.

**② Execution forms (each layer is a different kind of testing)**:

| Layer | Kind of testing | What it checks |
|:---|:---|:---|
| Layer 1 static verify | Document-level quality testing (zero cost) | AC format, case evidence, completeness, contract consistency |
| Layer 2 contract run | API contract testing (built-in real HTTP) | Status-code assertions, four-scenario coverage, authenticated calls to real environments |
| Layer 3 host framework | Schedules the project's own tests | Detects vitest/jest/playwright/pytest — unit/integration/e2e/visual regression/performance/security all land here |

**③ Scenario forms (smoke is only one of them)**:

| Scenario | Command | What it is |
|:---|:---|:---|
| Smoke | `run --priority high` | P0 only; main-path probe in minutes |
| Full regression | `run` (no args) | All iterations, layer by layer; old features stay guarded |
| Change regression | `regress --task` | Scope affected cases first, then run the subset |
| Impact analysis | `impact --task` | Which cases does one task touch |
| Env matrix | `run --env sit,uat` | Same cases compared across environments |
| Single-case rerun | `run --case TS-xxx-EP-001` | Pinpoint a failed case |
| Anti-flaky | `run --retry 2` | Auto-retry failures |
| Visual regression | Layer 3 Playwright `toHaveScreenshot` | Pixel comparison (deterministic, no AI needed) |
| Visual review | `visual-review` | Baseline confirmation / diff analysis / semantic assertions (external model) |
| Coverage check | `gap` | AC ↔ case coverage gap detection |

**④ Boundaries (borrow, don't shoulder)**: performance and security cases are generated by SpecTest and executed via layer 3 on the host framework — no built-in load engine or security scanner; the vision model is connected externally via the OpenAI-compatible protocol. What SpecTest can assert precisely it does itself (status codes, formats, coverage); heavy engines are borrowed from the host and the outside.

---

## Stage 4: Switch Environments (SIT/UAT)


### 4.1 Environment files

Environment config is independent of iterations, living in `.spectest/environments/{env}.yaml`, **created by hand** (init does not generate it):

```yaml
# .spectest/environments/sit.yaml
baseUrl: http://10.0.1.20:8080
timeoutMs: 10000
headers:
  Authorization: 'Bearer ${SIT_TOKEN}'    # ${VAR} env placeholders; secrets never on disk
```

| Field | Notes |
|:---|:---|
| `baseUrl` | Required. Contract-run target address |
| `timeoutMs` | Optional, defaults to 5000 ms |
| `headers` | Optional, global request headers (`${VAR}` placeholders supported) |

### 4.2 Stage switching (one command, one front)

```bash
# Test submission: three-layer chain on the test environment
spectest run -i Q1 --env test

# SIT smoke: P0 contract cases only, main-path probe in minutes
spectest run -i Q1 --priority high --env sit

# SIT/UAT comparison regression: env matrix, same cases on both environments
spectest run -i Q1 --env sit,uat

# Single layer, direct: contract layer standalone (fastest env probe)
spectest contract-run -i Q1 --env sit
```

The env matrix is **atomic per environment**: a missing config skips only that row — an unconfigured UAT never blocks SIT results.

### 4.3 CI integration

`templates/ci/` provides GitHub Actions and GitLab CI templates: workflow inputs take the iteration name and environment, then run "P0 smoke + gate". Copy into your project's `.github/workflows/` and it works.

---

## Stage 5: Enforce the Gate — gate

```bash
spectest gate -i Q1
```

The gate is the hard verdict on "can we ship" — **eight checks, fail is fail**:

| Check | What it stops |
|:---|:---|
| Task linkage | Cases not linked to a dev task (orphan cases) |
| Coverage | AC coverage below threshold (default 80%) |
| Spec completeness | Spec docs incomplete (missing ACs / hollow skeletons) |
| Execution completeness | Cases never executed |
| Pass rate | Below threshold (default 90%) |
| P0 cases | High-priority cases failing or unexecuted |
| Spec drift | Cases out of sync with specs (spec changed, cases didn't follow) |
| Unfixed defects | Open defects — **must fix and close first** |

Thresholds are tunable: `spectest config set gate.coverageThreshold 85`.

Failure triage:

```
See which check failed → treat accordingly:
  Coverage low   → add cases
  Open defects   → fix, then spectest bug close <BUG-ID>
  Spec drift     → update the spec in SpecCore → gen again
  Pass rate low  → rerun failures with --case to locate them
```

---

## Stage 6: Close Defects — bug

### 6.1 Record a defect

```bash
spectest bug --case-id TS-booking-service-api-contract-api-EP-001 \
             --title "amount precision lost in order API" \
             --severity high
```

### 6.2 Defect list and closing

```bash
spectest bug list              # default: open only
spectest bug list --status all # everything
spectest bug close BUG-0003    # close after the fix
```

- Each defect is an independent JSON fact file under `.spectest/bugs/`
- `INDEX.md` keeps the full index table (ID / severity / title / linked case / status) — **closing only changes status; the record stays traceable forever**
- The gate's "unfixed defects" check watches this list: anything open blocks the gate

### 6.3 Two defect classes

- **Code defects**: implementation doesn't match spec, linked case fails — fix the code, then close
- **Spec defects**: the spec itself is wrong — fix it in SpecCore, then re-run gen so cases follow

---

## Stage 7: Deliver Answers — report / summary / trend

### 7.1 Detailed report

```bash
spectest report -i Q1
```

Produces `.spectest/reports/REPORT-Q1.md`, three sections:

1. **Overview**: 11 metrics in one table — units/suites/cases, executed vs pending, passed/failed/skipped, pass rate, AC coverage, P0 status, open/closed defects, spec gaps/drift
2. **AC coverage matrix**: per platform per unit, each AC → scenario → proving cases → case status — one glance shows which AC nobody covers
3. **Suite details**: per suite, per case: ID / name / priority / status

### 7.2 One-page summary

```bash
spectest summary -i Q1
```

Produces `summary-Q1.md`: a single quality-metrics table for decision makers (can we ship, and what's short).

### 7.3 Cross-iteration trend

```bash
spectest trend       # pass rate / coverage / defects across iterations — climbing or slipping
spectest status      # current status panel: suites / cases / gaps at a glance
```

---

## Complete Example: One Full Cycle

Iteration Q1 with a booking feature (booking-service backend + h5-mobile frontend), a tester's day:

```bash
# 1. Set up territory
spectest init --iteration Q1

# 2. Grow cases (AI relay: scans all platforms, prints the relay list)
spectest gen --iteration Q1
#    → host AI writes cases/*.yaml for booking-service / h5-mobile per the list
spectest gen --iteration Q1 --apply    # validate & write back, register the matrix

# 3. Configure environments (create two env files by hand)
#    .spectest/environments/sit.yaml / uat.yaml

# 4. Test submission: three-layer chain
spectest run -i Q1 --env test

# 5. SIT smoke: P0 only
spectest run -i Q1 --priority high --env sit

# 6. SIT/UAT comparison regression: env matrix
spectest run -i Q1 --env sit,uat

# 7. Failed case → record defect → fix → close
spectest bug --case-id TS-booking-service-api-contract-api-EP-001 --title "amount precision lost" --severity high
spectest bug close BUG-0001

# 8. Release gate
spectest gate -i Q1

# 9. Deliver answers
spectest report -i Q1    # detailed report
spectest summary -i Q1   # one-page summary
spectest trend           # cross-iteration trend
```

---

## FAQ

**Q: I can't code — who writes the cases?**
gen only builds skeletons; the host AI fills in case content per the relay list — you review, run, and read reports. Every command also speaks plain language: `spectest ask "run the tests"`.

**Q: When Q2 starts, are Q1's cases lost?**
No. Case assets live in the global layer `GLOBAL/cases/`, reused across iterations; a no-args `spectest run` regresses Q1 as well. Archiving (`spectest archive`) snapshots facts and attaches case copies — it never moves assets away.

**Q: UAT isn't configured yet — will it block SIT regression?**
No. The env matrix is atomic per environment — with `--env sit,uat`, a missing UAT config skips only that row; SIT results come out normally.

**Q: Why both static verify and contract run?**
Static verify catches cheap mistakes at zero cost (format, hollow skeletons); contract run verifies the API contract surface without needing app code. Light first — the expensive host-framework run comes last.

**Q: Does visual regression need a vision model?**
No. Pixel comparison is Playwright's job (deterministic computation); the vision model only covers "needs eyes" parts like baseline confirmation and diff analysis. Without one, confirm manually — report the gap, never invent.

---

## More Docs

| Document | Content |
|:---|:---|
| [quick-start.en.md](quick-start.en.md) | 5-minute onboarding (the condensed version of this guide) |
| [command-reference.en.md](command-reference.en.md) | Full command reference |
| [workspace-organization.en.md](workspace-organization.en.md) | Directory layout & dual-layer asset semantics |
| [overview.en.md](overview.en.md) | Product overview: positioning, capabilities, boundaries |
