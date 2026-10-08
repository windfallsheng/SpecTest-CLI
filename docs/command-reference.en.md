# Command Reference

> All 17 commands with options and examples. `spectest <command> --help` anytime.

## Global Options

| Option | Notes |
|:---|:---|
| `--lang <locale>` | Language: `zh-CN` (default) or `en-US` |

## ask — plain-language smart entry

Speak naturally; intents are recognized and executed. High confidence runs directly; missing params print `[SPECTEST_NEEDS_INFO]` prompts; low confidence prints suggestions.

```bash
spectest ask "run the tests"
spectest ask "can the gate pass"
spectest ask "record defect case TS-h5-mobile-booking-unit-AC-001 title amount precision lost"
spectest ask --list     # list all supported intents
```

Intent families: run / regress / impact / gap / bug / bug-close / bug-list / gate / report / summary / trend / archive / status / config-set and more (`--list` for the full set).

## init — initialize the test workspace

Creates `.spectest/` (config.yaml, environments, templates, reports…) inside a SpecCore project.

| Option | Notes |
|:---|:---|
| `-f, --force` | Force re-initialization |
| `-i, --iteration <name>` | Iteration name (default: auto-detect from `.speccore/local/context.json`) |

## plan — generate a test plan

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `-g, --goal <goal>` | Iteration goal description |

## gen — generate cases from ACs

Skeleton prebuild + AI relay; existing cases with unchanged specs are reused, changed specs get incremental top-up.

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `-p, --platform <platform>` | Platform filter (standard platform name) |
| `-u, --unit <unit>` | Unit filter (slug or unit name) |
| `-t, --type <type>` | Test type: unit / integration / e2e / api / performance / security (default unit) |
| `--apply` | Write-back mode: zod validation + matrix registration + index rebuild |

```bash
spectest gen -i Q1                    # prebuild → [SPECTEST_PROMPT] → exit code 10
spectest gen -i Q1 --apply            # write-back after AI fills cases
spectest gen -i Q1 --type api         # filter by type
```

## api — generate API tests from contracts

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `-p, --platform <platform>` | Standard platform name (server-side, required) |
| `-n, --name <name>` | Test suite name |

## gap — detect coverage gaps

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `-o, --output <path>` | Report output path |

## run — run the test pipeline

Three layers (static verify → contract run → host framework), light first, stop on failure. **No args = full regression** (every iteration, layer by layer).

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration (default: full regression) |
| `-s, --suite <id>` | Run a specific suite |
| `--pipeline` | Explicit pipeline mode (default is pipeline; kept for compatibility) |
| `--interactive` | Interactive mode (overrides config, confirms each layer) |
| `--env <name>` | Contract environment (default config.pipeline.defaultEnv; comma-separated = env matrix, e.g. `sit,uat`) |
| `--priority <level>` | Priority filter: high/medium/low (high=P0, contract layer only) |
| `--case <ids>` | Case-level filter: idempotent caseIds, comma-separated (contract layer only) |
| `--retry <n>` | Contract-layer retry count on failure (default 0) |
| `--args <extra...>` | Extra args passed to the host framework |

```bash
spectest run                    # full regression
spectest run -i Q1              # single iteration
spectest run -i Q1 -s TS-xxx    # single suite
spectest run --interactive      # confirm per layer
spectest run -i Q1 --priority high --env sit   # SIT smoke: P0 contract cases only
spectest run -i Q1 --env sit,uat               # env matrix: SIT/UAT comparison
```

## regress — regression after a change

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `-t, --task <id>` | Scope regression by changed Task ID |

## contract-run — contract execution (built-in executor)

Real HTTP requests + status-code assertions — the only layer SpectTest runs itself. Callable standalone outside the three-layer chain.

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `--env <name>` | Environment (default test; comma-separated = env matrix, e.g. `sit,uat`) |
| `-p, --platform <name>` | Server platform filter |
| `-s, --suite <id>` | Run a specific suite |
| `--priority <level>` | Priority filter: high/medium/low (high=P0, same as gate) |
| `--case <ids>` | Case-level filter: idempotent caseIds, comma-separated |
| `--retry <n>` | Retry count on failure (default 0, 1+retry attempts total) |

```bash
spectest contract-run -i Q1 --env sit              # full contract run on SIT
spectest contract-run -i Q1 --env sit,uat          # SIT/UAT env matrix
spectest contract-run -i Q1 --priority high        # P0 only (smoke)
spectest contract-run -i Q1 --case TS-xxx-EP-001   # rerun a single case
spectest contract-run -i Q1 --retry 2              # retry twice on failure
```
## visual-review — visual model review (optional reviewer)

Pixel comparison is done by Playwright (deterministic computation); this command covers the "needs eyes" parts — baseline confirmation, failure diff analysis, semantic assertions. Honestly reports unavailability when the visual section is not configured.

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name (defaults to the latest gen/run iteration) |
| `--image <path>` | Image path to review (repeatable: baseline / new / diff) |
| `-q, --question <text>` | Review question (e.g. "Does this screenshot match the UI_SPEC page description?") |
| `-c, --context <text>` | Extra context (UI_SPEC description / AC text) |

```bash
# Enable a visual model (OpenAI-compatible protocol; key via env var, never on disk)
spectest config set visual.enabled true
spectest config set visual.apiKey '${VISUAL_API_KEY}'
spectest config set visual.baseUrl 'https://api.openai.com/v1'
spectest config set visual.model gpt-4o

spectest visual-review -i Q1 --image baseline.png --question "Does this screenshot match UI_SPEC?"
spectest visual-review -i Q1 --image base.png --image diff.png --question "Is the diff an acceptable change?"
```

Verdict: PASS / FAIL / unknown; records land in the iteration layer at `matrix/visual/REVIEW-*.json` (execution facts, per-iteration bookkeeping).

## impact — change impact analysis

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `-p, --platform <name>` | Platform filter |
| `-u, --unit <name>` | Unit filter |

## The gap family

| Command | Options | Notes |
|:---|:---|:---|
| `gap` | `-i, --iteration` / `-o, --output` | AC ↔ case coverage gaps |
| `regress --task <id>` | `-t, --task <id>` | Scope the regression by Task |
| `impact --task <id>` | `-t, --task <id>` | Analyze impact by Task |

## bug — record / close / list defects

```bash
# Record
spectest bug --case-id <caseId> --title <title> [--severity high|medium|low] [--description <desc>]

# Close
spectest bug close <BUG-ID>

# List
spectest bug list [--status open|closed|all]
```

| Option (record) | Notes |
|:---|:---|
| `-c, --case-id <id>` | Failed test case ID |
| `-t, --title <title>` | Defect title |
| `-s, --severity <level>` | Severity: high / medium / low (default medium) |
| `-d, --description <desc>` | Defect description |

Defects come in two kinds: code defects (devs fix) and spec defects (flow back to SpecProt). Open defects block the gate.

## gate — quality gate

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |
| `-t, --task <id>` | Check by Task |
| `--threshold <percent>` | Coverage threshold (default from config.yaml, fallback 80) |
| `--json` | JSON output (machine-readable for SpecCore's execute gate) |

Eight checks: task linkage, coverage, spec completeness, execution completeness, pass rate, P0 cases, spec drift, unfixed defects. Exit code 0 = pass, 1 = blocked.

## report / summary — reports

| Command | Options |
|:---|:---|
| `report` | `-i, --iteration` / `-s, --suite <id>` / `-o, --output <path>` |
| `summary` | `-i, --iteration <name>` |

## trend — cross-iteration trends

| Option | Notes |
|:---|:---|
| `-i, --iterations <list>` | Comma-separated iterations (e.g. Q1,Q2,Q3) |

## archive — archive an iteration

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |

The snapshot bundles copies of the involved units' global cases (GLOBAL-cases) — self-contained and readable.

## status — test status

| Option | Notes |
|:---|:---|
| `-i, --iteration <name>` | Iteration name |

## config — configuration

```bash
spectest config              # view config.yaml
spectest config set <key> <value>    # dotted-path write, e.g. gate.coverageThreshold 85
```

Key settings: `gate.coverageThreshold` (default 80), `gate.passRateThreshold` (default 90), `pipeline.interactive` (default false), `pipeline.defaultEnv` (default test).
