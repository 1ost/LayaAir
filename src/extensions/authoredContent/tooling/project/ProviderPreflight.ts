import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { FileHandle, lstat, open, realpath } from "node:fs/promises";
import { promisify } from "node:util";

import {
    AuthoredContentDisposition,
    AuthoredContentHold,
    AuthoredContentProject,
    AuthoredContentProviderReceipt,
    AuthoredContentToolError,
    AUTHORED_CONTENT_TOOL_SOURCE_SHA256,
    AUTHORED_CONTENT_TOOL_VERSION
} from "../types.js";
import { canonicalLfSha256, parseStrictJsonBytes, readStrictJson, sha256 } from "./CanonicalJson.js";

const execute = promisify(execFile);
const DISPOSITIONS = new Set<AuthoredContentDisposition>(["native", "declarative", "typescript-obligation", "evidence", "blocking"]);

export interface AuthoredContentProviderPreflight {
    readonly receipt: AuthoredContentProviderReceipt;
    readonly holds: readonly AuthoredContentHold[];
}

/** Internal test seam; neither this type nor preflight is exported by the package. */
export interface AuthoredContentProviderPreflightHooks {
    readonly verifyEvidence?: (root: string, authenticatedLedgerBytes: Buffer) => Promise<void>;
}

export async function preflightAuthoredContentProvider(
    project: AuthoredContentProject,
    providerRoot: string,
    hooks: AuthoredContentProviderPreflightHooks = {}
): Promise<AuthoredContentProviderPreflight> {
    const root = await realDirectory(providerRoot);
    const provider = project.provider;
    await requireCleanProvider(root);
    const head = await git(root, "rev-parse", "HEAD");
    if (head !== provider.commit)
        fail("AUTHORED_CONTENT_PROVIDER_COMMIT_DRIFT", `provider HEAD is ${head}; expected ${provider.commit}.`);
    const version = (await readStrictJson(path.join(root, "package.json"), "LayaAir package manifest") as any)?.version;
    if (version !== provider.packageVersion)
        fail("AUTHORED_CONTENT_PROVIDER_VERSION_DRIFT", `provider package version is ${JSON.stringify(version)}; expected ${provider.packageVersion}.`);
    const remoteUrl = await git(root, "remote", "get-url", provider.remote.name);
    if (remoteUrl !== provider.remote.url)
        fail("AUTHORED_CONTENT_PROVIDER_REMOTE_DRIFT", `provider remote URL is ${remoteUrl}; expected ${provider.remote.url}.`);
    const remoteCommit = await git(root, "rev-parse", provider.remote.ref);
    if (remoteCommit !== provider.remote.commit)
        fail("AUTHORED_CONTENT_PROVIDER_REMOTE_REF_DRIFT", `provider remote ref is ${remoteCommit}; expected ${provider.remote.commit}.`);

    const ledgerPath = await containedProviderFile(root, provider.capabilityLedger.path);
    const ledgerHandle = await open(ledgerPath, "r");
    try {
        const ledgerIdentity = await ledgerHandle.stat();
        await requirePathIdentity(ledgerPath, ledgerIdentity, "before ledger authentication");
        const ledgerBytes = await readExactHandle(ledgerHandle, ledgerIdentity.size);
        const afterAuthentication = await ledgerHandle.stat();
        requireSameSnapshot(ledgerIdentity, afterAuthentication, "capability ledger changed while it was authenticated");
        const ledgerHash = canonicalLfSha256(ledgerBytes, "authored-content capability ledger");
        if (ledgerHash !== provider.capabilityLedger.sha256)
            fail("AUTHORED_CONTENT_PROVIDER_LEDGER_DRIFT", `provider capability ledger digest is ${ledgerHash}; expected ${provider.capabilityLedger.sha256}.`);
        const ledger = parseStrictJsonBytes(ledgerBytes, "authored-content capability ledger") as any;
        if (ledger?.schema !== provider.capabilityLedger.schema || ledger?.hashMode !== provider.capabilityLedger.hashMode)
            fail("AUTHORED_CONTENT_PROVIDER_LEDGER_IDENTITY", "provider capability ledger schema or hash mode drifted.");
        if (!Array.isArray(ledger.capabilities))
            fail("AUTHORED_CONTENT_PROVIDER_LEDGER_CAPABILITIES", "provider capability ledger has no capability array.");
        const capabilities = new Map<string, any>();
        for (const [index, item] of ledger.capabilities.entries()) {
            if (!item || typeof item !== "object" || typeof item.id !== "string" || !DISPOSITIONS.has(item.status))
                fail("AUTHORED_CONTENT_PROVIDER_LEDGER_ROW", `provider capability row ${index} is invalid.`);
            if (capabilities.has(item.id))
                fail("AUTHORED_CONTENT_PROVIDER_LEDGER_DUPLICATE", `provider capability ${item.id} is duplicated.`);
            capabilities.set(item.id, item);
        }

        const holds: AuthoredContentHold[] = [];
        if (provider.commit !== provider.remote.commit) {
            holds.push({
                code: "AUTHORED_CONTENT_PROVIDER_UNPUBLISHED",
                jobId: null,
                capability: null,
                message: `Provider commit ${provider.commit} is not the authenticated published ref ${provider.remote.commit}.`
            });
        }
        let requiresAuthoritativeEvidence = false;
        for (const job of project.jobs) {
            for (const capabilityId of job.requiredCapabilities) {
                const capability = capabilities.get(capabilityId);
                if (!capability)
                    fail("AUTHORED_CONTENT_REQUIRED_CAPABILITY_UNKNOWN", `${job.id} requests unknown capability ${capabilityId}.`);
                if (capability.status === "blocking" || capability.status === "evidence") {
                    holds.push({
                        code: capability.status === "blocking"
                            ? "AUTHORED_CONTENT_CAPABILITY_BLOCKING"
                            : "AUTHORED_CONTENT_CAPABILITY_EVIDENCE_ONLY",
                        jobId: job.id,
                        capability: capabilityId,
                        message: capability.status === "blocking"
                            ? String(capability.blockingReason || `Capability ${capabilityId} is blocking.`)
                            : `Capability ${capabilityId} is evidence-only and cannot emit production output.`
                    });
                }
                else if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) {
                    fail("AUTHORED_CONTENT_CAPABILITY_EVIDENCE_MISSING", `admitted capability ${capabilityId} has no evidence.`);
                }
                else requiresAuthoritativeEvidence = true;
            }
        }

        const toolingSourceSha256 = await providerToolingSourceSha256(root);
        if (toolingSourceSha256 !== AUTHORED_CONTENT_TOOL_SOURCE_SHA256)
            fail("AUTHORED_CONTENT_PROVIDER_TOOLING_DRIFT", "running tooling does not match the authenticated provider commit.");
        if (requiresAuthoritativeEvidence)
            await (hooks.verifyEvidence ?? authoritativeEvidenceVerification)(root, ledgerBytes);
        const afterEvidenceBytes = await readExactHandle(ledgerHandle, ledgerIdentity.size);
        const afterEvidence = await ledgerHandle.stat();
        requireSameSnapshot(ledgerIdentity, afterEvidence, "capability ledger changed during authoritative evidence verification");
        if (!afterEvidenceBytes.equals(ledgerBytes))
            fail("AUTHORED_CONTENT_PROVIDER_LEDGER_MUTATED", "capability ledger bytes changed during authoritative evidence verification.");
        await requirePathIdentity(ledgerPath, ledgerIdentity, "after authoritative evidence verification");
        await requireCleanProvider(root);

        const receipt: AuthoredContentProviderReceipt = {
            repository: "LayaAir",
            commit: provider.commit,
            packageVersion: provider.packageVersion,
            remote: provider.remote,
            published: provider.commit === provider.remote.commit,
            capabilityLedger: provider.capabilityLedger,
            tooling: {
                package: "@layabox/laya-authored-content",
                version: AUTHORED_CONTENT_TOOL_VERSION,
                commit: provider.commit,
                sourceSha256: toolingSourceSha256
            }
        };
        return { receipt, holds: holds.sort(compareHold) };
    }
    finally { await ledgerHandle.close(); }
}

async function readExactHandle(handle: FileHandle, size: number): Promise<Buffer> {
    if (!Number.isSafeInteger(size) || size < 0)
        fail("AUTHORED_CONTENT_PROVIDER_LEDGER_SIZE", "capability ledger size is not a safe integer.");
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
        const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
        if (bytesRead === 0)
            fail("AUTHORED_CONTENT_PROVIDER_LEDGER_MUTATED", "capability ledger ended before its authenticated size.");
        offset += bytesRead;
    }
    const sentinel = Buffer.alloc(1);
    if ((await handle.read(sentinel, 0, 1, size)).bytesRead !== 0)
        fail("AUTHORED_CONTENT_PROVIDER_LEDGER_MUTATED", "capability ledger grew beyond its authenticated size.");
    return bytes;
}

function requireSameSnapshot(before: Awaited<ReturnType<FileHandle["stat"]>>, after: Awaited<ReturnType<FileHandle["stat"]>>, message: string): void {
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        fail("AUTHORED_CONTENT_PROVIDER_LEDGER_MUTATED", `${message}.`);
}

async function requirePathIdentity(file: string, identity: Awaited<ReturnType<FileHandle["stat"]>>, phase: string): Promise<void> {
    const direct = await lstat(file);
    if (direct.isSymbolicLink() || !direct.isFile() || direct.dev !== identity.dev || direct.ino !== identity.ino)
        fail("AUTHORED_CONTENT_PROVIDER_LEDGER_IDENTITY", `capability ledger path identity drifted ${phase}.`);
    const resolved = await realpath(file);
    if (!samePath(resolved, file))
        fail("AUTHORED_CONTENT_PROVIDER_LEDGER_IDENTITY", `capability ledger path resolution drifted ${phase}.`);
}

function samePath(left: string, right: string): boolean {
    return process.platform === "win32" ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US") : left === right;
}

async function containedProviderFile(root: string, relative: string): Promise<string> {
    let cursor = root;
    for (const part of relative.split("/")) {
        cursor = path.join(cursor, part);
        const info = await lstat(cursor);
        if (info.isSymbolicLink()) fail("AUTHORED_CONTENT_PROVIDER_SYMLINK", `provider path ${relative} traverses a symbolic link.`);
    }
    const resolved = await realpath(cursor);
    const containment = path.relative(root, resolved);
    if (containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment))
        fail("AUTHORED_CONTENT_PROVIDER_ESCAPE", `provider path ${relative} escaped the provider root.`);
    const info = await lstat(resolved);
    if (!info.isFile() || info.isSymbolicLink())
        fail("AUTHORED_CONTENT_PROVIDER_FILE", `provider path ${relative} must be a regular file.`);
    return resolved;
}

async function realDirectory(value: string): Promise<string> {
    const resolved = await realpath(path.resolve(value));
    const info = await lstat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink())
        fail("AUTHORED_CONTENT_PROVIDER_ROOT", "provider root must be a real directory.");
    return resolved;
}

async function git(root: string, ...arguments_: string[]): Promise<string> {
    try {
        const result = await execute("git", ["-C", root, ...arguments_], { encoding: "utf8", windowsHide: true });
        return result.stdout.trim();
    }
    catch (error) {
        throw new AuthoredContentToolError("AUTHORED_CONTENT_PROVIDER_GIT", `git ${arguments_.join(" ")} failed.`, { cause: error as Error });
    }
}

async function requireCleanProvider(root: string): Promise<void> {
    const status = await git(root, "status", "--porcelain=v1", "--untracked-files=all");
    if (status) fail("AUTHORED_CONTENT_PROVIDER_DIRTY", "provider checkout must exactly match its authenticated commit.");
}

async function providerToolingSourceSha256(root: string): Promise<string> {
    const listing = await git(root, "ls-tree", "-r", "--full-tree", "HEAD", "--",
        "package.json",
        "src/extensions/authoredContent/scripts/buildTooling.mjs",
        "src/extensions/authoredContent/tooling",
        "src/extensions/authoredContent/tsconfig.tooling.json",
        "tooling/layaAuthoredContent");
    return sha256(`${listing.replace(/\r\n?/g, "\n")}\n`);
}

async function authoritativeEvidenceVerification(root: string, authenticatedLedgerBytes: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        const child = spawn(process.execPath, [
            path.join(root, "scripts/checkAuthoredContentAdmission.mjs"),
            "--verify-evidence",
            "--capability-ledger-stdin"
        ], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", error => reject(new AuthoredContentToolError(
            "AUTHORED_CONTENT_PROVIDER_EVIDENCE_REJECTED",
            "authoritative capability evidence verification failed to start.",
            { cause: error }
        )));
        child.on("exit", code => code === 0 ? resolve() : reject(new AuthoredContentToolError(
            "AUTHORED_CONTENT_PROVIDER_EVIDENCE_REJECTED",
            `authoritative capability evidence verification failed with exit ${code}: ${(stderr || stdout).trim()}`
        )));
        child.stdin.on("error", error => reject(new AuthoredContentToolError(
            "AUTHORED_CONTENT_PROVIDER_EVIDENCE_REJECTED",
            "authoritative capability evidence verification rejected authenticated ledger input.",
            { cause: error }
        )));
        child.stdin.end(authenticatedLedgerBytes);
    });
}

function compareHold(left: AuthoredContentHold, right: AuthoredContentHold): number {
    const a = `${left.jobId ?? ""}\0${left.capability ?? ""}\0${left.code}`;
    const b = `${right.jobId ?? ""}\0${right.capability ?? ""}\0${right.code}`;
    return a < b ? -1 : a > b ? 1 : 0;
}

function fail(code: string, message: string): never {
    throw new AuthoredContentToolError(code, message);
}
