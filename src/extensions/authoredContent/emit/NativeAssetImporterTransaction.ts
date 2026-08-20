import { NativeAuthoredContentTransaction } from "./NativeLayaHierarchyWriter";

export interface NativeAssetTransactionHost {
    readonly fs: {
        readonly constants: { readonly COPYFILE_EXCL: number };
        readonly promises: {
            copyFile(source: string, destination: string, flags: number): Promise<void>;
            lstat(file: string): Promise<{ isFile(): boolean }>;
            mkdir(directory: string, options: { recursive: boolean }): Promise<unknown>;
            open(file: string, flags: string): Promise<{
                writeFile(bytes: Uint8Array | string): Promise<void>;
                sync(): Promise<void>;
                close(): Promise<void>;
            }>;
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
    | "after-backup-journal"
    | "after-backup"
    | "after-install-journal"
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

interface RecoveryJournal {
    readonly schema: "laya-authored-content-recovery@2";
    readonly targets: ReadonlyArray<{ readonly relativePath: string; readonly target: string }>;
    readonly installed: ReadonlyArray<InstalledFile>;
    readonly backups: ReadonlyArray<BackupFile>;
    readonly failures: ReadonlyArray<string>;
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
                backup = {
                    relativePath,
                    target: staged.target,
                    backup: backupPath,
                    authority: initial
                };
                this.backups.set(staged.target, backup);
                await this.persistJournal();
                await this.emit("after-backup-journal", staged, backupPath);
                await fs.promises.rename(staged.target, backupPath);
                await this.persistJournal();
                await assertFileAuthority(backupPath, initial, `backup '${relativePath}'`, this.host);
                await assertMissing(staged.target, `target '${relativePath}' after backup`, this.host);
                await this.emit("after-backup", staged, backupPath);
            }

            await assertMissing(staged.target, `target '${relativePath}' before install`, this.host);
            await this.emit("before-install", staged, backup?.backup);
            const installed = { relativePath, target: staged.target, authority: staged.authority };
            this.installed.set(staged.target, installed);
            await this.persistJournal();
            await this.emit("after-install-journal", staged, backup?.backup);
            await fs.promises.copyFile(staged.stagePath, staged.target, fs.constants.COPYFILE_EXCL);
            await this.persistJournal();
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
                if (await isMissing(installed.target, this.host)) {
                    this.installed.delete(installed.target);
                    await this.persistJournal();
                    continue;
                }
                await this.emit("before-rollback-remove", installed);
                const quarantine = path.join(this.root, "rollback", `installed-${failures.length}-${this.installed.size}`);
                await fs.promises.mkdir(path.dirname(quarantine), { recursive: true });
                await fs.promises.rename(installed.target, quarantine);
                try {
                    await assertFileAuthority(quarantine, installed.authority, `rollback installed '${installed.relativePath}'`, this.host);
                    await fs.promises.rm(quarantine, { force: true });
                    this.installed.delete(installed.target);
                    await this.persistJournal();
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
                if (await isMissing(backup.backup, this.host)) {
                    await assertFileAuthority(backup.target, backup.authority, `already restored '${backup.relativePath}'`, this.host);
                    this.backups.delete(backup.target);
                    await this.persistJournal();
                    continue;
                }
                await assertMissing(backup.target, `rollback target '${backup.relativePath}'`, this.host);
                await assertFileAuthority(backup.backup, backup.authority, `rollback backup '${backup.relativePath}'`, this.host);
                await fs.promises.mkdir(path.dirname(backup.target), { recursive: true });
                await fs.promises.copyFile(backup.backup, backup.target, fs.constants.COPYFILE_EXCL);
                await assertFileAuthority(backup.target, backup.authority, `restored '${backup.relativePath}'`, this.host);
                await fs.promises.rm(backup.backup, { force: true });
                this.backups.delete(backup.target);
                await this.persistJournal();
            }
            catch (error) {
                failures.push(asError(error));
            }
        }

        if (failures.length !== 0) {
            try {
                await this.persistJournal(failures);
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
        if (!await isMissing(this.root, this.host))
            fail("RECOVERY_PENDING", `Existing transaction state must be explicitly resumed and retired: ${this.recoveryPath}`);
        await fs.promises.mkdir(this.root, { recursive: true });
        for (const [, targetValue] of sortedTargets(this.targets)) {
            const target = path.resolve(targetValue);
            this.initialTargets.set(target, await readInitialTargetAuthority(target, this.host));
        }
        this.initialized = true;
        await this.persistJournal();
    }

    private async emit(event: NativeAssetTransactionEvent, file: StagedFile | InstalledFile, backup?: string): Promise<void> {
        await this.hook?.({ event, relativePath: file.relativePath, target: file.target, backup });
    }

    private async persistJournal(failures: ReadonlyArray<Error> = []): Promise<void> {
        await persistRecoveryJournal(this.root, {
            schema: "laya-authored-content-recovery@2",
            targets: sortedTargets(this.targets).map(([relativePath, target]) => ({
                relativePath,
                target: this.host.path.resolve(target)
            })),
            failures: failures.map(error => error.message),
            installed: [...this.installed.values()],
            backups: [...this.backups.values()]
        }, this.host);
    }

    private clearJournal(): void {
        this.staged.clear();
        this.initialTargets.clear();
        this.backups.clear();
        this.installed.clear();
        this.initialized = false;
    }
}

/**
 * Continues a retained rollback in a new editor process. The caller must
 * provide the exact logical target closure, preventing a forged journal from
 * naming arbitrary filesystem paths. Successful recovery remains durably
 * recorded as an empty journal until explicitly retired.
 */
export async function resumeNativeAssetImporterRecovery(
    tempPath: string,
    targets: ReadonlyMap<string, string>,
    host: NativeAssetTransactionHost = createNativeAssetTransactionHost()
): Promise<void> {
    const root = host.path.resolve(tempPath, "authored-content-native-transaction");
    const journal = await readRecoveryJournal(root, targets, host);
    const installed = new Map(journal.installed.map(file => [file.target, file]));
    const backups = new Map(journal.backups.map(file => [file.target, file]));
    const failures: Error[] = [];

    for (const file of [...installed.values()].reverse()) {
        try {
            if (!await isMissing(file.target, host)) {
                await assertFileAuthority(file.target, file.authority, `recovery installed '${file.relativePath}'`, host);
                const quarantine = host.path.join(root, "resume", `installed-${installed.size}`);
                await host.fs.promises.mkdir(host.path.dirname(quarantine), { recursive: true });
                await host.fs.promises.rename(file.target, quarantine);
                await assertFileAuthority(quarantine, file.authority, `recovery quarantine '${file.relativePath}'`, host);
                await host.fs.promises.rm(quarantine, { force: true });
            }
            installed.delete(file.target);
        }
        catch (error) {
            failures.push(asError(error));
        }
    }

    for (const backup of [...backups.values()].reverse()) {
        try {
            if (await isMissing(backup.backup, host)) {
                await assertFileAuthority(backup.target, backup.authority, `already restored '${backup.relativePath}'`, host);
            }
            else {
                await assertFileAuthority(backup.backup, backup.authority, `recovery backup '${backup.relativePath}'`, host);
                if (await isMissing(backup.target, host)) {
                    await host.fs.promises.mkdir(host.path.dirname(backup.target), { recursive: true });
                    await host.fs.promises.copyFile(backup.backup, backup.target, host.fs.constants.COPYFILE_EXCL);
                }
                await assertFileAuthority(backup.target, backup.authority, `recovered '${backup.relativePath}'`, host);
                await host.fs.promises.rm(backup.backup, { force: true });
            }
            backups.delete(backup.target);
        }
        catch (error) {
            failures.push(asError(error));
        }
    }

    await persistRecoveryJournal(root, {
        schema: "laya-authored-content-recovery@2",
        targets: journal.targets,
        failures: failures.map(error => error.message),
        installed: [...installed.values()],
        backups: [...backups.values()]
    }, host);
    if (failures.length !== 0)
        throw aggregateFailure(`AUTHORED_CONTENT_NATIVE_TRANSACTION_RESUME_INCOMPLETE: ${root}`, failures);
}

/** Deletes only an authenticated, fully recovered empty journal. */
export async function retireNativeAssetImporterRecovery(
    tempPath: string,
    targets: ReadonlyMap<string, string>,
    host: NativeAssetTransactionHost = createNativeAssetTransactionHost()
): Promise<void> {
    const root = host.path.resolve(tempPath, "authored-content-native-transaction");
    const journal = await readRecoveryJournal(root, targets, host);
    if (journal.installed.length !== 0 || journal.backups.length !== 0)
        fail("RECOVERY_NOT_COMPLETE", root);
    await host.fs.promises.rm(root, { recursive: true, force: true });
}

async function persistRecoveryJournal(
    root: string,
    journal: RecoveryJournal,
    host: NativeAssetTransactionHost
): Promise<void> {
    const recoveryPath = host.path.join(root, "recovery.json");
    const nextPath = host.path.join(root, "recovery.next.json");
    await host.fs.promises.mkdir(root, { recursive: true });
    if (!await isMissing(nextPath, host))
        fail("RECOVERY_UPDATE_PENDING", nextPath);
    const bytes = `${JSON.stringify(journal, null, 2)}\n`;
    const handle = await host.fs.promises.open(nextPath, "wx");
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    await host.fs.promises.rename(nextPath, recoveryPath);
    const directory = await host.fs.promises.open(root, "r");
    try {
        try {
            await directory.sync();
        }
        catch (error) {
            if (!isUnsupportedDirectorySync(error))
                throw error;
        }
    }
    finally {
        await directory.close();
    }
}

export async function isNativeAssetImporterRecoveryPending(
    tempPath: string,
    host: NativeAssetTransactionHost = createNativeAssetTransactionHost()
): Promise<boolean> {
    return !await isMissing(host.path.resolve(tempPath, "authored-content-native-transaction"), host);
}

function isUnsupportedDirectorySync(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error
        && ["EPERM", "EINVAL", "ENOTSUP"].includes(String((error as { code?: unknown }).code)));
}

async function readRecoveryJournal(
    root: string,
    targets: ReadonlyMap<string, string>,
    host: NativeAssetTransactionHost
): Promise<RecoveryJournal> {
    const recoveryPath = host.path.join(root, "recovery.json");
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await host.fs.promises.readFile(recoveryPath));
    const value = JSON.parse(raw) as Partial<RecoveryJournal>;
    if (value.schema !== "laya-authored-content-recovery@2" || !Array.isArray(value.targets)
        || !Array.isArray(value.installed)
        || !Array.isArray(value.backups) || !Array.isArray(value.failures))
        fail("RECOVERY_JOURNAL_INVALID", recoveryPath);
    const expectedTargets = sortedTargets(targets).map(([relativePath, target]) => ({
        relativePath,
        target: host.path.resolve(target)
    }));
    if (value.targets.length !== expectedTargets.length || value.targets.some((item, index) =>
        !item || item.relativePath !== expectedTargets[index].relativePath
        || host.path.resolve(item.target) !== expectedTargets[index].target))
        fail("RECOVERY_TARGET_AUTHORITY_MISMATCH", recoveryPath);
    const validate = (file: InstalledFile | BackupFile, backup: boolean): void => {
        if (!file || typeof file !== "object" || !isCanonicalRelativePath(file.relativePath)
            || typeof file.target !== "string" || !file.authority || typeof file.authority.byteLength !== "number"
            || !Number.isSafeInteger(file.authority.byteLength) || file.authority.byteLength < 0
            || !/^[0-9a-f]{64}$/.test(file.authority.sha256))
            fail("RECOVERY_JOURNAL_INVALID", recoveryPath);
        const expected = targets.get(file.relativePath);
        if (!expected || host.path.resolve(expected) !== host.path.resolve(file.target))
            fail("RECOVERY_TARGET_AUTHORITY_MISMATCH", file.relativePath);
        if (backup && (!("backup" in file) || typeof file.backup !== "string"
            || !host.path.resolve(file.backup).startsWith(`${root}${host.path.sep}`)))
            fail("RECOVERY_BACKUP_AUTHORITY_MISMATCH", file.relativePath);
    };
    for (const file of value.installed) validate(file, false);
    for (const file of value.backups) validate(file, true);
    if (value.failures.some(message => typeof message !== "string"))
        fail("RECOVERY_JOURNAL_INVALID", recoveryPath);
    return value as RecoveryJournal;
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
