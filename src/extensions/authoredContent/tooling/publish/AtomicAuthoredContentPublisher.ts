import path from "node:path";
import { randomBytes } from "node:crypto";
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readFile,
    readdir,
    realpath,
    rename,
    rmdir,
    rm,
    stat,
    unlink,
    writeFile
} from "node:fs/promises";

import { AuthoredContentConversionReceipt, AuthoredContentPublishedFile, AuthoredContentToolError } from "../types.js";
import { canonicalJson, sha256 } from "../project/CanonicalJson.js";
import { parseStrictJsonBytes } from "../project/CanonicalJson.js";

const CURRENT_SCHEMA = "laya-authored-content-current@1";
const RECEIPT_FILE = "laya-authored-content-receipt.json";

export type PublicationFailpoint =
    | "after-lock"
    | "after-stage-write"
    | "after-stage-validation"
    | "after-final-validation"
    | "after-generation-rename"
    | "before-pointer-rename"
    | "after-pointer-rename"
    | "cleanup"
    | "before-lock-release";

export interface PublishAuthoredContentGenerationRequest {
    readonly destinationRoot: string;
    readonly receipt: AuthoredContentConversionReceipt;
    readonly writeStaging: (stagingRoot: string) => Promise<void>;
    /** Test-only dependency injection. It is deliberately absent from the public package API and CLI. */
    readonly failpoint?: (name: PublicationFailpoint) => void | Promise<void>;
}

export interface PublishedAuthoredContentGeneration {
    readonly status: "published" | "unchanged";
    readonly generation: string;
    readonly receiptPath: string;
}

interface CurrentPointer {
    readonly schema: typeof CURRENT_SCHEMA;
    readonly generation: string;
    readonly receiptPath: typeof RECEIPT_FILE;
    readonly receiptSha256: string;
    readonly receiptSubjectSha256: string;
}

/**
 * Publishes immutable content-addressed generations, then commits one pointer.
 * Readers resolve current.json once; they can therefore never observe a partly
 * replaced multi-file tree.
 */
export async function publishAuthoredContentGeneration(
    request: PublishAuthoredContentGenerationRequest
): Promise<PublishedAuthoredContentGeneration> {
    validateReceipt(request.receipt);
    const destinationRoot = await ensureRealLocalRoot(request.destinationRoot);
    const authorityRoot = path.join(destinationRoot, ".laya-authored-content");
    await mkdir(authorityRoot, { recursive: true });
    await rejectSymlink(authorityRoot, "publication authority root");
    const generationsRoot = path.join(authorityRoot, "generations");
    const stagingRoot = path.join(authorityRoot, "staging");
    await mkdir(generationsRoot, { recursive: true });
    await mkdir(stagingRoot, { recursive: true });
    await rejectSymlink(generationsRoot, "publication generations root");
    await rejectSymlink(stagingRoot, "publication staging root");

    const token = randomBytes(16).toString("hex");
    const lockRoot = path.join(authorityRoot, "lock");
    await acquireLock(lockRoot, token);
    let stage: string | undefined;
    let committed = false;
    try {
        await request.failpoint?.("after-lock");
        const generation = request.receipt.receiptSubjectSha256;
        assertDigest(generation, "receipt subject digest");
        const pointerPath = path.join(authorityRoot, "current.json");
        const current = await readCurrent(pointerPath);
        if (current?.generation === generation && current.receiptSubjectSha256 === generation) {
            await verifyGeneration(path.join(generationsRoot, generation), request.receipt, current);
            return { status: "unchanged", generation, receiptPath: path.join(generationsRoot, generation, RECEIPT_FILE) };
        }

        stage = await mkdtemp(path.join(stagingRoot, `${generation}.`));
        await request.writeStaging(stage);
        await request.failpoint?.("after-stage-write");
        await verifyExactInventory(stage, request.receipt.inventory);
        const receiptBytes = Buffer.from(canonicalJson(request.receipt), "utf8");
        await durableExclusiveWrite(path.join(stage, RECEIPT_FILE), receiptBytes);
        await verifyExactInventory(stage, [
            ...request.receipt.inventory,
            { path: RECEIPT_FILE, sha256: sha256(receiptBytes), size: receiptBytes.length }
        ]);
        await request.failpoint?.("after-stage-validation");
        await freezeTree(stage);
        await verifyExactInventory(stage, [
            ...request.receipt.inventory,
            { path: RECEIPT_FILE, sha256: sha256(receiptBytes), size: receiptBytes.length }
        ]);
        await request.failpoint?.("after-final-validation");

        const generationRoot = path.join(generationsRoot, generation);
        try {
            await rename(stage, generationRoot);
            stage = undefined;
        }
        catch (error) {
            if (!await pathExists(generationRoot)) throw error;
            await verifyGeneration(generationRoot, request.receipt);
            await removeOwnedStage(stage!);
            stage = undefined;
        }
        await request.failpoint?.("after-generation-rename");
        await verifyGeneration(generationRoot, request.receipt);

        const receiptSha256 = sha256(receiptBytes);
        const pointer: CurrentPointer = {
            schema: CURRENT_SCHEMA,
            generation,
            receiptPath: RECEIPT_FILE,
            receiptSha256,
            receiptSubjectSha256: generation
        };
        const pointerTemporary = path.join(authorityRoot, `current.${token}.json`);
        await durableExclusiveWrite(pointerTemporary, Buffer.from(canonicalJson(pointer), "utf8"));
        await request.failpoint?.("before-pointer-rename");
        // The callback is deliberately the final adversarial boundary.  It may
        // yield to another task (or, in tests, mutate the generation), so the
        // generation authenticated above is no longer authority after it
        // returns.  Reauthenticate the exact receipt and complete byte
        // inventory immediately before the one atomic visibility commit.
        await verifyGeneration(generationRoot, request.receipt);
        await replaceFile(pointerTemporary, pointerPath);
        committed = true;
        try {
            await request.failpoint?.("after-pointer-rename");
        }
        catch {
            const reconciled = await readCurrent(pointerPath);
            if (!reconciled || reconciled.generation !== generation || reconciled.receiptSha256 !== receiptSha256)
                throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_RECONCILE", "publication outcome could not be reconciled after pointer commit.");
        }
        return { status: "published", generation, receiptPath: path.join(generationRoot, RECEIPT_FILE) };
    }
    catch (error) {
        if (committed) {
            const generation = request.receipt.receiptSubjectSha256;
            const current = await readCurrent(path.join(authorityRoot, "current.json"));
            if (current?.generation === generation)
                return { status: "published", generation, receiptPath: path.join(generationsRoot, generation, RECEIPT_FILE) };
        }
        throw error;
    }
    finally {
        let finalizationError: unknown;
        try {
            await request.failpoint?.("cleanup");
            if (stage) await removeOwnedStage(stage);
        }
        catch (error) { finalizationError = error; }
        try {
            try { await request.failpoint?.("before-lock-release"); }
            finally { await releaseLock(lockRoot, token); }
        }
        catch (error) { finalizationError ??= error; }
        if (!committed && finalizationError) throw finalizationError;
    }
}

export async function rollbackAuthoredContentGeneration(destinationRootValue: string, generation: string): Promise<void> {
    assertDigest(generation, "rollback generation");
    const destinationRoot = await ensureRealLocalRoot(destinationRootValue);
    const authorityRoot = path.join(destinationRoot, ".laya-authored-content");
    const token = randomBytes(16).toString("hex");
    const lockRoot = path.join(authorityRoot, "lock");
    await acquireLock(lockRoot, token);
    try {
        const generationRoot = path.join(authorityRoot, "generations", generation);
        await rejectSymlink(path.join(authorityRoot, "generations"), "publication generations root");
        const receiptBytes = await readFile(path.join(generationRoot, RECEIPT_FILE));
        const receipt = parseStrictJsonBytes(receiptBytes, "rollback receipt", true) as AuthoredContentConversionReceipt;
        validateReceipt(receipt);
        if (receipt.receiptSubjectSha256 !== generation)
            throw new AuthoredContentToolError("AUTHORED_CONTENT_ROLLBACK_RECEIPT", "rollback generation receipt identity is invalid.");
        await verifyGeneration(generationRoot, receipt);
        const pointer: CurrentPointer = {
            schema: CURRENT_SCHEMA,
            generation,
            receiptPath: RECEIPT_FILE,
            receiptSha256: sha256(receiptBytes),
            receiptSubjectSha256: generation
        };
        const temporary = path.join(authorityRoot, `current.${token}.json`);
        await durableExclusiveWrite(temporary, Buffer.from(canonicalJson(pointer), "utf8"));
        await replaceFile(temporary, path.join(authorityRoot, "current.json"));
    }
    finally {
        await releaseLock(lockRoot, token);
    }
}

export async function checkPublishedAuthoredContentGeneration(destinationRootValue: string): Promise<AuthoredContentConversionReceipt> {
    let destinationRoot: string;
    try {
        destinationRoot = await existingRealLocalRoot(destinationRootValue);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new AuthoredContentToolError("AUTHORED_CONTENT_DELIVERY_MISSING", "delivery root does not exist.");
        throw error;
    }
    const authorityRoot = path.join(destinationRoot, ".laya-authored-content");
    try {
        await rejectSymlink(authorityRoot, "publication authority root");
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new AuthoredContentToolError("AUTHORED_CONTENT_DELIVERY_MISSING", "delivery has no publication authority.");
        throw error;
    }
    const pointer = await readCurrent(path.join(authorityRoot, "current.json"));
    if (!pointer) throw new AuthoredContentToolError("AUTHORED_CONTENT_DELIVERY_MISSING", "delivery has no current publication pointer.");
    const generationRoot = path.join(authorityRoot, "generations", pointer.generation);
    await rejectSymlink(path.join(authorityRoot, "generations"), "publication generations root");
    const receiptBytes = await readFile(path.join(generationRoot, RECEIPT_FILE));
    if (sha256(receiptBytes) !== pointer.receiptSha256)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_CURRENT_RECEIPT_DRIFT", "current receipt digest does not match its pointer.");
    const receipt = parseStrictJsonBytes(receiptBytes, "published authored-content receipt", true) as AuthoredContentConversionReceipt;
    validateReceipt(receipt);
    if (receipt.receiptSubjectSha256 !== pointer.receiptSubjectSha256 || pointer.generation !== receipt.receiptSubjectSha256)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_CURRENT_IDENTITY", "current pointer and receipt identities differ.");
    await verifyGeneration(generationRoot, receipt, pointer);
    return receipt;
}

async function verifyGeneration(root: string, receipt: AuthoredContentConversionReceipt, pointer?: CurrentPointer): Promise<void> {
    await rejectSymlink(root, "published generation");
    const receiptFile = path.join(root, RECEIPT_FILE);
    await rejectSymlink(receiptFile, "published receipt");
    const receiptBytes = await readFile(receiptFile);
    if (pointer && sha256(receiptBytes) !== pointer.receiptSha256)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_CURRENT_RECEIPT_DRIFT", "current receipt digest does not match its pointer.");
    const actual = parseStrictJsonBytes(receiptBytes, "published authored-content receipt", true) as AuthoredContentConversionReceipt;
    validateReceipt(actual);
    if (canonicalJson(actual) !== canonicalJson(receipt))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_CURRENT_RECEIPT_DRIFT", "published receipt differs from the expected receipt.");
    await verifyExactInventory(root, [
        ...receipt.inventory,
        { path: RECEIPT_FILE, sha256: sha256(receiptBytes), size: receiptBytes.length }
    ]);
}

async function verifyExactInventory(root: string, expected: readonly AuthoredContentPublishedFile[]): Promise<void> {
    const actual = await inventory(root);
    const normalizedExpected = [...expected].sort(compareFile);
    const expectedPaths = new Set<string>();
    for (const file of normalizedExpected) {
        assertPortablePath(file.path);
        if (expectedPaths.has(portableIdentity(file.path)))
            throw new AuthoredContentToolError("AUTHORED_CONTENT_INVENTORY_COLLISION", `inventory path collides portably: ${file.path}.`);
        expectedPaths.add(portableIdentity(file.path));
    }
    if (canonicalJson(actual) !== canonicalJson(normalizedExpected))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_INVENTORY_MISMATCH", "staged or published files do not match the exact receipt inventory.");
}

async function inventory(root: string): Promise<AuthoredContentPublishedFile[]> {
    const result: AuthoredContentPublishedFile[] = [];
    const identities = new Set<string>();
    async function walk(directory: string, prefix: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            assertPortablePath(relative);
            const identity = portableIdentity(relative);
            if (identities.has(identity))
                throw new AuthoredContentToolError("AUTHORED_CONTENT_OUTPUT_COLLISION", `output path collides portably: ${relative}.`);
            identities.add(identity);
            const absolute = path.join(directory, entry.name);
            const info = await lstat(absolute);
            if (info.isSymbolicLink())
                throw new AuthoredContentToolError("AUTHORED_CONTENT_OUTPUT_SYMLINK", `output contains a symbolic link: ${relative}.`);
            if (info.isDirectory()) await walk(absolute, relative);
            else if (info.isFile()) {
                const bytes = await readFile(absolute);
                result.push({ path: relative, sha256: sha256(bytes), size: bytes.length });
            }
            else throw new AuthoredContentToolError("AUTHORED_CONTENT_OUTPUT_TYPE", `output contains an unsupported filesystem object: ${relative}.`);
        }
    }
    await walk(root, "");
    return result.sort(compareFile);
}

function assertPortablePath(value: string): void {
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
    if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0") || /[\x00-\x1f:]/.test(value))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_OUTPUT_PATH", `output path is not portable: ${value}.`);
    for (const part of value.split("/")) {
        if (!part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ") || reserved.test(part))
            throw new AuthoredContentToolError("AUTHORED_CONTENT_OUTPUT_PATH", `output path is not portable: ${value}.`);
    }
}

function portableIdentity(value: string): string {
    return value.normalize("NFC").toLocaleLowerCase("en-US");
}

async function ensureRealLocalRoot(value: string): Promise<string> {
    const resolved = path.resolve(value);
    if (resolved === path.parse(resolved).root)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_ROOT", "filesystem root cannot be a publication destination.");
    await mkdir(resolved, { recursive: true });
    const direct = await lstat(resolved);
    if (direct.isSymbolicLink())
        throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_SYMLINK", "publication destination must not be a symbolic link.");
    const real = await realpath(resolved);
    if (!samePath(resolved, real))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_SYMLINK", "publication destination traverses a symbolic link or junction.");
    await rejectSymlink(real, "publication destination");
    const info = await stat(real);
    if (!info.isDirectory()) throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_ROOT", "publication destination must be a directory.");
    return real;
}

async function existingRealLocalRoot(value: string): Promise<string> {
    const resolved = path.resolve(value);
    if (resolved === path.parse(resolved).root)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_ROOT", "filesystem root cannot be a publication destination.");
    const direct = await lstat(resolved);
    if (direct.isSymbolicLink())
        throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_SYMLINK", "delivery root must not be a symbolic link.");
    const real = await realpath(resolved);
    if (!samePath(resolved, real))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_SYMLINK", "delivery root traverses a symbolic link or junction.");
    const info = await stat(real);
    if (!info.isDirectory()) throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_ROOT", "delivery root must be a directory.");
    return real;
}

async function rejectSymlink(value: string, label: string): Promise<void> {
    const info = await lstat(value);
    if (info.isSymbolicLink()) throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_SYMLINK", `${label} must not be a symbolic link.`);
}

async function acquireLock(lockRoot: string, token: string): Promise<void> {
    try { await mkdir(lockRoot); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new AuthoredContentToolError("AUTHORED_CONTENT_PUBLICATION_BUSY", "publication destination is locked.");
        throw error;
    }
    await durableExclusiveWrite(path.join(lockRoot, "owner.json"), Buffer.from(canonicalJson({ schema: "laya-authored-content-lock@1", token }), "utf8"));
}

async function releaseLock(lockRoot: string, token: string): Promise<void> {
    try {
        const ownerPath = path.join(lockRoot, "owner.json");
        const owner = JSON.parse((await readFile(ownerPath)).toString("utf8")) as { token?: string };
        if (owner.token !== token) return;
        await unlink(ownerPath);
        await rmdir(lockRoot);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

async function durableExclusiveWrite(file: string, bytes: Buffer): Promise<void> {
    const handle = await open(file, "wx");
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
}

async function replaceFile(source: string, destination: string): Promise<void> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; ++attempt) {
        try { await rename(source, destination); return; }
        catch (error) {
            last = error;
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "EPERM" && code !== "EACCES") break;
            await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }
    throw last;
}

async function readCurrent(file: string): Promise<CurrentPointer | undefined> {
    try {
        await rejectSymlink(file, "current publication pointer");
        const value = parseStrictJsonBytes(await readFile(file), "current publication pointer", true) as CurrentPointer;
        const keys = Object.keys(value as object).sort();
        if (keys.join("\0") !== ["generation", "receiptPath", "receiptSha256", "receiptSubjectSha256", "schema"].sort().join("\0"))
            throw new AuthoredContentToolError("AUTHORED_CONTENT_CURRENT_INVALID", "current publication pointer has unsupported fields.");
        if (value.schema !== CURRENT_SCHEMA || value.receiptPath !== RECEIPT_FILE)
            throw new AuthoredContentToolError("AUTHORED_CONTENT_CURRENT_INVALID", "current publication pointer is invalid.");
        assertDigest(value.generation, "current generation");
        assertDigest(value.receiptSha256, "current receipt digest");
        assertDigest(value.receiptSubjectSha256, "current receipt subject digest");
        return value;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

async function freezeTree(root: string): Promise<void> {
    async function walk(directory: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) { await walk(absolute); await chmod(absolute, 0o555); }
            else if (entry.isFile()) await chmod(absolute, 0o444);
        }
    }
    await walk(root);
    await chmod(root, 0o555);
}

async function removeOwnedStage(stage: string): Promise<void> {
    const base = path.basename(stage);
    if (!/^[0-9a-f]{64}\.[A-Za-z0-9_-]+$/.test(base))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_STAGE_IDENTITY", "refusing to remove an unrecognized staging directory.");
    await rm(stage, { recursive: true, force: true });
}

async function pathExists(value: string): Promise<boolean> {
    try { await lstat(value); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

function assertDigest(value: string, label: string): void {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new AuthoredContentToolError("AUTHORED_CONTENT_DIGEST", `${label} must be a lowercase SHA-256 digest.`);
}

function validateReceipt(receipt: AuthoredContentConversionReceipt): void {
    exactKeys(receipt as unknown as Record<string, unknown>, [
        "command", "holds", "inputs", "inventory", "inventorySha256", "projectSha256", "provider",
        "receiptSubjectSha256", "requestSha256", "schema", "status", "toolVersion"
    ], "receipt");
    const { receiptSubjectSha256, ...subject } = receipt;
    assertDigest(receiptSubjectSha256, "receipt subject digest");
    if (sha256(canonicalJson(subject)) !== receiptSubjectSha256)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_IDENTITY", "receipt subject digest is invalid.", { exitCode: 1 });
    if (sha256(canonicalJson(receipt.inventory)) !== receipt.inventorySha256)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_INVENTORY_IDENTITY", "receipt inventory digest is invalid.", { exitCode: 1 });
    if (receipt.schema !== "laya-authored-content-receipt@1" || receipt.toolVersion !== "0.1.0" || receipt.command !== "publish" || receipt.status !== "published")
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_STATUS", "only a published receipt can commit a generation.", { exitCode: 1 });
    assertDigest(receipt.projectSha256, "receipt project digest");
    assertDigest(receipt.requestSha256, "receipt request digest");
    exactKeys(receipt.provider as unknown as Record<string, unknown>, ["capabilityLedger", "commit", "packageVersion", "published", "remote", "repository", "tooling"], "receipt provider");
    if (receipt.provider.repository !== "LayaAir" || typeof receipt.provider.published !== "boolean")
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_PROVIDER", "receipt provider identity is invalid.");
    if (!/^[0-9a-f]{40}$/.test(receipt.provider.commit))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_PROVIDER", "receipt provider commit is invalid.");
    exactKeys(receipt.provider.remote as unknown as Record<string, unknown>, ["commit", "name", "ref", "url"], "receipt provider remote");
    exactKeys(receipt.provider.capabilityLedger as unknown as Record<string, unknown>, ["hashMode", "path", "schema", "sha256"], "receipt provider ledger");
    exactKeys(receipt.provider.tooling as unknown as Record<string, unknown>, ["commit", "package", "sourceSha256", "version"], "receipt provider tooling");
    if (receipt.provider.tooling.package !== "@layabox/laya-authored-content" || receipt.provider.tooling.version !== "0.1.0"
        || receipt.provider.tooling.commit !== receipt.provider.commit)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_TOOLING", "receipt tooling identity is invalid.");
    assertDigest(receipt.provider.tooling.sourceSha256, "receipt tooling source digest");
    assertDigest(receipt.provider.capabilityLedger.sha256, "receipt capability ledger digest");
    if (!Array.isArray(receipt.inputs) || !Array.isArray(receipt.inventory) || !Array.isArray(receipt.holds) || receipt.holds.length !== 0)
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_ARRAYS", "published receipt arrays are invalid.");
    for (const [index, input] of receipt.inputs.entries()) {
        exactKeys(input as unknown as Record<string, unknown>, ["jobId", "kind", "path", "sha256", "size"], `receipt input ${index}`);
        assertDigest(input.sha256, `receipt input ${index} digest`);
        assertPortablePath(input.path);
        if (!Number.isSafeInteger(input.size) || input.size < 0)
            throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_INPUT", `receipt input ${index} size is invalid.`);
    }
    for (const [index, file] of receipt.inventory.entries()) {
        exactKeys(file as unknown as Record<string, unknown>, ["path", "sha256", "size"], `receipt inventory ${index}`);
        assertPortablePath(file.path);
        assertDigest(file.sha256, `receipt inventory ${index} digest`);
        if (!Number.isSafeInteger(file.size) || file.size < 0)
            throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_INVENTORY", `receipt inventory ${index} size is invalid.`);
    }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_SHAPE", `${label} must be an object.`);
    const actual = Object.keys(value).sort();
    const sorted = [...expected].sort();
    if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index]))
        throw new AuthoredContentToolError("AUTHORED_CONTENT_RECEIPT_SHAPE", `${label} has unsupported or missing fields.`);
}

function compareFile(left: AuthoredContentPublishedFile, right: AuthoredContentPublishedFile): number {
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function samePath(left: string, right: string): boolean {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return process.platform === "win32" ? a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US") : a === b;
}
