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

export async function readImmutableSourceFile(sourcePath: string): Promise<string> {
    const fs = IEditorEnv.require("fs") as ImmutableTextFileSystem;
    const stat = await fs.promises.stat(sourcePath);
    if (stat.isDirectory())
        throw new Error("AUTHORED_CONTENT_DIRECTORY_SOURCE_REJECTED: Source adapters require an immutable single file.");
    return fs.promises.readFile(sourcePath, "utf8");
}
