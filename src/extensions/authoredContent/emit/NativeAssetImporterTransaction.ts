import { NativeAuthoredContentTransaction } from "./NativeLayaHierarchyWriter";

export interface NativeAssetTransactionHost {
    readonly fs: {
        readonly constants: { readonly COPYFILE_EXCL: number };
        readonly promises: {
            copyFile(source: string, destination: string, flags: number): Promise<void>;
            lstat(file: string): Promise<{ isFile(): boolean }>;
            mkdir(directory: string, options: { recursive: boolean }): Promise<unknown>;
            readFile(file: string): Promise<Uint8Array>;
            rename(source: string, destination: string): Promise<void>;
            rm(file: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
            writeFile(file: string, bytes: Uint8Array | string, options?: { flag?: string }): Promise<void>;
        };
    };
    readonly path: {
        readonly sep: string;
        dirname(file: string): string;
        join(...parts: string[]): string;
        relative(from: string, to: string): string;
        resolve(...parts: string[]): string;
    };
    sha256(bytes: Uint8Array): string;
}

export type NativeAssetTransactionEvent =
    | "before-target-verify"
    | "after-backup"
    | "before-install"
    | "after-install"
    | "before-rollback-remove"
    | "before-rollback-restore";

export interface NativeAssetTransactionEventContext {
    readonly event: NativeAssetTransactionEvent;
    readonly relativePath: string;
    readonly target: string;
    readonly backup?: string;
}

export type NativeAssetTransactionHook = (
    context: NativeAssetTransactionEventContext
) => void | Promise<void>;

interface FileAuthority {
    readonly byteLength: number;
    readonly sha256: string;
}

interface TargetAuthority extends FileAuthority {
    readonly exists: true;
}

interface MissingTargetAuthority {
    readonly exists: false;
}

type InitialTargetAuthority = TargetAuthority | MissingTargetAuthority;

interface StagedFile {
    readonly relativePath: string;
    readonly stagePath: string;
    readonly target: string;
    readonly authority: FileAuthority;
}

interface BackupFile {
    readonly relativePath: string;
    readonly target: string;
    readonly backup: string;
    readonly authority: TargetAuthority;
}

interface InstalledFile {
    readonly relativePath: string;
    readonly target: string;
    readonly authority: FileAuthority;
}

/**
 * Real filesystem transaction for an authenticated native authored-content
 * bundle. Target state is snapshotted before the first staged byte and every
 * commit/rollback move is reauthenticated at its final path.
 */
export class NativeAssetImporterTransaction implements NativeAuthoredContentTransaction {
    readonly recoveryPath: string;

    private readonly root: string;
    private readonly staged = new Map<string, StagedFile>();
    private readonly initialTargets = new Map<string, InitialTargetAuthority>();
    private readonly backups = new Map<string, BackupFile>();
    private readonly installed = new Map<string, InstalledFile>();
    private initialized = false;
    private readonly host: NativeAssetTransactionHost;

    constructor(
        tempPath: string,
        private readonly targets: ReadonlyMap<string, string>,
        private readonly hook?: NativeAssetTransactionHook,
        host?: NativeAssetTransactionHost
    ) {
        this.host = host ?? createNativeAssetTransactionHost();
        const { path } = this.host;
        this.root = path.resolve(tempPath, "authored-content-native-transaction");
        this.recoveryPath = path.join(this.root, "recovery.json");
        const normalizedTargets = new Set<string>();
        for (const [relativePath, target] of targets) {
            if (!isCanonicalRelativePath(relativePath))
                fail("TARGET_PATH_INVALID", relativePath);
            const resolved = path.resolve(target);
            if (resolved === this.root || resolved.startsWith(`${this.root}${path.sep}`))
                fail("TARGET_INSIDE_TRANSACTION", `Output target '${target}' is inside transaction staging.`);
            const identity = path.sep === "\\" ? resolved.toLocaleLowerCase("en-US") : resolved;
            if (normalizedTargets.has(identity))
                fail("TARGET_COLLISION", `Output target '${target}' is duplicated.`);
            normalizedTargets.add(identity);
        }
    }

    async stage(relativePath: string, bytes: Uint8Array): Promise<void> {
        const { fs, path } = this.host;
        if (!isCanonicalRelativePath(relativePath))
            fail("STAGE_PATH_INVALID", relativePath);
        const targetValue = this.targets.get(relativePath);
        if (!targetValue)
            fail("TARGET_UNKNOWN", relativePath);
        if (this.staged.has(relativePath))
            fail("STAGE_DUPLICATE", relativePath);
        if (!(bytes instanceof Uint8Array))
            fail("STAGE_BYTES_INVALID", relativePath);
        await this.initialize();
        const target = path.resolve(targetValue);
        const stagePath = path.join(this.root, "staged", ...relativePath.split("/"));
        await fs.promises.mkdir(path.dirname(stagePath), { recursive: true });
        await fs.promises.writeFile(stagePath, new Uint8Array(bytes), { flag: "wx" });
        const authority = authorityForBytes(bytes, this.host);
        await assertFileAuthority(stagePath, authority, `staged '${relativePath}'`, this.host);
        this.staged.set(relativePath, { relativePath, stagePath, target, authority });
    }

    async commit(): Promise<void> {
        const { fs, path } = this.host;
        if (!this.initialized || this.staged.size !== this.targets.size)
            fail("CLOSURE_MISMATCH", "Not every output target was staged.");
        for (const [relativePath] of sortedTargets(this.targets)) {
            const staged = this.staged.get(relativePath)!;
            const initial = this.initialTargets.get(staged.target)!;
            await this.emit("before-target-verify", staged);
            await assertTargetAuthority(staged.target, initial, `target '${relativePath}'`, this.host);
            await assertFileAuthority(staged.stagePath, staged.authority, `staged '${relativePath}'`, this.host);
            await fs.promises.mkdir(path.dirname(staged.target), { recursive: true });

            let backup: BackupFile | undefined;
            if (initial.exists) {
                const backupPath = path.join(this.root, "backup", `${this.backups.size}`);
                await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
                await fs.promises.rename(staged.target, backupPath);
                backup = {
                    relativePath,
                    target: staged.target,
                    backup: backupPath,
                    authority: initial
                };
                this.backups.set(staged.target, backup);
                await assertFileAuthority(backupPath, initial, `backup '${relativePath}'`, this.host);
                await assertMissing(staged.target, `target '${relativePath}' after backup`, this.host);
                await this.emit("after-backup", staged, backupPath);
            }

            await assertMissing(staged.target, `target '${relativePath}' before install`, this.host);
            await this.emit("before-install", staged, backup?.backup);
            await fs.promises.copyFile(staged.stagePath, staged.target, fs.constants.COPYFILE_EXCL);
            const installed = { relativePath, target: staged.target, authority: staged.authority };
            this.installed.set(staged.target, installed);
            await assertFileAuthority(staged.target, staged.authority, `installed '${relativePath}'`, this.host);
            await this.emit("after-install", staged, backup?.backup);
        }

        try {
            await fs.promises.rm(this.root, { recursive: true, force: true });
        }
        catch {
            // Every output is authenticated and committed. Cleanup is
            // recoverable housekeeping; never roll valid outputs back after a
            // potentially partial backup cleanup.
        }
        this.clearJournal();
    }

    async rollback(): Promise<void> {
        const { fs, path } = this.host;
        if (!this.initialized)
            return;
        const failures: Error[] = [];
        for (const installed of [...this.installed.values()].reverse()) {
            try {
                await this.emit("before-rollback-remove", installed);
                const quarantine = path.join(this.root, "rollback", `installed-${failures.length}-${this.installed.size}`);
                await fs.promises.mkdir(path.dirname(quarantine), { recursive: true });
                await fs.promises.rename(installed.target, quarantine);
                try {
                    await assertFileAuthority(quarantine, installed.authority, `rollback installed '${installed.relativePath}'`, this.host);
                    await fs.promises.rm(quarantine, { force: true });
                }
                catch (error) {
                    if (await isMissing(installed.target, this.host))
                        await fs.promises.rename(quarantine, installed.target);
                    throw error;
                }
            }
            catch (error) {
                failures.push(asError(error));
            }
        }

        for (const backup of [...this.backups.values()].reverse()) {
            try {
                await this.emit("before-rollback-restore", {
                    relativePath: backup.relativePath,
                    target: backup.target,
                    stagePath: "",
                    authority: backup.authority
                }, backup.backup);
                await assertMissing(backup.target, `rollback target '${backup.relativePath}'`, this.host);
                await assertFileAuthority(backup.backup, backup.authority, `rollback backup '${backup.relativePath}'`, this.host);
                await fs.promises.mkdir(path.dirname(backup.target), { recursive: true });
                await fs.promises.copyFile(backup.backup, backup.target, fs.constants.COPYFILE_EXCL);
                await assertFileAuthority(backup.target, backup.authority, `restored '${backup.relativePath}'`, this.host);
                await fs.promises.rm(backup.backup, { force: true });
            }
            catch (error) {
                failures.push(asError(error));
            }
        }

        if (failures.length !== 0) {
            try {
                await fs.promises.mkdir(this.root, { recursive: true });
                await fs.promises.writeFile(this.recoveryPath, `${JSON.stringify({
                    schema: "laya-authored-content-recovery@1",
                    failures: failures.map(error => error.message),
                    backups: [...this.backups.values()].map(backup => ({
                        relativePath: backup.relativePath,
                        target: backup.target,
                        backup: backup.backup
                    }))
                }, null, 2)}\n`, { flag: "wx" });
            }
            catch (evidenceError) {
                failures.push(asError(evidenceError));
            }
            throw aggregateFailure(
                `AUTHORED_CONTENT_NATIVE_TRANSACTION_ROLLBACK_INCOMPLETE: ${this.root}`,
                failures
            );
        }

        await fs.promises.rm(this.root, { recursive: true, force: true });
        this.clearJournal();
    }

    private async initialize(): Promise<void> {
        const { fs, path } = this.host;
        if (this.initialized)
            return;
        await fs.promises.rm(this.root, { recursive: true, force: true });
        await fs.promises.mkdir(this.root, { recursive: true });
        for (const [, targetValue] of sortedTargets(this.targets)) {
            const target = path.resolve(targetValue);
            this.initialTargets.set(target, await readInitialTargetAuthority(target, this.host));
        }
        this.initialized = true;
    }

    private async emit(event: NativeAssetTransactionEvent, file: StagedFile | InstalledFile, backup?: string): Promise<void> {
        await this.hook?.({ event, relativePath: file.relativePath, target: file.target, backup });
    }

    private clearJournal(): void {
        this.staged.clear();
        this.initialTargets.clear();
        this.backups.clear();
        this.installed.clear();
        this.initialized = false;
    }
}

function sortedTargets(targets: ReadonlyMap<string, string>): Array<[string, string]> {
    return [...targets].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function isCanonicalRelativePath(value: string): boolean {
    return typeof value === "string" && value.length > 0 && !value.includes("\\")
        && !value.startsWith("/") && !/^[A-Za-z]:/.test(value)
        && value.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

async function readInitialTargetAuthority(file: string, host: NativeAssetTransactionHost): Promise<InitialTargetAuthority> {
    const { fs } = host;
    try {
        const stat = await fs.promises.lstat(file);
        if (!stat.isFile())
            fail("TARGET_NOT_REGULAR_FILE", file);
        const bytes = await fs.promises.readFile(file);
        return { exists: true, ...authorityForBytes(bytes, host) };
    }
    catch (error) {
        if (isMissingError(error))
            return { exists: false };
        throw error;
    }
}

async function assertTargetAuthority(
    file: string,
    expected: InitialTargetAuthority,
    label: string,
    host: NativeAssetTransactionHost
): Promise<void> {
    if (!expected.exists) {
        await assertMissing(file, label, host);
        return;
    }
    await assertFileAuthority(file, expected, label, host);
}

async function assertFileAuthority(
    file: string,
    expected: FileAuthority,
    label: string,
    host: NativeAssetTransactionHost
): Promise<void> {
    const { fs } = host;
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile())
        fail("FILE_AUTHORITY_MISMATCH", `${label} is not a regular file.`);
    const bytes = await fs.promises.readFile(file);
    const received = authorityForBytes(bytes, host);
    if (received.byteLength !== expected.byteLength || received.sha256 !== expected.sha256)
        fail("FILE_AUTHORITY_MISMATCH", `${label} bytes drifted.`);
}

async function assertMissing(file: string, label: string, host: NativeAssetTransactionHost): Promise<void> {
    if (!await isMissing(file, host))
        fail("TARGET_RECREATED", `${label} unexpectedly exists.`);
}

async function isMissing(file: string, host: NativeAssetTransactionHost): Promise<boolean> {
    const { fs } = host;
    try {
        await fs.promises.lstat(file);
        return false;
    }
    catch (error) {
        if (isMissingError(error))
            return true;
        throw error;
    }
}

function isMissingError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function authorityForBytes(bytes: Uint8Array, host: NativeAssetTransactionHost): FileAuthority {
    return {
        byteLength: bytes.byteLength,
        sha256: host.sha256(bytes)
    };
}

export function createNativeAssetTransactionHost(): NativeAssetTransactionHost {
    const fs = IEditorEnv.require("fs") as NativeAssetTransactionHost["fs"];
    const path = IEditorEnv.require("path") as NativeAssetTransactionHost["path"];
    const crypto = IEditorEnv.require("crypto") as {
        createHash(algorithm: "sha256"): { update(bytes: Uint8Array): any; digest(encoding: "hex"): string };
    };
    return {
        fs,
        path,
        sha256: bytes => crypto.createHash("sha256").update(bytes).digest("hex")
    };
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

function aggregateFailure(message: string, errors: ReadonlyArray<Error>): Error & { readonly errors: ReadonlyArray<Error> } {
    return Object.assign(new Error(message), { errors: Object.freeze([...errors]) });
}

function fail(code: string, detail: string): never {
    throw new Error(`AUTHORED_CONTENT_NATIVE_TRANSACTION_${code}: ${detail}`);
}
