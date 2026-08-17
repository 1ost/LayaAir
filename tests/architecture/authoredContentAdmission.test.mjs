import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    assertAuthoredContentAdmission,
    inspectAuthoredContentAdmission,
    logicalCompilerSignature,
} from "../../scripts/checkAuthoredContentAdmission.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policy = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "scripts/authoredContentAdmission.policy.json"), "utf8"));
const repositoryLedger = JSON.parse(fs.readFileSync(path.join(repositoryRoot, policy.capabilityLedger), "utf8"));
const blockedLedger = JSON.parse(JSON.stringify(repositoryLedger));
for (const capability of blockedLedger.capabilities) {
    capability.status = "blocking";
    capability.blockingReason = `Fixture blocker for ${capability.id}.`;
    delete capability.artifacts;
    delete capability.obligations;
    delete capability.evidence;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function digest(content) {
    return crypto.createHash("sha256").update(content).digest("hex");
}

function canonicalDigest(content) {
    return digest(content.replace(/\r\n?/g, "\n"));
}

function fixture(t, changes = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "laya-authored-admission-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const files = {
        "scripts/authoredContentAdmission.policy.json": JSON.stringify(policy, null, 2),
        "docTool/architecture/authored-content-capabilities.json": JSON.stringify(blockedLedger, null, 2),
        "scripts/config.mjs": "export const allBundles = [];\n",
        "scripts/buildEngine.mjs": "export {};\n",
        "scripts/checkAuthoredContentAdmission.mjs": "export {};\n",
        "tests/architecture/authoredContentAdmission.test.mjs": "export {};\n",
        "package.json": JSON.stringify({
            name: "layaair-fixture",
            private: true,
            scripts: {
                build: "npm run check:authored-content-admission && npm run verify:authored-content-capabilities && node scripts/buildEngine.mjs",
                "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
                "verify:authored-content-capabilities": "node scripts/checkAuthoredContentAdmission.mjs --verify-evidence",
            },
        }, null, 2),
        ...changes,
    };
    for (const [file, content] of Object.entries(files)) {
        if (content === null)
            continue;
        const destination = path.join(root, ...file.split("/"));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content, "utf8");
    }
    return root;
}

function runtimeFiles(extra = {}) {
    return {
        "src/layaAir/laya/utils/ClassUtils.ts": `
            export class ClassUtils {
                static regClass(id: string, constructor: new () => unknown): void { void id; void constructor; }
            }
        `,
        "src/layaAir/laya/authoredContent/core/index.ts": `
            export const NEUTRAL_AUTHORED_CONTENT_SCHEMA = "neutral-authored-content@1" as const;
        `,
        "src/layaAir/laya/authoredContent/layaair/registration.ts": `
            import { ClassUtils } from "../../utils/ClassUtils";
            export const AUTHORED_TIMELINE_CLIP_CLASS_ID = "Laya.AuthoredTimelineClip" as const;
            export class AuthoredTimelineClip {}
            ClassUtils.regClass(AUTHORED_TIMELINE_CLIP_CLASS_ID, AuthoredTimelineClip);
        `,
        ...extra,
    };
}

function failure(root, expression) {
    assert.throws(
        () => assertAuthoredContentAdmission(root),
        error => error instanceof Error && expression.test(error.message),
    );
}

function ledgerWith(id, replacement) {
    const ledger = clone(blockedLedger);
    const index = ledger.capabilities.findIndex(capability => capability.id === id);
    ledger.capabilities[index] = { id, ...replacement };
    return JSON.stringify(ledger, null, 2);
}

test("the consolidated base records every unresolved capability as an explicit blocker", () => {
    const result = assertAuthoredContentAdmission(repositoryRoot);
    assert.equal(result.productionReady, false);
    assert.deepEqual(result.blockingCapabilities, repositoryLedger.capabilities
        .filter(capability => capability.status === "blocking").map(capability => capability.id).sort());
    assert.deepEqual(result.syntheticBlockingCapabilities, []);
});

test("a complete blocked planning fixture passes without claiming production readiness", t => {
    const root = fixture(t);
    const result = assertAuthoredContentAdmission(root);
    assert.equal(result.productionReady, false);
    assert.equal(result.blockingCapabilities.length, policy.requiredCapabilities.length);
});

test("the capability ledger is exhaustive, unique, and status-checked", async t => {
    await t.test("policy cannot omit a minimum capability", t => {
        const weakened = clone(policy);
        weakened.requiredCapabilities = weakened.requiredCapabilities.filter(id => id !== "rendering.mask");
        failure(fixture(t, { "scripts/authoredContentAdmission.policy.json": JSON.stringify(weakened) }), /may not omit rendering\.mask/);
    });
    await t.test("missing", t => {
        const ledger = clone(blockedLedger);
        ledger.capabilities.pop();
        failure(fixture(t, { [policy.capabilityLedger]: JSON.stringify(ledger) }), /missing required capability/);
    });
    await t.test("duplicate", t => {
        const ledger = clone(blockedLedger);
        ledger.capabilities.push(clone(ledger.capabilities[0]));
        failure(fixture(t, { [policy.capabilityLedger]: JSON.stringify(ledger) }), /duplicate capability/);
    });
    await t.test("unknown", t => {
        const ledger = clone(blockedLedger);
        ledger.capabilities[0].id = "unknown.capability";
        failure(fixture(t, { [policy.capabilityLedger]: JSON.stringify(ledger) }), /unknown capability/);
    });
    await t.test("invalid status", t => {
        const ledger = clone(blockedLedger);
        ledger.capabilities[0].status = "ready";
        failure(fixture(t, { [policy.capabilityLedger]: JSON.stringify(ledger) }), /invalid status/);
    });
    await t.test("hash mode is explicit", t => {
        const ledger = clone(blockedLedger);
        ledger.hashMode = "raw-worktree-bytes";
        failure(fixture(t, { [policy.capabilityLedger]: JSON.stringify(ledger) }), /hashMode must be canonical-lf-utf8/);
    });
    await t.test("source code cannot become native execution", t => {
        const ledger = clone(blockedLedger);
        const item = ledger.capabilities.find(capability => capability.id === "source.executable-code");
        Object.assign(item, { status: "native", artifacts: [], evidence: [] });
        const root = fixture(t, {
            [policy.capabilityLedger]: JSON.stringify(ledger),
        });
        failure(root, /source\.executable-code may not be admitted as native/);
    });
});

test("admitted dispositions require concrete artifacts, symbols, and evidence", async t => {
    await t.test("native positive", t => {
        const artifact = "export const transformEvidence = true;";
        const evidence = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { transformEvidence } from "../src/layaAir/laya/display/TransformEvidence.ts";\ntest("native transform", () => { assert.equal(transformEvidence, true); });\n`;
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                status: "native",
                artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", export: "transformEvidence", sha256: digest(artifact) }],
                evidence: [{ path: "tests/transform.test.mjs", test: "native transform", sha256: digest(evidence), capability: "rendering.transform", covers: [digest(artifact)] }],
            }),
            "src/layaAir/laya/display/TransformEvidence.ts": artifact,
            "tests/transform.test.mjs": evidence,
        });
        assert.equal(assertAuthoredContentAdmission(root).productionReady, false);
    });
    await t.test("missing evidence", t => {
        const artifact = "export {};";
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                status: "native",
                artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", sha256: digest(artifact) }],
            }),
            "src/layaAir/laya/display/TransformEvidence.ts": artifact,
        });
        failure(root, /requires evidence/);
    });
    await t.test("placeholder evidence and hash drift cannot clear admission", t => {
        const artifact = "export const transformEvidence = true;";
        const evidence = "export {};\n";
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                status: "native",
                artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", export: "transformEvidence", sha256: "0".repeat(64) }],
                evidence: [{ path: "tests/transform.test.mjs", test: "native transform", sha256: digest(evidence), capability: "rendering.transform", covers: [digest(artifact)] }],
            }),
            "src/layaAir/laya/display/TransformEvidence.ts": artifact,
            "tests/transform.test.mjs": evidence,
        });
        failure(root, /hash drift|named node:test case/);
    });
    await t.test("skipped and unreachable tests are not evidence", t => {
        const artifact = "export const transformEvidence = true;";
        for (const evidence of [
            `import assert from "node:assert/strict"; import test from "node:test"; test("claim", { skip: true }, () => { assert.ok(true); });`,
            `import assert from "node:assert/strict"; import test from "node:test"; if (false) test("claim", () => { assert.ok(true); });`,
        ]) {
            const root = fixture(t, {
                [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                    status: "native",
                    artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", export: "transformEvidence", sha256: digest(artifact) }],
                    evidence: [{ path: "tests/transform.test.mjs", test: "claim", sha256: digest(evidence), capability: "rendering.transform", covers: [digest(artifact)] }],
                }),
                "src/layaAir/laya/display/TransformEvidence.ts": artifact,
                "tests/transform.test.mjs": evidence,
            });
            failure(root, /executable named node:test case/);
        }
    });
    await t.test("shadowed, post-return, and nested assertions are not evidence", t => {
        const artifact = "export const transformEvidence = true;";
        for (const body of [
            "const assert = { ok() {} }; assert.ok(transformEvidence);",
            "return; assert.ok(transformEvidence);",
            "function never() { assert.ok(transformEvidence); }",
            "assert.ok(true || transformEvidence);",
            "if (true) return; assert.ok(transformEvidence);",
        ]) {
            const evidence = `import assert from "node:assert/strict"; import test from "node:test"; import { transformEvidence } from "../src/layaAir/laya/display/TransformEvidence.ts"; test("claim", () => { ${body} });`;
            const root = fixture(t, {
                [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                    status: "native",
                    artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", export: "transformEvidence", sha256: digest(artifact) }],
                    evidence: [{ path: "tests/transform.test.mjs", test: "claim", sha256: digest(evidence), capability: "rendering.transform", covers: [digest(artifact)] }],
                }),
                "src/layaAir/laya/display/TransformEvidence.ts": artifact,
                "tests/transform.test.mjs": evidence,
            });
            failure(root, /executable named node:test case|assertion must import and exercise/);
        }
    });
    await t.test("evidence is capability and implementation bound", t => {
        const artifact = "export const transformEvidence = true;";
        const evidence = `import assert from "node:assert/strict"; import test from "node:test"; test("claim", () => { assert.ok(true); });`;
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                status: "native",
                artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", export: "transformEvidence", sha256: digest(artifact) }],
                evidence: [{ path: "tests/transform.test.mjs", test: "claim", sha256: digest(evidence), capability: "rendering.mask", covers: [] }],
            }),
            "src/layaAir/laya/display/TransformEvidence.ts": artifact,
            "tests/transform.test.mjs": evidence,
        });
        failure(root, /must bind proof to rendering\.transform|must exactly bind/);
    });
    await t.test("resolved TypeScript obligation", t => {
        const implementation = "export function bindTypedHandler(): void {}";
        const evidence = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { bindTypedHandler } from "../src/extensions/authoredContent/typed.ts";\ntest("typed handler", () => { assert.equal(typeof bindTypedHandler, "function"); });\n`;
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("binding.typed-handler", {
                status: "typescript-obligation",
                obligations: [{ module: "src/extensions/authoredContent/typed.ts", export: "bindTypedHandler", kind: "function", signature: "() => void", sha256: digest(implementation) }],
                evidence: [{ path: "tests/typed.test.mjs", test: "typed handler", sha256: digest(evidence), capability: "binding.typed-handler", covers: [digest(implementation)] }],
            }),
            "src/extensions/authoredContent/typed.ts": implementation,
            "tests/typed.test.mjs": evidence,
        });
        assertAuthoredContentAdmission(root);
    });
    await t.test("compiler signatures use repository-relative logical module paths", () => {
        const suffix = '/src/extensions/index").TextField';
        const first = logicalCompilerSignature("D:/worktrees/first", `() => import("D:/worktrees/first${suffix}`);
        const second = logicalCompilerSignature("E:/detached/second", `() => import("E:/detached/second${suffix}`);
        assert.equal(first, '() => import("repo:/src/extensions/index").TextField');
        assert.equal(second, first);
    });
    await t.test("canonical LF hashes admit equivalent CRLF source and evidence", t => {
        const artifactLf = "export const transformEvidence = true;\n";
        const evidenceLf = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { transformEvidence } from "../src/layaAir/laya/display/TransformEvidence.ts";\ntest("canonical bytes", () => { assert.equal(transformEvidence, true); });\n`;
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                status: "native",
                artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", export: "transformEvidence", sha256: canonicalDigest(artifactLf) }],
                evidence: [{ path: "tests/transform.test.mjs", test: "canonical bytes", sha256: canonicalDigest(evidenceLf), capability: "rendering.transform", covers: [canonicalDigest(artifactLf)] }],
            }),
            "src/layaAir/laya/display/TransformEvidence.ts": artifactLf.replace(/\n/g, "\r\n"),
            "tests/transform.test.mjs": evidenceLf.replace(/\n/g, "\r\n"),
        });
        assertAuthoredContentAdmission(root);
    });
    await t.test("missing TypeScript export", t => {
        const implementation = "export function present(): void {}";
        const evidence = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { missing } from "../src/extensions/authoredContent/typed.ts";\ntest("missing export", () => { assert.equal(typeof missing, "function"); });\n`;
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("binding.typed-handler", {
                status: "typescript-obligation",
                obligations: [{ module: "src/extensions/authoredContent/typed.ts", export: "missing", kind: "function", signature: "() => void", sha256: digest(implementation) }],
                evidence: [{ path: "tests/typed.test.mjs", test: "missing export", sha256: digest(evidence), capability: "binding.typed-handler", covers: [digest(implementation)] }],
            }),
            "src/extensions/authoredContent/typed.ts": implementation,
            "tests/typed.test.mjs": evidence,
        });
        failure(root, /export missing does not resolve/);
    });
    await t.test("TypeScript obligation signature is exact", t => {
        const implementation = "export function bindTypedHandler(value: string): number { return value.length; }";
        const evidence = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { bindTypedHandler } from "../src/extensions/authoredContent/typed.ts";\ntest("typed signature", () => { assert.equal(typeof bindTypedHandler, "function"); });\n`;
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("binding.typed-handler", {
                status: "typescript-obligation",
                obligations: [{ module: "src/extensions/authoredContent/typed.ts", export: "bindTypedHandler", kind: "function", signature: "() => void", sha256: digest(implementation) }],
                evidence: [{ path: "tests/typed.test.mjs", test: "typed signature", sha256: digest(evidence), capability: "binding.typed-handler", covers: [digest(implementation)] }],
            }),
            "src/extensions/authoredContent/typed.ts": implementation,
            "tests/typed.test.mjs": evidence,
        });
        failure(root, /expected exact compiler signature/);
    });
    await t.test("verification mode executes hash-bound evidence", t => {
        const artifact = "export const transformEvidence = true;";
        const evidence = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { transformEvidence } from "../src/layaAir/laya/display/TransformEvidence.ts";\ntest("failing behavior", () => { assert.equal(transformEvidence, false, "behavior failed"); });\n`;
        const root = fixture(t, {
            [policy.capabilityLedger]: ledgerWith("rendering.transform", {
                status: "native",
                artifacts: [{ path: "src/layaAir/laya/display/TransformEvidence.ts", export: "transformEvidence", sha256: digest(artifact) }],
                evidence: [{ path: "tests/transform.test.mjs", test: "failing behavior", sha256: digest(evidence), capability: "rendering.transform", covers: [digest(artifact)] }],
            }),
            "src/layaAir/laya/display/TransformEvidence.ts": artifact,
            "tests/transform.test.mjs": evidence,
        });
        const childEnvironment = { ...process.env };
        delete childEnvironment.NODE_TEST_CONTEXT;
        const execution = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts/checkAuthoredContentAdmission.mjs"), root, "--verify-evidence"], {
            encoding: "utf8",
            env: childEnvironment,
        });
        assert.notEqual(execution.status, 0, `${execution.stdout}\n${execution.stderr}`);
        assert.match(`${execution.stdout}${execution.stderr}`, /behavior failed|evidence failed/);
    });
});

test("runtime identity is compiler-resolved and singular", async t => {
    await t.test("valid dormant runtime", t => {
        assertAuthoredContentAdmission(fixture(t, runtimeFiles()));
    });
    await t.test("fake ClassUtils", t => {
        const files = runtimeFiles({
            "src/layaAir/laya/authoredContent/layaair/registration.ts": `
                const ClassUtils = { regClass(_id: string, _constructor: unknown): void {} };
                export const AUTHORED_TIMELINE_CLIP_CLASS_ID = "Laya.AuthoredTimelineClip" as const;
                export class AuthoredTimelineClip {}
                ClassUtils.regClass(AUTHORED_TIMELINE_CLIP_CLASS_ID, AuthoredTimelineClip);
            `,
        });
        failure(fixture(t, files), /does not resolve to engine ClassUtils\.regClass/);
    });
    await t.test("duplicate identity literal", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/layaair/duplicate.ts": "export const duplicate = 'Laya.AuthoredTimelineClip';",
        })), /identity literal must occur exactly once/);
    });
    await t.test("alternate identity", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/layaair/alternate.ts": "export const alternate = 'Laya.OtherAuthoredTimeline';",
        })), /alternate runtime identities are forbidden/);
    });
    await t.test("registration wrapper", t => {
        const files = runtimeFiles({
            "src/layaAir/laya/authoredContent/layaair/registration.ts": `
                import { ClassUtils } from "../../utils/ClassUtils";
                export const AUTHORED_TIMELINE_CLIP_CLASS_ID = "Laya.AuthoredTimelineClip" as const;
                export class AuthoredTimelineClip {}
                const register = ClassUtils.regClass;
                register(AUTHORED_TIMELINE_CLIP_CLASS_ID, AuthoredTimelineClip);
            `,
        });
        failure(fixture(t, files), /expected exactly one canonical class registration/);
    });
});

test("compiler-resolved layer edges cover every module syntax", async t => {
    const cases = {
        "import": `import "../../../../extensions/authoredContent/tool";`,
        "type import": `import type { Tool } from "../../../../extensions/authoredContent/tool"; export type Value = Tool;`,
        "export-from": `export * from "../../../../extensions/authoredContent/tool";`,
        "import-equals": `import tool = require("../../../../extensions/authoredContent/tool"); export { tool };`,
        "dynamic import": `export const load = () => import("../../../../extensions/authoredContent/tool");`,
        "require": `require("../../../../extensions/authoredContent/tool");`,
        "require.resolve": `require.resolve("../../../../extensions/authoredContent/tool");`,
        "aliased require": `const load = require; load("../../../../extensions/authoredContent/tool");`,
        "module.createRequire": `import * as module from "node:module"; const load = module.createRequire(import.meta.url); load("../../../../extensions/authoredContent/tool");`,
        "aliased createRequire import": `import { createRequire as makeRequire } from "node:module"; const load = makeRequire(import.meta.url); load("../../../../extensions/authoredContent/tool");`,
        "two-stage createRequire alias": `import { createRequire as makeRequire } from "node:module"; const factory = makeRequire; const load = factory(import.meta.url); load("../../../../extensions/authoredContent/tool");`,
        "destructured createRequire": `import * as module from "node:module"; const { createRequire: factory } = module; const load = factory(import.meta.url); load("../../../../extensions/authoredContent/tool");`,
        "computed createRequire": `import * as module from "node:module"; const factory = module["createRequire"]; const load = factory(import.meta.url); load("../../../../extensions/authoredContent/tool");`,
        "module.require": `declare const module: { require(value: string): unknown }; module.require("../../../../extensions/authoredContent/tool");`,
        "require.call": `require.call(null, "../../../../extensions/authoredContent/tool");`,
        "require.apply": `require.apply(null, ["../../../../extensions/authoredContent/tool"]);`,
        "require.bind": `const load = require.bind(null); load("../../../../extensions/authoredContent/tool");`,
        "Reflect.apply require": `Reflect.apply(require, null, ["../../../../extensions/authoredContent/tool"]);`,
    };
    for (const [name, source] of Object.entries(cases)) {
        await t.test(name, t => {
            const root = fixture(t, runtimeFiles({
                "src/layaAir/laya/authoredContent/core/reverse.ts": source,
                "src/extensions/authoredContent/tool.ts": "export interface Tool {}",
            }));
            failure(root, /core .* reaches editor module/);
        });
    }
});

test("TypeScript path aliases cannot disguise a reverse layer edge", t => {
    const root = fixture(t, runtimeFiles({
        "tsconfig.json": JSON.stringify({
            compilerOptions: {
                baseUrl: ".",
                paths: { "@editor/*": ["src/extensions/authoredContent/*"] },
            },
        }),
        "src/layaAir/laya/authoredContent/core/alias.ts": "import '@editor/tool';",
        "src/extensions/authoredContent/tool.ts": "export {};",
    }));
    failure(root, /core import reaches editor module/);
});

test("computed runtime loading fails closed while a shadowed require is inert", async t => {
    await t.test("computed import", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/computed.ts": "const suffix = 'tool'; export const load = () => import('./' + suffix);",
        })), /dynamic import must use a direct string literal/);
    });
    await t.test("shadowed require", t => {
        assertAuthoredContentAdmission(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/shadowed.ts": "export function invoke(require: (value: string) => void, value: string): void { require(value); }",
        })));
    });
    await t.test("syntax error", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/broken.ts": "export const = 1;",
        })), /TypeScript syntax error/);
    });
});

test("source adapters are editor-only and executable source formats are never admitted", async t => {
    await t.test("offline adapter positive", t => {
        assertAuthoredContentAdmission(fixture(t, {
            "src/extensions/authoredContent/offlineAdapters/SwfXmlSourceAdapter.ts": "export class SwfXmlSourceAdapter {}",
        }));
    });
    await t.test("editor may consume an offline adapter", t => {
        assertAuthoredContentAdmission(fixture(t, {
            "src/extensions/authoredContent/offlineAdapters/SwfXmlSourceAdapter.ts": "export class SwfXmlSourceAdapter {}",
            "src/extensions/authoredContent/EnvMain.ts": "import { SwfXmlSourceAdapter } from './offlineAdapters/SwfXmlSourceAdapter'; export const adapter = new SwfXmlSourceAdapter();",
        }));
    });
    await t.test("source adapter outside lane", t => {
        failure(fixture(t, {
            "src/extensions/authoredContent/SwfXmlSourceAdapter.ts": "export class SwfXmlSourceAdapter {}",
        }), /source-format .* outside the editor-only adapter lane|source-format adapters must live/);
    });
    await t.test("interface implementation outside lane", t => {
        failure(fixture(t, {
            "src/extensions/authoredContent/contracts.ts": "export interface SourceAdapter { parse(): void; }",
            "src/extensions/authoredContent/hidden.ts": "import { SourceAdapter } from './contracts'; export class Hidden implements SourceAdapter { parse(): void {} }",
        }), /SourceAdapter implementations must live/);
    });
    await t.test("executable source import", t => {
        failure(fixture(t, {
            "src/extensions/authoredContent/offlineAdapters/source.ts": "export const loadAbc = () => import('./executor');",
            "src/extensions/authoredContent/offlineAdapters/executor.ts": "export {};",
        }), /executable source-format/);
    });
});

test("the universal Flash API bridge is distinct from authored-asset compatibility", async t => {
    await t.test("source-visible API adapter positive", t => {
        const implementation = "export class FlashSprite { static readonly DEFAULT_VISIBLE: boolean = true; readonly visible: boolean = true; setPosition(x: number, y: number): void { void x; void y; } }";
        const evidence = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { FlashSprite } from "../src/layaAir/flash/display/Sprite.ts";\ntest("display signature", () => { assert.equal(new FlashSprite().visible, true); });\n`;
        const ledger = clone(blockedLedger);
        const capability = ledger.capabilities.find(item => item.id === "api.flash.display");
        Object.assign(capability, {
            status: "typescript-obligation",
            obligations: [{ module: "src/layaAir/flash/display/Sprite.ts", export: "FlashSprite", kind: "class", signature: "typeof FlashSprite", constructors: ["new (): FlashSprite"], indexSignatures: [], members: [{ abstract: false, kind: "property", name: "DEFAULT_VISIBLE", scope: "static", optional: false, readonly: true, signature: "boolean" }, { abstract: false, kind: "method", name: "setPosition", scope: "instance", optional: false, readonly: false, signature: "(x: number, y: number) => void" }, { abstract: false, kind: "property", name: "visible", scope: "instance", optional: false, readonly: true, signature: "boolean" }], sha256: digest(implementation) }],
            evidence: [{ path: "tests/flash-display.test.mjs", test: "display signature", sha256: digest(evidence), capability: "api.flash.display", covers: [digest(implementation)] }],
        });
        delete capability.blockingReason;
        assertAuthoredContentAdmission(fixture(t, {
            [policy.capabilityLedger]: JSON.stringify(ledger),
            "src/layaAir/flash/display/Sprite.ts": implementation,
            "tests/flash-display.test.mjs": evidence,
        }));
    });
    await t.test("class accessors, abstract/static surface, and index signatures are exact", t => {
        const implementation = "export class FlashSprite { get visible(): boolean { return true; } [key: string]: unknown; }";
        const evidence = `import assert from "node:assert/strict"; import test from "node:test"; import { FlashSprite } from "../src/layaAir/flash/display/Sprite.ts"; test("surface", () => { assert.equal(new FlashSprite().visible, true); });`;
        const ledger = clone(blockedLedger);
        const capability = ledger.capabilities.find(item => item.id === "api.flash.display");
        Object.assign(capability, {
            status: "typescript-obligation",
            obligations: [{ module: "src/layaAir/flash/display/Sprite.ts", export: "FlashSprite", kind: "class", signature: "typeof FlashSprite", constructors: ["new (): FlashSprite"], indexSignatures: [], members: [{ abstract: false, kind: "property", name: "visible", scope: "instance", optional: false, readonly: false, signature: "boolean" }], sha256: digest(implementation) }],
            evidence: [{ path: "tests/flash-display.test.mjs", test: "surface", sha256: digest(evidence), capability: "api.flash.display", covers: [digest(implementation)] }],
        });
        delete capability.blockingReason;
        failure(fixture(t, {
            [policy.capabilityLedger]: JSON.stringify(ledger),
            "src/layaAir/flash/display/Sprite.ts": implementation,
            "tests/flash-display.test.mjs": evidence,
        }), /members|indexSignatures/);
    });
    await t.test("editor may consume the source-visible API bridge", t => {
        assertAuthoredContentAdmission(fixture(t, {
            "src/layaAir/flash/display/Sprite.ts": "export class Sprite {}",
            "src/extensions/authoredContent/preview.ts": "import type { Sprite } from '../../layaAir/flash/display/Sprite'; export type Preview = Sprite;",
        }));
    });
    await t.test("AVM machinery forbidden", t => {
        failure(fixture(t, {
            "src/layaAir/flash/display/Runtime.ts": "export function resolveQName(): void {}",
        }), /Flash API bridge may not contain ABC\/AVM\/QName/);
    });
    await t.test("authored asset reader forbidden", t => {
        failure(fixture(t, {
            "src/layaAir/flash/display/SwfAssetReader.ts": "export class SwfAssetReader {}",
        }), /may not contain authored-asset readers/);
    });
    await t.test("neutral-named authored asset reader forbidden", t => {
        failure(fixture(t, {
            "src/layaAir/flash/display/MovieAssetReader.ts": "export class MovieAssetReader { read(): void {} }",
        }), /authored-asset reader\/parser/);
    });
    await t.test("ordinary API traits property is not AVM machinery", t => {
        assertAuthoredContentAdmission(fixture(t, {
            "src/layaAir/flash/display/DisplayObject.ts": "export class DisplayObject { traits = 0; }",
        }));
    });
    await t.test("singular AVM Trait class is forbidden", t => {
        failure(fixture(t, {
            "src/layaAir/flash/display/Trait.ts": "export class Trait {}",
        }), /AVM-style trait class/);
    });
    await t.test("class-expression readers, loaders, and traits are forbidden", t => {
        for (const source of [
            "export const Trait = class {};",
            "export const MovieAssetReader = class { read(): void {} };",
            "export const MovieAssetLoader = class { load(): void {} };",
        ])
            failure(fixture(t, { "src/layaAir/flash/display/Hidden.ts": source }), /trait class|authored-asset reader\/parser/);
        for (const source of [
            "export const MovieAssetLoader = class Implementation {};",
            "export const Trait = class Implementation {};",
        ])
            failure(fixture(t, { "src/layaAir/flash/display/Named.ts": source }), /trait class|authored-asset reader\/parser/);
    });
    await t.test("function and object authored decoders are forbidden", t => {
        for (const source of [
            "export function decodeAuthoredTimeline(bytes: Uint8Array): void { void bytes; }",
            "export const authoredTimelineDecoder = { decode(bytes: Uint8Array): void { void bytes; } };",
        ])
            failure(fixture(t, { "src/layaAir/flash/display/Decoder.ts": source }), /legacy authored reader\/decoder surface|forbidden clean-break/);
    });
    await t.test("source-visible getQualifiedClassName remains allowed", t => {
        assertAuthoredContentAdmission(fixture(t, {
            "src/layaAir/flash/utils/getQualifiedClassName.ts": "export function getQualifiedClassName(value: unknown): string { return typeof value; }",
        }));
    });
    await t.test("qualified-name machinery remains forbidden", t => {
        failure(fixture(t, {
            "src/layaAir/flash/utils/QualifiedNameResolver.ts": "export class QualifiedNameResolver {}",
        }), /QName|trait machinery/);
    });
    await t.test("new Flash namespace must be declared and ledgered", t => {
        failure(fixture(t, {
            "src/layaAir/flash/geom/Point.ts": "export class Point {}",
        }), /undeclared Flash API namespace flash\.geom/);
    });
    await t.test("camel-case Flash namespace and root barrel are supported when ledgered", t => {
        const extendedPolicy = clone(policy);
        extendedPolicy.flashApiNamespaces.push("flash.display3D");
        extendedPolicy.requiredCapabilities.push("api.flash.display3D");
        const ledger = clone(blockedLedger);
        ledger.capabilities.push({ id: "api.flash.display3D", status: "blocking", blockingReason: "Awaiting the native display3D API implementation." });
        assertAuthoredContentAdmission(fixture(t, {
            "scripts/authoredContentAdmission.policy.json": JSON.stringify(extendedPolicy),
            [policy.capabilityLedger]: JSON.stringify(ledger),
            "src/layaAir/flash/index.ts": "export * from './display3D/Context3D';",
            "src/layaAir/flash/display3D/Context3D.ts": "export class Context3D {}",
        }));
    });
    await t.test("bridge cannot depend on authored runtime", t => {
        failure(fixture(t, {
            ...runtimeFiles(),
            "src/layaAir/flash/display/Sprite.ts": "export * from '../../laya/authoredContent/core';",
        }), /flash-api export-from reaches core/);
    });
    await t.test("reachable bridge files require exact capability ownership", t => {
        failure(fixture(t, {
            "scripts/config.mjs": "export const allBundles = [{ name: 'flash', input: ['flash/display/**/*.*'] }];",
            "src/layaAir/flash/display/Unowned.ts": "export class Sprite {}",
        }), /not hash\/surface-owned/);
    });
    await t.test("Flash native disposition cannot bypass API obligations", t => {
        const implementation = "export class FlashSprite {}";
        const evidence = `import assert from "node:assert/strict"; import test from "node:test"; import { FlashSprite } from "../src/layaAir/flash/display/Sprite.ts"; test("surface", () => { assert.equal(typeof FlashSprite, "function"); });`;
        const ledger = clone(blockedLedger);
        const capability = ledger.capabilities.find(item => item.id === "api.flash.display");
        Object.assign(capability, {
            status: "native",
            artifacts: [{ path: "src/layaAir/flash/display/Sprite.ts", export: "FlashSprite", sha256: digest(implementation) }],
            evidence: [{ path: "tests/flash-display.test.mjs", test: "surface", sha256: digest(evidence), capability: "api.flash.display", covers: [digest(implementation)] }],
        });
        delete capability.blockingReason;
        failure(fixture(t, {
            [policy.capabilityLedger]: JSON.stringify(ledger),
            "src/layaAir/flash/display/Sprite.ts": implementation,
            "tests/flash-display.test.mjs": evidence,
        }), /requires a TypeScript obligation/);
    });
    await t.test("namespace ownership cannot be cross-wired", t => {
        const implementation = "export function onEvent(): void {}";
        const evidence = `import assert from "node:assert/strict"; import test from "node:test"; import { onEvent } from "../src/layaAir/flash/events/Event.ts"; test("surface", () => { assert.equal(typeof onEvent, "function"); });`;
        const ledger = clone(blockedLedger);
        const capability = ledger.capabilities.find(item => item.id === "api.flash.display");
        Object.assign(capability, {
            status: "typescript-obligation",
            obligations: [{ module: "src/layaAir/flash/events/Event.ts", export: "onEvent", kind: "function", signature: "() => void", sha256: digest(implementation) }],
            evidence: [{ path: "tests/flash-event.test.mjs", test: "surface", sha256: digest(evidence), capability: "api.flash.display", covers: [digest(implementation)] }],
        });
        delete capability.blockingReason;
        failure(fixture(t, {
            [policy.capabilityLedger]: JSON.stringify(ledger),
            "src/layaAir/flash/events/Event.ts": implementation,
            "tests/flash-event.test.mjs": evidence,
        }), /may only own modules in Flash namespace display/);
    });
    await t.test("every public bridge export and root barrel declaration is owned", t => {
        const implementation = "export class FlashSprite { visible = true; } export class FlashMovieClip {}";
        const evidence = `import assert from "node:assert/strict"; import test from "node:test"; import { FlashSprite } from "../src/layaAir/flash/display/Sprite.ts"; test("surface", () => { assert.equal(new FlashSprite().visible, true); });`;
        const ledger = clone(blockedLedger);
        const capability = ledger.capabilities.find(item => item.id === "api.flash.display");
        Object.assign(capability, {
            status: "typescript-obligation",
            obligations: [{ module: "src/layaAir/flash/display/Sprite.ts", export: "FlashSprite", kind: "class", signature: "typeof FlashSprite", constructors: ["new (): FlashSprite"], indexSignatures: [], members: [{ abstract: false, kind: "property", name: "visible", scope: "instance", optional: false, readonly: false, signature: "boolean" }], sha256: digest(implementation) }],
            evidence: [{ path: "tests/flash-display.test.mjs", test: "surface", sha256: digest(evidence), capability: "api.flash.display", covers: [digest(implementation)] }],
        });
        delete capability.blockingReason;
        failure(fixture(t, {
            [policy.capabilityLedger]: JSON.stringify(ledger),
            "scripts/config.mjs": "export const allBundles = [{ name: 'flash', input: ['flash/display/**/*.*'] }];",
            "src/layaAir/flash/display/Sprite.ts": implementation,
            "tests/flash-display.test.mjs": evidence,
        }), /public Flash API export FlashMovieClip lacks/);
        failure(fixture(t, {
            "scripts/config.mjs": "export const allBundles = [{ name: 'flash', input: ['flash/index.ts'] }];",
            "src/layaAir/flash/index.ts": "export class UnpinnedFlashApi {}",
        }), /root barrel may contain only export-from/);
    });
});

test("clean break rejects semantic compatibility and dual-reader mechanics without blanket vocabulary bans", async t => {
    await t.test("compatibility facade", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/bridge.ts": "export class CompatibilityFacade {}",
        })), /forbidden clean-break implementation surface/);
    });
    await t.test("multiple readers", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/reader.ts": "export class DocumentReader { read(): void {} } export class BackupLoader { load(): void {} }",
        })), /multiple reader\/loader implementations/);
    });
    await t.test("fallback reader chain", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/read.ts": "declare const a: { read(): unknown }; declare const b: { load(): unknown }; export const value = a.read() ?? b.load();",
        })), /fallback chains are forbidden/);
    });
    await t.test("ordinary fallback color prose is harmless", t => {
        assertAuthoredContentAdmission(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/color.ts": "export const fallbackColor = 0;",
        })));
    });
    await t.test("runtime semantic AVM machinery is forbidden", t => {
        for (const [file, source] of [
            ["MultinameResolver.ts", "export class MultinameResolver {}"],
            ["BytecodeInterpreter.ts", "export class BytecodeInterpreter {}"],
        ])
            failure(fixture(t, runtimeFiles({ [`src/layaAir/laya/authoredContent/core/${file}`]: source })), /authored runtime may not contain AVM/);
    });
    await t.test("decoder/deserializer dual readers and fallbacks are forbidden", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/deserialize.ts": "export class AuthoredDocumentDeserializer { deserialize(): void {} } export class AuthoredTimelineDecoder { decode(): void {} }",
        })), /multiple reader\/loader implementations/);
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/fallback.ts": "declare const primary: { decode(): unknown }; declare const secondary: { deserialize(): unknown }; export const value = primary.decode() ?? secondary.deserialize();",
        })), /fallback chains are forbidden/);
    });
});

test("package exports, dependency fields, and transitive production reachability are guarded", async t => {
    await t.test("conditional export to editor", t => {
        const manifest = {
            name: "layaair-fixture",
            scripts: {
                build: "npm run check:authored-content-admission && node scripts/buildEngine.mjs",
                "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
            },
            exports: { ".": { default: "./src/layaAir/index.ts", browser: ["./src/extensions/authoredContent/index.ts"] } },
        };
        failure(fixture(t, {
            "package.json": JSON.stringify(manifest),
            "src/layaAir/index.ts": "export {};",
            "src/extensions/authoredContent/index.ts": "export {};",
        }), /production reachability includes editor-only|exports exposes reverse-layer/);
    });
    await t.test("transitive adapter reachability", t => {
        const files = runtimeFiles({
            "src/layaAir/entry.ts": "export * from './laya/authoredContent/core/barrel';",
            "src/layaAir/laya/authoredContent/core/barrel.ts": "export * from '../../../../extensions/authoredContent/offlineAdapters/source';",
            "src/extensions/authoredContent/offlineAdapters/source.ts": "export const source = 1;",
        });
        failure(fixture(t, files), /core .* reaches offline-adapter|production reachability includes editor-only/);
    });
    await t.test("blocking runtime cannot be exported", t => {
        const manifest = {
            name: "layaair-fixture",
            scripts: {
                build: "npm run check:authored-content-admission && node scripts/buildEngine.mjs",
                "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
            },
            exports: { "./authored": "./src/layaAir/laya/authoredContent/layaair/registration.ts" },
        };
        failure(fixture(t, { ...runtimeFiles(), "package.json": JSON.stringify(manifest) }), /production-reachable while capabilities remain blocking/);
    });
    await t.test("ordinary exported production closure cannot hide AVM or authored readers", t => {
        for (const [file, source] of [
            ["src/layaAir/internal/QNameResolver.ts", "export class QNameResolver {}"],
            ["src/layaAir/internal/MovieAssetReader.ts", "export class MovieAssetReader { read(): void {} }"],
        ]) {
            const manifest = {
                name: "layaair-fixture",
                scripts: {
                    build: "npm run check:authored-content-admission && npm run verify:authored-content-capabilities && node scripts/buildEngine.mjs",
                    "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                    "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
                    "verify:authored-content-capabilities": "node scripts/checkAuthoredContentAdmission.mjs --verify-evidence",
                },
                exports: { ".": `./${file}` },
            };
            failure(fixture(t, { "package.json": JSON.stringify(manifest), [file]: source }), /production authored\/Flash closure/);
        }
    });
    await t.test("package index resolution preserves transitive closure and maps JS exports to TS", t => {
        const manifest = {
            name: "layaair-fixture",
            scripts: {
                build: "npm run check:authored-content-admission && npm run verify:authored-content-capabilities && node scripts/buildEngine.mjs",
                "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
                "verify:authored-content-capabilities": "node scripts/checkAuthoredContentAdmission.mjs --verify-evidence",
            },
            exports: { ".": "./src/layaAir/internal/entry.js" },
        };
        failure(fixture(t, {
            "package.json": JSON.stringify(manifest),
            "src/layaAir/internal/entry.ts": "export * from './hidden';",
            "src/layaAir/internal/hidden/index.ts": "export class QNameResolver {}",
        }), /QName|production authored\/Flash closure/);
    });
    await t.test("wildcard JS and directory index module targets map to source", t => {
        for (const [exports, file] of [
            [{ "./*": "./src/layaAir/internal/*.js" }, "src/layaAir/internal/Hidden.ts"],
            [{ ".": "./src/layaAir/internal" }, "src/layaAir/internal/index.mjs"],
        ]) {
            const manifest = {
                name: "layaair-fixture",
                scripts: {
                    build: "npm run check:authored-content-admission && npm run verify:authored-content-capabilities && node scripts/buildEngine.mjs",
                    "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                    "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
                    "verify:authored-content-capabilities": "node scripts/checkAuthoredContentAdmission.mjs --verify-evidence",
                },
                exports,
            };
            failure(fixture(t, { "package.json": JSON.stringify(manifest), [file]: "export class AvmRuntime {}" }), /production authored\/Flash closure/);
        }
    });
    await t.test("normal bundle globs scan self-contained forbidden production files", t => {
        for (const [file, source] of [
            ["src/layaAir/laya/loaders/MovieAssetReader.ts", "export class MovieAssetReader {}"],
            ["src/layaAir/laya/utils/AvmRuntime.ts", "export class AvmRuntime {}"],
            ["src/layaAir/laya/utils/LegacyAuthoredAssetDeserializer.ts", "export class LegacyAuthoredAssetDeserializer {}"],
            ["src/layaAir/laya/utils/AuthoredTimelineDecoder.ts", "export class AuthoredTimelineDecoder {}"],
            ["src/layaAir/laya/utils/BytecodeInterpreter.ts", "export class BytecodeInterpreter {}"],
        ])
            failure(fixture(t, { "scripts/config.mjs": `export const allBundles = [{ name: 'core', input: ['${file.replace("src/layaAir/", "")}'] }];`, [file]: source }), /production authored\/Flash closure/);
    });
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "pluginDependencies"]) {
        await t.test(`${field} reverse package dependency`, t => {
            const root = fixture(t, {
                "src/layaAir/laya/authoredContent/core/package.json": JSON.stringify({
                    name: "laya-authored-core",
                    [field]: { "laya-authored-editor": "1.0.0" },
                }),
                "src/extensions/authoredContent/package.json": JSON.stringify({ name: "laya-authored-editor", private: true }),
            });
            failure(root, new RegExp(`core package may not depend on editor package.*${field}`));
        });
    }
    await t.test("npm alias dependency", t => {
        const root = fixture(t, {
            "src/layaAir/laya/authoredContent/core/package.json": JSON.stringify({
                name: "laya-authored-core",
                dependencies: { hidden: "npm:laya-authored-editor@1.0.0" },
            }),
            "src/extensions/authoredContent/package.json": JSON.stringify({ name: "laya-authored-editor", private: true }),
        });
        failure(root, /core package may not depend on editor package hidden/);
    });
    await t.test("file dependency cannot disguise an editor package", t => {
        for (const version of [
            "file:..\\..\\..\\..\\extensions\\authoredContent",
            "portal:../../../../extensions/authoredContent",
            "workspace:../../../../extensions/authoredContent",
            "workspace:laya-authored-editor@*",
        ]) {
            const root = fixture(t, {
                "src/layaAir/laya/authoredContent/core/package.json": JSON.stringify({
                    name: "laya-authored-core",
                    dependencies: { hidden: version },
                }),
                "src/extensions/authoredContent/package.json": JSON.stringify({ name: "laya-authored-editor", private: true }),
            });
            failure(root, /core package may not depend on editor package hidden/);
        }
    });
    await t.test("build configuration cannot ship editor code", t => {
        failure(fixture(t, {
            "scripts/config.mjs": "export const allBundles = [{ name: 'authored', input: ['extensions/authoredContent/**/*.*'] }];",
            "src/extensions/authoredContent/index.ts": "export {};",
        }), /production reachability includes editor-only/);
    });
    await t.test("computed bundle inputs fail closed", t => {
        failure(fixture(t, {
            "scripts/config.mjs": "const inputs = ['laya/authoredContent/**/*.*']; export const allBundles = [{ name: 'authored', input: inputs }];",
        }), /literal array/);
    });
    await t.test("computed, spread, and post-literal bundle assembly fail closed", t => {
        for (const config of [
            "const makeBundles = () => []; export const allBundles = makeBundles();",
            "const importedBundles = []; export const allBundles = [...importedBundles];",
            "export const allBundles = [{ name: 'core', input: [] }]; allBundles[0].input.push('laya/loaders/**/*.*');",
            "const hidden = { input: ['laya/loaders/**/*.*'] }; export const allBundles = [{ input: [], ...hidden }];",
            "export const allBundles = [{ input: [], get hidden() { return []; } }];",
            "export const allBundles = [{ input: [] }]; const alias = allBundles; alias[0].input.fill('laya/loaders/**/*.*');",
            "export const allBundles = [{ input: [] }]; Object.assign(allBundles[0], { input: ['laya/loaders/**/*.*'] });",
        ])
            failure(fixture(t, { "scripts/config.mjs": config }), /literal array|literal object without spreads|statically named property|may not be referenced/);
    });
    await t.test("extglob bundle inputs are conservatively production-scanned", t => {
        failure(fixture(t, {
            "scripts/config.mjs": "export const allBundles = [{ name: 'core', input: ['laya/@(loaders|utils)/**/*.*'] }];",
            "src/layaAir/laya/loaders/MovieAssetReader.ts": "export class MovieAssetReader {}",
        }), /production authored\/Flash closure/);
    });
    await t.test("reachable production JSON is scanned", t => {
        for (const manifest of [
            { reader: "legacy SWF", schema: "old-authored@1" },
            { loader: "legacy authored asset", documentSchema: "old-authored@2" },
            { deserializer: "legacy authored timeline" },
        ])
            failure(fixture(t, {
                "scripts/config.mjs": "export const allBundles = [{ name: 'core', input: ['laya/loaders/**/*.*'] }];",
                "src/layaAir/laya/loaders/legacy-manifest.json": JSON.stringify(manifest),
            }), /production JSON/);
    });
    await t.test("copy and output merge surfaces are literal and production-scanned", t => {
        failure(fixture(t, {
            "scripts/config.mjs": "const makeOutput = () => ({}); export const allBundles = [{ name: 'x', input: [], output: makeOutput() }];",
        }), /output must be one literal object/);
        for (const config of [
            "export const allBundles = [{ name: 'x', input: [], copy: ['laya/loaders/Hidden.js'] }];",
            "export const allBundles = [{ name: 'x', input: [], output: { 'laya.x.js': ['laya/loaders/Hidden.js'] } }];",
        ])
            failure(fixture(t, {
                "scripts/config.mjs": config,
                "src/layaAir/laya/loaders/Hidden.js": "export class AvmRuntime {}",
            }), /production authored\/Flash closure/);
    });
});

test("schemas and discovery manifests are strict and synthesize unknown blockers", async t => {
    await t.test("parallel schema discriminator", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/document.schema.json": JSON.stringify({
                properties: { schema: { const: "neutral-authored-content@2" } },
            }),
        })), /schema discriminator must be the single current identity/);
    });
    await t.test("escaping schema ref", t => {
        failure(fixture(t, runtimeFiles({
            "src/layaAir/laya/authoredContent/core/document.schema.json": JSON.stringify({
                properties: { schema: { const: "neutral-authored-content@1" } },
                $ref: "../retired.schema.json",
            }),
        })), /schema reference must stay local/);
    });
    await t.test("unknown discovered tag", t => {
        const root = fixture(t, {
            "src/extensions/authoredContent/offlineAdapters/discovery.manifest.json": JSON.stringify({ discoveredTags: ["DefineFutureThing"] }),
        });
        const result = inspectAuthoredContentAdmission(root);
        assert.ok(result.failures.some(message => /requires blocking capability/.test(message)));
        assert.deepEqual(result.syntheticBlockingCapabilities, ["source.tag.definefuturething"]);
    });
    await t.test("known discovered parameter", t => {
        assertAuthoredContentAdmission(fixture(t, {
            "src/extensions/authoredContent/offlineAdapters/discovery.manifest.json": JSON.stringify({
                discoveredParameters: [{ name: "mask", capabilityId: "rendering.mask" }],
            }),
        }));
    });
});

test("mandatory scripts cannot be detached from the normal build", async t => {
    await t.test("missing standalone test", t => {
        const manifest = {
            scripts: {
                build: "npm run check:authored-content-admission && node scripts/buildEngine.mjs",
                "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
            },
        };
        failure(fixture(t, { "package.json": JSON.stringify(manifest) }), /mandatory test:authored-content-admission/);
    });
    await t.test("check after build", t => {
        const manifest = {
            scripts: {
                build: "node scripts/buildEngine.mjs && npm run check:authored-content-admission",
                "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
            },
        };
        failure(fixture(t, { "package.json": JSON.stringify(manifest) }), /build must be exactly/);
    });
    await t.test("echoed or swallowed gates cannot imitate wiring", t => {
        for (const build of [
            "echo npm run check:authored-content-admission && node scripts/buildEngine.mjs",
            "npm run check:authored-content-admission || exit 0 && node scripts/buildEngine.mjs",
        ]) {
            const manifest = {
                scripts: {
                    build,
                    "check:authored-content-admission": "node scripts/checkAuthoredContentAdmission.mjs",
                    "test:authored-content-admission": "node --test tests/architecture/authoredContentAdmission.test.mjs",
                    "verify:authored-content-capabilities": "node scripts/checkAuthoredContentAdmission.mjs --verify-evidence",
                },
            };
            failure(fixture(t, { "package.json": JSON.stringify(manifest) }), /build must be exactly/);
        }
    });
});

test("fixture cleanup leaves no directories behind", t => {
    const before = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("laya-authored-admission-")));
    const root = fixture(t);
    assert.ok(fs.existsSync(root));
    t.after(() => {
        const after = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("laya-authored-admission-") && !before.has(name));
        assert.deepEqual(after, []);
    });
});
