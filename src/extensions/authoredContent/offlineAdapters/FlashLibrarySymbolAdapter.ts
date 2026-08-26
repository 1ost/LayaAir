import {
    NeutralAuthoredContentIR,
    NeutralInertPlacementRatio,
    NeutralAuthoredNode,
    NeutralAuthoredFilter,
    NeutralTimeline,
    normalizeNeutralAuthoredContent,
} from "../core/NeutralAuthoredContentIR";
import { parseRestrictedFlashHtmlText } from "../core/RestrictedFlashHtmlText";

type NeutralResourceInput = {
    readonly id: string;
    readonly sourcePath: string;
    readonly mediaType: "image/jpeg" | "image/png" | "font/ttf";
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
type PlacementEvidenceContext = {
    readonly timelineSymbolId: number;
    readonly frameIndex: number;
    readonly operationIndex: number;
};

const PLACEMENT_FIELDS = new Set(["characterId", "colorTransform", "depth", "filters", "matrix", "move", "name", "op", "ratio"]);
const REMOVE_FIELDS = new Set(["depth", "op"]);
const GLOW_FILTER_FIELDS = new Set([
    "blurX", "blurY", "color", "compositeSource", "innerGlow", "kind", "knockout", "passes", "sourceType", "strength",
]);
const GRADIENT_BEVEL_FILTER_FIELDS = new Set([
    "angleRadians", "blurX", "blurY", "colors", "compositeSource", "distance", "innerShadow", "kind",
    "knockout", "onTop", "passes", "ratios", "sourceType", "strength", "type",
]);
const FILTER_COLOR_FIELDS = new Set(["alpha", "color"]);
const MATRIX_FIELDS = new Set(["a", "b", "c", "d", "tx", "ty"]);
const COLOR_TRANSFORM_FIELDS = new Set([
    "alphaMultiplier", "alphaOffset", "blueMultiplier", "blueOffset", "greenMultiplier",
    "greenOffset", "redMultiplier", "redOffset",
]);
const BUTTON_FIELDS = new Set(["hasActions", "records", "trackAsMenu"]);
const BUTTON_RECORD_FIELDS = new Set(["characterId", "colorTransform", "depth", "matrix", "states"]);
const BOUNDS_FIELDS = new Set(["height", "width", "x", "y"]);
const BUTTON_STATES = ["up", "over", "down", "hitTest"] as const;
type ButtonStateName = typeof BUTTON_STATES[number];
const BUTTON_STATE_NAMES: ReadonlySet<string> = new Set(BUTTON_STATES);
const TIMELINE_FIELDS = new Set(["frameCount", "frameRate", "frames", "schema", "symbolId", "symbolName"]);
const FRAME_FIELDS = new Set(["durationTicks", "index", "label", "labels", "operations", "sounds"]);
const FRAME_LABEL_OPERATION_FIELDS = new Set(["name", "op"]);
const STAGE_FIELDS = new Set(["backgroundColor", "frameCount", "frameRate", "height", "width"]);
const STAGE_BACKGROUND_FIELDS = new Set(["alpha", "color"]);
const TEXT_FIELD_FIELDS = new Set([
    "align", "autoSize", "border", "color", "fieldType", "fontId", "fontSize", "html", "indent",
    "initialText", "leading", "leftMargin", "multiline", "password", "rightMargin", "selectable",
    "useOutlines", "variableName", "wordWrap",
]);
const FONT_FIELDS = new Set([
    "ascent", "bold", "descent", "embedded", "family", "glyphCount", "glyphs", "hasLayout",
    "italic", "kerning", "leading", "unitsPerEm",
]);
const FONT_GLYPH_FIELDS = new Set(["advance", "bounds", "codePoint", "index"]);
const FONT_GLYPH_BOUNDS_FIELDS = new Set(["xmax", "xmin", "ymax", "ymin"]);
const FONT_KERNING_FIELDS = new Set(["adjustment", "leftCodePoint", "rightCodePoint"]);
const FONT_ALIGN_ZONES_FIELDS = new Set(["fontId", "sourceTag", "tableHint", "tableHintName", "zones"]);
const FONT_ALIGN_ZONE_FIELDS = new Set(["data", "maskX", "maskY"]);
const FONT_ALIGN_ZONE_DATA_FIELDS = new Set(["alignmentCoordinate", "alignmentCoordinateBits", "range", "rangeBits"]);
const TEXT_RENDERING_FIELDS = new Set([
    "gridFit", "gridFitMode", "renderer", "sharpness", "sourceTag", "textId", "thickness", "useFlashType",
]);
const SCALING_GRID_FIELDS = new Set(["characterId", "rect", "sizeGrid", "sourceTag", "units", "valid"]);
const SCALING_GRID_RECT_FIELDS = new Set(["height", "width", "x", "y"]);

export interface FlashLibraryResourceAuthority {
    readonly sourcePath: string;
    readonly mediaType: "image/jpeg" | "image/png" | "font/ttf";
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
        const inertPlacementRatios = new Map<string, NeutralInertPlacementRatio>();
        const root = this.createSprite(
            request.entrySymbolId,
            undefined,
            undefined,
            undefined,
            assets,
            request.timelines,
            request.resources,
            request.rasterizedShapes ?? new Map(),
            request.rasterizedSprites ?? new Map(),
            resources,
            inertPlacementRatios,
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
            ...(inertPlacementRatios.size === 0 ? {} : { inertPlacementRatios: [...inertPlacementRatios.values()] }),
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
        instanceId: string | undefined,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
        inertPlacementRatios: Map<string, NeutralInertPlacementRatio>,
        root = false,
    ): NeutralAuthoredNode {
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind !== "sprite")
            fail("FLASH_LIBRARY_SPRITE_REQUIRED", `Character ${characterId} is not a sprite.`);
        const linkage = flashLibraryAssetName(asset, characterId);
        const sourceTimeline = timeline(timelines, characterId);
        if (sourceTimeline.symbolId !== characterId)
            fail("FLASH_LIBRARY_TIMELINE_ID_MISMATCH", `Timeline ${characterId} identifies another symbol.`);
        const firstFrame = frame(sourceTimeline, 0);
        validateFrame(firstFrame, characterId);
        const initialPlacements = indexedDisplayOperations(firstFrame, characterId);
        const boundslessEmptyNamedAnchor = asset.bounds === undefined
            && isBoundslessEmptyNamedAnchor(operation, sourceTimeline);
        const bounds = spriteBounds(asset, characterId, boundslessEmptyNamedAnchor);
        // Text remains semantic authored content. A diagnostic full-frame
        // raster may authenticate visual evidence, but it must never replace
        // a reachable DefineText/DefineEditText node in production output.
        const rasterFrames = spriteContainsTranslatableText(characterId, assets, timelines)
            ? undefined
            : rasterizedSprites.get(characterId);
        if (rasterFrames !== undefined)
            recordRasterizedTimelineInertPlacementRatios(sourceTimeline, assets, inertPlacementRatios);
        const animated = rasterFrames === undefined
            ? sourceTimeline.frameCount === 1 || boundslessEmptyNamedAnchor ? undefined : this.createAnimatedDisplayList(
                sourceTimeline, assets, timelines, resourceAuthorities, rasterizedShapes, rasterizedSprites, resources,
                inertPlacementRatios, root ? linkage : instanceId!,
            )
            : this.createRasterizedSprite(
                sourceTimeline, linkage, root ? linkage : instanceId!, rasterFrames, resources,
            );
        const children = animated === undefined
            ? initialPlacements.map(({ operation: placed, operationIndex }, index) => {
                const placedCharacterId = positiveInteger(placed.characterId, "place.characterId");
                const placedAsset = object(assets[String(placedCharacterId)], `library.assets.${placedCharacterId}`);
                return this.createPlacedNode(
                placed,
                placementInstanceId(placedAsset, placed, 1, index + 1),
                assets,
                timelines,
                resourceAuthorities,
                rasterizedShapes,
                rasterizedSprites,
                resources,
                inertPlacementRatios,
                { timelineSymbolId: characterId, frameIndex: 1, operationIndex },
            );})
            : animated.children;
        const placement = operation === undefined ? unitPlacement() : placementTransform(operation);
        const authoredName = forcedName ?? operation?.name;
        const node: NeutralAuthoredNode = {
            linkage,
            instanceId: root ? linkage : instanceId,
            ...(root ? { name: linkage } : authoredName === undefined ? {} : { name: authoredName }),
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
                instanceId: root ? linkage : instanceId,
                kind: "container",
                children,
            }),
            ...(asset.scalingGrid === undefined ? {} : {
                scale9Grid: authoredScale9Grid(asset.scalingGrid, characterId, bounds, sourceTimeline, children),
            }),
        };
        return node;
    }

    private createPlacedNode(
        operation: Record<string, any>,
        instanceId: string,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
        inertPlacementRatios: Map<string, NeutralInertPlacementRatio>,
        evidenceContext?: PlacementEvidenceContext,
    ): NeutralAuthoredNode {
        exactPlace(operation);
        const characterId = positiveInteger(operation.characterId, "place.characterId");
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        recordInertPlacementRatio(operation, asset, characterId, evidenceContext, inertPlacementRatios);
        if (asset.kind !== "input-text" && asset.kind !== "text" && asset.kind !== "sprite" && operation.filters !== undefined)
            fail("FLASH_LIBRARY_FILTER_TARGET_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' cannot carry authored filters.`);
        if (asset.kind === "sprite") {
            return this.createSprite(
                characterId,
                operation,
                operation.name,
                instanceId,
                assets,
                timelines,
                resourceAuthorities,
                rasterizedShapes,
                rasterizedSprites,
                resources,
                inertPlacementRatios,
            );
        }
        if (asset.kind === "button") {
            return this.createButton(
                asset,
                operation,
                instanceId,
                assets,
                timelines,
                resourceAuthorities,
                rasterizedShapes,
                rasterizedSprites,
                resources,
                inertPlacementRatios,
            );
        }
        if (asset.kind === "shape")
            return this.createImage(asset, operation, instanceId, assets, resourceAuthorities, rasterizedShapes, resources);
        if (asset.kind === "input-text")
            return this.createDynamicText(asset, operation, instanceId, assets, resourceAuthorities, resources);
        if (asset.kind === "text")
            return this.createStaticTextField(asset, operation, instanceId, assets);
        fail("FLASH_LIBRARY_CHARACTER_KIND_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' is unsupported.`);
    }

    private createButton(
        asset: Record<string, any>,
        operation: Record<string, any>,
        instanceId: string,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
        inertPlacementRatios: Map<string, NeutralInertPlacementRatio>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "button.characterId");
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        exactKeys(bounds, BOUNDS_FIELDS, `library.assets.${characterId}.bounds`, "FLASH_LIBRARY_BUTTON_BOUNDS_FIELD_UNSUPPORTED");
        const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
        const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
        const width = finite(bounds.width, `library.assets.${characterId}.bounds.width`);
        const height = finite(bounds.height, `library.assets.${characterId}.bounds.height`);
        if (boundsX !== 0 || boundsY !== 0 || width <= 0 || height <= 0)
            fail("FLASH_LIBRARY_BUTTON_BOUNDS_UNSUPPORTED", `Button ${characterId} requires positive zero-origin bounds.`);

        const button = object(asset.button, `library.assets.${characterId}.button`);
        exactKeys(button, BUTTON_FIELDS, `library.assets.${characterId}.button`, "FLASH_LIBRARY_BUTTON_FIELD_UNSUPPORTED");
        exactValue(button.hasActions, false, "FLASH_LIBRARY_BUTTON_ACTIONS_UNSUPPORTED", `Button ${characterId} contains action records.`);
        exactValue(button.trackAsMenu, false, "FLASH_LIBRARY_BUTTON_MENU_UNSUPPORTED", `Button ${characterId} uses menu tracking.`);
        const records = array(button.records, `library.assets.${characterId}.button.records`);

        type ButtonRecord = { readonly record: Record<string, any>; readonly alpha: number };
        const recordsByState = new Map<ButtonStateName, ButtonRecord[]>(BUTTON_STATES.map(state => [state, []]));
        records.forEach((value, index) => {
            const label = `library.assets.${characterId}.button.records[${index}]`;
            const record = object(value, label);
            exactKeys(record, BUTTON_RECORD_FIELDS, label, "FLASH_LIBRARY_BUTTON_RECORD_FIELD_UNSUPPORTED");
            positiveInteger(record.characterId, `${label}.characterId`);
            const depth = positiveInteger(record.depth, `${label}.depth`);
            placementTransform({ matrix: object(record.matrix, `${label}.matrix`) });
            const alpha = displayAlpha(record.colorTransform);
            const states = array(record.states, `${label}.states`);
            if (states.length === 0)
                fail("FLASH_LIBRARY_BUTTON_STATE_REQUIRED", `${label}.states must not be empty.`);
            const uniqueStates = new Set<ButtonStateName>();
            states.forEach((stateValue, stateIndex) => {
                const state = string(stateValue, `${label}.states[${stateIndex}]`);
                if (!isButtonStateName(state))
                    fail("FLASH_LIBRARY_BUTTON_STATE_UNSUPPORTED", `${label} contains unsupported state '${state}'.`);
                if (uniqueStates.has(state))
                    fail("FLASH_LIBRARY_BUTTON_STATE_DUPLICATE", `${label} repeats state '${state}'.`);
                uniqueStates.add(state);
                const stateRecords = recordsByState.get(state)!;
                if (stateRecords.some(entry => positiveInteger(entry.record.depth, "button record depth") === depth))
                    fail("FLASH_LIBRARY_BUTTON_DEPTH_DUPLICATE", `Button ${characterId} state '${state}' repeats depth ${depth}.`);
                stateRecords.push({ record, alpha });
            });
        });
        const linkage = flashLibraryAssetName(asset, characterId);
        const stateChildren = BUTTON_STATES.map<NeutralAuthoredNode>(state => {
            const children = recordsByState.get(state)!
                .sort((left, right) => positiveInteger(left.record.depth, "button record depth")
                    - positiveInteger(right.record.depth, "button record depth"))
                .map(({ record, alpha }, index) => {
                    const placed = {
                        op: "place",
                        characterId: record.characterId,
                        depth: record.depth,
                        move: false,
                        ratio: 0,
                        matrix: record.matrix,
                    };
                    const placedCharacterId = positiveInteger(record.characterId, "button record characterId");
                    const placedAsset = object(assets[String(placedCharacterId)], `library.assets.${placedCharacterId}`);
                    const child = this.createPlacedNode(
                        placed,
                        placementInstanceId(placedAsset, placed, 1, index + 1),
                        assets, timelines, resourceAuthorities, rasterizedShapes, rasterizedSprites, resources,
                        inertPlacementRatios,
                    );
                    return alpha === 1 ? child : { ...child, alpha };
                });
            const stateName = `${state}State`;
            return {
                linkage: `${linkage}_${stateName}`,
                instanceId: stateName,
                name: stateName,
                kind: "button-state",
                children,
            };
        });
        const placement = placementTransform(operation);
        const placementAlpha = operation.colorTransform === undefined ? 1 : displayAlpha(operation.colorTransform);
        return {
            linkage,
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
            kind: "button",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x,
            y: placement.y,
            matrix: placement.matrix,
            width,
            height,
            ...(placementAlpha === 1 ? {} : { alpha: placementAlpha }),
            variable: typeof operation.name === "string",
            children: stateChildren,
        };
    }

    private createAnimatedDisplayList(
        sourceTimeline: Record<string, any>,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        rasterizedShapes: ReadonlyMap<number, FlashLibraryResourceAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
        inertPlacementRatios: Map<string, NeutralInertPlacementRatio>,
        ownerInstanceId: string,
    ): { readonly children: ReadonlyArray<NeutralAuthoredNode>; readonly timeline: NeutralTimeline } {
        const active = new Map<number, FlashDisplayState>();
        const instances: FlashDisplayState[] = [];
        const snapshots: Array<Map<number, FlashDisplayState>> = [];
        const frames = validatedTimelineFrames(sourceTimeline);
        const frameLabels = extractFrameLabels(sourceTimeline);
        frames.forEach((value, frameIndex) => {
            const current = object(value, `timeline ${sourceTimeline.symbolId} frame ${frameIndex + 1}`);
            validateFrame(current, sourceTimeline.symbolId);
            indexedDisplayOperations(current, sourceTimeline.symbolId)
                .forEach(({ operation, operationIndex }) => {
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
                        const state = createDisplayState(
                            operation, frameIndex + 1, instances.length + 1, assets, 1,
                            { timelineSymbolId: sourceTimeline.symbolId, frameIndex: frameIndex + 1, operationIndex },
                            inertPlacementRatios,
                        );
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
                        const state = createDisplayState(
                            {
                                ...operation,
                                characterId: replacementId,
                                matrix: operation.matrix ?? prior.matrix,
                            },
                            frameIndex + 1, instances.length + 1, assets, prior.alpha,
                            { timelineSymbolId: sourceTimeline.symbolId, frameIndex: frameIndex + 1, operationIndex },
                            inertPlacementRatios,
                        );
                        instances.push(state);
                        active.set(depth, state);
                        return;
                    }
                    if (operation.matrix !== undefined)
                        prior.matrix = displayMatrix(operation.matrix);
                    if (operation.colorTransform !== undefined)
                        prior.alpha = displayAlpha(operation.colorTransform);
                    recordInertPlacementRatio(
                        operation,
                        object(assets[String(replacementId)], `library.assets.${replacementId}`),
                        replacementId,
                        { timelineSymbolId: sourceTimeline.symbolId, frameIndex: frameIndex + 1, operationIndex },
                        inertPlacementRatios,
                    );
                });
            snapshots.push(new Map([...active].map(([depth, state]) => [depth, { ...state, matrix: { ...state.matrix } }])));
        });
        if (instances.length === 0)
            fail("FLASH_LIBRARY_ANIMATED_DISPLAY_LIST_EMPTY", `Timeline ${sourceTimeline.symbolId} contains no display objects.`);
        const ordered = [...instances].sort((left, right) =>
            left.authoredDepth - right.authoredDepth || left.firstFrame - right.firstFrame || left.instanceId - right.instanceId);
        const children = ordered.map((instance, index) => {
            const operation = {
                op: "place", characterId: instance.characterId, depth: index + 1, move: false, ratio: 0,
                ...(instance.operation.name === undefined ? {} : { name: instance.operation.name }),
                ...(instance.operation.filters === undefined ? {} : { filters: instance.operation.filters }),
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            };
            const placedAsset = object(assets[String(instance.characterId)], `library.assets.${instance.characterId}`);
            const child = this.createPlacedNode(
                operation,
                placementInstanceId(placedAsset, instance.operation, instance.firstFrame, instance.instanceId),
                assets, timelines, resourceAuthorities, rasterizedShapes, rasterizedSprites, resources,
                inertPlacementRatios,
            );
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
                targetPath: [ownerInstanceId, child.instanceId ?? child.linkage],
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
                frameLabels,
                tracks,
            },
        };
    }

    private createRasterizedSprite(
        sourceTimeline: Record<string, any>,
        linkage: string,
        ownerInstanceId: string,
        authorities: ReadonlyArray<FlashLibraryRasterizedFrameAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): { readonly children: ReadonlyArray<NeutralAuthoredNode>; readonly timeline: NeutralTimeline } {
        const symbolId = positiveInteger(sourceTimeline.symbolId, "rasterized sprite symbolId");
        const frameRate = positiveInteger(sourceTimeline.frameRate, `timeline ${symbolId}.frameRate`);
        const frameCount = positiveInteger(sourceTimeline.frameCount, `timeline ${symbolId}.frameCount`);
        validatedTimelineFrames(sourceTimeline, "FLASH_LIBRARY_RASTERIZED_SPRITE_FRAME_CLOSURE");
        if (authorities.length !== frameCount)
            fail("FLASH_LIBRARY_RASTERIZED_SPRITE_FRAME_CLOSURE", `Rasterized sprite ${symbolId} must authenticate exactly ${frameCount} frames.`);
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
                frameLabels: extractFrameLabels(sourceTimeline),
                tracks: children.map((child, childIndex) => ({
                    targetPath: [ownerInstanceId, child.instanceId ?? child.linkage],
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
        instanceId: string,
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
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
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
        instanceId: string,
        assets: Record<string, any>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "text.characterId");
        const textField = object(asset.textField, `library.assets.${characterId}.textField`);
        exactKeys(textField, TEXT_FIELD_FIELDS, `library.assets.${characterId}.textField`, "FLASH_LIBRARY_TEXT_FIELD_UNSUPPORTED");
        // Both embedded-outline and device-font Flash fields become native,
        // editable TextFields. The authenticated source font family/weight is
        // retained below; rasterizing embedded text would make localization
        // impossible and duplicate the surrounding artwork.
        const useOutlines = boolean(textField.useOutlines, `library.assets.${characterId}.textField.useOutlines`);
        exactValue(textField.autoSize, false, "FLASH_LIBRARY_TEXT_AUTO_SIZE_UNSUPPORTED", `Text ${characterId} auto-size is unsupported.`);
        exactValue(textField.border, false, "FLASH_LIBRARY_TEXT_BORDER_UNSUPPORTED", `Text ${characterId} border rendering is unsupported.`);
        exactValue(textField.variableName, "", "FLASH_LIBRARY_TEXT_VARIABLE_UNSUPPORTED", `Text ${characterId} has an unsupported internal variable binding.`);
        const sourceInitialText = text(textField.initialText, `library.assets.${characterId}.textField.initialText`);
        if (text(asset.initialText, `library.assets.${characterId}.initialText`) !== sourceInitialText)
            fail("FLASH_LIBRARY_TEXT_INITIAL_VALUE_MISMATCH", `Text ${characterId} initial-text authorities disagree.`);
        const fontId = positiveInteger(textField.fontId, `library.assets.${characterId}.textField.fontId`);
        const fontAsset = object(assets[String(fontId)], `library.assets.${fontId}`);
        if (fontAsset.kind !== "font")
            fail("FLASH_LIBRARY_TEXT_FONT_REQUIRED", `Text ${characterId} does not reference a font asset.`);
        const font = object(fontAsset.font, `library.assets.${fontId}.font`);
        exactKeys(font, FONT_FIELDS, `library.assets.${fontId}.font`, "FLASH_LIBRARY_FONT_FIELD_UNSUPPORTED");
        const isEmbedded = font.embedded === undefined
            ? false
            : boolean(font.embedded, `library.assets.${fontId}.font.embedded`);
        if (useOutlines && !isEmbedded)
            fail("FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED", `Text ${characterId} uses outlines without an embedded font.`);
        const embeddedFont = isEmbedded
            ? authoredEmbeddedFont(fontAsset, font, fontId, resourceAuthorities, resources)
            : undefined;
        if (useOutlines && asset.textRendering === undefined)
            fail("FLASH_LIBRARY_TEXT_RENDERING_REQUIRED", `Text ${characterId} uses outlines but lacks exact CSM settings.`);
        const rasterization = asset.textRendering === undefined
            ? undefined
            : authoredAdvancedTextRasterization(asset, characterId);
        const color = object(textField.color, `library.assets.${characterId}.textField.color`);
        exactKeys(color, new Set(["alpha", "color"]), `library.assets.${characterId}.textField.color`, "FLASH_LIBRARY_TEXT_COLOR_UNSUPPORTED");
        exactValue(color.alpha, 1, "FLASH_LIBRARY_TEXT_COLOR_ALPHA_UNSUPPORTED", `Text ${characterId} color alpha is unsupported.`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = placementTransform(operation);
        const html = boolean(textField.html, `library.assets.${characterId}.textField.html`);
        const authoredHtml = html
            ? parseAuthoredFlashHtml(sourceInitialText, characterId, font, textField, color)
            : undefined;
        const initialText = authoredHtml?.markup ?? sourceInitialText;
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
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
                html,
                useOutlines,
                filters: authoredGlowFilters(operation.filters, characterId),
                gutter: 2,
                overflow: "hidden",
                initialText,
                ...(rasterization === undefined ? {} : { rasterization }),
                format: {
                    fontMode: embeddedFont === undefined ? "device" : "embedded",
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
                    letterSpacing: authoredHtml?.letterSpacing ?? 0,
                    kerning: authoredHtml?.kerning ?? false,
                    ...(embeddedFont === undefined ? {} : { embeddedFont }),
                },
            },
            children: [],
        };
    }

    private createStaticTextField(
        asset: Record<string, any>,
        operation: Record<string, any>,
        instanceId: string,
        assets: Record<string, any>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "text.characterId");
        const staticText = object(asset.staticText, `library.assets.${characterId}.staticText`);
        exactKeys(staticText, new Set(["exactGlyphs", "issues", "matrix", "runs"]),
            `library.assets.${characterId}.staticText`, "FLASH_LIBRARY_STATIC_TEXT_UNSUPPORTED");
        exactValue(staticText.exactGlyphs, true, "FLASH_LIBRARY_STATIC_TEXT_GLYPHS_REQUIRED",
            `Text ${characterId} lacks exact glyph evidence.`);
        if (array(staticText.issues, `library.assets.${characterId}.staticText.issues`).length !== 0)
            fail("FLASH_LIBRARY_STATIC_TEXT_ISSUES", `Text ${characterId} contains unresolved extraction issues.`);
        const staticMatrix = object(staticText.matrix, `library.assets.${characterId}.staticText.matrix`);
        exactKeys(staticMatrix, MATRIX_FIELDS, `library.assets.${characterId}.staticText.matrix`, "FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED");
        for (const field of ["a", "d"] as const) exactValue(staticMatrix[field], 1,
            "FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED", `Text ${characterId} has a non-identity text matrix.`);
        for (const field of ["b", "c", "tx", "ty"] as const) exactValue(staticMatrix[field], 0,
            "FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED", `Text ${characterId} has a non-identity text matrix.`);
        const runs = array(staticText.runs, `library.assets.${characterId}.staticText.runs`);
        if (runs.length !== 1)
            fail("FLASH_LIBRARY_STATIC_TEXT_RUNS_UNSUPPORTED", `Text ${characterId} must contain exactly one translatable run.`);
        const run = object(runs[0], `library.assets.${characterId}.staticText.runs[0]`);
        exactKeys(run, new Set(["color", "fontId", "fontSize", "glyphs", "text", "width", "x", "y"]),
            `library.assets.${characterId}.staticText.runs[0]`, "FLASH_LIBRARY_STATIC_TEXT_RUN_UNSUPPORTED");
        const initialText = text(asset.initialText, `library.assets.${characterId}.initialText`);
        if (text(run.text, `library.assets.${characterId}.staticText.runs[0].text`) !== initialText)
            fail("FLASH_LIBRARY_TEXT_INITIAL_VALUE_MISMATCH", `Text ${characterId} initial-text authorities disagree.`);
        const glyphs = array(run.glyphs, `library.assets.${characterId}.staticText.runs[0].glyphs`);
        if (glyphs.map((glyph, index) => text(object(glyph, `static glyph ${index}`).character,
            `static glyph ${index}.character`)).join("") !== initialText)
            fail("FLASH_LIBRARY_STATIC_TEXT_GLYPH_TEXT_MISMATCH", `Text ${characterId} glyph characters disagree with its string.`);
        const fontId = positiveInteger(run.fontId, `library.assets.${characterId}.staticText.runs[0].fontId`);
        const fontAsset = object(assets[String(fontId)], `library.assets.${fontId}`);
        if (fontAsset.kind !== "font")
            fail("FLASH_LIBRARY_TEXT_FONT_REQUIRED", `Text ${characterId} does not reference a font asset.`);
        const font = object(fontAsset.font, `library.assets.${fontId}.font`);
        const color = object(run.color, `library.assets.${characterId}.staticText.runs[0].color`);
        exactKeys(color, new Set(["alpha", "color"]), `library.assets.${characterId}.staticText.runs[0].color`,
            "FLASH_LIBRARY_TEXT_COLOR_UNSUPPORTED");
        exactValue(color.alpha, 1, "FLASH_LIBRARY_TEXT_COLOR_ALPHA_UNSUPPORTED", `Text ${characterId} color alpha is unsupported.`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
        const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
        const fontSize = positive(run.fontSize, `library.assets.${characterId}.staticText.runs[0].fontSize`);
        const placement = placementTransform(operation);
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
            kind: "dynamic-text",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x + placement.a * boundsX + placement.c * boundsY,
            y: placement.y + placement.b * boundsX + placement.d * boundsY,
            matrix: placement.matrix,
            width: positive(bounds.width, `Text ${characterId} width`),
            height: Math.max(positive(bounds.height, `Text ${characterId} height`), fontSize + 4),
            variable: typeof operation.name === "string",
            textField: {
                sourceId: characterId,
                type: "dynamic",
                multiline: false,
                wordWrap: false,
                selectable: false,
                displayAsPassword: false,
                autoSize: "none",
                html: false,
                useOutlines: false,
                filters: authoredGlowFilters(operation.filters, characterId),
                gutter: 2,
                overflow: "hidden",
                initialText,
                format: {
                    fontMode: "device",
                    font: string(font.family, `library.assets.${fontId}.font.family`),
                    size: fontSize,
                    color: finite(color.color, "text.color.color"),
                    bold: boolean(font.bold, "font.bold"),
                    italic: boolean(font.italic, "font.italic"),
                    underline: false,
                    align: "left",
                    leftMargin: 0,
                    rightMargin: 0,
                    indent: 0,
                    leading: 0,
                    letterSpacing: 0,
                    kerning: true,
                },
            },
            children: [],
        };
    }
}

function isButtonStateName(value: string): value is ButtonStateName {
    return BUTTON_STATE_NAMES.has(value);
}

function spriteContainsTranslatableText(
    characterId: number,
    assets: Record<string, any>,
    timelines: ReadonlyMap<number, unknown>,
    visited = new Set<number>(),
): boolean {
    if (visited.has(characterId)) return false;
    visited.add(characterId);
    const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
    if (asset.kind === "text" || asset.kind === "input-text") return true;
    if (asset.kind !== "sprite") return false;
    const sourceTimeline = timeline(timelines, characterId);
    return array(sourceTimeline.frames, `timeline ${characterId}.frames`).some((frameValue, frameIndex) =>
        array(object(frameValue, `timeline ${characterId} frame ${frameIndex + 1}`).operations,
            `timeline ${characterId} frame ${frameIndex + 1}.operations`).some((operationValue, operationIndex) => {
            const operation = object(operationValue, `timeline ${characterId} operation ${operationIndex}`);
            return operation.op === "place" && operation.characterId !== undefined
                && spriteContainsTranslatableText(positiveInteger(operation.characterId, "place.characterId"), assets, timelines, visited);
        }));
}

function parseAuthoredFlashHtml(
    value: string,
    characterId: number,
    font: Record<string, any>,
    textField: Record<string, any>,
    color: Record<string, any>,
): ReturnType<typeof parseRestrictedFlashHtmlText> {
    let layout: ReturnType<typeof parseRestrictedFlashHtmlText>;
    try { layout = parseRestrictedFlashHtmlText(value); }
    catch (error) {
        fail("FLASH_LIBRARY_TEXT_HTML_UNSUPPORTED", `Text ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (layout.font !== string(font.family, `Text ${characterId} font family`)
        || layout.size !== finite(textField.fontSize, `Text ${characterId} font size`)
        || layout.color !== finite(color.color, `Text ${characterId} color`)
        || layout.align !== string(textField.align, `Text ${characterId} align`)
        || layout.bold !== boolean(font.bold, `Text ${characterId} font bold`)) {
        fail("FLASH_LIBRARY_TEXT_HTML_AUTHORITY_MISMATCH", `Text ${characterId} HTML formatting disagrees with its field metadata.`);
    }
    return layout;
}

function authoredEmbeddedFont(
    fontAsset: Record<string, any>,
    font: Record<string, any>,
    fontId: number,
    resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
    resources: Map<string, NeutralResourceInput>,
) {
    exactValue(fontAsset.sourceTag, "DefineFont3Tag", "FLASH_LIBRARY_FONT_FORMAT_UNSUPPORTED", `Font ${fontId} is not an embedded DefineFont3 resource.`);
    exactValue(font.embedded, true, "FLASH_LIBRARY_FONT_NOT_EMBEDDED", `Font ${fontId} is not embedded.`);
    exactValue(font.hasLayout, true, "FLASH_LIBRARY_FONT_LAYOUT_REQUIRED", `Font ${fontId} does not retain layout metrics.`);
    const sourcePath = string(fontAsset.path, `library.assets.${fontId}.path`);
    if (!sourcePath.toLocaleLowerCase("en-US").endsWith(".ttf"))
        fail("FLASH_LIBRARY_FONT_RESOURCE_FORMAT_UNSUPPORTED", `Font ${fontId} must identify a .ttf resource.`);
    const authority = resourceAuthorities.get(sourcePath);
    if (!authority || authority.sourcePath !== sourcePath || authority.mediaType !== "font/ttf")
        fail("FLASH_LIBRARY_FONT_RESOURCE_AUTHORITY_MISSING", `No authenticated TrueType authority exists for '${sourcePath}'.`);
    const resourceId = `flash-font-${fontId}`;
    registerResource(resources, resourceId, authority);

    const glyphCount = positiveInteger(font.glyphCount, `library.assets.${fontId}.font.glyphCount`);
    const glyphValues = array(font.glyphs, `library.assets.${fontId}.font.glyphs`);
    if (glyphValues.length !== glyphCount)
        fail("FLASH_LIBRARY_FONT_GLYPH_COUNT_MISMATCH", `Font ${fontId} glyph count does not match its retained metrics.`);
    let previousCodePoint = -1;
    const glyphs = glyphValues.map((candidate, index) => {
        const glyph = object(candidate, `library.assets.${fontId}.font.glyphs[${index}]`);
        exactKeys(glyph, FONT_GLYPH_FIELDS, `library.assets.${fontId}.font.glyphs[${index}]`, "FLASH_LIBRARY_FONT_GLYPH_FIELD_UNSUPPORTED");
        exactValue(glyph.index, index, "FLASH_LIBRARY_FONT_GLYPH_INDEX_MISMATCH", `Font ${fontId} glyph indices must be contiguous source order.`);
        const codePoint = unicodeScalar(glyph.codePoint, `font ${fontId} glyph ${index}.codePoint`);
        if (codePoint <= previousCodePoint)
            fail("FLASH_LIBRARY_FONT_GLYPH_ORDER_UNSUPPORTED", `Font ${fontId} glyph code points must be strictly ordered.`);
        previousCodePoint = codePoint;
        const bounds = object(glyph.bounds, `font ${fontId} glyph ${index}.bounds`);
        exactKeys(bounds, FONT_GLYPH_BOUNDS_FIELDS, `font ${fontId} glyph ${index}.bounds`, "FLASH_LIBRARY_FONT_GLYPH_BOUNDS_FIELD_UNSUPPORTED");
        const advance = nonnegativeFinite(glyph.advance, `font ${fontId} glyph ${index}.advance`);
        return {
            index,
            codePoint,
            advance,
            bounds: {
                xmin: finite(bounds.xmin, `font ${fontId} glyph ${index}.bounds.xmin`),
                xmax: finite(bounds.xmax, `font ${fontId} glyph ${index}.bounds.xmax`),
                ymin: finite(bounds.ymin, `font ${fontId} glyph ${index}.bounds.ymin`),
                ymax: finite(bounds.ymax, `font ${fontId} glyph ${index}.bounds.ymax`),
            },
        };
    });
    const kerning = array(font.kerning, `library.assets.${fontId}.font.kerning`).map((candidate, index) => {
        const pair = object(candidate, `font ${fontId} kerning ${index}`);
        exactKeys(pair, FONT_KERNING_FIELDS, `font ${fontId} kerning ${index}`, "FLASH_LIBRARY_FONT_KERNING_FIELD_UNSUPPORTED");
        const leftCodePoint = unicodeScalar(pair.leftCodePoint, `font ${fontId} kerning ${index}.leftCodePoint`);
        const rightCodePoint = unicodeScalar(pair.rightCodePoint, `font ${fontId} kerning ${index}.rightCodePoint`);
        return { leftCodePoint, rightCodePoint, adjustment: finite(pair.adjustment, `font ${fontId} kerning ${index}.adjustment`) };
    }).sort((left, right) => left.leftCodePoint - right.leftCodePoint || left.rightCodePoint - right.rightCodePoint);
    for (let index = 1; index < kerning.length; index++) {
        const previous = kerning[index - 1];
        const current = kerning[index];
        if (previous.leftCodePoint === current.leftCodePoint && previous.rightCodePoint === current.rightCodePoint)
            fail("FLASH_LIBRARY_FONT_KERNING_DUPLICATE", `Font ${fontId} kerning pairs must be unique.`);
    }
    const alignZones = authoredFontAlignZones(fontAsset.fontAlignZones, fontId, glyphCount);
    const bold = boolean(font.bold, `library.assets.${fontId}.font.bold`);
    const italic = boolean(font.italic, `library.assets.${fontId}.font.italic`);
    return {
        resourceId,
        sourceSha256: authority.sha256,
        fontId,
        fontType: "embedded" as const,
        fontStyle: bold && italic ? "boldItalic" as const : bold ? "bold" as const : italic ? "italic" as const : "regular" as const,
        unitsPerEm: positive(font.unitsPerEm, `library.assets.${fontId}.font.unitsPerEm`),
        ascent: nonnegativeFinite(font.ascent, `library.assets.${fontId}.font.ascent`),
        descent: nonnegativeFinite(font.descent, `library.assets.${fontId}.font.descent`),
        leading: finite(font.leading, `library.assets.${fontId}.font.leading`),
        glyphs,
        kerning,
        alignZones,
    };
}

function authoredFontAlignZones(value: unknown, fontId: number, glyphCount: number) {
    const source = object(value, `library.assets.${fontId}.fontAlignZones`);
    exactKeys(source, FONT_ALIGN_ZONES_FIELDS, `library.assets.${fontId}.fontAlignZones`, "FLASH_LIBRARY_FONT_ALIGN_ZONE_FIELD_UNSUPPORTED");
    exactValue(source.fontId, fontId, "FLASH_LIBRARY_FONT_ALIGN_ZONE_ID_MISMATCH", `Font ${fontId} align zones identify another font.`);
    exactValue(source.sourceTag, "DefineFontAlignZonesTag", "FLASH_LIBRARY_FONT_ALIGN_ZONE_FORMAT_UNSUPPORTED", `Font ${fontId} align zones lack DefineFontAlignZones authority.`);
    exactValue(source.tableHint, 1, "FLASH_LIBRARY_FONT_ALIGN_ZONE_TABLE_UNSUPPORTED", `Font ${fontId} align zones use an unsupported table hint.`);
    exactValue(source.tableHintName, "medium", "FLASH_LIBRARY_FONT_ALIGN_ZONE_TABLE_UNSUPPORTED", `Font ${fontId} align zones use an unsupported table hint name.`);
    const zones = array(source.zones, `library.assets.${fontId}.fontAlignZones.zones`);
    if (zones.length !== glyphCount)
        fail("FLASH_LIBRARY_FONT_ALIGN_ZONE_COUNT_MISMATCH", `Font ${fontId} align-zone count does not match its glyph count.`);
    return {
        tableHint: 1 as const,
        tableHintName: "medium" as const,
        zones: zones.map((candidate, zoneIndex) => {
            const zone = object(candidate, `font ${fontId} align zone ${zoneIndex}`);
            exactKeys(zone, FONT_ALIGN_ZONE_FIELDS, `font ${fontId} align zone ${zoneIndex}`, "FLASH_LIBRARY_FONT_ALIGN_ZONE_FIELD_UNSUPPORTED");
            const data = array(zone.data, `font ${fontId} align zone ${zoneIndex}.data`);
            if (data.length !== 2)
                fail("FLASH_LIBRARY_FONT_ALIGN_ZONE_DATA_COUNT", `Font ${fontId} align zone ${zoneIndex} must retain X and Y records.`);
            return {
                data: data.map((datumValue, dataIndex) => {
                    const datum = object(datumValue, `font ${fontId} align zone ${zoneIndex}.data[${dataIndex}]`);
                    exactKeys(datum, FONT_ALIGN_ZONE_DATA_FIELDS, `font ${fontId} align zone ${zoneIndex}.data[${dataIndex}]`, "FLASH_LIBRARY_FONT_ALIGN_ZONE_DATA_FIELD_UNSUPPORTED");
                    return {
                        alignmentCoordinate: nonnegativeFinite(datum.alignmentCoordinate, `font ${fontId} align zone ${zoneIndex}.alignmentCoordinate`),
                        alignmentCoordinateBits: uint16(datum.alignmentCoordinateBits, `font ${fontId} align zone ${zoneIndex}.alignmentCoordinateBits`),
                        range: nonnegativeFinite(datum.range, `font ${fontId} align zone ${zoneIndex}.range`),
                        rangeBits: uint16(datum.rangeBits, `font ${fontId} align zone ${zoneIndex}.rangeBits`),
                    };
                }),
                maskX: boolean(zone.maskX, `font ${fontId} align zone ${zoneIndex}.maskX`),
                maskY: boolean(zone.maskY, `font ${fontId} align zone ${zoneIndex}.maskY`),
            };
        }),
    };
}

function authoredAdvancedTextRasterization(asset: Record<string, any>, characterId: number) {
    const rendering = object(asset.textRendering, `library.assets.${characterId}.textRendering`);
    exactKeys(rendering, TEXT_RENDERING_FIELDS, `library.assets.${characterId}.textRendering`, "FLASH_LIBRARY_TEXT_RENDERING_FIELD_UNSUPPORTED");
    exactValue(rendering.sourceTag, "CSMSettingsTag", "FLASH_LIBRARY_TEXT_RENDERER_UNSUPPORTED", `Text ${characterId} does not retain CSM settings.`);
    exactValue(rendering.textId, characterId, "FLASH_LIBRARY_TEXT_RENDERING_ID_MISMATCH", `Text ${characterId} rendering authority identifies another field.`);
    exactValue(rendering.renderer, "advanced", "FLASH_LIBRARY_TEXT_RENDERER_UNSUPPORTED", `Text ${characterId} renderer is unsupported.`);
    exactValue(rendering.useFlashType, 1, "FLASH_LIBRARY_TEXT_RENDERER_UNSUPPORTED", `Text ${characterId} does not use FlashType.`);
    const gridFit = rendering.gridFit;
    const gridFitMode = rendering.gridFitMode;
    const gridFitType = gridFit === 1 && gridFitMode === "pixel" ? "pixel"
        : gridFit === 2 && gridFitMode === "subpixel" ? "subpixel" : null;
    if (gridFitType === null)
        fail("FLASH_LIBRARY_TEXT_GRID_FIT_UNSUPPORTED", `Text ${characterId} grid-fit code and mode are unsupported.`);
    const sharpness = finite(rendering.sharpness, `library.assets.${characterId}.textRendering.sharpness`);
    const thickness = finite(rendering.thickness, `library.assets.${characterId}.textRendering.thickness`);
    if (sharpness < -400 || sharpness > 400 || thickness < -200 || thickness > 200)
        fail("FLASH_LIBRARY_TEXT_RASTERIZATION_RANGE", `Text ${characterId} rasterization settings exceed Flash ranges.`);
    return { antiAliasType: "advanced" as const, gridFitType, sharpness, thickness };
}

function authoredScale9Grid(
    value: unknown,
    characterId: number,
    bounds: Record<string, any>,
    sourceTimeline: Record<string, any>,
    children: ReadonlyArray<NeutralAuthoredNode>,
): NonNullable<NeutralAuthoredNode["scale9Grid"]> {
    const source = object(value, `library.assets.${characterId}.scalingGrid`);
    exactKeys(source, SCALING_GRID_FIELDS, `library.assets.${characterId}.scalingGrid`, "FLASH_LIBRARY_SCALING_GRID_FIELD_UNSUPPORTED");
    exactValue(source.characterId, characterId, "FLASH_LIBRARY_SCALING_GRID_CHARACTER_MISMATCH", `Scaling grid ${characterId} identifies another character.`);
    exactValue(source.sourceTag, "DefineScalingGridTag", "FLASH_LIBRARY_SCALING_GRID_SOURCE_UNSUPPORTED", `Scaling grid ${characterId} has an unsupported source tag.`);
    exactValue(source.units, "pixels", "FLASH_LIBRARY_SCALING_GRID_UNITS_UNSUPPORTED", `Scaling grid ${characterId} is not in pixels.`);
    exactValue(source.valid, true, "FLASH_LIBRARY_SCALING_GRID_INVALID", `Scaling grid ${characterId} was not validated by the source adapter.`);
    if (positiveInteger(sourceTimeline.frameCount, `timeline ${characterId}.frameCount`) !== 1)
        fail("FLASH_LIBRARY_ANIMATED_SCALING_GRID_UNSUPPORTED", `Scaling grid ${characterId} requires a one-frame raster projection.`);
    if (children.length !== 1 || children[0].kind !== "image")
        fail("FLASH_LIBRARY_SCALING_GRID_RASTER_TARGET_REQUIRED", `Scaling grid ${characterId} requires exactly one direct image child.`);
    const child = children[0];
    const boundsWidth = finite(bounds.width, `library.assets.${characterId}.bounds.width`);
    const boundsHeight = finite(bounds.height, `library.assets.${characterId}.bounds.height`);
    if ((child.x ?? 0) !== 0 || (child.y ?? 0) !== 0 || child.width !== boundsWidth || child.height !== boundsHeight)
        fail("FLASH_LIBRARY_SCALING_GRID_RASTER_BOUNDS_MISMATCH", `Scaling grid ${characterId} image child does not cover the authored bounds.`);
    const rect = object(source.rect, `library.assets.${characterId}.scalingGrid.rect`);
    exactKeys(rect, SCALING_GRID_RECT_FIELDS, `library.assets.${characterId}.scalingGrid.rect`, "FLASH_LIBRARY_SCALING_GRID_RECT_FIELD_UNSUPPORTED");
    const x = finite(rect.x, `library.assets.${characterId}.scalingGrid.rect.x`);
    const y = finite(rect.y, `library.assets.${characterId}.scalingGrid.rect.y`);
    const width = finite(rect.width, `library.assets.${characterId}.scalingGrid.rect.width`);
    const height = finite(rect.height, `library.assets.${characterId}.scalingGrid.rect.height`);
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > boundsWidth || y + height > boundsHeight)
        fail("FLASH_LIBRARY_SCALING_GRID_RECT_INVALID", `Scaling grid ${characterId} lies outside the authored bounds.`);
    const values = array(source.sizeGrid, `library.assets.${characterId}.scalingGrid.sizeGrid`);
    if (values.length !== 5)
        fail("FLASH_LIBRARY_SCALING_GRID_SIZE_INVALID", `Scaling grid ${characterId} sizeGrid must contain five values.`);
    const sizeGrid = values.map((item, index) => finite(item, `library.assets.${characterId}.scalingGrid.sizeGrid[${index}]`));
    const expected = [y, boundsWidth - x - width, boundsHeight - y - height, x, 0];
    if (sizeGrid.some((item, index) => item !== expected[index]))
        fail("FLASH_LIBRARY_SCALING_GRID_INSETS_MISMATCH", `Scaling grid ${characterId} insets disagree with its rectangle.`);
    return {
        x,
        y,
        width,
        height,
        sizeGrid: sizeGrid as [number, number, number, number, 0],
        target: child.name ?? child.instanceId ?? child.linkage,
    };
}

function spriteBounds(
    asset: Record<string, any>,
    characterId: number,
    boundslessEmptyNamedAnchor: boolean,
): Record<string, any> {
    if (asset.bounds !== undefined)
        return object(asset.bounds, `library.assets.${characterId}.bounds`);
    if (!boundslessEmptyNamedAnchor)
        fail("FLASH_LIBRARY_SPRITE_BOUNDS_MISSING", `Sprite ${characterId} requires bounds unless it is an empty named anchor.`);
    return { x: 0, y: 0, width: 0, height: 0 };
}

function isBoundslessEmptyNamedAnchor(
    operation: Record<string, any> | undefined,
    sourceTimeline: Record<string, any>,
): boolean {
    if (operation === undefined || typeof operation.name !== "string")
        return false;
    return validatedTimelineFrames(sourceTimeline).every((value, index) => {
        const current = object(value, `timeline ${sourceTimeline.symbolId} frame ${index + 1}`);
        return current.label === undefined
            && array(current.operations, `timeline ${sourceTimeline.symbolId}.operations`).length === 0;
    });
}

function registerResource(
    resources: Map<string, NeutralResourceInput>,
    resourceId: string,
    authority: FlashLibraryResourceAuthority,
): void {
    const resource: NeutralResourceInput = {
        id: resourceId,
        sourcePath: string(authority.sourcePath, `${resourceId}.sourcePath`),
        mediaType: oneOf(authority.mediaType, ["image/jpeg", "image/png", "font/ttf"], `${resourceId}.mediaType`),
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
    evidenceContext?: PlacementEvidenceContext,
    inertPlacementRatios?: Map<string, NeutralInertPlacementRatio>,
): FlashDisplayState {
    const characterId = positiveInteger(operation.characterId, "place.characterId");
    const authoredDepth = positiveInteger(operation.depth, "place.depth");
    const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
    if (operation.name !== undefined) string(operation.name, "place.name");
    if (inertPlacementRatios === undefined)
        validateTimelineRatio(operation, asset);
    else
        recordInertPlacementRatio(operation, asset, characterId, evidenceContext, inertPlacementRatios);
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

function validateTimelineRatio(
    operation: Record<string, any>,
    asset: Record<string, any>,
    allowRasterizedMorph = false,
): number | undefined {
    if (operation.ratio === undefined) return undefined;
    const ratio = finite(operation.ratio, "place.ratio");
    if (!Number.isInteger(ratio) || ratio < 0 || ratio > 0xffff)
        fail("FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED", "Placement ratio must fit the unsigned Flash field.");
    if (ratio === 0) return undefined;
    if (!(allowRasterizedMorph && asset.kind === "morph")
        && asset.kind !== "button" && asset.kind !== "input-text" && asset.kind !== "shape"
        && asset.kind !== "sprite" && asset.kind !== "text")
        fail("FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED", `Non-zero placement ratios require a proven non-morph character; kind '${String(asset.kind)}' remains fail-closed.`);
    return ratio;
}

function placementInstanceId(
    asset: Record<string, any>,
    operation: Record<string, any>,
    firstFrame: number,
    ordinal: number,
): string {
    if (operation.name !== undefined)
        return string(operation.name, "place.name");
    const characterId = positiveInteger(asset.characterId, "asset.characterId");
    const depth = positiveInteger(operation.depth, "place.depth");
    if (!Number.isSafeInteger(firstFrame) || firstFrame < 1
        || !Number.isSafeInteger(ordinal) || ordinal < 1)
        fail("FLASH_LIBRARY_INSTANCE_ID_AUTHORITY_INVALID", "Placement frame and ordinal must be positive safe integers.");
    return `${flashLibraryAssetName(asset, characterId)}$d${depth}$f${firstFrame}$i${ordinal}`;
}

function recordInertPlacementRatio(
    operation: Record<string, any>,
    asset: Record<string, any>,
    characterId: number,
    context: PlacementEvidenceContext | undefined,
    evidence: Map<string, NeutralInertPlacementRatio>,
    allowRasterizedMorph = false,
): void {
    const ratio = validateTimelineRatio(operation, asset, allowRasterizedMorph);
    if (ratio === undefined) return;
    if (context === undefined)
        fail("FLASH_LIBRARY_RATIO_EVIDENCE_CONTEXT_MISSING", "A non-zero inert placement ratio has no source coordinate.");
    const sourceKind = string(asset.kind, `library.assets.${characterId}.kind`);
    const characterKind = sourceKind === "morph" && allowRasterizedMorph
        ? "morph-rasterized"
        : sourceKind as NeutralInertPlacementRatio["characterKind"];
    const value: NeutralInertPlacementRatio = {
        timelineSymbolId: positiveInteger(context.timelineSymbolId, "ratio.timelineSymbolId"),
        frameIndex: positiveInteger(context.frameIndex, "ratio.frameIndex"),
        operationIndex: nonnegativeInteger(context.operationIndex, "ratio.operationIndex"),
        depth: positiveInteger(operation.depth, "place.depth"),
        characterId,
        characterKind,
        ratio,
    };
    const key = `${value.timelineSymbolId}/${value.frameIndex}/${value.operationIndex}`;
    const prior = evidence.get(key);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(value))
        fail("FLASH_LIBRARY_RATIO_EVIDENCE_DRIFT", `Placement ratio evidence at ${key} resolved inconsistently.`);
    evidence.set(key, value);
}

function recordRasterizedTimelineInertPlacementRatios(
    sourceTimeline: Record<string, any>,
    assets: Record<string, any>,
    evidence: Map<string, NeutralInertPlacementRatio>,
): void {
    const symbolId = positiveInteger(sourceTimeline.symbolId, "timeline.symbolId");
    const active = new Map<number, number>();
    validatedTimelineFrames(sourceTimeline).forEach((value, frameIndex) => {
        const frameValue = object(value, `timeline ${symbolId} frame ${frameIndex + 1}`);
        indexedDisplayOperations(frameValue, symbolId).forEach(({ operation, operationIndex }) => {
            const depth = positiveInteger(operation.depth, `${operation.op}.depth`);
            if (operation.op === "remove") {
                active.delete(depth);
                return;
            }
            if (operation.op !== "place") return;
            const prior = active.get(depth);
            const characterId = operation.characterId === undefined
                ? prior
                : positiveInteger(operation.characterId, "place.characterId");
            if (characterId === undefined) {
                if (operation.ratio !== undefined && operation.ratio !== 0)
                    fail("FLASH_LIBRARY_RATIO_EVIDENCE_CHARACTER_MISSING", `Timeline ${symbolId} ratio at frame ${frameIndex + 1} operation ${operationIndex} has no effective character.`);
                return;
            }
            active.set(depth, characterId);
            recordInertPlacementRatio(
                operation,
                object(assets[String(characterId)], `library.assets.${characterId}`),
                characterId,
                { timelineSymbolId: symbolId, frameIndex: frameIndex + 1, operationIndex },
                evidence,
                true,
            );
        });
    });
}

function nativeTimeline(source: Record<string, any>, owner: NeutralAuthoredNode): NeutralTimeline {
    const frameRate = finite(source.frameRate, `timeline ${source.symbolId}.frameRate`);
    const frameCount = positiveInteger(source.frameCount, `timeline ${source.symbolId}.frameCount`);
    const frames = validatedTimelineFrames(source);
    const tracks = frameCount === 1 ? [] : owner.children.map(child => ({
        targetPath: [owner.instanceId ?? owner.linkage, child.instanceId ?? child.linkage],
        property: "visible" as const,
        keyframes: frames.flatMap((value, index) => {
            const operations = displayOperations(object(value, "frame"), source.symbolId);
            if (operations.length === 0)
                return [];
            const activeId = positiveInteger(object(operations[0], "operation").characterId, "operation.characterId");
            const childId = positiveInteger(Number(child.linkage.replace("symbol", "")), "child.characterId");
            return [{ time: index / frameRate, value: activeId === childId }];
        }),
    }));
    return {
        frameRate,
        duration: frameCount / frameRate,
        loop: frameCount > 1,
        frameLabels: extractFrameLabels(source),
        tracks,
    };
}

function validatedTimelineFrames(
    sourceTimeline: Record<string, any>,
    closureCode = "FLASH_LIBRARY_FRAME_CLOSURE",
): any[] {
    const symbolId = positiveInteger(sourceTimeline.symbolId, "timeline.symbolId");
    const frameCount = positiveInteger(sourceTimeline.frameCount, `timeline ${symbolId}.frameCount`);
    const frames = array(sourceTimeline.frames, `timeline ${symbolId}.frames`);
    if (frames.length !== frameCount)
        fail(closureCode, `Timeline ${symbolId} frame count drifted.`);
    frames.forEach((value, index) => {
        const current = object(value, `timeline ${symbolId} frame ${index + 1}`);
        if (current.index !== index + 1 || (current.durationTicks !== undefined && current.durationTicks !== 1))
            fail("FLASH_LIBRARY_FRAME_INDEX_INVALID", `Timeline ${symbolId} frame indexing/duration is unsupported.`);
        validateFrame(current, symbolId);
    });
    return frames;
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

function validateFrame(value: Record<string, any>, symbolId: number): void {
    exactKeys(value, FRAME_FIELDS, `timeline ${symbolId} frame`, "FLASH_LIBRARY_FRAME_FIELD_UNSUPPORTED");
    if (array(value.labels ?? [], `timeline ${symbolId}.labels`).length !== 0)
        fail("FLASH_LIBRARY_FRAME_LABELS_UNSUPPORTED", `Timeline ${symbolId} contains frame labels.`);
    if (array(value.sounds ?? [], `timeline ${symbolId}.sounds`).length !== 0)
        fail("FLASH_LIBRARY_FRAME_SOUNDS_UNSUPPORTED", `Timeline ${symbolId} contains frame sounds.`);
    const frameLabel = value.label === undefined
        ? undefined
        : validFrameLabel(value.label, `timeline ${symbolId}.label`);
    const labelOperations = array(value.operations, `timeline ${symbolId}.operations`)
        .map((operation, index) => object(operation, `timeline ${symbolId}.operations[${index}]`))
        .filter(operation => operation.op === "label");
    if (labelOperations.length > 1)
        fail("FLASH_LIBRARY_FRAME_LABEL_OPERATION_DUPLICATE", `Timeline ${symbolId} contains multiple label operations on one frame.`);
    if (labelOperations.length === 1) {
        const operation = labelOperations[0];
        exactKeys(operation, FRAME_LABEL_OPERATION_FIELDS, "label", "FLASH_LIBRARY_FRAME_LABEL_OPERATION_FIELD_UNSUPPORTED");
        const operationLabel = validFrameLabel(operation.name, `timeline ${symbolId} label operation`);
        if (frameLabel === undefined || operationLabel !== frameLabel)
            fail("FLASH_LIBRARY_FRAME_LABEL_OPERATION_MISMATCH", `Timeline ${symbolId} label operation does not match frame.label.`);
    }
}

function displayOperations(value: Record<string, any>, symbolId: number): any[] {
    return indexedDisplayOperations(value, symbolId).map(value => value.operation);
}

function indexedDisplayOperations(
    value: Record<string, any>,
    symbolId: number,
): ReadonlyArray<{ readonly operation: Record<string, any>; readonly operationIndex: number }> {
    return array(value.operations, `timeline ${symbolId}.operations`)
        .map((value, operationIndex) => ({
            operation: object(value, `timeline ${symbolId} operation ${operationIndex}`),
            operationIndex,
        }))
        .filter(value => value.operation.op !== "label");
}

function extractFrameLabels(sourceTimeline: Record<string, any>): Readonly<Record<string, number>> {
    const symbolId = positiveInteger(sourceTimeline.symbolId, "timeline.symbolId");
    const labels: Record<string, number> = {};
    array(sourceTimeline.frames, `timeline ${symbolId}.frames`).forEach((value, index) => {
        const current = object(value, `timeline ${symbolId} frame ${index + 1}`);
        validateFrame(current, symbolId);
        if (current.label === undefined) return;
        const label = validFrameLabel(current.label, `timeline ${symbolId} frame ${index + 1}.label`);
        if (Object.prototype.hasOwnProperty.call(labels, label))
            fail("FLASH_LIBRARY_FRAME_LABEL_DUPLICATE", `Timeline ${symbolId} repeats frame label '${label}'.`);
        Object.defineProperty(labels, label, { value: index + 1, enumerable: true });
    });
    return Object.freeze(labels);
}

function validFrameLabel(value: unknown, label: string): string {
    const result = string(value, label);
    if (!/^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/.test(result))
        fail("FLASH_LIBRARY_FRAME_LABEL_INVALID", `${label} is not a stable identifier.`);
    return result;
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

function authoredGlowFilters(value: unknown, characterId: number): ReadonlyArray<NeutralAuthoredFilter> {
    if (value === undefined) return [];
    return array(value, `place ${characterId}.filters`).map((filterValue, index) => {
        const label = `place ${characterId}.filters[${index}]`;
        const filter = object(filterValue, label);
        if (filter.kind === "gradient-bevel") return authoredGradientBevelFilter(filter, label);
        exactKeys(filter, GLOW_FILTER_FIELDS, label, "FLASH_LIBRARY_FILTER_FIELD_UNSUPPORTED");
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

function authoredGradientBevelFilter(filter: Record<string, any>, label: string): NeutralAuthoredFilter {
    exactKeys(filter, GRADIENT_BEVEL_FILTER_FIELDS, label, "FLASH_LIBRARY_FILTER_FIELD_UNSUPPORTED");
    exactValue(filter.sourceType, "GRADIENTBEVELFILTER", "FLASH_LIBRARY_FILTER_SOURCE_TYPE_UNSUPPORTED", `${label}.sourceType is unsupported.`);
    exactValue(filter.compositeSource, true, "FLASH_LIBRARY_FILTER_COMPOSITE_SOURCE_UNSUPPORTED", `${label}.compositeSource is unsupported.`);
    const type = filter.type;
    if (type !== "inner" && type !== "outer" && type !== "full")
        fail("FLASH_LIBRARY_FILTER_TYPE_UNSUPPORTED", `${label}.type is unsupported.`);
    exactValue(filter.innerShadow, type === "inner", "FLASH_LIBRARY_FILTER_TYPE_UNSUPPORTED", `${label}.innerShadow disagrees with type.`);
    exactValue(filter.onTop, type === "full", "FLASH_LIBRARY_FILTER_TYPE_UNSUPPORTED", `${label}.onTop disagrees with type.`);
    const colorStops = array(filter.colors, `${label}.colors`).map((candidate, index) => {
        const stop = object(candidate, `${label}.colors[${index}]`);
        exactKeys(stop, FILTER_COLOR_FIELDS, `${label}.colors[${index}]`, "FLASH_LIBRARY_FILTER_COLOR_FIELD_UNSUPPORTED");
        const color = finite(stop.color, `${label}.colors[${index}].color`);
        const alpha = finite(stop.alpha, `${label}.colors[${index}].alpha`);
        if (!Number.isInteger(color) || color < 0 || color > 0xffffff || alpha < 0 || alpha > 1)
            fail("FLASH_LIBRARY_FILTER_COLOR_INVALID", `${label}.colors[${index}] is outside the Flash range.`);
        return { color, alpha };
    });
    const ratios = array(filter.ratios, `${label}.ratios`).map((candidate, index) => {
        const ratio = finite(candidate, `${label}.ratios[${index}]`);
        if (!Number.isInteger(ratio) || ratio < 0 || ratio > 255)
            fail("FLASH_LIBRARY_FILTER_RATIO_INVALID", `${label}.ratios[${index}] is outside the Flash range.`);
        return ratio;
    });
    if (colorStops.length < 2 || colorStops.length !== ratios.length)
        fail("FLASH_LIBRARY_FILTER_GRADIENT_INVALID", `${label} gradient stops are incomplete.`);
    const blurX = finite(filter.blurX, `${label}.blurX`);
    const blurY = finite(filter.blurY, `${label}.blurY`);
    const strength = finite(filter.strength, `${label}.strength`);
    const quality = positiveInteger(filter.passes, `${label}.passes`);
    if (blurX < 0 || blurX > 255 || blurY < 0 || blurY > 255 || strength < 0 || strength > 255 || quality > 15)
        fail("FLASH_LIBRARY_FILTER_RANGE_INVALID", `${label} exceeds the Flash filter range.`);
    return {
        kind: "gradient-bevel", distance: finite(filter.distance, `${label}.distance`),
        angle: finite(filter.angleRadians, `${label}.angleRadians`) * 180 / Math.PI,
        colors: colorStops.map(stop => stop.color), alphas: colorStops.map(stop => stop.alpha), ratios,
        blurX, blurY, strength, quality, type,
        knockout: boolean(filter.knockout, `${label}.knockout`),
    };
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

function nonnegativeFinite(value: unknown, label: string): number {
    const result = finite(value, label);
    if (result < 0)
        fail("FLASH_LIBRARY_NONNEGATIVE_NUMBER_REQUIRED", `${label} must be nonnegative.`);
    return result;
}

function unicodeScalar(value: unknown, label: string): number {
    const result = finite(value, label);
    if (!Number.isInteger(result) || result < 0 || result > 0x10ffff
        || result >= 0xd800 && result <= 0xdfff)
        fail("FLASH_LIBRARY_UNICODE_SCALAR_REQUIRED", `${label} must be a Unicode scalar value.`);
    return result;
}

function uint16(value: unknown, label: string): number {
    const result = finite(value, label);
    if (!Number.isInteger(result) || result < 0 || result > 0xffff)
        fail("FLASH_LIBRARY_UINT16_REQUIRED", `${label} must be a uint16 value.`);
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
