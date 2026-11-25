import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const target = process.env.AGENT_EVALS_CLI
  ? new URL("./index.js", pathToFileURL(resolve(process.env.AGENT_EVALS_CLI))).href
  : new URL("../../agent-evals/dist/index.js", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@lelouchhe/agent-evals") {
      return { url: target, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
