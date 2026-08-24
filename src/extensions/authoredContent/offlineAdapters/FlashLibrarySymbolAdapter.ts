import {
    NeutralAuthoredContentIR,
    NeutralAuthoredNode,
    NeutralTimeline,
    normalizeNeutralAuthoredContent,
} from "../core/NeutralAuthoredContentIR";

type NeutralResourceInput = {
    readonly id: string;
    readonly sourcePath: string;
    readonly mediaType: "image/jpeg" | "image/png";
    readonly byteLength: number;
    readonly sha256: string;
};

const PLACEMENT_FIELDS = new Set(["characterId", "depth", "matrix", "move", "name", "op", "ratio"]);
const MATRIX_FIELDS = new Set(["a", "b", "c", "d", "tx", "ty"]);
const TIMELINE_FIELDS = new Set(["frameCount", "frameRate", "frames", "schema", "symbolId", "symbolName"]);
const FRAME_FIELDS = new Set(["durationTicks", "index", "labels", "operations", "sounds"]);
const STAGE_FIELDS = new Set(["backgroundColor", "frameCount", "frameRate", "height", "width"]);
const STAGE_BACKGROUND_FIELDS = new Set(["alpha", "color"]);
const TEXT_FIELD_FIELDS = new Set([
    "align", "autoSize", "border", "color", "fieldType", "fontId", "fontSize", "html", "indent",
    "initialText", "leading", "leftMargin", "multiline", "password", "rightMargin", "selectable",
    "useOutlines", "variableName", "wordWrap",
]);

export interface FlashLibraryResourceAuthority {
    readonly sourcePath: string;
    readonly mediaType: "image/jpeg" | "image/png";
    readonly byteLength: number;
    readonly sha256: string;
}

export interface FlashLibrarySymbolRequest {
    readonly library: unknown;
    readonly timelines: ReadonlyMap<number, unknown>;
    readonly entrySymbolId: number;
    readonly runtimeLinkage: string;
    readonly resources: ReadonlyMap<string, FlashLibraryResourceAuthority>;
}

export class FlashLibrarySymbolAdapter {
    parse(request: FlashLibrarySymbolRequest): NeutralAuthoredContentIR {
        const library = object(request.library, "library");
        exactSchema(library, "flash-library@1", "library");
        const assets = object(library.assets, "library.assets");
        const stage = object(library.stage, "library.stage");
        exactKeys(stage, STAGE_FIELDS, "library.stage", "FLASH_LIBRARY_STAGE_FIELD_UNSUPPORTED");
        const stageWidth = finite(stage.width, "library.stage.width");
        const stageHeight = finite(stage.height, "library.stage.height");
        const stageFrameRate = positiveInteger(stage.frameRate, "library.stage.frameRate");
        const stageFrameCount = positiveInteger(stage.frameCount, "library.stage.frameCount");
        const stageBackground = object(stage.backgroundColor, "library.stage.backgroundColor");
        exactKeys(stageBackground, STAGE_BACKGROUND_FIELDS, "library.stage.backgroundColor", "FLASH_LIBRARY_STAGE_BACKGROUND_FIELD_UNSUPPORTED");
        const stageBackgroundAlpha = finite(stageBackground.alpha, "library.stage.backgroundColor.alpha");
        const stageBackgroundColor = finite(stageBackground.color, "library.stage.backgroundColor.color");
        if (stageWidth <= 0 || stageHeight <= 0)
            fail("FLASH_LIBRARY_STAGE_INVALID", "Stage width and height must be positive.");
        if (stageFrameRate > 0x7fff)
            fail("FLASH_LIBRARY_STAGE_FRAME_RATE_INVALID", "Stage frame rate exceeds the signed native parser field.");
        if (stageBackgroundAlpha !== 1)
            fail("FLASH_LIBRARY_STAGE_BACKGROUND_ALPHA_UNSUPPORTED", "Only an opaque authored stage background is supported.");
        if (!Number.isInteger(stageBackgroundColor) || stageBackgroundColor < 0 || stageBackgroundColor > 0xffffff)
            fail("FLASH_LIBRARY_STAGE_BACKGROUND_COLOR_INVALID", "Stage background color must be an RGB integer.");
        const entryTimeline = timeline(request.timelines, request.entrySymbolId);
        const entryFrameRate = positiveInteger(entryTimeline.frameRate, `timeline ${request.entrySymbolId}.frameRate`);
        const entryFrameCount = positiveInteger(entryTimeline.frameCount, `timeline ${request.entrySymbolId}.frameCount`);
        if (entryFrameRate !== stageFrameRate)
            fail("FLASH_LIBRARY_STAGE_FRAME_RATE_MISMATCH", "Stage frame rate must match the entry-symbol timeline.");
        if (entryFrameCount !== stageFrameCount)
            fail("FLASH_LIBRARY_STAGE_FRAME_COUNT_MISMATCH", "Stage frame count must match the entry-symbol timeline.");
        const frameLabels = array(library.frameLabels, "library.frameLabels");
        if (frameLabels.length !== 0)
            fail("FLASH_LIBRARY_FRAME_LABELS_UNSUPPORTED", "This native projection requires an empty frame-label set.");
        const resources = new Map<string, NeutralResourceInput>();
        const root = this.createSprite(
            request.entrySymbolId,
            undefined,
            undefined,
            assets,
            request.timelines,
            request.resources,
            resources,
            true,
        );
        const content = {
            schema: "neutral-authored-content@1",
            documentId: `flash-library-symbol-${request.entrySymbolId}`,
            resources: [...resources.values()],
            root: {
                ...root,
                runtimeLinkage: request.runtimeLinkage,
                timeline: undefined,
            },
            timeline: nativeTimeline(entryTimeline, root),
            stage: {
                width: root.width,
                height: root.height,
                frameRate: stageFrameRate,
                frameCount: stageFrameCount,
                backgroundColor: {
                    alpha: stageBackgroundAlpha,
                    color: stageBackgroundColor,
                },
            },
        };
        return normalizeNeutralAuthoredContent(content);
    }

    private createSprite(
        characterId: number,
        operation: Record<string, any> | undefined,
        forcedName: string | undefined,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
        root = false,
    ): NeutralAuthoredNode {
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind !== "sprite")
            fail("FLASH_LIBRARY_SPRITE_REQUIRED", `Character ${characterId} is not a sprite.`);
        const sourceTimeline = timeline(timelines, characterId);
        if (sourceTimeline.symbolId !== characterId)
            fail("FLASH_LIBRARY_TIMELINE_ID_MISMATCH", `Timeline ${characterId} identifies another symbol.`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const firstFrame = frame(sourceTimeline, 0);
        const initialOperations = array(firstFrame.operations, `timeline ${characterId} frame 1 operations`);
        const children = sourceTimeline.frameCount === 1
            ? initialOperations.map((value, index) => this.createPlacedNode(
                object(value, `timeline ${characterId} frame 1 operation ${index}`),
                assets,
                timelines,
                resourceAuthorities,
                resources,
            ))
            : this.createReplacementChildren(
                sourceTimeline,
                assets,
                resourceAuthorities,
                resources,
            );
        const placement = operation === undefined ? { x: 0, y: 0 } : translation(operation);
        const linkage = flashLibraryAssetName(asset, characterId);
        const node: NeutralAuthoredNode = {
            linkage,
            name: forcedName ?? operation?.name ?? linkage,
            kind: "container",
            depth: root ? undefined : positiveInteger(operation?.depth, `sprite ${characterId} depth`),
            x: placement.x,
            y: placement.y,
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            variable: typeof operation?.name === "string",
            children,
            timeline: root ? undefined : nativeTimeline(sourceTimeline, {
                linkage,
                kind: "container",
                children,
            }),
        };
        return node;
    }

    private createPlacedNode(
        operation: Record<string, any>,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        exactPlace(operation);
        const characterId = positiveInteger(operation.characterId, "place.characterId");
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind === "sprite") {
            return this.createSprite(
                characterId,
                operation,
                operation.name,
                assets,
                timelines,
                resourceAuthorities,
                resources,
            );
        }
        if (asset.kind === "shape")
            return this.createImage(asset, operation, resourceAuthorities, resources);
        if (asset.kind === "input-text")
            return this.createDynamicText(asset, operation, assets);
        fail("FLASH_LIBRARY_CHARACTER_KIND_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' is unsupported.`);
    }

    private createReplacementChildren(
        sourceTimeline: Record<string, any>,
        assets: Record<string, any>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): ReadonlyArray<NeutralAuthoredNode> {
        const seenDepths = new Set<number>();
        const poses: Array<{ characterId: number; depth: number; firstFrame: number }> = [];
        const frames = array(sourceTimeline.frames, `timeline ${sourceTimeline.symbolId}.frames`);
        frames.forEach((value, frameIndex) => {
            const current = object(value, `timeline ${sourceTimeline.symbolId} frame ${frameIndex + 1}`);
            rejectFrameSideEffects(current, sourceTimeline.symbolId);
            array(current.operations, `timeline ${sourceTimeline.symbolId} frame ${frameIndex + 1} operations`)
                .forEach((operationValue, operationIndex) => {
                    const operation = object(operationValue, `timeline operation ${operationIndex}`);
                    exactPlace(operation, "replacement");
                    const depth = positiveInteger(operation.depth, "place.depth");
                    const characterId = positiveInteger(operation.characterId, "place.characterId");
                    const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
                    if (asset.kind !== "shape")
                        fail("FLASH_LIBRARY_REPLACEMENT_KIND_UNSUPPORTED", "Multi-frame replacement timelines currently require rasterized shapes.");
                    if (!operation.move && seenDepths.has(depth))
                        fail("FLASH_LIBRARY_DEPTH_REPLACEMENT_INVALID", `Depth ${depth} is placed twice without move=true.`);
                    if (operation.move && !seenDepths.has(depth))
                        fail("FLASH_LIBRARY_DEPTH_REPLACEMENT_INVALID", `Depth ${depth} moves before it is placed.`);
                    seenDepths.add(depth);
                    poses.push({ characterId, depth, firstFrame: frameIndex + 1 });
                });
        });
        if (seenDepths.size !== 1 || poses.length < 2)
            fail("FLASH_LIBRARY_REPLACEMENT_TIMELINE_UNSUPPORTED", "Multi-frame timelines require one-depth discrete replacements.");
        return poses.map((pose, index) => {
            const asset = object(assets[String(pose.characterId)], `library.assets.${pose.characterId}`);
            return {
                ...this.createImage(asset, {
                    op: "place",
                    characterId: pose.characterId,
                    depth: index + 1,
                    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                }, resourceAuthorities, resources),
                visible: index === 0,
            };
        });
    }

    private createImage(
        asset: Record<string, any>,
        operation: Record<string, any>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "shape.characterId");
        const sourcePath = resolveFlashLibraryShapeResourcePath(asset, resourceAuthorities);
        const authority = resourceAuthorities.get(sourcePath);
        if (!authority || authority.sourcePath !== sourcePath)
            fail("FLASH_LIBRARY_RESOURCE_AUTHORITY_MISSING", `No authenticated resource authority exists for '${sourcePath}'.`);
        const resourceId = `flash-character-${characterId}`;
        const existing = resources.get(resourceId);
        const resource: NeutralResourceInput = {
            id: resourceId,
            sourcePath,
            mediaType: authority.mediaType,
            byteLength: authority.byteLength,
            sha256: authority.sha256,
        };
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(resource))
            fail("FLASH_LIBRARY_RESOURCE_IDENTITY_DRIFT", `Resource '${resourceId}' has conflicting authority.`);
        resources.set(resourceId, resource);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = translation(operation);
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            name: operation.name ?? flashLibraryAssetName(asset, characterId),
            kind: "image",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x + finite(bounds.x, `library.assets.${characterId}.bounds.x`),
            y: placement.y + finite(bounds.y, `library.assets.${characterId}.bounds.y`),
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            resourceId,
            variable: typeof operation.name === "string",
            children: [],
        };
    }

    private createDynamicText(
        asset: Record<string, any>,
        operation: Record<string, any>,
        assets: Record<string, any>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "text.characterId");
        const textField = object(asset.textField, `library.assets.${characterId}.textField`);
        exactKeys(textField, TEXT_FIELD_FIELDS, `library.assets.${characterId}.textField`, "FLASH_LIBRARY_TEXT_FIELD_UNSUPPORTED");
        if (textField.useOutlines !== false)
            fail("FLASH_LIBRARY_TEXT_OUTLINES_UNSUPPORTED", `Text ${characterId} is not a device-font field.`);
        exactValue(textField.autoSize, false, "FLASH_LIBRARY_TEXT_AUTO_SIZE_UNSUPPORTED", `Text ${characterId} auto-size is unsupported.`);
        exactValue(textField.html, false, "FLASH_LIBRARY_TEXT_HTML_UNSUPPORTED", `Text ${characterId} HTML mode is unsupported.`);
        exactValue(textField.border, false, "FLASH_LIBRARY_TEXT_BORDER_UNSUPPORTED", `Text ${characterId} border rendering is unsupported.`);
        exactValue(textField.variableName, "", "FLASH_LIBRARY_TEXT_VARIABLE_UNSUPPORTED", `Text ${characterId} has an unsupported internal variable binding.`);
        const initialText = text(textField.initialText, `library.assets.${characterId}.textField.initialText`);
        if (text(asset.initialText, `library.assets.${characterId}.initialText`) !== initialText)
            fail("FLASH_LIBRARY_TEXT_INITIAL_VALUE_MISMATCH", `Text ${characterId} initial-text authorities disagree.`);
        const fontId = positiveInteger(textField.fontId, `library.assets.${characterId}.textField.fontId`);
        const fontAsset = object(assets[String(fontId)], `library.assets.${fontId}`);
        if (fontAsset.kind !== "font")
            fail("FLASH_LIBRARY_TEXT_FONT_REQUIRED", `Text ${characterId} does not reference a font asset.`);
        const font = object(fontAsset.font, `library.assets.${fontId}.font`);
        const color = object(textField.color, `library.assets.${characterId}.textField.color`);
        exactKeys(color, new Set(["alpha", "color"]), `library.assets.${characterId}.textField.color`, "FLASH_LIBRARY_TEXT_COLOR_UNSUPPORTED");
        exactValue(color.alpha, 1, "FLASH_LIBRARY_TEXT_COLOR_ALPHA_UNSUPPORTED", `Text ${characterId} color alpha is unsupported.`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = translation(operation);
        return {
            linkage: string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            name: operation.name ?? string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            kind: "dynamic-text",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x,
            y: placement.y,
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            variable: typeof operation.name === "string",
            textField: {
                sourceId: characterId,
                type: oneOf(textField.fieldType, ["dynamic", "input"], "text.fieldType"),
                multiline: boolean(textField.multiline, "text.multiline"),
                wordWrap: boolean(textField.wordWrap, "text.wordWrap"),
                selectable: boolean(textField.selectable, "text.selectable"),
                displayAsPassword: boolean(textField.password, "text.password"),
                autoSize: "none",
                html: false,
                gutter: 2,
                overflow: "hidden",
                initialText,
                format: {
                    fontMode: "device",
                    font: string(font.family, `library.assets.${fontId}.font.family`),
                    size: finite(textField.fontSize, "text.fontSize"),
                    color: finite(color.color, "text.color.color"),
                    bold: boolean(font.bold, "font.bold"),
                    italic: boolean(font.italic, "font.italic"),
                    underline: false,
                    align: oneOf(textField.align, ["left", "center", "right", "justify"], "text.align"),
                    leftMargin: finite(textField.leftMargin, "text.leftMargin"),
                    rightMargin: finite(textField.rightMargin, "text.rightMargin"),
                    indent: finite(textField.indent, "text.indent"),
                    leading: finite(textField.leading, "text.leading"),
                },
            },
            children: [],
        };
    }
}

/**
 * Resolves the authenticated bitmap authority for a Flash shape which is an
 * exact axis-aligned bitmap projection. The FFDec XML exporter may retain its
 * sentinel bitmap fill (character 65535) alongside the real fill; the sentinel
 * carries no pixels and is ignored only after the remaining geometry proves a
 * complete rectangular projection. Bitmap fills may reference either lossless
 * PNG authorities or authored JPEG authorities retained by the extractor.
 */
export function resolveFlashLibraryShapeResourcePath(
    assetValue: unknown,
    resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
): string {
    const asset = object(assetValue, "shape asset");
    const characterId = positiveInteger(asset.characterId, "shape.characterId");
    if (asset.path !== undefined)
        return string(asset.path, `library.assets.${characterId}.path`);

    const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
    const shape = object(asset.shape, `library.assets.${characterId}.shape`);
    const fillStyles = array(shape.fillStyles, `library.assets.${characterId}.shape.fillStyles`)
        .map((value, index) => ({ value: object(value, `shape ${characterId} fill ${index}`), styleIndex: index + 1 }))
        .filter(value => value.value.bitmapId !== 65535);
    if (fillStyles.length !== 1)
        fail("FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED", `Shape ${characterId} must contain exactly one non-sentinel bitmap fill.`);
    const { value: fill, styleIndex } = fillStyles[0];
    if (fill.kind !== "bitmap" || fill.repeat !== false || fill.smooth !== false)
        fail("FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED", `Shape ${characterId} bitmap fill mode is unsupported.`);
    const matrix = object(fill.startMatrix, `shape ${characterId} bitmap matrix`);
    exactKeys(matrix, MATRIX_FIELDS, `shape ${characterId} bitmap matrix`, "FLASH_LIBRARY_BITMAP_FILL_MATRIX_FIELD_UNSUPPORTED");
    if (matrix.a !== 20 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 20
        || matrix.tx !== bounds.x || matrix.ty !== bounds.y)
        fail("FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED", `Shape ${characterId} bitmap matrix is not a one-pixel-per-pixel bounds projection.`);
    if (array(shape.lineStyles, `shape ${characterId}.lineStyles`).length !== 0
        || shape.usesFillWindingRule !== false
        || !isBoundsRectangle(array(shape.segments, `shape ${characterId}.segments`), bounds, styleIndex))
        fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} is not the exact bounds rectangle.`);

    const bitmapId = positiveInteger(fill.bitmapId, `shape ${characterId}.bitmapId`);
    const expectedName = new RegExp(`(?:^|/)${bitmapId}\\.(?:png|jpe?g)$`, "i");
    const candidates = [...resourceAuthorities.entries()]
        .filter(([sourcePath, authority]) => {
            const normalized = sourcePath.replace(/\\/g, "/");
            if (!expectedName.test(normalized)) return false;
            const lower = normalized.toLowerCase();
            return (lower.endsWith(".png") && authority.mediaType === "image/png")
                || ((lower.endsWith(".jpg") || lower.endsWith(".jpeg")) && authority.mediaType === "image/jpeg");
        })
        .map(([sourcePath]) => sourcePath);
    if (candidates.length !== 1)
        fail("FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED", `Shape ${characterId} bitmap ${bitmapId} has no unique authenticated image authority.`);
    return candidates[0];
}

function flashLibraryAssetName(asset: Record<string, any>, characterId: number): string {
    return asset.symbolName === undefined
        ? `character_${characterId}`
        : string(asset.symbolName, `library.assets.${characterId}.symbolName`);
}

function isBoundsRectangle(segmentsValue: ReadonlyArray<unknown>, bounds: Record<string, any>, styleIndex: number): boolean {
    if (segmentsValue.length !== 4) return false;
    const x = finite(bounds.x, "shape.bounds.x");
    const y = finite(bounds.y, "shape.bounds.y");
    const width = finite(bounds.width, "shape.bounds.width");
    const height = finite(bounds.height, "shape.bounds.height");
    if (width <= 0 || height <= 0) return false;
    const corners = new Set([`${x},${y}`, `${x + width},${y}`, `${x + width},${y + height}`, `${x},${y + height}`]);
    const expectedEdges = new Set([
        canonicalEdge(`${x},${y}`, `${x + width},${y}`),
        canonicalEdge(`${x + width},${y}`, `${x + width},${y + height}`),
        canonicalEdge(`${x + width},${y + height}`, `${x},${y + height}`),
        canonicalEdge(`${x},${y + height}`, `${x},${y}`),
    ]);
    const observedEdges = new Set<string>();
    for (const value of segmentsValue) {
        const segment = object(value, "shape segment");
        if (segment.kind !== "line" || segment.fillStyle1 !== styleIndex || segment.fillStyle0 !== 0 || segment.lineStyle !== 0)
            return false;
        const edge = object(segment.end, "shape segment.end");
        const from = array(edge.from, "shape segment.end.from");
        const to = array(edge.to, "shape segment.end.to");
        if (from.length !== 2 || to.length !== 2 || !from.every(Number.isFinite) || !to.every(Number.isFinite))
            return false;
        const fromKey = `${from[0]},${from[1]}`;
        const toKey = `${to[0]},${to[1]}`;
        if (!corners.has(fromKey) || !corners.has(toKey)
            || (from[0] !== to[0] && from[1] !== to[1])) return false;
        observedEdges.add(canonicalEdge(fromKey, toKey));
    }
    return observedEdges.size === expectedEdges.size
        && [...observedEdges].every(value => expectedEdges.has(value));
}

function canonicalEdge(from: string, to: string): string {
    return from < to ? `${from}|${to}` : `${to}|${from}`;
}

function nativeTimeline(source: Record<string, any>, owner: NeutralAuthoredNode): NeutralTimeline {
    const frameRate = finite(source.frameRate, `timeline ${source.symbolId}.frameRate`);
    const frameCount = positiveInteger(source.frameCount, `timeline ${source.symbolId}.frameCount`);
    const frames = array(source.frames, `timeline ${source.symbolId}.frames`);
    if (frames.length !== frameCount)
        fail("FLASH_LIBRARY_FRAME_CLOSURE", `Timeline ${source.symbolId} frame count drifted.`);
    frames.forEach((value, index) => {
        const current = object(value, `timeline ${source.symbolId} frame ${index + 1}`);
        if (current.index !== index + 1 || (current.durationTicks !== undefined && current.durationTicks !== 1))
            fail("FLASH_LIBRARY_FRAME_INDEX_INVALID", `Timeline ${source.symbolId} frame indexing/duration is unsupported.`);
        rejectFrameSideEffects(current, source.symbolId);
    });
    const tracks = frameCount === 1 ? [] : owner.children.map(child => ({
        targetPath: [owner.linkage, child.linkage],
        property: "visible" as const,
        keyframes: frames.flatMap((value, index) => {
            const operations = array(object(value, "frame").operations, "frame.operations");
            if (operations.length === 0)
                return [];
            const activeId = positiveInteger(object(operations[0], "operation").characterId, "operation.characterId");
            const childId = positiveInteger(Number(child.linkage.replace("symbol", "")), "child.characterId");
            return [{ time: index / frameRate, value: activeId === childId }];
        }),
    }));
    return { frameRate, duration: frameCount / frameRate, loop: frameCount > 1, tracks };
}

function timeline(values: ReadonlyMap<number, unknown>, id: number): Record<string, any> {
    const value = object(values.get(id), `timeline ${id}`);
    exactSchema(value, "flash-timeline@1", `timeline ${id}`);
    exactKeys(value, TIMELINE_FIELDS, `timeline ${id}`, "FLASH_LIBRARY_TIMELINE_FIELD_UNSUPPORTED");
    return value;
}

function frame(sourceTimeline: Record<string, any>, index: number): Record<string, any> {
    return object(array(sourceTimeline.frames, `timeline ${sourceTimeline.symbolId}.frames`)[index], `timeline frame ${index + 1}`);
}

function rejectFrameSideEffects(value: Record<string, any>, symbolId: number): void {
    exactKeys(value, FRAME_FIELDS, `timeline ${symbolId} frame`, "FLASH_LIBRARY_FRAME_FIELD_UNSUPPORTED");
    if (array(value.labels ?? [], `timeline ${symbolId}.labels`).length !== 0)
        fail("FLASH_LIBRARY_FRAME_LABELS_UNSUPPORTED", `Timeline ${symbolId} contains frame labels.`);
    if (array(value.sounds ?? [], `timeline ${symbolId}.sounds`).length !== 0)
        fail("FLASH_LIBRARY_FRAME_SOUNDS_UNSUPPORTED", `Timeline ${symbolId} contains frame sounds.`);
}

function exactPlace(operation: Record<string, any>, mode: "static" | "replacement" = "static"): void {
    exactKeys(operation, PLACEMENT_FIELDS, "place", "FLASH_LIBRARY_PLACE_FIELD_UNSUPPORTED");
    if (operation.op !== "place")
        fail("FLASH_LIBRARY_DISPLAY_OPERATION_UNSUPPORTED", `Display operation '${String(operation.op)}' is unsupported.`);
    positiveInteger(operation.characterId, "place.characterId");
    positiveInteger(operation.depth, "place.depth");
    const move = operation.move === undefined ? false : boolean(operation.move, "place.move");
    if (operation.name !== undefined)
        string(operation.name, "place.name");
    if (mode === "static" && move)
        fail("FLASH_LIBRARY_STATIC_MOVE_UNSUPPORTED", "A static placement cannot modify a prior depth.");
    if (mode === "replacement" && operation.name !== undefined)
        fail("FLASH_LIBRARY_REPLACEMENT_NAME_UNSUPPORTED", "Replacement frames cannot change instance names.");
    if (mode === "replacement" && move && operation.matrix !== undefined)
        fail("FLASH_LIBRARY_REPLACEMENT_MATRIX_UNSUPPORTED", "Replacement frames cannot override the retained depth transform.");
    if (operation.ratio !== undefined && operation.ratio !== 0)
        fail("FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED", "Non-zero morph ratios are unsupported.");
    if (operation.matrix !== undefined) {
        const placement = translation(operation);
        if (mode === "replacement" && (placement.x !== 0 || placement.y !== 0))
            fail("FLASH_LIBRARY_REPLACEMENT_MATRIX_UNSUPPORTED", "Replacement timelines require a zero-translation retained depth transform.");
    }
}

function translation(operation: Record<string, any>): { x: number; y: number } {
    if (operation.matrix === undefined)
        return { x: 0, y: 0 };
    const matrix = object(operation.matrix, "place.matrix");
    exactKeys(matrix, MATRIX_FIELDS, "place.matrix", "FLASH_LIBRARY_MATRIX_FIELD_UNSUPPORTED");
    if (matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1)
        fail("FLASH_LIBRARY_MATRIX_UNSUPPORTED", "Only untranslated unit-scale retained placements are admitted by this projection.");
    return { x: finite(matrix.tx, "place.matrix.tx"), y: finite(matrix.ty, "place.matrix.ty") };
}

function exactSchema(value: Record<string, any>, expected: string, label: string): void {
    if (value.schema !== expected)
        fail("FLASH_LIBRARY_SCHEMA_UNSUPPORTED", `${label} schema must be '${expected}'.`);
}

function exactKeys(value: Record<string, any>, allowed: ReadonlySet<string>, label: string, code: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            fail(code, `${label}.${key} is unsupported.`);
    }
}

function exactValue(value: unknown, expected: unknown, code: string, message: string): void {
    if (value !== expected)
        fail(code, message);
}

function object(value: unknown, label: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("FLASH_LIBRARY_OBJECT_REQUIRED", `${label} must be an object.`);
    return value as Record<string, any>;
}

function array(value: unknown, label: string): any[] {
    if (!Array.isArray(value))
        fail("FLASH_LIBRARY_ARRAY_REQUIRED", `${label} must be an array.`);
    return value;
}

function string(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0)
        fail("FLASH_LIBRARY_STRING_REQUIRED", `${label} must be a non-empty string.`);
    return value;
}

function text(value: unknown, label: string): string {
    if (typeof value !== "string")
        fail("FLASH_LIBRARY_TEXT_REQUIRED", `${label} must be text.`);
    return value;
}

function oneOf<T extends string>(value: unknown, values: ReadonlyArray<T>, label: string): T {
    if (typeof value !== "string" || !values.includes(value as T))
        fail("FLASH_LIBRARY_ENUM_REQUIRED", `${label} must be one of ${values.join(", ")}.`);
    return value as T;
}

function finite(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        fail("FLASH_LIBRARY_NUMBER_REQUIRED", `${label} must be finite.`);
    return value;
}

function positiveInteger(value: unknown, label: string): number {
    const result = finite(value, label);
    if (!Number.isSafeInteger(result) || result < 1)
        fail("FLASH_LIBRARY_POSITIVE_INTEGER_REQUIRED", `${label} must be a positive safe integer.`);
    return result;
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean")
        fail("FLASH_LIBRARY_BOOLEAN_REQUIRED", `${label} must be boolean.`);
    return value;
}

function fail(code: string, message: string): never {
    throw new Error(`${code}: ${message}`);
}
