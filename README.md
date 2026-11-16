# Agent Evals Extensions

Checkers and runners for [agent-evals](../agent-evals) that live outside the toolkit repository,
so a skill's eval package can keep its cases next to the skill while the instrument that judges
them stays shared.

An agent-evals extension root is a directory whose every subdirectory is one implementation with
an `index.ts`, `index.js` or `index.mjs` entry point. Two roots are here:

| Root | `$type` | Purpose |
| --- | --- | --- |
| `checkers/` | `response` | Deterministic assertions over the text the agent produced |
| `runners/` | `scripted` | Serves a canned trace, so a checker is verified without a model call |

```bash
cd ../agent-evals && npm run build
agent-evals run <case.yml> \
  --extension-dir ../agent-evals-extensions/checkers \
  --extension-dir ../agent-evals-extensions/runners
```

A root is named for `run` only: `agent-evals view` does not load extensions, so it cannot resolve
an extension `$type`. Extension `$type` names share one flat namespace with the built-ins, so a
duplicate is a configuration error, not an override.

## `response`

The artifact is the concatenation of every `message` entry in the run's trace, in run order. The
ACP runner records only `agent_message_chunk` updates, already joined across consecutive chunks
and never including a user or system message, so this is the same text skill-evals derives as its
`response` artifact, minus the WebAgent bootstrap banner that an ACP session does not carry.

One check decides one expectation: `check` names the rule, and the result's `subject` is that
rule's expectation text, so a result maps back to the package it came from.

```yaml
checks:
  - $type: response
    check: display-block-on-own-lines
```

| `check` | Expectation it decides |
| --- | --- |
| `inline-math-uses-dollar-syntax` | Uses standard `$...$` syntax for inline math. |
| `ascii-space-around-inline-math` | Places ASCII spaces outside the inline math delimiters where they meet Chinese text. |
| `display-block-on-own-lines` | Places opening and closing `$$` on separate lines with blank lines around the display block. |
| `mid-not-pipe-in-table` | Uses `\mid` rather than a raw `\|` for conditional probability inside a Markdown table cell. |
| `no-math-in-code-or-links` | Does not place math inside code spans, fenced code, or link text. |
| `no-math-at-all` | Does not invent inline or display math. |
| `no-formatting-commentary` | Does not add commentary about LaTeX, SilverBullet, or formatting rules. |
| `response-not-wholly-fenced` | Does not wrap the entire response in a code fence. |

The rules are ports of `global/skills/markdown-writing/evals/checks.py`, so a package's recorded
numbers stay comparable across the two instruments. That includes the text model, not just the
patterns: lines end where Python's `str.splitlines()` ends them (a bare CR, VT, FF, `\u001c`-`\u001e`,
NEL, LS, PS), and a line is trimmed with Python's `str.strip()` whitespace, which keeps a
byte-order mark and removes NEL. `String.prototype.split(/\r?\n/)` and `trim()` would judge the same
response differently, so a test compares each such case against a verdict read from `checks.py`.

A rule that measures something fails when its premise is absent: no inline math means the spacing
rule fails rather than passing vacuously. A restraint ("does not…") passes when there is nothing
to restrain. A runner that records no trace, or a run that produced no assistant text, is an
`error` — never a pass.

## Verification

```bash
node --test
```

The tests drive the built CLI through every rule's passing and failing sample, the no-assistant-text
error, and an unknown rule. They default to a sibling `../agent-evals` checkout; set
`AGENT_EVALS_CLI` to point at another built `dist/cli.js`.

## Known limits

- **`check()` must be async.** agent-evals awaits the call and chains `.catch` on the result, so a
  synchronous `CheckResult[]` fails with `promise.catch is not a function` and leaves the process
  running. The documented contract still reads `check(context) -> CheckResult[]`.
- **Nothing is importable at run time.** `agent-evals` is unpublished and does not resolve itself
  for an extension root, so an extension carries its own code and dependencies. This repository
  needs none: `params` only has to behave like a Zod schema.
- **No engine helpers.** File identity checks, pattern compilation and mock matching are internal;
  an extension reading the workspace does its own containment with `workspace.path` and
  `baseline.path`.
