/**
 * The `response` checker: deterministic assertions over the text the agent produced.
 *
 * agent-evals' ACP trace records only `agent_message_chunk` updates, already joined across
 * consecutive chunks and never including a user or system message. The artifact this checker
 * reads is therefore the concatenation of every `message` entry, which is the same text
 * skill-evals derives as its `response` artifact, minus the bootstrap banner that a WebAgent
 * session carries and an ACP session does not.
 *
 * The rules are ports of `global/skills/markdown-writing/evals/checks.py`, kept comparable
 * with that package's recorded numbers: one rule per expectation, one result per check.
 */

/** @typedef {{ pass: boolean, reason: string }} Verdict */

/** One rule per ported expectation. `subject` is the expectation text it decides. */
const RULES = {
  "inline-math-uses-dollar-syntax": {
    subject: "Uses standard $...$ syntax for inline math.",
    verify(text) {
      const spans = inlineSpans(text);
      const parens = allMatches(/\\\((.*?)\\\)/gs, text).map((match) => match[1]);
      if (parens.length > 0 && spans.length === 0) {
        return fail(`inline math used \\(...\\) instead of $...$: ${excerpt(parens[0])}`);
      }
      if (spans.length === 0) return fail("no $...$ inline math found in the response");
      return pass(`${spans.length} inline span(s), e.g. $${spans[0][1]}`);
    },
  },

  "ascii-space-around-inline-math": {
    subject: "Places ASCII spaces outside the inline math delimiters where they meet Chinese text.",
    verify(text) {
      const spans = inlineSpans(text);
      if (spans.length === 0) {
        return fail("no inline math in the response, so the spacing rule was never exercised");
      }
      // Only the CJK side is enforced: Latin prose around math is a style question, while a
      // delimited run against an ideograph is the failure the rule exists for.
      const offenders = [];
      for (const span of spans) {
        const start = span.index;
        const end = start + span[0].length;
        const before = start > 0 ? text[start - 1] : "";
        const after = end < text.length ? text[end] : "";
        if (CJK.test(before)) offenders.push(`before ${excerpt(span[0])}: ${before}`);
        if (CJK.test(after)) offenders.push(`after ${excerpt(span[0])}: ${after}`);
      }
      if (offenders.length > 0) {
        return fail(`${offenders.length} span(s) touching CJK without a space: ${offenders.slice(0, 2).join("; ")}`);
      }
      return pass(`${spans.length} inline span(s), none touching CJK directly`);
    },
  },

  "display-block-on-own-lines": {
    subject: "Places opening and closing $$ on separate lines with blank lines around the display block.",
    verify(text) {
      const lines = splitLines(text);
      const markers = lines.flatMap((line, index) => (strip(line) === "$$" ? [index] : []));
      if (markers.length === 0) {
        const inlineBlock = /^\s*\$\$.*\$\$\s*$/m.exec(text);
        if (inlineBlock !== null) return fail(`the display block is inline: ${excerpt(strip(inlineBlock[0]))}`);
        return fail("no `$$` block in the response");
      }
      if (markers.length % 2 === 1) return fail(`${markers.length} opening/closing \`$$\` line(s): the block is not closed`);
      const problems = [];
      for (let index = 0; index < markers.length; index += 2) {
        const opening = markers[index];
        const closing = markers[index + 1];
        if (opening > 0 && strip(lines[opening - 1]) !== "") {
          problems.push(`line ${opening + 1}: no blank line before the block`);
        }
        if (closing + 1 < lines.length && strip(lines[closing + 1]) !== "") {
          problems.push(`line ${closing + 2}: no blank line after the block`);
        }
      }
      if (problems.length > 0) return fail(problems.slice(0, 3).join("; "));
      return pass(`${markers.length / 2} block(s), delimiters alone on their lines, blank-line separated`);
    },
  },

  "mid-not-pipe-in-table": {
    subject: "Uses \\mid rather than a raw | for conditional probability inside a Markdown table cell.",
    verify(text) {
      const tableMath = splitLines(text)
        .map(strip)
        .filter((line) => line.startsWith("|"))
        .flatMap((line) => inlineSpans(line).map((span) => span[1]));
      if (tableMath.length === 0) return fail("no math inside a table row, so the rule was never exercised");
      const offenders = tableMath.filter((span) => span.includes("|"));
      if (offenders.length > 0) return fail(`raw | inside table math: ${offenders.slice(0, 2).map(excerpt).join(", ")}`);
      return pass(`${tableMath.length} table math span(s), all using \\mid`);
    },
  },

  "no-math-in-code-or-links": {
    subject: "Does not place math inside code spans, fenced code, or link text.",
    verify(text) {
      const offenders = [];
      for (const [pattern, kind] of [
        [/```.*?```/gs, "fenced code"],
        [/`[^`\n]*`/g, "code span"],
      ]) {
        for (const match of allMatches(pattern, text)) {
          if (match[0].includes("$")) offenders.push(`${kind}: ${excerpt(match[0])}`);
        }
      }
      for (const match of allMatches(/\[([^\]\n]*)\]\([^)\n]*\)/g, text)) {
        if (match[1].includes("$")) offenders.push(`link text: ${excerpt(match[1])}`);
      }
      if (offenders.length > 0) return fail(offenders.slice(0, 3).join("; "));
      return pass("no $ inside code spans, fenced code, or link text");
    },
  },

  "no-math-at-all": {
    subject: "Does not invent inline or display math.",
    verify(text) {
      const found = [...inlineSpans(text).map((span) => span[0]), ...allMatches(/\$\$/g, text).map((match) => match[0])];
      if (found.length > 0) return fail(`${found.length} math construct(s) invented: ${found.slice(0, 3).map(excerpt).join(", ")}`);
      return pass("no math delimiters in the response");
    },
  },

  "no-formatting-commentary": {
    subject: "Does not add commentary about LaTeX, SilverBullet, or formatting rules.",
    verify(text) {
      const lower = text.toLowerCase();
      const found = ["latex", "silverbullet", "delimiter", "$$", "$...$", "code fence", "\\mid"].filter((term) =>
        lower.includes(term),
      );
      if (found.length > 0) return fail(`explains its own formatting: ${found.join(", ")}`);
      return pass("no formatting commentary");
    },
  },

  "response-not-wholly-fenced": {
    subject: "Does not wrap the entire response in a code fence.",
    verify(text) {
      const stripped = strip(text);
      const fences = allMatches(/```/g, stripped).length;
      if (stripped.startsWith("```") && stripped.endsWith("```") && fences === 2) {
        return fail("the entire response is one code fence");
      }
      return pass("the response is not swallowed by a code fence");
    },
  },
};

/** CJK punctuation, unified ideographs and fullwidth forms: the neighbours the spacing rule is about. */
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

/**
 * Python's `str.splitlines()` boundaries, which `String.prototype.split(/\r?\n/)` is not: a bare
 * CR, VT, FF, `\u001c`-`\u001e`, NEL, LS and PS all end a line there. A trailing boundary does not
 * add an empty final element, as in Python.
 */
const LINE_BOUNDARY = /\r\n|[\n\r\v\f\u001c\u001d\u001e\u0085\u2028\u2029]/;

function splitLines(text) {
  if (text === "") return [];
  const lines = text.split(LINE_BOUNDARY);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * Python's `str.strip()` whitespace, which `String.prototype.trim()` is not: it keeps a byte-order
 * mark (`\uFEFF`) and removes `\u001c`-`\u001f` and NEL.
 */
const PY_SPACE = "[\t\n\v\f\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]";
const PY_STRIP = new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`, "g");

function strip(value) {
  return value.replace(PY_STRIP, "");
}

function inlineSpans(text) {
  return allMatches(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, text);
}

function allMatches(pattern, text) {
  return [...text.matchAll(pattern)];
}

function excerpt(value) {
  const text = value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return JSON.stringify(text);
}

function pass(reason) {
  return { pass: true, reason };
}

function fail(reason) {
  return { pass: false, reason };
}

/** Join every agent message the trace recorded, in run order. */
function responseText(trace) {
  return trace.map((entry) => (entry.type === "message" ? entry.text : "")).join("");
}

function invalid(message) {
  return { success: false, error: { issues: [{ path: [], message }] } };
}

/**
 * `params` only has to behave like a Zod schema: the engine substitutes placeholders, then
 * calls `safeParseAsync` once before the agent starts, and reports `issues[].message` on
 * failure. Exactly one rule is selected per check, so a verdict maps to one expectation.
 */
const params = {
  async safeParseAsync(raw) {
    const keys = Object.keys(raw);
    if (keys.length !== 1 || keys[0] !== "check") return invalid("must have exactly one key: check");
    if (typeof raw.check !== "string" || !Object.hasOwn(RULES, raw.check)) {
      return invalid(`check must be one of: ${Object.keys(RULES).join(", ")}`);
    }
    return { success: true, data: { check: raw.check } };
  },
};

export const checker = {
  type: "response",
  params,
  create(parsed) {
    const rule = RULES[parsed.check];
    return {
      // The engine awaits this call and chains `.catch` on the result, so it must be async.
      async check(context) {
        if (context.trace === undefined) {
          return [{ checker: "response", subject: rule.subject, status: "error", reason: "this runner records no trace" }];
        }
        const text = responseText(context.trace);
        if (strip(text) === "") {
          return [
            { checker: "response", subject: rule.subject, status: "error", reason: "the run produced no assistant text" },
          ];
        }
        const verdict = rule.verify(text);
        return [
          { checker: "response", subject: rule.subject, status: verdict.pass ? "pass" : "fail", reason: verdict.reason },
        ];
      },
    };
  },
};
