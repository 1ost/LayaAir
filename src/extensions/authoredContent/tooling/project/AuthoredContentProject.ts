import path from "node:path";
import { lstat, open, realpath } from "node:fs/promises";

import {
    AUTHORED_CONTENT_PROJECT_SCHEMA,
    AuthoredContentInputKind,
    AuthoredContentProject,
    AuthoredContentProjectInput,
    AuthoredContentProjectJob,
    AuthoredContentProjectProvider,
    AuthoredContentToolError
} from "../types.js";
import { canonicalJsonSha256, readStrictJson, sha256 } from "./CanonicalJson.js";

const DIGEST = /^[0-9a-f]{64}$/;
const GIT_OID = /^[0-9a-f]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const INPUT_KINDS = new Set<AuthoredContentInputKind>(["raw-swf", "raw-swc", "evidence-bundle", "neutral-ir"]);

export interface LoadedAuthoredContentProject {
    readonly value: AuthoredContentProject;
    readonly canonicalSha256: string;
}

export interface VerifiedAuthoredContentInput {
    readonly jobId: string;
    readonly kind: AuthoredContentInputKind;
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
}

export async function loadAuthoredContentProject(projectPath: string): Promise<LoadedAuthoredContentProject> {
    const value = validateProject(await readStrictJson(projectPath, "authored-content project", true));
    return { value, canonicalSha256: canonicalJsonSha256(value) };
}

/** Internal validator entrypoint used by the schema differential gate. */
export function validateAuthoredContentProjectDocument(value: unknown): AuthoredContentProject {
    return validateProject(value);
}

export async function verifyProjectInputs(
    project: AuthoredContentProject,
    workspaceRoot: string
): Promise<readonly VerifiedAuthoredContentInput[]> {
    const root = await realDirectory(workspaceRoot, "workspace root");
    const results: VerifiedAuthoredContentInput[] = [];
    for (const job of project.jobs) {
        const file = await containedRegularFile(root, job.input.path, `job ${job.id} input`);
        const handle = await open(file, "r");
        let bytes: Buffer;
        try {
            const before = await handle.stat();
            if (!before.isFile()) fail("AUTHORED_CONTENT_INPUT_NOT_FILE", `${job.id} input must be a regular file.`);
            bytes = await handle.readFile();
            const after = await handle.stat();
            if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
                fail("AUTHORED_CONTENT_INPUT_MUTATED", `${job.id} input changed while it was being authenticated.`);
        }
        finally { await handle.close(); }
        if (bytes.length !== job.input.size)
            throw new AuthoredContentToolError("AUTHORED_CONTENT_INPUT_SIZE_MISMATCH", `${job.id} input size does not match the project lock.`);
        const digest = sha256(bytes);
        if (digest !== job.input.sha256)
            throw new AuthoredContentToolError("AUTHORED_CONTENT_INPUT_HASH_MISMATCH", `${job.id} input digest does not match the project lock.`);
        results.push({ jobId: job.id, kind: job.input.kind, path: job.input.path, sha256: digest, size: bytes.length });
    }
    return results;
}

export function canonicalRelativePath(value: unknown, label: string): string {
    const text = nonemptyString(value, label);
    if (text.includes("\\") || text.startsWith("/") || /^[A-Za-z]:/.test(text) || /[\x00-\x1f:]/.test(text))
        fail("AUTHORED_CONTENT_PATH_INVALID", `${label} must be a portable relative path.`);
    const parts = text.split("/");
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
    if (parts.some(part => !part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ") || reserved.test(part)))
        fail("AUTHORED_CONTENT_PATH_INVALID", `${label} must not contain empty, dot, or parent segments.`);
    return text;
}

async function containedRegularFile(root: string, relative: string, label: string): Promise<string> {
    let cursor = root;
    for (const part of canonicalRelativePath(relative, label).split("/")) {
        cursor = path.join(cursor, part);
        let info;
        try { info = await lstat(cursor); }
        catch (error) {
            throw new AuthoredContentToolError("AUTHORED_CONTENT_INPUT_MISSING", `${label} does not exist.`, { cause: error as Error });
        }
        if (info.isSymbolicLink())
            fail("AUTHORED_CONTENT_INPUT_SYMLINK", `${label} traverses a symbolic link.`);
    }
    const resolved = await realpath(cursor);
    if (!isContained(root, resolved))
        fail("AUTHORED_CONTENT_INPUT_ESCAPE", `${label} escaped the workspace root.`);
    const info = await lstat(resolved);
    if (!info.isFile() || info.isSymbolicLink())
        fail("AUTHORED_CONTENT_INPUT_NOT_FILE", `${label} must be a regular file.`);
    return resolved;
}

async function realDirectory(value: string, label: string): Promise<string> {
    const resolved = await realpath(path.resolve(value));
    const info = await lstat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink())
        fail("AUTHORED_CONTENT_ROOT_INVALID", `${label} must be a real directory.`);
    return resolved;
}

function isContained(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validateProject(value: unknown): AuthoredContentProject {
    const source = exactObject(value, ["jobs", "provider", "schema"], "project");
    if (source.schema !== AUTHORED_CONTENT_PROJECT_SCHEMA)
        fail("AUTHORED_CONTENT_PROJECT_SCHEMA", `project.schema must be ${AUTHORED_CONTENT_PROJECT_SCHEMA}.`);
    const provider = validateProvider(source.provider);
    if (!Array.isArray(source.jobs) || source.jobs.length === 0)
        fail("AUTHORED_CONTENT_PROJECT_JOBS", "project.jobs must be a non-empty array.");
    const jobs = source.jobs.map((job, index) => validateJob(job, index)).sort((left, right) => compareText(left.id, right.id));
    assertUnique(jobs.map(job => job.id), "project job IDs");
    const outputs = new Map<string, string>();
    for (const job of jobs) {
        const outputIdentity = portableIdentity(job.output);
        for (const [existingIdentity, existing] of outputs) {
            if (outputIdentity === existingIdentity || outputIdentity.startsWith(`${existingIdentity}/`) || existingIdentity.startsWith(`${outputIdentity}/`))
                fail("AUTHORED_CONTENT_OUTPUT_OVERLAP", `job output ${job.output} overlaps ${existing}.`);
        }
        outputs.set(outputIdentity, job.output);
    }
    return { schema: AUTHORED_CONTENT_PROJECT_SCHEMA, provider, jobs };
}

function validateProvider(value: unknown): AuthoredContentProjectProvider {
    const source = exactObject(value, ["capabilityLedger", "commit", "packageVersion", "remote", "repository"], "project.provider");
    if (source.repository !== "LayaAir")
        fail("AUTHORED_CONTENT_PROVIDER_REPOSITORY", "project.provider.repository must be LayaAir.");
    const commit = gitOid(source.commit, "project.provider.commit");
    const packageVersion = nonemptyString(source.packageVersion, "project.provider.packageVersion");
    const remoteSource = exactObject(source.remote, ["commit", "name", "ref", "url"], "project.provider.remote");
    const remoteName = stableId(remoteSource.name, "project.provider.remote.name");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remoteName))
        fail("AUTHORED_CONTENT_PROVIDER_REMOTE_NAME", "project.provider.remote.name is not a portable Git remote name.");
    const remoteRef = nonemptyString(remoteSource.ref, "project.provider.remote.ref");
    if (!remoteRef.startsWith(`refs/remotes/${remoteName}/`) || remoteRef.includes("..") || remoteRef.startsWith("-"))
        fail("AUTHORED_CONTENT_PROVIDER_REMOTE_REF", "project.provider.remote.ref must be a full remote-tracking ref for the selected remote.");
    const remote = {
        name: remoteName,
        url: nonemptyString(remoteSource.url, "project.provider.remote.url"),
        ref: remoteRef,
        commit: gitOid(remoteSource.commit, "project.provider.remote.commit")
    };
    const ledgerSource = exactObject(source.capabilityLedger, ["hashMode", "path", "schema", "sha256"], "project.provider.capabilityLedger");
    if (ledgerSource.schema !== "laya-authored-content-capabilities@1")
        fail("AUTHORED_CONTENT_LEDGER_SCHEMA", "provider ledger schema lock is unsupported.");
    if (ledgerSource.hashMode !== "canonical-lf-utf8")
        fail("AUTHORED_CONTENT_LEDGER_HASH_MODE", "provider ledger hash mode must be canonical-lf-utf8.");
    const capabilityLedger = {
        path: canonicalRelativePath(ledgerSource.path, "project.provider.capabilityLedger.path"),
        schema: "laya-authored-content-capabilities@1" as const,
        hashMode: "canonical-lf-utf8" as const,
        sha256: digest(ledgerSource.sha256, "project.provider.capabilityLedger.sha256")
    };
    return { repository: "LayaAir", commit, packageVersion, remote, capabilityLedger };
}

function validateJob(value: unknown, index: number): AuthoredContentProjectJob {
    const label = `project.jobs[${index}]`;
    const source = exactObject(value, ["entries", "id", "input", "locales", "output", "requiredCapabilities"], label);
    const id = stableId(source.id, `${label}.id`);
    const input = validateInput(source.input, `${label}.input`);
    const entries = stringArray(source.entries, `${label}.entries`, false);
    const locales = stringArray(source.locales, `${label}.locales`, true);
    const requiredCapabilities = stringArray(source.requiredCapabilities, `${label}.requiredCapabilities`, true);
    return { id, input, entries, locales, output: canonicalRelativePath(source.output, `${label}.output`), requiredCapabilities };
}

function validateInput(value: unknown, label: string): AuthoredContentProjectInput {
    const source = exactObject(value, ["kind", "path", "sha256", "size"], label);
    if (typeof source.kind !== "string" || !INPUT_KINDS.has(source.kind as AuthoredContentInputKind))
        fail("AUTHORED_CONTENT_INPUT_KIND", `${label}.kind is unsupported.`);
    if (!Number.isSafeInteger(source.size) || (source.size as number) < 0)
        fail("AUTHORED_CONTENT_INPUT_SIZE", `${label}.size must be a non-negative safe integer.`);
    return {
        kind: source.kind as AuthoredContentInputKind,
        path: canonicalRelativePath(source.path, `${label}.path`),
        sha256: digest(source.sha256, `${label}.sha256`),
        size: source.size as number
    };
}

function stringArray(value: unknown, label: string, emptyAllowed: boolean): readonly string[] {
    if (!Array.isArray(value) || (!emptyAllowed && value.length === 0))
        fail("AUTHORED_CONTENT_STRING_ARRAY", `${label} must be ${emptyAllowed ? "an" : "a non-empty"} array.`);
    const values = value.map((item, index) => stableId(item, `${label}[${index}]`)).sort(compareText);
    assertUnique(values, label);
    return values;
}

function assertUnique(values: readonly string[], label: string): void {
    if (new Set(values).size !== values.length)
        fail("AUTHORED_CONTENT_ORDER", `${label} must contain unique values.`);
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("AUTHORED_CONTENT_OBJECT", `${label} must be an object.`);
    const source = value as Record<string, unknown>;
    const actual = Object.keys(source).sort(compareText);
    const expected = [...keys].sort(compareText);
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
        fail("AUTHORED_CONTENT_KEYS", `${label} keys must be exactly ${expected.join(", ")}.`);
    return source;
}

function nonemptyString(value: unknown, label: string): string {
    if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0"))
        fail("AUTHORED_CONTENT_STRING", `${label} must be a stable non-empty string.`);
    return value.normalize("NFC");
}

function portableIdentity(value: string): string {
    return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function stableId(value: unknown, label: string): string {
    const text = nonemptyString(value, label);
    if (!ID.test(text)) fail("AUTHORED_CONTENT_ID", `${label} contains unsupported characters.`);
    return text;
}

function digest(value: unknown, label: string): string {
    const text = nonemptyString(value, label);
    if (!DIGEST.test(text)) fail("AUTHORED_CONTENT_DIGEST", `${label} must be a lowercase SHA-256 digest.`);
    return text;
}

function gitOid(value: unknown, label: string): string {
    const text = nonemptyString(value, label);
    if (!GIT_OID.test(text)) fail("AUTHORED_CONTENT_GIT_OID", `${label} must be a full lowercase 40-character Git object ID.`);
    return text;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: string, message: string): never {
    throw new AuthoredContentToolError(code, message);
}
