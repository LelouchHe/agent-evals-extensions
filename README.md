# Agent Evals Extensions

Example checkers and runners for [agent-evals](https://github.com/LelouchHe/agent-evals), kept
outside the toolkit to demonstrate the extension point. Written against agent-evals `0.1.0`.

## Usage

Clone both repositories side by side, build the toolkit, then name the roots you need:

```bash
git clone https://github.com/LelouchHe/agent-evals
git clone https://github.com/LelouchHe/agent-evals-extensions
cd agent-evals && npm ci && npm run build

node dist/cli.js run <case.yml> \
  --extension-dir ../agent-evals-extensions/checkers \
  --extension-dir ../agent-evals-extensions/runners
```

`--extension-dir` applies to `run` only — `view` does not load extensions — and an extension
`$type` shares one flat namespace with the built-ins, so a duplicate is a configuration error.

## What is here

| Root        | `$type`    | Purpose                                                                  |
| ----------- | ---------- | ------------------------------------------------------------------------ |
| `checkers/` | `response` | Asserts on the text the agent produced                                   |
| `runners/`  | `scripted` | Answers with a canned trace, so a checker is tested without a model call |

## `response`

The toolkit's built-in `trace` checker (`event: message`) already matches patterns against the
agent's text. `response` is the example of what an extension adds on top: a fixed set of
Markdown-and-math formatting rules too specific to build in. It joins every `message` entry of the
run's trace and asserts on that text. One check is one rule and
produces one result:

```yaml
checks:
  - $type: response
    check: display-block-on-own-lines
```

| `check`                          | What it decides                                             |
| -------------------------------- | ----------------------------------------------------------- |
| `inline-math-uses-dollar-syntax` | `$...$` rather than `\(...\)`                               |
| `ascii-space-around-inline-math` | an ASCII space where inline math meets Chinese text         |
| `display-block-on-own-lines`     | `$$` alone on its lines, with a blank line around the block |
| `mid-not-pipe-in-table`          | `\mid` rather than a raw `\|` in a table cell               |
| `no-math-in-code-or-links`       | no `$` inside code spans, fenced code or link text          |
| `no-math-at-all`                 | invents no inline or display math                           |
| `no-formatting-commentary`       | does not explain LaTeX or its own formatting                |
| `response-not-wholly-fenced`     | does not wrap the whole answer in one code fence            |

A rule whose premise is absent fails rather than passing vacuously — no inline math means the
spacing rule fails — while a restraint passes when there is nothing to restrain. A runner that
records no trace, or a run with no assistant text, is an `error`. The rules follow Python's line and
whitespace semantics, not JavaScript's, and the tests pin that.

## Verify

```bash
node --test
```

The tests drive the built CLI through each rule's passing and failing sample. They expect the
toolkit as a sibling `../agent-evals`; set `AGENT_EVALS_CLI` to use another built `dist/cli.js`.
