import {
    NeutralAuthoredContentIR,
    normalizeNeutralAuthoredContent
} from "../core/NeutralAuthoredContentIR";
import {
    AuthoredContentImportSettings,
    SourceAdapter,
    readImmutableSourceFile
} from "../core/SourceAdapter";

export class XflBundleSourceAdapter implements SourceAdapter {
    async parse(sourcePath: string, settings: AuthoredContentImportSettings): Promise<NeutralAuthoredContentIR> {
        return this.parseText(await readImmutableSourceFile(sourcePath), settings);
    }

    parseText(text: string, settings: AuthoredContentImportSettings = {}): NeutralAuthoredContentIR {
        let value: unknown;
        try {
            value = JSON.parse(text);
        }
        catch (error) {
            throw new Error(`AUTHORED_CONTENT_XFL_BUNDLE_INVALID_JSON: ${String(error)}`);
        }
        if (!value || typeof value !== "object" || (value as any).format !== "xflbundle@1")
            throw new Error("AUTHORED_CONTENT_XFL_BUNDLE_SCHEMA_UNSUPPORTED: Expected 'xflbundle@1'.");
        return normalizeNeutralAuthoredContent((value as any).content, settings.scale ?? 1);
    }
}
