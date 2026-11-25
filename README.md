# Agent Evals Extensions

Example checkers and runners for [agent-evals](https://github.com/LelouchHe/agent-evals), kept
outside the toolkit to demonstrate the extension point. Written against `@lelouchhe/agent-evals`
`0.1.1`.

## Usage

Install dependencies (which brings in `@lelouchhe/agent-evals` for both the CLI and its public
helper exports), then pass the extension roots you need:

```bash
git clone https://github.com/LelouchHe/agent-evals-extensions
cd agent-evals-extensions && npm install

npx agent-evals run <case.yml> \
  --extension-dir ./checkers \
  --extension-dir ./runners
```

Or run with a globally installed `agent-evals` CLI, or a local checkout (`node ../agent-evals/dist/cli.js run ...`).
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
npm test              # runs against the installed @lelouchhe/agent-evals package
npm run test:local    # runs against a built sibling ../agent-evals (both CLI and exports)
```

The tests drive the CLI through each rule's passing and failing sample. `npm run test:local`
redirects both the CLI (`AGENT_EVALS_CLI`) and runtime `@lelouchhe/agent-evals` imports to the
sibling `../agent-evals/dist/`, without modifying `node_modules`. Set `AGENT_EVALS_CLI` to point at
another built `dist/cli.js`.
