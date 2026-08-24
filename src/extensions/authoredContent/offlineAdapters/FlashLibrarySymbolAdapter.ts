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

type DisplayMatrix = {
    readonly a: number;
    readonly b: 0;
    readonly c: 0;
    readonly d: number;
    readonly tx: number;
    readonly ty: number;
};
type FlashDisplayState = {
    readonly instanceId: number;
    readonly characterId: number;
    readonly authoredDepth: number;
    readonly firstFrame: number;
    readonly operation: Record<string, any>;
    matrix: DisplayMatrix;
    alpha: number;
};

const PLACEMENT_FIELDS = new Set(["characterId", "colorTransform", "depth", "filters", "matrix", "move", "name", "op", "ratio"]);
const REMOVE_FIELDS = new Set(["depth", "op"]);
const FILTER_FIELDS = new Set([
    "blurX", "blurY", "color", "compositeSource", "innerGlow", "kind", "knockout", "passes", "sourceType", "strength",
]);
const FILTER_COLOR_FIELDS = new Set(["alpha", "color"]);
const MATRIX_FIELDS = new Set(["a", "b", "c", "d", "tx", "ty"]);
const COLOR_TRANSFORM_FIELDS = new Set([
    "alphaMultiplier", "alphaOffset", "blueMultiplier", "blueOffset", "greenMultiplier",
    "greenOffset", "redMultiplier", "redOffset",
]);
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

export interface FlashLibraryRasterizedFrameAuthority extends FlashLibraryResourceAuthority {
    /** Pixel-space placement of the authenticated raster relative to the authored sprite origin. */
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface FlashLibrarySymbolRequest {
    readonly library: unknown;
    readonly timelines: ReadonlyMap<number, unknown>;
    readonly entrySymbolId: number;
    readonly runtimeLinkage: string;
    readonly resources: ReadonlyMap<string, FlashLibraryResourceAuthority>;
    /** Import an exported linkage in symbol-local space rather than the SWF document stage. */
    readonly projection?: "document" | "library-symbol";
    /** Explicit JPEXS raster authorities for shapes which cannot be projected from vector fill records. */
    readonly rasterizedShapes?: ReadonlyMap<number, FlashLibraryResourceAuthority>;
    /** Explicit full-frame JPEXS raster authorities for symbols whose leaf rendering is intentionally flattened. */
    readonly rasterizedSprites?: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>;
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
        positiveInteger(stage.frameCount, "library.stage.frameCount");
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
        const projection = request.projection ?? "document";
        if (projection !== "document" && projection !== "library-symbol")
            fail("FLASH_LIBRARY_PROJECTION_UNSUPPORTED", `Projection '${String(projection)}' is unsupported.`);
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
            request.rasterizedShapes ?? new Map(),
            request.rasterizedSprites ?? new Map(),
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
            timeline: root.timeline,
            stage: {
                width: root.width,
                height: root.height,
                frameRate: stageFrameRate,
                frameCount: entryFrameCount,
                backgroundColor: {
                    alpha: projection === "library-symbol" ? 0 : stageBackgroundAlpha,
                    color: projection === "library-symbol" ? 0 : stageBackgroundColor,
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
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
        root = false,
    ): NeutralAuthoredNode {
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind !== "sprite")
            fail("FLASH_LIBRARY_SPRITE_REQUIRED", `Character ${characterId} is not a sprite.`);
        const sourceTimeline = timeline(timelines, characterId);
        if (sourceTimeline.symbolId !== characterId)
            fail("FLASH_LIBRARY_TIMELINE_ID_MISMATCH", `Timeline ${characterId} identifies another symbol.`);
        const bounds = spriteBounds(asset, sourceTimeline, characterId);
        const firstFrame = frame(sourceTimeline, 0);
        const initialOperations = array(firstFrame.operations, `timeline ${characterId} frame 1 operations`);
        const rasterFrames = rasterizedSprites.get(characterId);
        const animated = rasterFrames === undefined
            ? sourceTimeline.frameCount === 1 ? undefined : this.createAnimatedDisplayList(
                sourceTimeline, assets, timelines, resourceAuthorities, rasterizedShapes, rasterizedSprites, resources,
            )
            : this.createRasterizedSprite(
                sourceTimeline, flashLibraryAssetName(asset, characterId), rasterFrames, resources,
            );
        const children = animated === undefined
            ? initialOperations.map((value, index) => this.createPlacedNode(
                object(value, `timeline ${characterId} frame 1 operation ${index}`),
                assets,
                timelines,
                resourceAuthorities,
                rasterizedShapes,
                rasterizedSprites,
                resources,
            ))
            : animated.children;
        const placement = operation === undefined ? unitPlacement() : placementTransform(operation);
        const linkage = flashLibraryAssetName(asset, characterId);
        const node: NeutralAuthoredNode = {
            linkage,
            name: forcedName ?? operation?.name ?? linkage,
            kind: "container",
            depth: root ? undefined : positiveInteger(operation?.depth, `sprite ${characterId} depth`),
            x: placement.x,
            y: placement.y,
            matrix: placement.matrix,
            ...(operation?.filters === undefined ? {} : { filters: authoredGlowFilters(operation.filters, characterId) }),
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            variable: typeof operation?.name === "string",
            children,
            timeline: animated?.timeline ?? nativeTimeline(sourceTimeline, {
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
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        exactPlace(operation);
        const characterId = positiveInteger(operation.characterId, "place.characterId");
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind !== "input-text" && asset.kind !== "sprite" && operation.filters !== undefined)
            fail("FLASH_LIBRARY_FILTER_TARGET_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' cannot carry authored filters.`);
        if (asset.kind === "sprite") {
            return this.createSprite(
                characterId,
                operation,
                operation.name,
                assets,
                timelines,
                resourceAuthorities,
                rasterizedShapes,
                rasterizedSprites,
                resources,
            );
        }
        if (asset.kind === "shape")
            return this.createImage(asset, operation, assets, resourceAuthorities, rasterizedShapes, resources);
        if (asset.kind === "input-text")
            return this.createDynamicText(asset, operation, assets);
        fail("FLASH_LIBRARY_CHARACTER_KIND_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' is unsupported.`);
    }

    private createAnimatedDisplayList(
        sourceTimeline: Record<string, any>,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
    ): { readonly children: ReadonlyArray<NeutralAuthoredNode>; readonly timeline: NeutralTimeline } {
        const active = new Map<number, FlashDisplayState>();
        const instances: FlashDisplayState[] = [];
        const snapshots: Array<Map<number, FlashDisplayState>> = [];
        const frames = array(sourceTimeline.frames, `timeline ${sourceTimeline.symbolId}.frames`);
        frames.forEach((value, frameIndex) => {
            const current = object(value, `timeline ${sourceTimeline.symbolId} frame ${frameIndex + 1}`);
            rejectFrameSideEffects(current, sourceTimeline.symbolId);
            array(current.operations, `timeline ${sourceTimeline.symbolId} frame ${frameIndex + 1} operations`)
                .forEach((operationValue, operationIndex) => {
                    const operation = object(operationValue, `timeline operation ${operationIndex}`);
                    const depth = positiveInteger(operation.depth, `${operation.op}.depth`);
                    if (operation.op === "remove") {
                        exactKeys(operation, REMOVE_FIELDS, "remove", "FLASH_LIBRARY_REMOVE_FIELD_UNSUPPORTED");
                        if (!active.delete(depth))
                            fail("FLASH_LIBRARY_DISPLAY_DEPTH_INVALID", `Depth ${depth} is removed before it is placed.`);
                        return;
                    }
                    exactKeys(operation, PLACEMENT_FIELDS, "place", "FLASH_LIBRARY_PLACE_FIELD_UNSUPPORTED");
                    if (operation.op !== "place")
                        fail("FLASH_LIBRARY_DISPLAY_OPERATION_UNSUPPORTED", `Display operation '${String(operation.op)}' is unsupported.`);
                    const move = operation.move === undefined ? false : boolean(operation.move, "place.move");
                    const prior = active.get(depth);
                    if (!move) {
                        if (prior !== undefined)
                            fail("FLASH_LIBRARY_DISPLAY_DEPTH_INVALID", `Depth ${depth} is placed twice without removal or move=true.`);
                        const state = createDisplayState(operation, frameIndex + 1, instances.length + 1, assets);
                        instances.push(state);
                        active.set(depth, state);
                        return;
                    }
                    if (prior === undefined)
                        fail("FLASH_LIBRARY_DISPLAY_DEPTH_INVALID", `Depth ${depth} moves before it is placed.`);
                    const replacementId = operation.characterId === undefined
                        ? prior.characterId
                        : positiveInteger(operation.characterId, "place.characterId");
                    if (replacementId !== prior.characterId) {
                        const state = createDisplayState({
                            ...operation,
                            characterId: replacementId,
                            matrix: operation.matrix ?? prior.matrix,
                        }, frameIndex + 1, instances.length + 1, assets, prior.alpha);
                        instances.push(state);
                        active.set(depth, state);
                        return;
                    }
                    if (operation.matrix !== undefined)
                        prior.matrix = displayMatrix(operation.matrix);
                    if (operation.colorTransform !== undefined)
                        prior.alpha = displayAlpha(operation.colorTransform);
                    validateTimelineRatio(operation, assets, replacementId);
                });
            snapshots.push(new Map([...active].map(([depth, state]) => [depth, { ...state, matrix: { ...state.matrix } }])));
        });
        if (instances.length === 0)
            fail("FLASH_LIBRARY_ANIMATED_DISPLAY_LIST_EMPTY", `Timeline ${sourceTimeline.symbolId} contains no display objects.`);
        const ordered = [...instances].sort((left, right) =>
            left.authoredDepth - right.authoredDepth || left.firstFrame - right.firstFrame || left.instanceId - right.instanceId);
        const seenLinkages = new Set<string>();
        const children = ordered.map((instance, index) => {
            const operation = {
                op: "place", characterId: instance.characterId, depth: index + 1, move: false, ratio: 0,
                ...(instance.operation.name === undefined ? {} : { name: instance.operation.name }),
                ...(instance.operation.filters === undefined ? {} : { filters: instance.operation.filters }),
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            };
            const child = this.createPlacedNode(
                operation, assets, timelines, resourceAuthorities, rasterizedShapes, rasterizedSprites, resources,
            );
            if (seenLinkages.has(child.linkage))
                fail("FLASH_LIBRARY_ANIMATED_LINKAGE_COLLISION", `Timeline ${sourceTimeline.symbolId} places '${child.linkage}' more than once.`);
            seenLinkages.add(child.linkage);
            return { ...child, visible: false };
        });
        const frameRate = positiveInteger(sourceTimeline.frameRate, `timeline ${sourceTimeline.symbolId}.frameRate`);
        const tracks = ordered.flatMap((instance, index) => {
            const child = children[index];
            const baseX = child.x ?? 0;
            const baseY = child.y ?? 0;
            const values = snapshots.map(snapshot => {
                const state = [...snapshot.values()].find(candidate => candidate.instanceId === instance.instanceId);
                return state === undefined ? undefined : {
                    x: baseX + state.matrix.tx,
                    y: baseY + state.matrix.ty,
                    scaleX: state.matrix.a,
                    scaleY: state.matrix.d,
                    alpha: state.alpha,
                    visible: true,
                };
            });
            return (["x", "y", "scaleX", "scaleY", "alpha", "visible"] as const).map(property => ({
                targetPath: [string(sourceTimeline.symbolName ?? `character_${sourceTimeline.symbolId}`, "timeline.symbolName"), child.linkage],
                property,
                keyframes: values.map((state, frameIndex) => ({
                    time: frameIndex / frameRate,
                    value: state?.[property] ?? (property === "visible" ? false : property === "alpha" ? 1 : property.startsWith("scale") ? 1 : 0),
                })),
            }));
        });
        return {
            children,
            timeline: {
                frameRate,
                duration: frames.length / frameRate,
                loop: true,
                tracks,
            },
        };
    }

    private createRasterizedSprite(
        sourceTimeline: Record<string, any>,
        linkage: string,
        authorities: ReadonlyArray<FlashLibraryRasterizedFrameAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): { readonly children: ReadonlyArray<NeutralAuthoredNode>; readonly timeline: NeutralTimeline } {
        const symbolId = positiveInteger(sourceTimeline.symbolId, "rasterized sprite symbolId");
        const frameRate = positiveInteger(sourceTimeline.frameRate, `timeline ${symbolId}.frameRate`);
        const frameCount = positiveInteger(sourceTimeline.frameCount, `timeline ${symbolId}.frameCount`);
        const frames = array(sourceTimeline.frames, `timeline ${symbolId}.frames`);
        if (frames.length !== frameCount || authorities.length !== frameCount)
            fail("FLASH_LIBRARY_RASTERIZED_SPRITE_FRAME_CLOSURE", `Rasterized sprite ${symbolId} must authenticate exactly ${frameCount} frames.`);
        frames.forEach((value, index) => {
            const current = object(value, `timeline ${symbolId} frame ${index + 1}`);
            if (current.index !== index + 1 || (current.durationTicks !== undefined && current.durationTicks !== 1))
                fail("FLASH_LIBRARY_FRAME_INDEX_INVALID", `Timeline ${symbolId} frame indexing/duration is unsupported.`);
            rejectFrameSideEffects(current, symbolId);
        });
        const children = authorities.map((authority, index): NeutralAuthoredNode => {
            const resourceId = `flash-sprite-${symbolId}-frame-${index + 1}`;
            registerResource(resources, resourceId, authority);
            return {
                linkage: `${linkage}_raster_frame_${index + 1}`,
                name: `${linkage}_raster_frame_${index + 1}`,
                kind: "image",
                depth: index + 1,
                x: finite(authority.x, `rasterized sprite ${symbolId} frame ${index + 1}.x`),
                y: finite(authority.y, `rasterized sprite ${symbolId} frame ${index + 1}.y`),
                width: positive(authority.width, `rasterized sprite ${symbolId} frame ${index + 1}.width`),
                height: positive(authority.height, `rasterized sprite ${symbolId} frame ${index + 1}.height`),
                resourceId,
                visible: index === 0,
                children: [],
            };
        });
        return {
            children,
            timeline: {
                frameRate,
                duration: frameCount / frameRate,
                loop: frameCount > 1,
                tracks: children.map((child, childIndex) => ({
                    targetPath: [linkage, child.linkage],
                    property: "visible" as const,
                    keyframes: authorities.map((_, frameIndex) => ({
                        time: frameIndex / frameRate,
                        value: frameIndex === childIndex,
                    })),
                })),
            },
        };
    }

    private createImage(
        asset: Record<string, any>,
        operation: Record<string, any>,
        assets: Record<string, any>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "shape.characterId");
        const rasterAuthority = rasterizedShapes.get(characterId);
        const sourcePath = rasterAuthority?.sourcePath
            ?? resolveFlashLibraryShapeResourcePath(asset, assets, resourceAuthorities);
        const authority = rasterAuthority ?? resourceAuthorities.get(sourcePath);
        if (!authority || authority.sourcePath !== sourcePath)
            fail("FLASH_LIBRARY_RESOURCE_AUTHORITY_MISSING", `No authenticated resource authority exists for '${sourcePath}'.`);
        const resourceId = `flash-character-${characterId}`;
        registerResource(resources, resourceId, authority);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = placementTransform(operation);
        const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
        const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            name: operation.name ?? flashLibraryAssetName(asset, characterId),
            kind: "image",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x + placement.a * boundsX + placement.c * boundsY,
            y: placement.y + placement.b * boundsX + placement.d * boundsY,
            matrix: placement.matrix,
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
        const placement = placementTransform(operation);
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            name: operation.name ?? flashLibraryAssetName(asset, characterId),
            kind: "dynamic-text",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x,
            y: placement.y,
            matrix: placement.matrix,
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
                filters: authoredGlowFilters(operation.filters, characterId),
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

function spriteBounds(asset: Record<string, any>, sourceTimeline: Record<string, any>, characterId: number): Record<string, any> {
    if (asset.bounds !== undefined)
        return object(asset.bounds, `library.assets.${characterId}.bounds`);
    const frames = array(sourceTimeline.frames, `timeline ${characterId}.frames`);
    for (const value of frames) {
        const current = object(value, `timeline ${characterId} empty sprite frame`);
        rejectFrameSideEffects(current, characterId);
        if (array(current.operations, `timeline ${characterId} empty sprite operations`).length !== 0)
            fail("FLASH_LIBRARY_SPRITE_BOUNDS_REQUIRED", `Non-empty sprite ${characterId} requires authored bounds.`);
    }
    return { x: 0, y: 0, width: 0, height: 0 };
}

function registerResource(
    resources: Map<string, NeutralResourceInput>,
    resourceId: string,
    authority: FlashLibraryResourceAuthority,
): void {
    const resource: NeutralResourceInput = {
        id: resourceId,
        sourcePath: string(authority.sourcePath, `${resourceId}.sourcePath`),
        mediaType: oneOf(authority.mediaType, ["image/jpeg", "image/png"], `${resourceId}.mediaType`),
        byteLength: nonnegativeInteger(authority.byteLength, `${resourceId}.byteLength`),
        sha256: string(authority.sha256, `${resourceId}.sha256`),
    };
    const existing = resources.get(resourceId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(resource))
        fail("FLASH_LIBRARY_RESOURCE_IDENTITY_DRIFT", `Resource '${resourceId}' has conflicting authority.`);
    resources.set(resourceId, resource);
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
    assetsValue: unknown,
    resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
): string {
    const asset = object(assetValue, "shape asset");
    const assets = object(assetsValue, "library.assets");
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
    const bitmapAsset = object(assets[String(bitmapId)], `library.assets.${bitmapId}`);
    if (bitmapAsset.kind !== "image" || bitmapAsset.characterId !== bitmapId)
        fail("FLASH_LIBRARY_BITMAP_FILL_IMAGE_REQUIRED", `Shape ${characterId} bitmap ${bitmapId} does not identify an image asset.`);
    const sourcePath = string(bitmapAsset.path, `library.assets.${bitmapId}.path`);
    const authority = resourceAuthorities.get(sourcePath);
    const lower = sourcePath.replace(/\\/g, "/").toLowerCase();
    const mediaMatches = authority !== undefined && authority.sourcePath === sourcePath
        && ((lower.endsWith(".png") && authority.mediaType === "image/png")
            || ((lower.endsWith(".jpg") || lower.endsWith(".jpeg")) && authority.mediaType === "image/jpeg"));
    if (!mediaMatches)
        fail("FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED", `Shape ${characterId} bitmap ${bitmapId} has no unique authenticated image authority.`);
    return sourcePath;
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

function createDisplayState(
    operation: Record<string, any>,
    firstFrame: number,
    instanceId: number,
    assets: Record<string, any>,
    inheritedAlpha = 1,
): FlashDisplayState {
    const characterId = positiveInteger(operation.characterId, "place.characterId");
    const authoredDepth = positiveInteger(operation.depth, "place.depth");
    object(assets[String(characterId)], `library.assets.${characterId}`);
    if (operation.name !== undefined) string(operation.name, "place.name");
    validateTimelineRatio(operation, assets, characterId);
    return {
        instanceId,
        characterId,
        authoredDepth,
        firstFrame,
        operation,
        matrix: operation.matrix === undefined
            ? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
            : displayMatrix(operation.matrix),
        alpha: operation.colorTransform === undefined
            ? inheritedAlpha
            : displayAlpha(operation.colorTransform),
    };
}

function displayMatrix(value: unknown): DisplayMatrix {
    const matrix = object(value, "place.matrix");
    exactKeys(matrix, MATRIX_FIELDS, "place.matrix", "FLASH_LIBRARY_MATRIX_FIELD_UNSUPPORTED");
    const a = finite(matrix.a, "place.matrix.a");
    const b = finite(matrix.b, "place.matrix.b");
    const c = finite(matrix.c, "place.matrix.c");
    const d = finite(matrix.d, "place.matrix.d");
    if (b !== 0 || c !== 0)
        fail("FLASH_LIBRARY_ANIMATED_MATRIX_UNSUPPORTED", "Animated display-list projection does not admit skew or rotation.");
    return { a, b: 0, c: 0, d, tx: finite(matrix.tx, "place.matrix.tx"), ty: finite(matrix.ty, "place.matrix.ty") };
}

function displayAlpha(value: unknown): number {
    const transform = object(value, "place.colorTransform");
    exactKeys(transform, COLOR_TRANSFORM_FIELDS, "place.colorTransform", "FLASH_LIBRARY_COLOR_TRANSFORM_FIELD_UNSUPPORTED");
    for (const channel of ["red", "green", "blue"] as const) {
        if (finite(transform[`${channel}Multiplier`], `colorTransform.${channel}Multiplier`) !== 1
            || finite(transform[`${channel}Offset`], `colorTransform.${channel}Offset`) !== 0)
            fail("FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED", "Animated display-list projection only admits alpha transforms.");
    }
    if (finite(transform.alphaOffset, "colorTransform.alphaOffset") !== 0)
        fail("FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED", "Animated display-list projection does not admit alpha offsets.");
    const alpha = finite(transform.alphaMultiplier, "colorTransform.alphaMultiplier");
    if (alpha < 0 || alpha > 1)
        fail("FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED", "Animated display-list alpha multiplier must be between zero and one.");
    return alpha;
}

function validateTimelineRatio(operation: Record<string, any>, assets: Record<string, any>, characterId: number): void {
    if (operation.ratio === undefined || operation.ratio === 0) return;
    const ratio = finite(operation.ratio, "place.ratio");
    if (!Number.isInteger(ratio) || ratio < 0 || ratio > 0xffff)
        fail("FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED", "Placement ratio must fit the unsigned Flash field.");
    const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
    if (asset.kind !== "sprite")
        fail("FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED", "Non-zero morph ratios are admitted only when Flash ignores them for sprite characters.");
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
        const placement = placementTransform(operation);
        if (mode === "replacement" && (placement.x !== 0 || placement.y !== 0))
            fail("FLASH_LIBRARY_REPLACEMENT_MATRIX_UNSUPPORTED", "Replacement timelines require a zero-translation retained depth transform.");
    }
}

interface PlacementTransform {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly x: number;
    readonly y: number;
    readonly matrix?: { readonly a: number; readonly b: number; readonly c: number; readonly d: number };
}

function unitPlacement(): PlacementTransform {
    return { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
}

function placementTransform(operation: Record<string, any>): PlacementTransform {
    if (operation.matrix === undefined)
        return unitPlacement();
    const matrix = object(operation.matrix, "place.matrix");
    exactKeys(matrix, MATRIX_FIELDS, "place.matrix", "FLASH_LIBRARY_MATRIX_FIELD_UNSUPPORTED");
    const a = finite(matrix.a, "place.matrix.a");
    const b = finite(matrix.b, "place.matrix.b");
    const c = finite(matrix.c, "place.matrix.c");
    const d = finite(matrix.d, "place.matrix.d");
    const x = finite(matrix.tx, "place.matrix.tx");
    const y = finite(matrix.ty, "place.matrix.ty");
    return { a, b, c, d, x, y, ...(a === 1 && b === 0 && c === 0 && d === 1 ? {} : { matrix: { a, b, c, d } }) };
}

function authoredGlowFilters(value: unknown, characterId: number): ReadonlyArray<Record<string, unknown>> {
    if (value === undefined) return [];
    return array(value, `place ${characterId}.filters`).map((filterValue, index) => {
        const label = `place ${characterId}.filters[${index}]`;
        const filter = object(filterValue, label);
        exactKeys(filter, FILTER_FIELDS, label, "FLASH_LIBRARY_FILTER_FIELD_UNSUPPORTED");
        exactValue(filter.kind, "glow", "FLASH_LIBRARY_FILTER_KIND_UNSUPPORTED", `${label} must be a glow filter.`);
        exactValue(filter.sourceType, "GLOWFILTER", "FLASH_LIBRARY_FILTER_SOURCE_TYPE_UNSUPPORTED", `${label}.sourceType is unsupported.`);
        exactValue(filter.compositeSource, true, "FLASH_LIBRARY_FILTER_COMPOSITE_SOURCE_UNSUPPORTED", `${label}.compositeSource is unsupported.`);
        const color = object(filter.color, `${label}.color`);
        exactKeys(color, FILTER_COLOR_FIELDS, `${label}.color`, "FLASH_LIBRARY_FILTER_COLOR_FIELD_UNSUPPORTED");
        const rgb = finite(color.color, `${label}.color.color`);
        if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff)
            fail("FLASH_LIBRARY_FILTER_COLOR_INVALID", `${label}.color.color must be an RGB integer.`);
        const alpha = finite(color.alpha, `${label}.color.alpha`);
        if (alpha < 0 || alpha > 1)
            fail("FLASH_LIBRARY_FILTER_ALPHA_INVALID", `${label}.color.alpha must be between zero and one.`);
        const blurX = finite(filter.blurX, `${label}.blurX`);
        const blurY = finite(filter.blurY, `${label}.blurY`);
        if (blurX < 0 || blurX > 255 || blurY < 0 || blurY > 255)
            fail("FLASH_LIBRARY_FILTER_BLUR_INVALID", `${label} blur dimensions must be between zero and 255.`);
        const strength = finite(filter.strength, `${label}.strength`);
        if (strength < 0 || strength > 255)
            fail("FLASH_LIBRARY_FILTER_STRENGTH_INVALID", `${label}.strength must be between zero and 255.`);
        const quality = positiveInteger(filter.passes, `${label}.passes`);
        if (quality > 15)
            fail("FLASH_LIBRARY_FILTER_QUALITY_INVALID", `${label}.passes exceeds the Flash quality range.`);
        return {
            kind: "glow", color: rgb, alpha, blurX, blurY, strength, quality,
            inner: boolean(filter.innerGlow, `${label}.innerGlow`),
            knockout: boolean(filter.knockout, `${label}.knockout`),
        };
    });
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

function positive(value: unknown, label: string): number {
    const result = finite(value, label);
    if (result <= 0)
        fail("FLASH_LIBRARY_POSITIVE_NUMBER_REQUIRED", `${label} must be positive.`);
    return result;
}

function nonnegativeInteger(value: unknown, label: string): number {
    const result = finite(value, label);
    if (!Number.isSafeInteger(result) || result < 0)
        fail("FLASH_LIBRARY_NONNEGATIVE_INTEGER_REQUIRED", `${label} must be a non-negative safe integer.`);
    return result;
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
