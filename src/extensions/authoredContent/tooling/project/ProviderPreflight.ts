import path from "node:path";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";

import {
    AuthoredContentDisposition,
    AuthoredContentHold,
    AuthoredContentProject,
    AuthoredContentProviderReceipt,
    AuthoredContentToolError
} from "../types.js";
import { canonicalLfSha256, readStrictJson } from "./CanonicalJson.js";

const execute = promisify(execFile);
const DISPOSITIONS = new Set<AuthoredContentDisposition>(["native", "declarative", "typescript-obligation", "evidence", "blocking"]);

export interface AuthoredContentProviderPreflight {
    readonly receipt: AuthoredContentProviderReceipt;
    readonly holds: readonly AuthoredContentHold[];
}

export async function preflightAuthoredContentProvider(
    project: AuthoredContentProject,
    providerRoot: string
): Promise<AuthoredContentProviderPreflight> {
    const root = await realDirectory(providerRoot);
    const provider = project.provider;
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
    const ledgerBytes = await readFile(ledgerPath);
    const ledgerHash = canonicalLfSha256(ledgerBytes, "authored-content capability ledger");
    if (ledgerHash !== provider.capabilityLedger.sha256)
        fail("AUTHORED_CONTENT_PROVIDER_LEDGER_DRIFT", `provider capability ledger digest is ${ledgerHash}; expected ${provider.capabilityLedger.sha256}.`);
    const ledger = await readStrictJson(ledgerPath, "authored-content capability ledger") as any;
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
        }
    }

    const receipt: AuthoredContentProviderReceipt = {
        repository: "LayaAir",
        commit: provider.commit,
        packageVersion: provider.packageVersion,
        remote: provider.remote,
        published: provider.commit === provider.remote.commit,
        capabilityLedger: provider.capabilityLedger
    };
    return { receipt, holds: holds.sort(compareHold) };
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

function compareHold(left: AuthoredContentHold, right: AuthoredContentHold): number {
    const a = `${left.jobId ?? ""}\0${left.capability ?? ""}\0${left.code}`;
    const b = `${right.jobId ?? ""}\0${right.capability ?? ""}\0${right.code}`;
    return a < b ? -1 : a > b ? 1 : 0;
}

function fail(code: string, message: string): never {
    throw new AuthoredContentToolError(code, message);
}
