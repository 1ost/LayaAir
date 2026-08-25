import type {
    NeutralAuthoredContentIR,
    NeutralAuthoredNode,
    NeutralEmbeddedFont,
} from "../core/NeutralAuthoredContentIR";

export interface NativeAuthoredFontManifestEntry {
    readonly documentId: string;
    readonly fontId: number;
    readonly fontName: string;
    readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
    readonly fontType: "embedded";
    readonly sourceSha256: string;
    readonly sourceUrl: string;
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly leading: number;
    readonly glyphs: NeutralEmbeddedFont["glyphs"];
    readonly kerning: NeutralEmbeddedFont["kerning"];
    readonly alignZones: NeutralEmbeddedFont["alignZones"];
}

export interface NativeAuthoredFontManifest {
    readonly schema: "laya-authored-font-manifest@1";
    readonly fonts: ReadonlyArray<NativeAuthoredFontManifestEntry>;
}

export interface NativeAuthenticatedJsonReference {
    readonly url: string;
    readonly size: number;
    readonly sha256: string;
}

export interface NativeAuthoredFontStartupManifest {
    readonly schema: "laya-authored-font-startup@1";
    readonly manifest: NativeAuthenticatedJsonReference;
    readonly preloadOrder: ReadonlyArray<string>;
    readonly definitions: ReadonlyArray<{
        readonly className: string;
        readonly fontName: string;
        readonly authoredFont: {
            readonly documentId: string;
            readonly fontId: number;
            readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
            readonly sourceSha256: string;
        };
    }>;
}

export interface NativeAuthoredFontCatalogDefinition {
    readonly resourceId: string;
    readonly entry: NativeAuthoredFontManifestEntry;
    readonly className: string;
}

export interface NativeAuthoredFontCatalogDescription {
    readonly manifestPath: string;
    readonly startupPath: string;
    readonly definitions: ReadonlyArray<NativeAuthoredFontCatalogDefinition>;
    readonly manifest: NativeAuthoredFontManifest;
    createStartup(reference: NativeAuthenticatedJsonReference): NativeAuthoredFontStartupManifest;
}

/**
 * Derives the exact runtime font catalog from normalized embedded-text state.
 * It never reads source bytes and therefore cannot invent or downgrade font
 * identity after the authenticated resource closure has been normalized.
 */
export function describeNativeAuthoredFontCatalog(
    content: NeutralAuthoredContentIR,
    prefabPath: string,
): NativeAuthoredFontCatalogDescription | undefined {
    const stem = prefabPath.slice(0, -3);
    const manifestPath = `${stem}.font-manifest.json`;
    const startupPath = `${stem}.font-startup.json`;
    const manifestDirectory = directory(manifestPath);
    const candidates: Array<{ font: NeutralEmbeddedFont; family: string }> = [];
    visit(content.root, node => {
        const font = node.textField?.format.embeddedFont;
        if (font !== undefined) candidates.push({ font, family: node.textField!.format.font });
    });
    if (candidates.length === 0) return undefined;
    const runtimeLinkage = content.root.runtimeLinkage;
    if (!runtimeLinkage)
        throw new Error("AUTHORED_CONTENT_EMBEDDED_FONT_RUNTIME_LINKAGE_REQUIRED");
    const resources = new Map(content.resources.map(resource => [resource.id, resource]));
    const definitions = new Map<string, NativeAuthoredFontCatalogDefinition>();
    for (const candidate of candidates) {
        const resource = resources.get(candidate.font.resourceId);
        if (!resource || resource.mediaType !== "font/ttf")
            throw new Error(`AUTHORED_CONTENT_EMBEDDED_FONT_RESOURCE_INVALID: ${candidate.font.resourceId}`);
        if (resource.sha256 !== candidate.font.sourceSha256)
            throw new Error(`AUTHORED_CONTENT_EMBEDDED_FONT_RESOURCE_IDENTITY_DRIFT: ${candidate.font.resourceId}`);
        const entry: NativeAuthoredFontManifestEntry = Object.freeze({
            documentId: content.documentId,
            fontId: candidate.font.fontId,
            fontName: candidate.family,
            fontStyle: candidate.font.fontStyle,
            fontType: candidate.font.fontType,
            sourceSha256: resource.sha256,
            sourceUrl: relative(manifestDirectory, resource.outputPath),
            unitsPerEm: candidate.font.unitsPerEm,
            ascent: candidate.font.ascent,
            descent: candidate.font.descent,
            leading: candidate.font.leading,
            glyphs: Object.freeze(candidate.font.glyphs.map(glyph => Object.freeze({ ...glyph }))),
            kerning: Object.freeze(candidate.font.kerning.map(pair => Object.freeze({ ...pair }))),
            alignZones: Object.freeze({
                ...candidate.font.alignZones,
                zones: Object.freeze(candidate.font.alignZones.zones.map(zone => Object.freeze({
                    ...zone,
                    data: Object.freeze([
                        Object.freeze({ ...zone.data[0] }),
                        Object.freeze({ ...zone.data[1] }),
                    ] as const),
                }))),
            }),
        });
        const key = JSON.stringify([
            entry.documentId, entry.fontId, entry.fontStyle, entry.sourceSha256,
        ]);
        const definition: NativeAuthoredFontCatalogDefinition = Object.freeze({
            resourceId: candidate.font.resourceId,
            entry,
            className: `${runtimeLinkage}.__authoredFont_${entry.fontId}_${entry.fontStyle}`,
        });
        const existing = definitions.get(key);
        if (existing && JSON.stringify(existing) !== JSON.stringify(definition))
            throw new Error(`AUTHORED_CONTENT_EMBEDDED_FONT_IDENTITY_DRIFT: ${entry.fontId}`);
        definitions.set(key, definition);
    }
    const ordered = Object.freeze([...definitions.values()].sort((left, right) =>
        left.entry.fontId - right.entry.fontId || left.entry.fontStyle.localeCompare(right.entry.fontStyle)));
    const manifest: NativeAuthoredFontManifest = Object.freeze({
        schema: "laya-authored-font-manifest@1",
        fonts: Object.freeze(ordered.map(definition => definition.entry)),
    });
    return Object.freeze({
        manifestPath,
        startupPath,
        definitions: ordered,
        manifest,
        createStartup(reference: NativeAuthenticatedJsonReference): NativeAuthoredFontStartupManifest {
            return Object.freeze({
                schema: "laya-authored-font-startup@1",
                manifest: Object.freeze({ ...reference }),
                preloadOrder: Object.freeze([content.documentId]),
                definitions: Object.freeze(ordered.map(definition => Object.freeze({
                    className: definition.className,
                    fontName: definition.entry.fontName,
                    authoredFont: Object.freeze({
                        documentId: definition.entry.documentId,
                        fontId: definition.entry.fontId,
                        fontStyle: definition.entry.fontStyle,
                        sourceSha256: definition.entry.sourceSha256,
                    }),
                }))),
            });
        },
    });
}

function directory(value: string): string {
    const index = value.lastIndexOf("/");
    return index === -1 ? "" : value.slice(0, index);
}

function relative(fromDirectory: string, target: string): string {
    const from = fromDirectory === "" ? [] : fromDirectory.split("/");
    const to = target.split("/");
    while (from.length !== 0 && to.length !== 0 && from[0] === to[0]) {
        from.shift();
        to.shift();
    }
    return [...from.map(() => ".."), ...to].join("/");
}

function visit(node: NeutralAuthoredNode, consume: (node: NeutralAuthoredNode) => void): void {
    consume(node);
    node.children.forEach(child => visit(child, consume));
}
