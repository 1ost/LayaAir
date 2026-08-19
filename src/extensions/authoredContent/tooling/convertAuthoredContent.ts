import path from "node:path";

import {
    AUTHORED_CONTENT_RECEIPT_SCHEMA,
    AUTHORED_CONTENT_TOOL_VERSION,
    AuthoredContentConversionReceipt,
    AuthoredContentConversionReceiptSubject,
    AuthoredContentHold,
    AuthoredContentToolError,
    ConvertAuthoredContentRequest,
    ConvertAuthoredContentResult
} from "./types.js";
import { loadAuthoredContentProject, verifyProjectInputs } from "./project/AuthoredContentProject.js";
import { canonicalJsonSha256 } from "./project/CanonicalJson.js";
import { preflightAuthoredContentProvider } from "./project/ProviderPreflight.js";

/**
 * Headless LayaAir authored-content entrypoint. The first production slice is
 * deliberately fail-closed: it authenticates the entire request, provider,
 * capability ledger, and inputs, then returns HOLD until a Node-safe adapter
 * is admitted. IDE-only importers are never loaded by this package.
 */
export async function convertAuthoredContent(requestValue: ConvertAuthoredContentRequest): Promise<ConvertAuthoredContentResult> {
    const request = validateRequest(requestValue);
    const loaded = await loadAuthoredContentProject(request.projectPath);
    const inputs = await verifyProjectInputs(loaded.value, request.workspaceRoot);
    const provider = await preflightAuthoredContentProvider(loaded.value, request.providerRoot);
    const holds: AuthoredContentHold[] = [...provider.holds];

    for (const job of loaded.value.jobs) {
        holds.push({
            code: "AUTHORED_CONTENT_INPUT_ADAPTER_HOLD",
            jobId: job.id,
            capability: null,
            message: `No admitted headless LayaAir adapter is registered for ${job.input.kind}; no output was written.`
        });
    }
    holds.sort(compareHold);

    const requestIdentity = {
        schema: "laya-authored-content-request-identity@1",
        command: request.command,
        projectSha256: loaded.canonicalSha256,
        providerCommit: loaded.value.provider.commit,
        inputs: inputs.map(input => ({ jobId: input.jobId, sha256: input.sha256, size: input.size }))
    };
    const subject: AuthoredContentConversionReceiptSubject = {
        schema: AUTHORED_CONTENT_RECEIPT_SCHEMA,
        toolVersion: AUTHORED_CONTENT_TOOL_VERSION,
        command: request.command,
        status: "hold",
        projectSha256: loaded.canonicalSha256,
        requestSha256: canonicalJsonSha256(requestIdentity),
        provider: provider.receipt,
        inputs,
        inventory: [],
        inventorySha256: canonicalJsonSha256([]),
        holds
    };
    const receipt: AuthoredContentConversionReceipt = {
        ...subject,
        receiptSubjectSha256: canonicalJsonSha256(subject)
    };
    return { exitCode: 2, receipt };
}

function validateRequest(value: ConvertAuthoredContentRequest): Required<Omit<ConvertAuthoredContentRequest, "outputRoot">> & Pick<ConvertAuthoredContentRequest, "outputRoot"> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("AUTHORED_CONTENT_REQUEST", "request must be an object.");
    const source = value as unknown as Record<string, unknown>;
    const allowed = new Set(["command", "outputRoot", "projectPath", "providerRoot", "workspaceRoot"]);
    for (const key of Object.keys(source)) if (!allowed.has(key)) fail("AUTHORED_CONTENT_REQUEST_KEYS", `request contains unsupported key ${key}.`);
    if (source.command !== "check" && source.command !== "convert" && source.command !== "publish")
        fail("AUTHORED_CONTENT_COMMAND", "command must be check, convert, or publish.");
    const projectPath = absolutePath(source.projectPath, "projectPath");
    const workspaceRoot = absolutePath(source.workspaceRoot, "workspaceRoot");
    const providerRoot = absolutePath(source.providerRoot, "providerRoot");
    let outputRoot: string | undefined;
    if (source.outputRoot !== undefined) outputRoot = absolutePath(source.outputRoot, "outputRoot");
    if ((source.command === "convert" || source.command === "publish") && !outputRoot)
        fail("AUTHORED_CONTENT_OUTPUT_REQUIRED", `${source.command} requires outputRoot.`);
    return { command: source.command, projectPath, workspaceRoot, providerRoot, outputRoot };
}

function absolutePath(value: unknown, label: string): string {
    if (typeof value !== "string" || value !== value.trim() || !path.isAbsolute(value) || value.includes("\0"))
        fail("AUTHORED_CONTENT_REQUEST_PATH", `${label} must be an absolute path.`);
    return path.normalize(value);
}

function compareHold(left: AuthoredContentHold, right: AuthoredContentHold): number {
    const a = `${left.jobId ?? ""}\0${left.capability ?? ""}\0${left.code}`;
    const b = `${right.jobId ?? ""}\0${right.capability ?? ""}\0${right.code}`;
    return a < b ? -1 : a > b ? 1 : 0;
}

function fail(code: string, message: string): never {
    throw new AuthoredContentToolError(code, message, { exitCode: 1 });
}
