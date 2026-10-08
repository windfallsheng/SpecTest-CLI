# Quick Start

> For testers: no coding required. Follow along and complete "generate → run → gate" in ten minutes.

## Prerequisites

- Node.js ≥ 18 (check with `node --version`)
- A SpecCore project (with `020-specs/` test specs)
- An AI coding tool for case generation relay (optional — you can write cases by hand)

## Step 0: Install

```bash
npm install -g spectest-cli   # 命令名仍是 spectest
spectest --version   # a version number means success
```

## Step 1: Initialize

Enter the SpecCore project directory (where `.speccore/` and `Iteration-*/` live):

```bash
cd your-project
spectest init --iteration Q1
```

`init` creates the `.spectest/` territory (config, environments, reports…) and records Q1 as the iteration. If `.speccore/local/context.json` exists, the current iteration is auto-detected even without `--iteration`.

## Step 2: Generate Cases (AI Relay)

```bash
spectest gen --iteration Q1
```

What happens:
1. The CLI scans TEST.md for every "unit × platform" under `020-specs/`, extracting the acceptance criteria (AC) list
2. It pre-builds a **skeleton** per unit: `SUITE.yaml` (suite metadata) + `SCAFFOLD.md` (skeleton notes), and registers the trace matrix
3. It prints a `[SPECTEST_PROMPT]` relay prompt and exits with code 10

Hand the relay prompt to your AI coding tool, which writes case files to `cases/TS-…-AC-….yaml`. **Cases must anchor to ACs**: at least one case per AC, covering the scenario quadrants (happy/error/boundary/edge) per the AC scenario.

Then validate and write back:

```bash
spectest gen --iteration Q1 --apply
```

`--apply` validates each case file with zod → registers the trace matrix (AC ↔ case, visible both ways) → rebuilds the index → reports skeleton completeness. "Skeleton completeness 100%" means you're done; missing ACs are listed for top-up.

> **No AI?** Write the yaml cases by hand following `SCAFFOLD.md`, then `--apply` — same result.

### Incremental generation, the nice part

Run `spectest gen` again and watch "reuse, no rebuild":

```
│  To relay  │  0
│  Reused    │  1
[OK] ✅ Global cases exist: 1 suite reused, no regeneration needed
```

Cases already live in the global layer `GLOBAL/cases`; unchanged specs are never redone — changed specs are marked for incremental top-up.

## Step 3: Run the Pipeline

```bash
spectest run              # full regression: every iteration, three layers each
spectest run -i Q1        # a single iteration
spectest run -i Q1 -s TS-h5-mobile-booking-unit   # a single suite
```

Three layers in order, light first, stop on failure:

| Layer | What it does | When skipped |
|:---|:---|:---|
| 1 Static verify | Spec skeletons, AC coverage, case completeness | Never — zero cost |
| 2 Contract run | Real HTTP + assertions (API cases) | Auto-skipped without `environments/test.yaml` |
| 3 Host framework | Schedules the project's vitest/jest/pytest/playwright | Honestly reported "not connected" if absent |

**Contract environment config** (for API testing):

```yaml
# .spectest/environments/test.yaml
name: test
baseUrl: http://localhost:8080
auth:
  type: none        # none / bearer / basic
  token: ""
```

## Step 4: Quality Gate

```bash
spectest gate --iteration Q1
```

Eight checks (task linkage, coverage, spec completeness, execution completeness, pass rate, P0 cases, spec drift, unfixed defects), each with a verdict. **Fail is fail**:

- Exit code 1 = blocked (SpecCore's execute gate reads this verdict — no release)
- `--json` prints a machine-readable verdict for pipeline feedback

Common gate failures and fixes:

| Why it failed | Fix |
|:---|:---|
| Low coverage | `spectest gap -i Q1` to see the gaps, then `gen`/`--apply` |
| Unfixed defects | `spectest bug list` → dev fixes → `spectest bug close <BUG-ID>` |
| Spec drift | Update the spec (TEST.md) in SpecCore → `spectest gen` tops up |

## Step 5: Record Defects (bug loop)

```bash
# Record
spectest bug --case-id TS-h5-mobile-booking-unit-AC-001 \
  --title "amount precision lost" --severity high --description "1.99 order settles as 2.00"

# List (open only by default)
spectest bug list
spectest bug list --status all

# Close after fix
spectest bug close BUG-1790669695502
```

Defects come in two kinds: **code defects** (devs fix) and **spec defects** (the AC is unreasonable — flows back to SpecProt). After `bug close`, the gate's "unfixed defects" check passes.

## Step 6: See the Results

```bash
spectest report -i Q1      # full report (coverage, cases, defects)
spectest summary -i Q1     # one-page summary
spectest trend             # cross-iteration trends (pass-rate curve, coverage growth)
spectest status            # current status panel
spectest archive -i Q1     # archive the iteration (snapshot includes case copies)
```

## Daily Ops (one minute)

```bash
spectest ask "run the tests"              # plain language, intent auto-recognized
spectest ask "can the gate pass"          # equals gate
spectest ask "record defect case TS-xxx-AC-001 title amount precision lost"
```

## In one sentence

**init sets the territory → gen grows cases → run runs three layers → gate guards hard → bug closes defects → report hands in the answer sheet.**

---

> 📖 Want every stage in full depth (AI relay details, env matrix, visual regression, the eight gate checks, report shapes)?
> Read [workflow.en.md](workflow.en.md) — the complete handbook for testers.
