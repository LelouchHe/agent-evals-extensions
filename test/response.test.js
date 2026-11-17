import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checker } from "../checkers/response/index.js";

const exec = promisify(execFile);
const cli = process.env.AGENT_EVALS_CLI ?? fileURLToPath(new URL("../../agent-evals/dist/cli.js", import.meta.url));
const extensionArgs = ["checkers", "runners"].flatMap((name) => [
  "--extension-dir",
  fileURLToPath(new URL(`../${name}`, import.meta.url)),
]);

/**
 * One sample per side of each rule. These are the skill-evals expectations this checker
 * ports, so a rule that changes meaning should fail here rather than silently drift.
 */
const samples = [
  {
    rule: "inline-math-uses-dollar-syntax",
    passing: "当 $x > 0$ 时递增。",
    failing: "当 \\(x > 0\\) 时递增。",
  },
  {
    rule: "ascii-space-around-inline-math",
    passing: "当 $x > 0$ 时递增。",
    failing: "当$x > 0$时递增。",
  },
  {
    rule: "display-block-on-own-lines",
    passing: "说明。\n\n$$\ny = x^2\n$$\n\n后文。\n",
    failing: "说明。\n$$\ny = x^2\n$$\n后文。\n",
  },
  {
    rule: "mid-not-pipe-in-table",
    passing: "| 条件 | 概率 |\n| --- | --- |\n| $P(A \\mid B)$ | 0.3 |\n",
    failing: "| 条件 | 概率 |\n| --- | --- |\n| $P(A|B)$ | 0.3 |\n",
  },
  {
    rule: "no-math-in-code-or-links",
    passing: "数学写成 $x$ 即可。\n",
    failing: "数学写成 `$x$` 即可。\n",
  },
  {
    rule: "no-math-at-all",
    passing: "## Setup\n\n1. Install.\n2. Configure.\n3. Run.\n",
    failing: "## Setup\n\nSet $x > 0$ first.\n",
  },
  {
    rule: "no-formatting-commentary",
    passing: "## Setup\n\n1. Install.\n2. Configure.\n3. Run.\n",
    failing: "使用 $...$ 作为行内公式的界定符。\n",
  },
  {
    rule: "response-not-wholly-fenced",
    passing: "## Setup\n\n1. Install.\n",
    failing: "```markdown\n## Setup\n```\n",
  },
];

/** One document: every sample is a named case with a canned answer and its own single check. */
function document() {
  const cases = samples
    .flatMap(({ rule, passing, failing }) => [
      [`${rule}-pass`, rule, passing],
      [`${rule}-fail`, rule, failing],
    ])
    .map(
      ([name, rule, text]) => `  ${name}:
    input: smoke
    runner:
      $type: scripted
      text: ${JSON.stringify(text)}
    checks:
      - $type: response
        check: ${rule}`,
    );
  return `cases:\n${cases.join("\n")}\n`;
}

async function invoke(dir, name, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [
      cli,
      "run",
      join(dir, "case.yml"),
      ...args,
      ...extensionArgs,
      "--results-dir",
      join(dir, "results", name),
    ]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function record(dir, name) {
  const resultsDir = join(dir, "results", name);
  const [runId] = await readdir(resultsDir);
  return JSON.parse(await readFile(join(resultsDir, runId, "result.json"), "utf8"));
}

test("every rule decides its passing and failing sample as ported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-evals-extensions-"));
  try {
    await writeFile(join(dir, "case.yml"), document());
    for (const { rule } of samples) {
      for (const [suffix, expected] of [
        ["pass", "pass"],
        ["fail", "fail"],
      ]) {
        const name = `${rule}-${suffix}`;
        const { code, stderr } = await invoke(dir, name, ["--case", name]);
        assert.notEqual(code, 2, `${name} could not be evaluated: ${stderr}`);
        const { checks } = await record(dir, name);
        assert.equal(checks.length, 1, `${name} must produce one result`);
        assert.equal(checks[0].checker, "response");
        assert.equal(checks[0].status, expected, `${name}: ${checks[0].reason}`);
        assert.ok(checks[0].reason.length > 10, `${name} reported no evidence: ${checks[0].reason}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no assistant text is an error, not a vacuous pass", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-evals-extensions-"));
  try {
    await writeFile(
      join(dir, "case.yml"),
      [
        "input: smoke",
        "runner:",
        "  $type: noop",
        "checks:",
        "  - $type: response",
        "    check: no-math-at-all",
        "",
      ].join("\n"),
    );
    const { code, stderr } = await invoke(dir, "noop", []);
    assert.equal(code, 2);
    const { checks } = await record(dir, "noop");
    assert.equal(checks[0].status, "error");
    assert.match(checks[0].reason, /no assistant text/);
    assert.equal(stderr.trim(), "", "an unevaluable check is reported in the record, not on stderr");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Python's text model is the authority: `str.splitlines()` ends a line at a bare CR, VT, FF,
 * `\u001c`-`\u001e`, NEL, LS and PS, while `str.strip()` keeps a byte-order mark and removes
 * NEL. Every expected verdict below was read from the package's former `checks.py` run under
 * `python3 -B`, so a JS string/line primitive leaking into a rule changes the verdict and fails
 * here.
 */
test("line and whitespace semantics match the Python the rules were ported from", async () => {
  const cases = [
    ["display-block-on-own-lines", "$$\ry=x^2\r$$", "pass"],
    ["mid-not-pipe-in-table", "prose\r| $P(A \\mid B)$ |", "pass"],
    ["mid-not-pipe-in-table", "| $x$ |\rprose $P(A|B)$", "pass"],
    ["display-block-on-own-lines", "prose\n\uFEFF\n$$\nx\n$$", "fail"],
    ["response-not-wholly-fenced", "\uFEFF```markdown\nx\n```", "pass"],
  ];
  for (const [rule, text, expected] of cases) {
    const { data } = await checker.params.safeParseAsync({ check: rule });
    const [result] = await checker.create(data).check({ trace: [{ type: "message", text }] });
    assert.equal(result.status, expected, `${rule} on ${JSON.stringify(text)}: ${result.reason}`);
  }
});

test("an unknown rule is a configuration error before the agent runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-evals-extensions-"));
  try {
    await writeFile(
      join(dir, "case.yml"),
      [
        "input: smoke",
        "runner:",
        "  $type: scripted",
        '  text: "no math"',
        "checks:",
        "  - $type: response",
        "    check: invented-rule",
        "",
      ].join("\n"),
    );
    const { code, stderr } = await invoke(dir, "only", []);
    assert.equal(code, 2);
    assert.match(stderr, /check must be one of: inline-math-uses-dollar-syntax/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
