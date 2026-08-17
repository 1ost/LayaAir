const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");

const pluginRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(pluginRoot, "../../..");

globalThis.window = {};
globalThis.document = {};
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
        fileName: filename,
        compilerOptions: {
            target: ts.ScriptTarget.ES2019,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            experimentalDecorators: true
        }
    });
    module._compile(output.outputText, filename);
};
require(path.join(repositoryRoot, "tests", "authoredContent", "run.ts"));
