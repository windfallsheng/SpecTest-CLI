# Changelog

## 0.3.1 (2026-10-08)

- New docs/workflow.md / workflow.en.md: the Testing Workflow Handbook — a full-depth walkthrough for testers (seven stages: init → gen relay → run three layers → env matrix → eight gate checks → bug loop → report/summary/trend), with a complete end-to-end example and FAQ
- README doc navigation and quick-start footers point to the new guide
- workflow handbook gains a "full testing landscape" section: six types × three layers × scenario forms × boundaries (smoke/regression/matrix/rerun/retry/visual/coverage — ten scenarios)
## 0.3.0 (2026-09-29)

### Visual regression & visual model review

- gen relay prompt gains a "visual regression requirements" section: frontend platforms (h5-mobile/admin-web/app/miniapp) must emit Playwright visual regression tests alongside UI cases (test names carry idempotent caseIds, pixel-level `toHaveScreenshot` assertions, baselines via `--update-snapshots`)
- New `visual-review` command (alias vr): visual model review — baseline confirmation / failure diff analysis / semantic assertions; verdicts PASS/FAIL/unknown; records land in the iteration layer at `matrix/visual/REVIEW-*.json`
- New config `visual` section (OpenAI-compatible protocol): `enabled` (off by default) / `baseUrl` / `apiKey` (`${VAR}` env placeholders, keys never on disk) / `model`
- Boundary philosophy: pixel comparison is Playwright's job (deterministic computation); "judging by eye" connects to an external vision model via the OpenAI-compatible protocol and honestly reports unavailability for manual confirmation — no built-in vision model

### Fixes

- Command name mismatch in the relay prompt and error messages (`spectest visual review` → `spectest visual-review`), unified with the actual CLI command name
## 0.2.1 (2026-09-29)

- Fix: `--version` and welcome banner hardcoded version drift (still showed 0.1.0 after bump); now read from package.json dynamically

## 0.2.0 (2026-09-29)

- Four contract-execution capabilities: `--priority` (high=P0 smoke), `--case` (case-level filter), `--retry` (retry on failure), `--env` comma-separated environment matrix (SIT/UAT comparison)
- Both run and contract-run support the new flags; env matrix is per-environment atomic
- New CI templates (templates/ci/: GitHub Actions + GitLab CI) with P0 smoke and gate feedback
- Doc fix: regress section in command-reference had contract-run's option table

## 0.1.0 (2026-09-29)

First officially documented release. Highlights:

### Global Case Library (GLOBAL/cases)

- Case assets moved to their sole home, the global layer `.spectest/GLOBAL/cases/`, reused across iterations; the iteration layer keeps only matrix execution facts
- **gen's three incremental states**: existing cases + unchanged spec → reuse without rebuild (global assets untouched); spec anchor changed → incremental top-up; new unit → full prebuild
- **`run` with no args = full regression**: advances the three-layer pipeline iteration by iteration (no longer falls back to the current iteration)
- **Legacy migration**: iteration-layer suites migrate idempotently to the global layer (move; on conflicts the old dir is backed up as `.legacy-*`)
- Archive snapshots bundle copies of the involved units' global cases (self-contained archives)

### Test Pipeline (run)

- `run` converged as the pipeline executor: three layers static verify → contract run → host framework, light first, stop on failure
- Anti-fake-green semantics: honestly non-zero exit when no host framework is connected
- Dual mode: fully automatic / `--interactive` per-layer confirmation; `--suite` passes through to layer 3

### ask — plain-language entry

- 20 intent-family dictionary (trigger +25 / pattern +35 / priority bonus, two-tier confidence at 70/45)
- High confidence runs directly; missing params print `[SPECTEST_NEEDS_INFO]` prompts; CLI_CMD mapping keeps marked commands reproducible by the host AI

### Documentation

- README rewritten in Chinese & English: tester-friendly (non-technical), 5-minute onboarding + plain-language concepts + FAQ
- docs/ in paired CN/EN: quick-start / overview / command-reference / workspace-organization
- AGENTS.md / ARCHITECTURE.md directory layout synced to the global-layer shape

### Quality

- 115 unit tests green; E2E covers the gen relay loop, incremental reuse, cross-iteration full regression, and legacy migration
