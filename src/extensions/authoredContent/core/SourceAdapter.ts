import { NeutralAuthoredContentIR } from "./NeutralAuthoredContentIR";

export interface AuthoredContentImportSettings {
    readonly scale?: number;
}
export interface SourceAdapter {
    parse(sourcePath: string, settings: AuthoredContentImportSettings): Promise<NeutralAuthoredContentIR>;
}

export type ImmutableTextFileSystem = {
    readonly promises: {
        stat(path: string): Promise<{ isDirectory(): boolean }>;
        readFile(path: string, encoding: "utf8"): Promise<string>;
    };
};

type ImmutableResourceFileSystem = {
    readonly promises: {
        lstat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>;
        realpath(path: string): Promise<string>;
        readFile(path: string): Promise<Uint8Array>;
    };
};

type NativePath = {
    dirname(path: string): string;
    join(...parts: string[]): string;
    relative(from: string, to: string): string;
    sep: string;
};

export async function readImmutableSourceFile(sourcePath: string): Promise<string> {
    const fs = IEditorEnv.require("fs") as ImmutableTextFileSystem;
    const stat = await fs.promises.stat(sourcePath);
    if (stat.isDirectory())
        throw new Error("AUTHORED_CONTENT_DIRECTORY_SOURCE_REJECTED: Source adapters require an immutable single file.");
    return fs.promises.readFile(sourcePath, "utf8");
}

/**
 * Reads the exact image closure beside an immutable authored-content manifest.
 * The returned bytes, rather than a later path read, are the authenticated
 * authority staged into the native Laya bundle.
 */
export async function readAuthenticatedResourcePayloads(
    sourcePath: string,
    content: NeutralAuthoredContentIR
): Promise<ReadonlyMap<string, Uint8Array>> {
    const fs = IEditorEnv.require("fs") as ImmutableResourceFileSystem;
    const path = IEditorEnv.require("path") as NativePath;
    const crypto = IEditorEnv.require("crypto") as {
        createHash(algorithm: "sha256"): { update(bytes: Uint8Array): any; digest(encoding: "hex"): string };
    };
    const sourceDirectory = await fs.promises.realpath(path.dirname(sourcePath));
    const payloads = new Map<string, Uint8Array>();
    for (const resource of content.resources) {
        const target = path.join(sourceDirectory, ...resource.sourcePath.split("/"));
        await rejectSymbolicPath(fs, path, sourceDirectory, resource.sourcePath);
        const realTarget = await fs.promises.realpath(target);
        const relative = path.relative(sourceDirectory, realTarget);
        if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || relative.startsWith("/") || /^[A-Za-z]:/.test(relative))
            throw new Error(`AUTHORED_CONTENT_RESOURCE_ESCAPES_SOURCE: ${resource.sourcePath}`);
        const stat = await fs.promises.lstat(realTarget);
        if (!stat.isFile() || stat.isDirectory() || stat.isSymbolicLink())
            throw new Error(`AUTHORED_CONTENT_RESOURCE_FILE_REQUIRED: ${resource.sourcePath}`);
        const bytes = new Uint8Array(await fs.promises.readFile(realTarget));
        if (bytes.byteLength !== resource.byteLength)
            throw new Error(`AUTHORED_CONTENT_RESOURCE_SIZE_MISMATCH: ${resource.id}`);
        const digest = crypto.createHash("sha256").update(bytes).digest("hex");
        if (digest !== resource.sha256)
            throw new Error(`AUTHORED_CONTENT_RESOURCE_HASH_MISMATCH: ${resource.id}`);
        payloads.set(resource.id, bytes);
    }
    if (payloads.size !== content.resources.length)
        throw new Error("AUTHORED_CONTENT_RESOURCE_CLOSURE_MISMATCH");
    return payloads;
}

async function rejectSymbolicPath(
    fs: ImmutableResourceFileSystem,
    path: NativePath,
    root: string,
    relativePath: string
): Promise<void> {
    let current = root;
    for (const segment of relativePath.split("/")) {
        current = path.join(current, segment);
        const stat = await fs.promises.lstat(current);
        if (stat.isSymbolicLink())
            throw new Error(`AUTHORED_CONTENT_RESOURCE_SYMLINK_REJECTED: ${relativePath}`);
    }
}
