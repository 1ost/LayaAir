export const AUTHORED_CONTENT_PROJECT_SCHEMA = "laya-authored-content-project@1" as const;
export const AUTHORED_CONTENT_RECEIPT_SCHEMA = "laya-authored-content-receipt@1" as const;
export const AUTHORED_CONTENT_TOOL_VERSION = "0.1.0" as const;

export type AuthoredContentCommand = "check" | "convert" | "publish";
export type AuthoredContentInputKind = "raw-swf" | "raw-swc" | "evidence-bundle" | "neutral-ir";
export type AuthoredContentDisposition = "native" | "declarative" | "typescript-obligation" | "evidence" | "blocking";

export interface AuthoredContentProjectProviderRemote {
    readonly name: string;
    readonly url: string;
    readonly ref: string;
    readonly commit: string;
}

export interface AuthoredContentCapabilityLedgerLock {
    readonly path: string;
    readonly schema: "laya-authored-content-capabilities@1";
    readonly hashMode: "canonical-lf-utf8";
    readonly sha256: string;
}

export interface AuthoredContentProjectProvider {
    readonly repository: "LayaAir";
    readonly commit: string;
    readonly packageVersion: string;
    readonly remote: AuthoredContentProjectProviderRemote;
    readonly capabilityLedger: AuthoredContentCapabilityLedgerLock;
}

export interface AuthoredContentProjectInput {
    readonly kind: AuthoredContentInputKind;
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
}

export interface AuthoredContentProjectJob {
    readonly id: string;
    readonly input: AuthoredContentProjectInput;
    readonly entries: readonly string[];
    readonly locales: readonly string[];
    readonly output: string;
    /** Scheduling expectation only. The selected Laya adapter must rediscover the exact set before admission. */
    readonly requiredCapabilities: readonly string[];
}

export interface AuthoredContentProject {
    readonly schema: typeof AUTHORED_CONTENT_PROJECT_SCHEMA;
    readonly provider: AuthoredContentProjectProvider;
    readonly jobs: readonly AuthoredContentProjectJob[];
}

export interface ConvertAuthoredContentRequest {
    readonly command: AuthoredContentCommand;
    readonly projectPath: string;
    readonly workspaceRoot: string;
    readonly providerRoot: string;
    readonly outputRoot?: string;
}

export interface AuthoredContentHold {
    readonly code: string;
    readonly jobId: string | null;
    readonly capability: string | null;
    readonly message: string;
}

export interface AuthoredContentProviderReceipt {
    readonly repository: "LayaAir";
    readonly commit: string;
    readonly packageVersion: string;
    readonly remote: AuthoredContentProjectProviderRemote;
    readonly published: boolean;
    readonly capabilityLedger: AuthoredContentCapabilityLedgerLock;
}

export interface AuthoredContentInputReceipt {
    readonly jobId: string;
    readonly kind: AuthoredContentInputKind;
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
}

export interface AuthoredContentPublishedFile {
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
}

export interface AuthoredContentConversionReceiptSubject {
    readonly schema: typeof AUTHORED_CONTENT_RECEIPT_SCHEMA;
    readonly toolVersion: typeof AUTHORED_CONTENT_TOOL_VERSION;
    readonly command: AuthoredContentCommand;
    readonly status: "hold" | "checked" | "converted" | "published" | "unchanged";
    readonly projectSha256: string;
    readonly requestSha256: string;
    readonly provider: AuthoredContentProviderReceipt;
    readonly inputs: readonly AuthoredContentInputReceipt[];
    readonly inventory: readonly AuthoredContentPublishedFile[];
    readonly inventorySha256: string;
    readonly holds: readonly AuthoredContentHold[];
}

export interface AuthoredContentConversionReceipt extends AuthoredContentConversionReceiptSubject {
    readonly receiptSubjectSha256: string;
}

export interface ConvertAuthoredContentResult {
    readonly exitCode: 0 | 2;
    readonly receipt: AuthoredContentConversionReceipt;
}

export class AuthoredContentToolError extends Error {
    readonly code: string;
    readonly exitCode: 1 | 2;

    constructor(code: string, message: string, options?: ErrorOptions & { readonly exitCode?: 1 | 2 }) {
        super(`${code}: ${message}`, options);
        this.name = "AuthoredContentToolError";
        this.code = code;
        this.exitCode = options?.exitCode ?? 2;
    }
}
