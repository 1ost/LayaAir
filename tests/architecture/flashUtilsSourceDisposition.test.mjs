import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = path.join(root, "docTool/architecture/flash-utils-source-dispositions.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const index = fs.readFileSync(path.join(root, "src/layaAir/flash/index.ts"), "utf8");

const expected = new Map([
    ["flash.utils.describeType", "native-reflection-bridge"],
    ["flash.utils.Dictionary", "native-collection-bridge"],
    ["flash.utils.flash_proxy", "native-application-rewrite"],
    ["flash.utils.getDefinitionByName", "native-reflection-bridge"],
    ["flash.utils.getQualifiedClassName", "native-reflection-bridge"],
    ["flash.utils.getQualifiedSuperclassName", "native-reflection-bridge"],
    ["flash.utils.Proxy", "native-application-rewrite"],
    ["flash.utils.XML", "native-mutable-xml-bridge"],
]);

function exportedNames(source) {
    const names = new Set();
    for (const match of source.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
        for (const item of match[1].split(",")) {
            const name = item.trim().split(/\s+as\s+/)[1] ?? item.trim().split(/\s+as\s+/)[0];
            if (name) names.add(name);
        }
    }
    return names;
}

test("source-used utility dispositions are exhaustive and fail closed", () => {
    assert.equal(report.schema, "layaair-flash-source-dispositions@1");
    assert.match(report.sourceRevision, /^[0-9a-f]{40}$/);
    assert.match(report.engineBaseRevision, /^[0-9a-f]{40}$/);
    assert.equal(report.dispositions.length, expected.size);
    assert.deepEqual(
        report.dispositions.map(item => item.requestedQName),
        [...expected.keys()],
        "the reviewed QName order and membership are canonical",
    );
    for (const item of report.dispositions) {
        assert.equal(item.disposition, expected.get(item.requestedQName), item.requestedQName);
        assert.ok(Array.isArray(item.sourceEvidence) && item.sourceEvidence.length > 0, item.requestedQName);
        assert.ok(item.sourceEvidence.every(value => /^game-client\/.+\.as:\d+$/.test(value)), item.requestedQName);
        assert.equal(typeof item.reason, "string", item.requestedQName);
        assert.ok(item.reason.length > 40, item.requestedQName);
        assert.match(item.hold, /HOLD/, item.requestedQName);
    }
});

test("the public Flash barrel excludes registry and reflection-only utility subpaths", () => {
    const exports = exportedNames(index);
    for (const name of [
        "describeType", "flash_proxy", "getDefinitionByName",
        "getQualifiedClassName",
        "getQualifiedSuperclassName", "Proxy",
    ]) assert.equal(exports.has(name), false, `${name} must remain a native-port disposition`);
    assert.equal(exports.has("FilterProxy"), true);
    assert.equal(exports.has("Dictionary"), true);
    assert.equal(exports.has("StrictXmlDocument"), true);
    assert.equal(exports.has("XML"), true);
    assert.equal(exports.has("XMLList"), true);
});

test("the admitted replacements stay explicit and avoid Proxy or E4X machinery", () => {
    const filterProxy = fs.readFileSync(path.join(root, "src/layaAir/flash/filters/FilterProxy.ts"), "utf8");
    const strictXml = fs.readFileSync(path.join(root, "src/layaAir/flash/xml/StrictXmlDocument.ts"), "utf8");
    const mutableXml = fs.readFileSync(path.join(root, "src/layaAir/flash/utils/XML.ts"), "utf8");
    const describeType = fs.readFileSync(path.join(root, "src/layaAir/flash/utils/describeType.ts"), "utf8");
    const qualifiedName = fs.readFileSync(path.join(root, "src/layaAir/flash/utils/getQualifiedClassName.ts"), "utf8");
    const authoredBootstrap = fs.readFileSync(path.join(root, "src/extensions/authoredContent/runtime/bootstrap.ts"), "utf8");
    assert.doesNotMatch(filterProxy, /new\s+globalThis\.Proxy|extends\s+Proxy|\[\s*flash_proxy\s*\]/);
    assert.match(filterProxy, /export\s+class\s+FilterProxy\b/);
    assert.match(strictXml, /export\s+class\s+StrictXmlDocument\b/);
    assert.match(mutableXml, /export\s+class\s+XML\b/);
    assert.match(mutableXml, /export\s+class\s+XMLList\b/);
    assert.doesNotMatch(mutableXml, /new\s+globalThis\.Proxy|extends\s+Proxy|flash_proxy|AVM|QName|cinit/);
    assert.match(describeType, /export\s+function\s+describeType\b/);
    assert.match(qualifiedName, /export\s+function\s+getQualifiedClassName\b/);
    assert.doesNotMatch(strictXml,
        /export\s+(?:class|interface|type|const|function)\s+(?:XMLList|E4X|describeType)\b/);
    assert.match(authoredBootstrap, /export\s+function\s+registerAuthoredContentRuntime\b/);
    assert.doesNotMatch(authoredBootstrap, /getDefinitionByName|qualifiedClassName|describeType/);
});
