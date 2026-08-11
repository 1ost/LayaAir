const ts = require("typescript");
const path = require("path");

const configPath = path.resolve("src/layaAir/tsconfig.json");
const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
const formatHost = {
    getCanonicalFileName: file => file,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
};
if (loaded.error) {
    console.error(ts.formatDiagnosticsWithColorAndContext([loaded.error], formatHost));
    process.exit(1);
}

const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath));
const marker = "/RenderDriver/WebGPUDriver/";
const roots = parsed.fileNames.filter(file => !file.replace(/\\/g, "/").includes(marker));
const options = {
    ...parsed.options,
    noEmit: true,
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
};
const program = ts.createProgram({ rootNames: roots, options });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
    process.exit(1);
}
console.log(`Non-WebGPU LayaAir typecheck passed (${roots.length} roots).`);
