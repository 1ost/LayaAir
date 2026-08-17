import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(pluginRoot, "../../..");

process.env.TS_NODE_PROJECT = path.join(pluginRoot, "tsconfig.json");
globalThis.window = {};
globalThis.document = {};
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
require("ts-node/register/transpile-only");
require(path.join(repositoryRoot, "tests", "authoredContent", "run.ts"));
