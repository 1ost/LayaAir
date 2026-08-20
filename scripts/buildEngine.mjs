import fs from "fs";
import path from "path";
import { glob } from "glob";
import ts from "typescript";
import { rimrafSync } from "rimraf";
import { Project } from "ts-morph";
import { rollup } from "rollup";
import rollupSourcemaps from "rollup-plugin-sourcemaps";
import { glsl } from "./rollupPlugins.mjs";
import { shellExec, onRollupWarn } from "./utils.mjs";
import { allBundles } from "./config.mjs";

const tscOutPath = "./bin/tsc/";
const buildOutPath = "./build/libs/";

const ignoreCircularDependencyWarnings = true;//process.argv.indexOf("-cd") == -1;
const bundleArg = process.argv.find(arg => arg.startsWith("--bundles="));
const requestedBundles = bundleArg
    ? new Set(bundleArg.substring("--bundles=".length).split(",").map(name => name.trim()).filter(Boolean))
    : null;
const skipDeclarations = process.argv.includes("--skip-declarations");
const strictDiagnostics = process.argv.includes("--strict-diagnostics");

const webgpuSubmoduleReady = fs.existsSync("./src/layaAir/laya/RenderDriver/WebGPUDriver/RenderDevice/WebGPURenderEngine.ts");

if (!webgpuSubmoduleReady) {
    console.warn("\x1b[33m[WARNING] WebGPUDriver submodule is not initialized.");
    console.warn("[WARNING] Skipping webgpu_2D and webgpu_3D bundles.");
    console.warn("[WARNING] Run: git submodule update --init src/layaAir/laya/RenderDriver/WebGPUDriver\x1b[0m");
}

buildBundles().then(() => skipDeclarations ? undefined : buildDeclarations());

async function buildBundles() {
    console.log("compiling...");
    console.time("completed");

    rimrafSync(tscOutPath + 'layaAir');
    rimrafSync(tscOutPath + 'extensions');

    const proj = new Project({
        compilerOptions: { removeComments: true, outDir: tscOutPath + 'layaAir' },
        tsConfigFilePath: "./src/layaAir/tsconfig.json"
    });

    await proj.emit();

    let diagnostics = proj.getPreEmitDiagnostics();
    if (requestedBundles && !requestedBundles.has("webgpu_3D")) {
        diagnostics = diagnostics.filter(diagnostic => {
            const fileName = diagnostic.getSourceFile()?.getFilePath().replaceAll("\\", "/") ?? "";
            return !fileName.includes("/WebGPUDriver/3DRenderPass/");
        });
    }
    if (diagnostics.length > 0) {
        console.error(proj.formatDiagnosticsWithColorAndContext(diagnostics));
        if (strictDiagnostics)
            throw new Error(`TypeScript reported ${diagnostics.length} relevant diagnostic(s).`);
    }

    shellExec("npx", ["copyfiles", "-u", "1", "./src/**/*.{glsl,vs,fs,wgsl}", "./bin/tsc/"]);

    console.timeEnd("completed");

    console.log("building bundles...");
    console.time("completed");

    rimrafSync(buildOutPath);

    const rootPath = process.cwd();
    const outPath = path.join(rootPath, tscOutPath);
    const mentry = 'entry-';

    function myMultiInput(libName, files, fileSet) {
        return {
            resolveId(id, importer) {
                if (id.startsWith(mentry))
                    return id;

                if (importer == null)
                    return;

                var ext = path.extname(id);
                if (ext == ".js" || ext == "") {
                    var importfile = path.join(importer.startsWith(mentry) ? rootPath : path.dirname(importer), id);
                    if (ext == "")
                        importfile += ".js";

                    if (!fileSet.has(importfile)) {
                        if (libName == "core")
                            console.warn(`external: ${path.relative(outPath, importer)} ==> ${path.relative(outPath, importfile)}`);
                        return {
                            id: 'Laya',
                            external: true
                        };
                    }
                }
            },

            load(id) {
                if (id.startsWith(mentry))
                    return files.map(ele => `export * from ${JSON.stringify(tscOutPath + ele)};`).join('\n');
            }
        };
    }

    let bundles = webgpuSubmoduleReady
        ? allBundles
        : allBundles.filter(b => b.name !== 'webgpu_2D' && b.name !== 'webgpu_3D');

    if (requestedBundles) {
        const unknown = [...requestedBundles].filter(name => !allBundles.some(bundle => bundle.name === name));
        if (unknown.length > 0)
            throw new Error(`Unknown bundle name(s): ${unknown.join(", ")}`);
        bundles = bundles.filter(bundle => requestedBundles.has(bundle.name));
    }

    for (let bundleDef of bundles) {
        const globalName = bundleDef.globalName || 'Laya';
        if (bundleDef.name === 'flash' && globalName !== 'LayaFlash')
            throw new Error("flash bundle must use the collision-free LayaFlash global");
        let files = await glob(bundleDef.input.map(e => "./layaAir/" + e), { cwd: path.join(process.cwd(), "./src"), realpath: false });
        const excludedFiles = new Set(await glob((bundleDef.excludeInput || []).map(e => "./layaAir/" + e),
            { cwd: path.join(process.cwd(), "./src"), realpath: false }));
        const internalFiles = await glob((bundleDef.internalInput || []).map(e => "./layaAir/" + e),
            { cwd: path.join(process.cwd(), "./src"), realpath: false });
        files = files.filter(ele => !excludedFiles.has(ele));
        files.sort();
        files = files.filter(ele => ele.endsWith(".ts"))
            .map(ele => ele = ele.substring(0, ele.length - 3) + ".js");
        const privateFiles = internalFiles.filter(ele => ele.endsWith(".ts"))
            .map(ele => ele.substring(0, ele.length - 3) + ".js");
        let fileSet = new Set([...files, ...privateFiles].map(ele => path.normalize(outPath + ele)));
        let sourcemap = !bundleDef.name.startsWith("adapter-");

        let config = {
            input: mentry + bundleDef.name,
            output: {
                extend: true,
                globals: {
                    'Laya': 'Laya'
                }
            },
            external: ['Laya'],
            onwarn: onRollupWarn(ignoreCircularDependencyWarnings),
            plugins: [
                myMultiInput(bundleDef.name, files, fileSet),
                rollupSourcemaps(),
                glsl({
                    include: /.*(.glsl|.vs|.fs)$/,
                    sourceMap: sourcemap,
                    compress: true
                })
            ],
        };

        let outFile = path.join(buildOutPath, "laya." + bundleDef.name + ".js");
        let outputOption = {
            file: outFile,
            format: 'iife',
            esModule: false,
            name: globalName,
            globals: {
                'Laya': 'Laya'
            },
            sourcemap: sourcemap
        };
        if (bundleDef.name != "core")
            outputOption.extend = true;

        console.log("created " + bundleDef.name);
        const bundle = await rollup(config);
        await bundle.write(outputOption);

        let content = await fs.promises.readFile(outFile, "utf-8");
        if (globalName === 'Laya') {
            content = content.replace(/var Laya = \(function \(exports.*\)/, "window.Laya = (function (exports)");
            content = content.replace(/}\)\({}, Laya\);/, "})({});");
            content = content.replace(/Laya\$1\./g, "exports.");
            content = content.replace(/\(this.Laya = this.Laya \|\| {}, Laya\)/, "(window.Laya = window.Laya || {}, Laya)");
        } else {
            const rollupAttachment = `(this.${globalName} = this.${globalName} || {}, Laya)`;
            const browserAttachment = `(window.${globalName} = window.${globalName} || {}, Laya)`;
            if (!content.includes(rollupAttachment))
                throw new Error(`${bundleDef.name} bundle lacks its exact ${globalName} global attachment`);
            content = content.replace(rollupAttachment, browserAttachment);
            if (content.includes("window.Laya = (function") || content.includes("(window.Laya = window.Laya || {}, Laya)"))
                throw new Error(`${bundleDef.name} bundle would overwrite the core Laya global`);
        }
        await fs.promises.writeFile(outFile, content);

        if (bundleDef.copy)
            shellExec("npx", ["copyfiles", "-f", ...bundleDef.copy.map(e => "./src/layaAir/" + e), buildOutPath]);
        if (bundleDef.output) {
            let source = Buffer.from(content + "\n", "utf-8");
            for (let k in bundleDef.output) {
                let result = source;
                for (let file of bundleDef.output[k]) {
                    let buf = await fs.promises.readFile("./src/layaAir/" + file);
                    result = Buffer.concat([result, buf]);
                }
                await fs.promises.writeFile(path.join(buildOutPath, k), result);
            }
        }
    }

    console.timeEnd("completed");
}

async function buildDeclarations() {
    console.log("building declarations...");
    console.time("completed");

    rimrafSync("./build/types");
    fs.mkdirSync("./build/types", { recursive: true });

    const proj = new Project({
        compilerOptions: { removeComments: false, declaration: true },
        tsConfigFilePath: "./src/layaAir/tsconfig.json",
    });
    let emitResult = proj.emitToMemory({ emitOnlyDtsFiles: true });

    const dtsContents = [];
    const flashDtsContents = [];
    const dtsContentsTop = [];
    const SyntaxKind = ts.SyntaxKind;

    function processTree(sourceFile, rootNode, replacer) {
        let code = '';
        let cursorPosition = rootNode.pos;

        function skip(node) {
            cursorPosition = node.end;
        }

        function readThrough(node) {
            code += sourceFile.text.slice(cursorPosition, node.pos);
            cursorPosition = node.pos;
        }

        function visit(node) {
            readThrough(node);

            const replacement = replacer(node);

            if (replacement != null) {
                code += replacement;
                skip(node);
            } else {
                ts.forEachChild(node, visit);
            }
        }

        visit(rootNode);
        code += sourceFile.text.slice(cursorPosition, rootNode.end);

        return code;
    }

    const builtinTypeNames = new Set([
        "Float32Array", "Float32ArrayConstructor",
        "Float64Array", "Float64ArrayConstructor",
        "Int8Array", "Int8ArrayConstructor",
        "Int16Array", "Int16ArrayConstructor",
        "Int32Array", "Int32ArrayConstructor",
        "Uint8Array", "Uint8ArrayConstructor",
        "Uint8ClampedArray", "Uint8ClampedArrayConstructor",
        "Uint16Array", "Uint16ArrayConstructor",
        "Uint32Array", "Uint32ArrayConstructor",
        "BigInt64Array", "BigInt64ArrayConstructor",
        "BigUint64Array", "BigUint64ArrayConstructor",
        "ArrayBuffer", "ArrayBufferConstructor",
        "ArrayBufferView", "ArrayBufferLike",
        "DataView", "DataViewConstructor",
        "SharedArrayBuffer",
    ]);

    const internalDeclarationFiles = new Set(allBundles.flatMap(bundle => bundle.internalInput || [])
        .filter(pattern => !/[?*\[\]{}]/.test(pattern))
        .map(file => `/layaAir/${file.replace(/\.ts$/, ".d.ts")}`));
    let files = emitResult.getFiles();
    files.sort((a, b) => a.filePath.localeCompare(b.filePath));
    for (let file of files) {
        if (!file.filePath.endsWith("d.ts"))
            continue;

        const normalizedFilePath = file.filePath.replaceAll("\\", "/");
        if ([...internalDeclarationFiles].some(internal => normalizedFilePath.endsWith(internal)))
            continue;
        const inFlashNamespace = normalizedFilePath.includes("/flash/");
        let inNamespace = !file.filePath.endsWith("Laya.d.ts") && !file.filePath.endsWith("Laya3D.d.ts");
        let code = file.text;
        let declarationFile = ts.createSourceFile(file.filePath, code, ts.ScriptTarget.Latest, true);
        const flashImportAliases = new Map();
        if (inFlashNamespace) {
            for (const statement of declarationFile.statements) {
                if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
                    || !statement.importClause?.namedBindings
                    || !ts.isNamedImports(statement.importClause.namedBindings))
                    continue;
                const moduleName = statement.moduleSpecifier.text.replaceAll("\\", "/");
                const coreImport = moduleName.includes("/laya/") || moduleName.endsWith("/ILaya")
                    || moduleName.endsWith("/Config");
                for (const element of statement.importClause.namedBindings.elements) {
                    const importedName = element.propertyName?.text || element.name.text;
                    flashImportAliases.set(element.name.text, coreImport ? `Laya.${importedName}` : importedName);
                }
            }
        }

        function visitNode(node) {
            if (node.kind == SyntaxKind.ImportDeclaration || node.kind == SyntaxKind.ImportEqualsDeclaration) { //删除所有import语句
                return '';
            } else if (node.kind == SyntaxKind.ExportDeclaration) { //something like "export xx;"
                return '';
            } else if (node.kind == SyntaxKind.ExportKeyword) { //删除所有export语句
                let code = declarationFile.text.slice(node.pos, node.end);
                return code.substring(0, code.length - 6);
            } else if ((node.kind == SyntaxKind.DeclareKeyword || node.kind == SyntaxKind.ModuleDeclaration) && inNamespace) { //删除declare
                return '';
            } else if (node.kind == SyntaxKind.TypeReference) {
                let code = declarationFile.text.slice(node.pos, node.end);
                code = code.substring(1);
                if (!inNamespace && code.indexOf(".") == -1
                    && !code.startsWith("Promise") && code !== "ErrorEvent"
                    && !builtinTypeNames.has(code)
                    && code.length > 1)
                    return " Laya." + code;
                else if (code.startsWith("glTF."))
                    return " " + code.substring(5);
            } else if (inFlashNamespace && ts.isImportTypeNode(node)
                && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
                && node.qualifier) {
                const moduleName = node.argument.literal.text.replaceAll("\\", "/");
                const targetNamespace = moduleName.includes("/laya/") || moduleName.endsWith("/ILaya")
                    || moduleName.endsWith("/Config") ? "Laya" : "";
                const typeArguments = node.typeArguments?.length
                    ? `<${node.typeArguments.map(argument => argument.getText(declarationFile)).join(", ")}>` : "";
                const qualifier = targetNamespace ? `${targetNamespace}.${node.qualifier.getText(declarationFile)}`
                    : node.qualifier.getText(declarationFile);
                return declarationFile.text.slice(node.pos, node.getStart(declarationFile))
                    + `${node.isTypeOf ? "typeof " : ""}${qualifier}${typeArguments}`;
            } else if (inFlashNamespace && ts.isIdentifier(node) && flashImportAliases.has(node.text)
                && node.parent?.name !== node) {
                return declarationFile.text.slice(node.pos, node.getStart(declarationFile))
                    + flashImportAliases.get(node.text);
            }
            //console.log(node.kind, node.parent?.kind, node.text);
        }

        const content = processTree(declarationFile, declarationFile, visitNode).trimEnd();
        if (content.length == 0)
            continue;

        if (inFlashNamespace) {
            let lines = content.split("\n");
            flashDtsContents.push(lines.map(l => "    " + l).join("\n"));
        } else if (inNamespace) {
            let lines = content.split("\n");
            dtsContents.push(lines.map(l => "    " + l).join("\n"));
        } else
            dtsContentsTop.push(content);
    }

    //pretty print
    let code = dtsContentsTop.join("\n\n") +
        "\n\ndeclare namespace Laya {\n\n" +
        dtsContents.join("\n\n") +
        "\n\n}";

    let declarationFile = ts.createSourceFile("./build/types/LayaAir.d.ts", code, ts.ScriptTarget.Latest, true);
    code = ts.createPrinter().printFile(declarationFile);

    fs.writeFileSync("./build/types/LayaAir.d.ts", code);

    let flashCode = "declare namespace LayaFlash {\n\n" +
        flashDtsContents.join("\n\n") +
        "\n\n}";
    const flashDeclarationFile = ts.createSourceFile("./build/types/LayaFlash.d.ts", flashCode,
        ts.ScriptTarget.Latest, true);
    flashCode = ts.createPrinter().printFile(flashDeclarationFile);
    fs.writeFileSync("./build/types/LayaFlash.d.ts", flashCode);
    if (flashDtsContents.length === 0 || /declare namespace Laya\s*\{/.test(flashCode))
        throw new Error("Flash declarations must be present only in the LayaFlash namespace");

    const referencedCoreNames = [...new Set([...flashCode.matchAll(/\bLaya\.([A-Za-z_$][A-Za-z0-9_$]*)/g)]
        .map(match => match[1]))].sort();
    const validationShimPath = "./build/types/.LayaFlash.core-shim.d.ts";
    const validationShim = "declare namespace Laya {\n" + referencedCoreNames
        .map(name => `    type ${name} = any; const ${name}: any;`).join("\n") + "\n}";
    fs.writeFileSync(validationShimPath, validationShim);
    try {
        const declarationProgram = ts.createProgram({
            rootNames: [validationShimPath, "./build/types/LayaFlash.d.ts"],
            options: { noEmit: true, skipLibCheck: false, target: ts.ScriptTarget.ES2020,
                lib: ["lib.es2020.d.ts", "lib.dom.d.ts"], types: [] }
        });
        const declarationDiagnostics = ts.getPreEmitDiagnostics(declarationProgram);
        if (declarationDiagnostics.length > 0) {
            const host = {
                getCanonicalFileName: fileName => fileName,
                getCurrentDirectory: () => process.cwd(),
                getNewLine: () => "\n"
            };
            throw new Error("generated Flash declaration validation failed:\n" +
                ts.formatDiagnosticsWithColorAndContext(declarationDiagnostics, host));
        }
    } finally {
        fs.unlinkSync(validationShimPath);
    }

    shellExec("npx", ["copyfiles", '-f', './src/layaAir/tslibs/*.*', './build/types']);

    console.timeEnd("completed");
}
