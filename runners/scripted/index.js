/**
 * A runner that serves a canned agent trace, so a checker can be verified through the real
 * engine without a model call, a harness or a sandbox.
 *
 * It is not part of the instrument: name this root only when testing
 * (`--extension-dir <repo>/scripted`), and never in a recorded sweep.
 */

const params = {
  async safeParseAsync(raw) {
    const keys = Object.keys(raw);
    if (keys.length !== 1 || keys[0] !== "text") return invalid("must have exactly one key: text");
    if (typeof raw.text !== "string") return invalid("text must be a string");
    return { success: true, data: { text: raw.text } };
  },
};

function invalid(message) {
  return { success: false, error: { issues: [{ path: [], message }] } };
}

export const runner = {
  type: "scripted",
  params,
  create(parsed) {
    return {
      async run() {
        return { finalText: parsed.text, diagnostics: [] };
      },
      async stop() {},
      trace() {
        return [{ type: "message", text: parsed.text }];
      },
    };
  },
};
