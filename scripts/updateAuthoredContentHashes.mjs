import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { logicalCompilerSignature } from "./checkAuthoredContentAdmission.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ledgerPath = path.join(root, "docTool/architecture/authored-content-capabilities.json");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
if (ledger.hashMode !== "canonical-lf-utf8")
    throw new Error("Capability ledger must declare hashMode canonical-lf-utf8");

const eventCapability = ledger.capabilities.find(item => item.id === "api.flash.events");
for (const [module, exported] of [
    ["src/layaAir/flash/events/FocusEvent.ts", "FocusEvent"],
    ["src/layaAir/flash/events/IMEEvent.ts", "IMEEvent"],
    ["src/layaAir/flash/events/TextEvent.ts", "TextEvent"],
]) {
    if (!eventCapability.obligations.some(item => item.module === module && item.export === exported))
        eventCapability.obligations.push({ module, export: exported, kind: "class", signature: "", members: [], constructors: [], indexSignatures: [], sha256: "" });
}

const options = compilerOptions();
const program = ts.createProgram({ rootNames: discoverCode(root), options });
const checker = program.getTypeChecker();

for (const capability of ledger.capabilities) {
    const admitted = [...(capability.artifacts || []), ...(capability.obligations || [])];
    for (const obligation of capability.obligations || []) updateSurface(obligation);
    for (const item of admitted)
        item.sha256 = canonicalHash(item.path || item.module);
    const coverage = [...new Set(admitted.map(item => item.sha256))].sort();
    for (const evidence of capability.evidence || []) {
        evidence.sha256 = canonicalHash(evidence.path);
        evidence.covers = coverage;
    }
}
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log("Updated authored-content hashes using canonical-lf-utf8.");

function canonicalHash(relative) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Path escapes repository: ${relative}`);
    const bytes = fs.readFileSync(file);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`Not valid UTF-8: ${relative}`);
    return crypto.createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

function compilerOptions() {
    const fallback = {
        allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true,
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        baseUrl: path.join(root, "src/layaAir"),
    };
    for (const relative of ["tsconfig.json", "src/extensions/tsconfig.json", "src/layaAir/tsconfig.json"]) {
        const file = path.join(root, relative);
        if (!fs.existsSync(file)) continue;
        const loaded = ts.readConfigFile(file, ts.sys.readFile);
        if (loaded.error) throw new Error(`Cannot parse ${relative}`);
        const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(file));
        return { ...fallback, ...parsed.options, allowJs: true, checkJs: false, noEmit: true };
    }
    return fallback;
}

function discoverCode(directory) {
    const skip = new Set([".git", "node_modules", "build", "bin", "coverage", ".idea", ".vscode"]);
    const extensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
    const result = [];
    const visit = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.isDirectory() && skip.has(entry.name)) continue;
            const candidate = path.join(current, entry.name);
            if (entry.isDirectory()) visit(candidate);
            else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(candidate);
        }
    };
    visit(directory);
    return result;
}

function updateSurface(obligation) {
    const source = program.getSourceFile(path.join(root, obligation.module));
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find(symbol => symbol.name === obligation.export);
    if (!exported) throw new Error(`Missing export ${obligation.export} from ${obligation.module}`);
    const declaration = exported.valueDeclaration || exported.declarations?.find(item => !item.getSourceFile().isDeclarationFile);
    if (!declaration) throw new Error(`Missing concrete declaration ${obligation.export}`);
    obligation.signature = logicalCompilerSignature(root, checker.typeToString(
        checker.getTypeOfSymbolAtLocation(exported, declaration), declaration, ts.TypeFormatFlags.NoTruncation));
    if (!ts.isClassDeclaration(declaration)) return;
    const instanceType = checker.getDeclaredTypeOfSymbol(exported);
    const classType = checker.getTypeOfSymbolAtLocation(exported, declaration);
    obligation.heritage = (declaration.heritageClauses || []).flatMap(clause => clause.types.map(type => ({
        kind: clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements",
        signature: logicalCompilerSignature(root, checker.typeToString(
            checker.getTypeAtLocation(type), type, ts.TypeFormatFlags.NoTruncation)),
    }))).sort((a, b) => `${a.kind}:${a.signature}`.localeCompare(`${b.kind}:${b.signature}`));
    const collect = (type, scope) => checker.getPropertiesOfType(type).filter(member => {
        if (scope === "static" && member.name === "prototype") return false;
        const memberDeclaration = member.valueDeclaration || member.declarations?.[0];
        const modifiers = memberDeclaration ? ts.getModifiers(memberDeclaration) || [] : [];
        return !modifiers.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
    }).map(member => {
        const memberDeclaration = member.valueDeclaration || member.declarations?.[0] || declaration;
        const modifiers = ts.getModifiers(memberDeclaration) || [];
        const declarationKinds = (member.declarations || []).map(item => ts.SyntaxKind[item.kind]);
        const accessorKinds = [declarationKinds.includes("GetAccessor") ? "get" : null,
            declarationKinds.includes("SetAccessor") ? "set" : null].filter(Boolean);
        return {
            abstract: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword),
            kind: accessorKinds.length ? accessorKinds.join("+")
                : ts.isMethodDeclaration(memberDeclaration) || ts.isMethodSignature(memberDeclaration) ? "method" : "property",
            name: member.name, scope,
            optional: Boolean(member.flags & ts.SymbolFlags.Optional || memberDeclaration.questionToken),
            readonly: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword),
            signature: logicalCompilerSignature(root, checker.typeToString(
                checker.getTypeOfSymbolAtLocation(member, memberDeclaration), memberDeclaration, ts.TypeFormatFlags.NoTruncation)),
        };
    });
    obligation.members = [...collect(instanceType, "instance"), ...collect(classType, "static")]
        .sort((a, b) => `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`));
    obligation.constructors = classType.getConstructSignatures().map(signature => logicalCompilerSignature(root,
        checker.signatureToString(signature, declaration, ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Construct))).sort();
    obligation.indexSignatures = [["number", instanceType.getNumberIndexType()], ["string", instanceType.getStringIndexType()]]
        .filter(([, type]) => Boolean(type)).map(([key, type]) => ({
            key, signature: logicalCompilerSignature(root, checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation))
        }));
}
