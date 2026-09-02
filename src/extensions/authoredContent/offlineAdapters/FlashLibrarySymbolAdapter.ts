import {
    NeutralAuthoredContentIR,
    NeutralAuthoredFilter,
    NeutralInertPlacementRatio,
    NeutralAuthoredNode,
    NeutralFontAlignZoneData,
    NeutralFontAlignZones,
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
    readonly b: number;
    readonly c: number;
    readonly d: number;
    readonly tx: number;
    readonly ty: number;
};
type DisplayColorTransform = {
    readonly redMultiplier: number;
    readonly greenMultiplier: number;
    readonly blueMultiplier: number;
    readonly alphaMultiplier: number;
    readonly redOffset: number;
    readonly greenOffset: number;
    readonly blueOffset: number;
    readonly alphaOffset: number;
};
type FlashDisplayState = {
    readonly instanceId: number;
    readonly characterId: number;
    readonly authoredDepth: number;
    readonly firstFrame: number;
    readonly operation: Record<string, any>;
    matrix: DisplayMatrix;
    alpha: number;
    visible: boolean;
    colorTransform: DisplayColorTransform;
    filters: ReadonlyArray<NeutralAuthoredFilter>;
    animatedVisualState: boolean;
};
type PlacementEvidenceContext = {
    readonly timelineSymbolId: number;
    readonly frameIndex: number;
    readonly operationIndex: number;
};
type FlashLibraryShapeProjection = {
    readonly bitmapId: number;
    readonly sourcePath: string;
    readonly styleIndex: number;
    readonly smoothing: boolean;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly flipX: boolean;
    readonly flipY: boolean;
};

const PLACEMENT_FIELDS = new Set(["blendMode", "blendModeCode", "characterId", "clipDepth", "colorTransform", "depth", "filters", "matrix", "move", "name", "op", "ratio", "visible"]);
const REMOVE_FIELDS = new Set(["depth", "op"]);
const FILTER_FIELDS = new Set([
    "blurX", "blurY", "color", "compositeSource", "innerGlow", "kind", "knockout", "passes", "sourceType", "strength",
]);
const DROP_SHADOW_FILTER_FIELDS = new Set([
    "angleRadians", "blurX", "blurY", "color", "compositeSource", "distance", "innerShadow",
    "kind", "knockout", "passes", "sourceType", "strength",
]);
const BEVEL_FILTER_FIELDS = new Set([
    "angleRadians", "blurX", "blurY", "compositeSource", "distance", "highlightColor", "innerShadow",
    "kind", "knockout", "onTop", "passes", "shadowColor", "sourceType", "strength", "type",
]);
const BLUR_FILTER_FIELDS = new Set(["blurX", "blurY", "kind", "passes", "sourceType"]);
const GRADIENT_FILTER_FIELDS = new Set([
    "angleRadians", "blurX", "blurY", "colors", "compositeSource", "distance", "innerShadow", "kind",
    "knockout", "onTop", "passes", "ratios", "sourceType", "strength", "type",
]);
const COLOR_MATRIX_FILTER_FIELDS = new Set(["kind", "matrix", "sourceType"]);
const FILTER_COLOR_FIELDS = new Set(["alpha", "color"]);
const MATRIX_FIELDS = new Set(["a", "b", "c", "d", "tx", "ty"]);
const COLOR_TRANSFORM_FIELDS = new Set([
    "alphaMultiplier", "alphaOffset", "blueMultiplier", "blueOffset", "greenMultiplier",
    "greenOffset", "redMultiplier", "redOffset",
]);
const BUTTON_FIELDS = new Set(["hasActions", "records", "trackAsMenu"]);
const BUTTON_RECORD_FIELDS = new Set(["characterId", "colorTransform", "depth", "filters", "matrix", "states"]);
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
const FONT_GLYPH_WITHOUT_LAYOUT_FIELDS = new Set(["codePoint", "index"]);
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

export interface FlashLibraryRasterizedShapeAuthority extends FlashLibraryResourceAuthority {
    /** Exact pixel extent of the authenticated raster, including Flash's covered terminal edge. */
    readonly pixelWidth: number;
    readonly pixelHeight: number;
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
    /** Retain authenticated TextField paths/text while replacing non-text shapes with inert placeholders. */
    readonly textMapOnly?: boolean;
    /** Explicit JPEXS raster authorities for shapes which cannot be projected from vector fill records. */
    readonly rasterizedShapes?: ReadonlyMap<number, FlashLibraryRasterizedShapeAuthority>;
    /** Explicit full-frame JPEXS raster authorities for symbols whose leaf rendering is intentionally flattened. */
    readonly rasterizedSprites?: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>;
}

export class FlashLibrarySymbolAdapter {
    private textMapOnly = false;

    parse(request: FlashLibrarySymbolRequest): NeutralAuthoredContentIR {
        if (request.textMapOnly !== undefined && typeof request.textMapOnly !== "boolean")
            fail("FLASH_LIBRARY_TEXT_MAP_ONLY_INVALID", "textMapOnly must be boolean when provided.");
        this.textMapOnly = request.textMapOnly === true;
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
        rasterizedShapes: ReadonlyMap<number, FlashLibraryRasterizedShapeAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
        inertPlacementRatios: Map<string, NeutralInertPlacementRatio>,
        root = false,
    ): NeutralAuthoredNode {
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind !== "sprite")
            fail("FLASH_LIBRARY_SPRITE_REQUIRED", `Character ${characterId} is not a sprite.`);
        const linkage = flashLibraryAssetName(asset, characterId);
        const sourceTimeline = normalizeReservedZeroDepthTimeline(timeline(timelines, characterId), assets);
        if (sourceTimeline.symbolId !== characterId)
            fail("FLASH_LIBRARY_TIMELINE_ID_MISMATCH", `Timeline ${characterId} identifies another symbol.`);
        const firstFrame = frame(sourceTimeline, 0);
        validateFrame(firstFrame, characterId);
        const initialPlacements = indexedDisplayOperations(firstFrame, characterId)
            .filter(({ operation: placed }) => !admitNonvisualFontAuthorityPlacement(placed, assets));
        const boundslessNonvisualSprite = asset.bounds === undefined
            && (isBoundslessEmptyPlaceholder(operation, sourceTimeline)
                || isBoundslessNamedAnchorTree(operation, sourceTimeline, assets, timelines, new Set([characterId])));
        const bounds = spriteBounds(asset, characterId, boundslessNonvisualSprite);
        // Text remains semantic authored content. A diagnostic full-frame
        // raster may authenticate visual evidence, but it must never replace
        // a reachable DefineText/DefineEditText node in production output.
        const rasterFrames = spriteContainsTranslatableText(characterId, assets, timelines)
            ? undefined
            : rasterizedSprites.get(characterId);
        if (rasterFrames !== undefined)
            recordRasterizedTimelineInertPlacementRatios(sourceTimeline, assets, inertPlacementRatios);
        const animated = rasterFrames === undefined
            ? sourceTimeline.frameCount === 1 || boundslessNonvisualSprite ? undefined : this.createAnimatedDisplayList(
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
        const colorTransform = operation?.colorTransform === undefined
            ? undefined
            : displayColorTransform(operation.colorTransform);
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
            ...(this.textMapOnly || colorTransform === undefined || isIdentityColorTransform(colorTransform)
                ? {}
                : { colorTransform }),
            ...(this.textMapOnly || colorTransform === undefined || colorTransform.alphaMultiplier === 1
                ? {}
                : { alpha: colorTransform.alphaMultiplier }),
            ...(this.textMapOnly || operation?.filters === undefined ? {} : { filters: authoredFilters(operation.filters, characterId) }),
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
            ...(this.textMapOnly || asset.scalingGrid === undefined ? {} : {
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
        rasterizedShapes: ReadonlyMap<number, FlashLibraryRasterizedShapeAuthority>,
        rasterizedSprites: ReadonlyMap<number, ReadonlyArray<FlashLibraryRasterizedFrameAuthority>>,
        resources: Map<string, NeutralResourceInput>,
        inertPlacementRatios: Map<string, NeutralInertPlacementRatio>,
        evidenceContext?: PlacementEvidenceContext,
    ): NeutralAuthoredNode {
        exactPlace(operation);
        const characterId = positiveInteger(operation.characterId, "place.characterId");
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        recordInertPlacementRatio(operation, asset, characterId, evidenceContext, inertPlacementRatios);
        if (!this.textMapOnly && asset.kind !== "input-text" && asset.kind !== "text" && asset.kind !== "sprite" && operation.filters !== undefined)
            fail("FLASH_LIBRARY_FILTER_TARGET_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' cannot carry authored filters.`);
        let node: NeutralAuthoredNode;
        if (asset.kind === "sprite") {
            node = this.createSprite(
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
        else if (asset.kind === "button") {
            node = this.createButton(
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
        else if (asset.kind === "shape")
            node = this.createImage(asset, operation, instanceId, assets, resourceAuthorities, rasterizedShapes, resources);
        else if (asset.kind === "input-text")
            node = this.createDynamicText(asset, operation, instanceId, assets, resourceAuthorities, resources);
        else if (asset.kind === "text")
            node = this.createStaticTextField(asset, operation, instanceId, assets);
        else
            fail("FLASH_LIBRARY_CHARACTER_KIND_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' is unsupported.`);
        const blendMode = authoredBlendMode(operation);
        if (blendMode !== undefined)
            node = { ...node, blendMode };
        if (operation.visible !== undefined)
            node = { ...node, visible: boolean(operation.visible, "place.visible") };
        return operation.clipDepth === undefined
            ? node
            : { ...node, clipDepth: positiveInteger(operation.clipDepth, "place.clipDepth") };
    }

    private createButton(
        asset: Record<string, any>,
        operation: Record<string, any>,
        instanceId: string,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        rasterizedShapes: ReadonlyMap<number, FlashLibraryRasterizedShapeAuthority>,
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
        if (width <= 0 || height <= 0)
            fail("FLASH_LIBRARY_BUTTON_BOUNDS_UNSUPPORTED", `Button ${characterId} requires positive bounds.`);

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
                    let child = this.createPlacedNode(
                        placed,
                        placementInstanceId(placedAsset, placed, 1, index + 1),
                        assets, timelines, resourceAuthorities, rasterizedShapes, rasterizedSprites, resources,
                        inertPlacementRatios,
                    );
                    const filters = authoredFilters(record.filters, placedCharacterId);
                    if (filters.length !== 0) {
                        const { depth, ...visual } = child;
                        child = {
                            linkage: `${linkage}_${state}_filtered_${index + 1}`,
                            instanceId: child.instanceId,
                            kind: "container",
                            depth,
                            ...(alpha === 1 ? {} : { alpha }),
                            filters,
                            children: [{
                                ...visual,
                                instanceId: `${child.instanceId ?? child.linkage}$filteredVisual`,
                                variable: false,
                            }],
                        };
                    }
                    else if (alpha !== 1) child = { ...child, alpha };
                    return child;
                });
            const stateName = `${state}State`;
            return {
                linkage: `${linkage}_${stateName}`,
                instanceId: stateName,
                name: stateName,
                kind: "button-state",
                ...(boundsX === 0 ? {} : { x: -boundsX }),
                ...(boundsY === 0 ? {} : { y: -boundsY }),
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
            x: placement.x + placement.a * boundsX + placement.c * boundsY,
            y: placement.y + placement.b * boundsX + placement.d * boundsY,
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
        rasterizedShapes: ReadonlyMap<number, FlashLibraryRasterizedShapeAuthority>,
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
                            operation, frameIndex + 1, instances.length + 1, assets, 1, true,
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
                            frameIndex + 1, instances.length + 1, assets, prior.alpha, prior.visible,
                            { timelineSymbolId: sourceTimeline.symbolId, frameIndex: frameIndex + 1, operationIndex },
                            inertPlacementRatios,
                            prior.colorTransform,
                            prior.filters,
                        );
                        instances.push(state);
                        active.set(depth, state);
                        return;
                    }
                    if (operation.matrix !== undefined)
                        prior.matrix = displayMatrix(operation.matrix);
                    if (operation.colorTransform !== undefined) {
                        const colorTransform = displayColorTransform(operation.colorTransform);
                        if (!this.textMapOnly && !sameRgbColorTransform(colorTransform, prior.colorTransform)) {
                            if (typeof prior.operation.name === "string") {
                                const placedAsset = object(assets[String(prior.characterId)], `library.assets.${prior.characterId}`);
                                if (placedAsset.kind !== "sprite")
                                    fail("FLASH_LIBRARY_NAMED_DYNAMIC_COLOR_TRANSFORM_UNSUPPORTED",
                                        `Timeline ${String(sourceTimeline.symbolId)} depth ${depth} placement '${prior.operation.name}' `
                                        + "changes RGB color transform on a non-sprite target.");
                                prior.animatedVisualState = true;
                            }
                            else {
                                const state = createDisplayState(
                                    {
                                        ...prior.operation,
                                        ...operation,
                                        op: "place",
                                        characterId: replacementId,
                                        depth,
                                        move: false,
                                        matrix: operation.matrix ?? prior.matrix,
                                        colorTransform,
                                    },
                                    frameIndex + 1, instances.length + 1, assets, prior.alpha, prior.visible,
                                    { timelineSymbolId: sourceTimeline.symbolId, frameIndex: frameIndex + 1, operationIndex },
                                    inertPlacementRatios,
                                    prior.colorTransform,
                                    prior.filters,
                                );
                                instances.push(state);
                                active.set(depth, state);
                                return;
                            }
                        }
                        prior.colorTransform = colorTransform;
                        prior.alpha = colorTransform.alphaMultiplier;
                    }
                    if (operation.filters !== undefined) {
                        const filters = authoredFilters(operation.filters, replacementId);
                        if (!this.textMapOnly && !sameAuthoredFilters(filters, prior.filters)) {
                            const placedAsset = object(assets[String(prior.characterId)], `library.assets.${prior.characterId}`);
                            if (placedAsset.kind !== "sprite")
                                fail("FLASH_LIBRARY_NAMED_DYNAMIC_FILTER_UNSUPPORTED",
                                    `Timeline ${String(sourceTimeline.symbolId)} depth ${depth} placement `
                                    + "changes filters on a non-sprite target.");
                            prior.animatedVisualState = true;
                        }
                        prior.filters = filters;
                    }
                    if (operation.visible !== undefined)
                        prior.visible = boolean(operation.visible, "place.visible");
                    recordInertPlacementRatio(
                        operation,
                        object(assets[String(replacementId)], `library.assets.${replacementId}`),
                        replacementId,
                        { timelineSymbolId: sourceTimeline.symbolId, frameIndex: frameIndex + 1, operationIndex },
                        inertPlacementRatios,
                    );
                });
            snapshots.push(new Map([...active].map(([depth, state]) => [depth, {
                ...state,
                matrix: { ...state.matrix },
                colorTransform: { ...state.colorTransform },
                filters: [...state.filters],
            }])));
        });
        if (instances.length === 0)
            fail("FLASH_LIBRARY_ANIMATED_DISPLAY_LIST_EMPTY", `Timeline ${sourceTimeline.symbolId} contains no display objects.`);
        const ordered = [...instances].sort((left, right) =>
            left.authoredDepth - right.authoredDepth || left.firstFrame - right.firstFrame || left.instanceId - right.instanceId);
        const claimedVariableNames = new Set<string>();
        const children = ordered.map((instance, index) => {
            const sourceName = typeof instance.operation.name === "string" ? instance.operation.name : undefined;
            const retainsVariableName = sourceName !== undefined && !claimedVariableNames.has(sourceName);
            if (retainsVariableName) claimedVariableNames.add(sourceName!);
            const initial = instance.animatedVisualState
                ? [...snapshots[0].values()].find(candidate => candidate.instanceId === instance.instanceId) ?? instance
                : instance;
            const operation = {
                op: "place", characterId: instance.characterId, depth: index + 1, move: false, ratio: 0,
                ...(retainsVariableName ? { name: sourceName } : {}),
                ...(instance.operation.filters === undefined ? {} : { filters: instance.operation.filters }),
                ...(instance.operation.blendMode === undefined ? {} : {
                    blendMode: instance.operation.blendMode,
                    blendModeCode: instance.operation.blendModeCode,
                }),
                ...(!isIdentityColorTransform(initial.colorTransform)
                    ? { colorTransform: initial.colorTransform }
                    : {}),
                matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
            };
            const placedAsset = object(assets[String(instance.characterId)], `library.assets.${instance.characterId}`);
            const child = this.createPlacedNode(
                operation,
                animatedPlacementInstanceId(placedAsset, instance.operation, instance.firstFrame, instance.instanceId),
                assets, timelines, resourceAuthorities, rasterizedShapes, rasterizedSprites, resources,
                inertPlacementRatios,
            );
            return { ...child, visible: false };
        });
        const frameRate = positiveInteger(sourceTimeline.frameRate, `timeline ${sourceTimeline.symbolId}.frameRate`);
        const tracks = ordered.flatMap((instance, index) => {
            const child = children[index];
            const initial = instance.animatedVisualState
                ? [...snapshots[0].values()].find(candidate => candidate.instanceId === instance.instanceId) ?? instance
                : instance;
            const baseX = child.x ?? 0;
            const baseY = child.y ?? 0;
            const values = snapshots.map(snapshot => {
                const state = [...snapshot.values()].find(candidate => candidate.instanceId === instance.instanceId);
                return state === undefined ? undefined : {
                    x: baseX + state.matrix.tx,
                    y: baseY + state.matrix.ty,
                    scaleX: state.matrix.a,
                    scaleY: state.matrix.d,
                    matrixA: state.matrix.a,
                    matrixB: state.matrix.b,
                    matrixC: state.matrix.c,
                    matrixD: state.matrix.d,
                    alpha: state.alpha,
                    visible: state.visible,
                };
            });
            const usesAffineMatrix = values.some(state => state !== undefined
                && (state.matrixB !== 0 || state.matrixC !== 0));
            const properties = usesAffineMatrix
                ? (["x", "y", "matrixA", "matrixB", "matrixC", "matrixD", "alpha", "visible"] as const)
                : (["x", "y", "scaleX", "scaleY", "alpha", "visible"] as const);
            const transformTracks = properties.map(property => ({
                targetPath: [ownerInstanceId, child.instanceId ?? child.linkage],
                property,
                keyframes: values.map((state, frameIndex) => ({
                    time: frameIndex / frameRate,
                    value: state?.[property] ?? (property === "visible" ? false
                        : property === "alpha" || property === "scaleX" || property === "scaleY"
                            || property === "matrixA" || property === "matrixD" ? 1 : 0),
                })),
            }));
            return instance.animatedVisualState ? [...transformTracks, {
                targetPath: [ownerInstanceId, child.instanceId ?? child.linkage],
                property: "authoredVisualState" as const,
                keyframes: snapshots.map((snapshot, frameIndex) => {
                    const state = [...snapshot.values()].find(candidate => candidate.instanceId === instance.instanceId);
                    const visual = state ?? initial;
                    return {
                        time: frameIndex / frameRate,
                        value: {
                            colorTransform: { ...visual.colorTransform },
                            filters: visual.filters.map(filter => ({ ...filter })),
                        },
                    };
                }),
            }] : transformTracks;
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
        rasterizedShapes: ReadonlyMap<number, FlashLibraryRasterizedShapeAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "shape.characterId");
        const rasterAuthority = rasterizedShapes.get(characterId);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = placementTransform(operation);
        const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
        const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
        const boundsWidth = finite(bounds.width, `library.assets.${characterId}.bounds.width`);
        const boundsHeight = finite(bounds.height, `library.assets.${characterId}.bounds.height`);
        const linkage = flashLibraryAssetName(asset, characterId);
        const common = {
            linkage,
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x + placement.a * boundsX + placement.c * boundsY,
            y: placement.y + placement.b * boundsX + placement.d * boundsY,
            matrix: placement.matrix,
            width: boundsWidth,
            height: boundsHeight,
            variable: typeof operation.name === "string",
        };
        if (this.textMapOnly)
            return { ...common, kind: "container", children: [] };
        if (rasterAuthority !== undefined) {
            const resourceId = `flash-character-${characterId}`;
            registerResource(resources, resourceId, rasterAuthority);
            return {
                ...common,
                kind: "image",
                resourceId,
                // Flash logical bounds end on a covered pixel edge. JPEXS
                // therefore exports an N+1 pixel raster for an N-unit shape;
                // drawing it back into the logical bounds resamples every
                // pixel. Retain the authenticated raster's native extent.
                width: positiveInteger(rasterAuthority.pixelWidth, `${resourceId}.pixelWidth`),
                height: positiveInteger(rasterAuthority.pixelHeight, `${resourceId}.pixelHeight`),
                // JPEXS shape rasters are authenticated pixel projections, not
                // smoothed source artwork. Point sampling preserves their exact
                // covered-edge pixels when Laya applies placement transforms.
                smoothing: false,
                children: [],
            };
        }

        if (asset.path !== undefined) {
            const sourcePath = string(asset.path, `library.assets.${characterId}.path`);
            const authority = resourceAuthorities.get(sourcePath);
            if (!authority || authority.sourcePath !== sourcePath)
                fail("FLASH_LIBRARY_RESOURCE_AUTHORITY_MISSING", `No authenticated resource authority exists for '${sourcePath}'.`);
            const resourceId = `flash-character-${characterId}`;
            registerResource(resources, resourceId, authority);
            return { ...common, kind: "image", resourceId, children: [] };
        }

        const projections = resolveFlashLibraryShapeProjections(asset, assets, resourceAuthorities);
        if (projections.length === 1 && !projections[0].flipX && !projections[0].flipY) {
            const projection = projections[0];
            const authority = resourceAuthorities.get(projection.sourcePath);
            if (!authority || authority.sourcePath !== projection.sourcePath)
                fail("FLASH_LIBRARY_RESOURCE_AUTHORITY_MISSING", `No authenticated resource authority exists for '${projection.sourcePath}'.`);
            const resourceId = registerBitmapResource(
                resources, projection.bitmapId, authority, projection.smoothing,
            );
            return {
                ...common,
                kind: "image",
                resourceId,
                smoothing: projection.smoothing,
                children: [],
            };
        }

        const children = projections.map((projection, index): NeutralAuthoredNode => {
            const authority = resourceAuthorities.get(projection.sourcePath);
            if (!authority || authority.sourcePath !== projection.sourcePath)
                fail("FLASH_LIBRARY_RESOURCE_AUTHORITY_MISSING", `No authenticated resource authority exists for '${projection.sourcePath}'.`);
            const resourceId = registerBitmapResource(
                resources, projection.bitmapId, authority, projection.smoothing,
            );
            return {
                linkage: `${linkage}_fill_${projection.styleIndex}`,
                instanceId: `fill_${projection.styleIndex}`,
                kind: "image",
                depth: index + 1,
                x: projection.x - boundsX + (projection.flipX ? projection.width : 0),
                y: projection.y - boundsY + (projection.flipY ? projection.height : 0),
                ...(projection.flipX || projection.flipY ? {
                    matrix: {
                        a: projection.flipX ? -1 : 1,
                        b: 0,
                        c: 0,
                        d: projection.flipY ? -1 : 1,
                    },
                } : {}),
                width: projection.width,
                height: projection.height,
                resourceId,
                smoothing: projection.smoothing,
                children: [],
            };
        });
        return {
            ...common,
            kind: "container",
            children,
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
        if (this.textMapOnly)
            return this.createTextMapNode(asset, operation, instanceId, characterId, true);
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
        const hasLayout = isEmbedded
            ? boolean(font.hasLayout, `library.assets.${fontId}.font.hasLayout`)
            : false;
        const usesZeroGlyphDeviceFace = useOutlines && !isEmbedded;
        if (usesZeroGlyphDeviceFace)
            admitZeroGlyphOutlineFontAsDevice(fontAsset, font, fontId);
        if (useOutlines && isEmbedded && !hasLayout)
            fail("FLASH_LIBRARY_FONT_LAYOUT_REQUIRED", `Text ${characterId} uses outlines from font ${fontId}, which does not retain layout metrics.`);
        if (isEmbedded && !hasLayout)
            admitEmbeddedFontAsDevice(fontAsset, font, fontId, resourceAuthorities);
        const embeddedFont = isEmbedded && hasLayout
            ? authoredEmbeddedFont(fontAsset, font, fontId, resourceAuthorities, resources)
            : undefined;
        // DefineEditText.useOutlines selects the embedded font independently
        // of the optional CSMSettings tag. When that tag is absent Flash uses
        // the TextField defaults (normal anti-aliasing and pixel grid fit), so
        // omitting rasterization retains the exact authored state.
        const rasterization = asset.textRendering === undefined || usesZeroGlyphDeviceFace
            ? undefined
            : authoredAdvancedTextRasterization(asset, characterId);
        const color = object(textField.color, `library.assets.${characterId}.textField.color`);
        exactKeys(color, new Set(["alpha", "color"]), `library.assets.${characterId}.textField.color`, "FLASH_LIBRARY_TEXT_COLOR_UNSUPPORTED");
        exactValue(color.alpha, 1, "FLASH_LIBRARY_TEXT_COLOR_ALPHA_UNSUPPORTED", `Text ${characterId} color alpha is unsupported.`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
        const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
        const boundsWidth = finite(bounds.width, `library.assets.${characterId}.bounds.width`);
        const boundsHeight = finite(bounds.height, `library.assets.${characterId}.bounds.height`);
        const placement = placementTransform(operation);
        const html = boolean(textField.html, `library.assets.${characterId}.textField.html`);
        const authoredHtml = html
            ? parseAuthoredFlashHtml(sourceInitialText, characterId, font, textField, color,
                !useOutlines || isEmbedded && !hasLayout)
            : undefined;
        const initialText = authoredHtml?.markup ?? sourceInitialText;
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
            kind: "dynamic-text",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x + placement.a * boundsX + placement.c * boundsY,
            y: placement.y + placement.b * boundsX + placement.d * boundsY,
            matrix: placement.matrix,
            width: boundsWidth,
            height: boundsHeight,
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
                useOutlines: useOutlines && !usesZeroGlyphDeviceFace,
                filters: this.textMapOnly ? [] : authoredFilters(operation.filters, characterId),
                gutter: 2,
                overflow: "hidden",
                initialText,
                ...(rasterization === undefined ? {} : { rasterization }),
                format: {
                    fontMode: embeddedFont === undefined ? "device" : "embedded",
                    font: authoredHtml?.font ?? string(font.family, `library.assets.${fontId}.font.family`),
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
        const initialText = text(asset.initialText, `library.assets.${characterId}.initialText`);
        const issues = array(staticText.issues, `library.assets.${characterId}.staticText.issues`);
        const runs = array(staticText.runs, `library.assets.${characterId}.staticText.runs`);
        if (admitMissingStaticTextPlaceholder(asset, staticText, initialText, issues, runs, characterId)) {
            const placement = placementTransform(operation);
            return {
                linkage: flashLibraryAssetName(asset, characterId), instanceId,
                kind: "container", depth: positiveInteger(operation.depth, "place.depth"),
                x: placement.x, y: placement.y, matrix: placement.matrix,
                width: 0, height: 0, children: [],
            };
        }
        exactValue(staticText.exactGlyphs, true, "FLASH_LIBRARY_STATIC_TEXT_GLYPHS_REQUIRED",
            `Text ${characterId} lacks exact glyph evidence.`);
        if (issues.length !== 0)
            fail("FLASH_LIBRARY_STATIC_TEXT_ISSUES", `Text ${characterId} contains unresolved extraction issues.`);
        const staticMatrix = object(staticText.matrix, `library.assets.${characterId}.staticText.matrix`);
        exactKeys(staticMatrix, MATRIX_FIELDS, `library.assets.${characterId}.staticText.matrix`, "FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED");
        // DefineText bounds already contain the text-matrix transform. Project
        // the authenticated local rectangle back through that matrix before
        // composing it with the placement transform. The deliberately narrow
        // admitted set covers Flash identity and exact quarter-turn labels;
        // scaling, skew, singular, and approximate rotations remain closed.
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const projection = staticTextProjection(staticMatrix, bounds, placementTransform(operation), characterId);
        if (runs.length > 1)
            return this.createPositionedStaticTextRuns(
                asset, operation, instanceId, assets, projection, runs, initialText,
            );
        if (this.textMapOnly)
            return this.createTextMapNode(asset, operation, instanceId, characterId, false);
        if (runs.length !== 1)
            fail("FLASH_LIBRARY_STATIC_TEXT_RUNS_UNSUPPORTED", `Text ${characterId} must contain at least one authenticated run.`);
        const run = object(runs[0], `library.assets.${characterId}.staticText.runs[0]`);
        exactKeys(run, new Set(["color", "fontId", "fontSize", "glyphs", "text", "width", "x", "y"]),
            `library.assets.${characterId}.staticText.runs[0]`, "FLASH_LIBRARY_STATIC_TEXT_RUN_UNSUPPORTED");
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
        const fontSize = positive(run.fontSize, `library.assets.${characterId}.staticText.runs[0].fontSize`);
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
            kind: "dynamic-text",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: projection.x,
            y: projection.y,
            matrix: projection.matrix,
            width: projection.width,
            height: Math.max(projection.height, fontSize + 4),
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
                filters: this.textMapOnly ? [] : authoredFilters(operation.filters, characterId),
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

    /**
     * DefineText may encode vertical or otherwise positioned labels as a run
     * per glyph. A single browser text layout cannot retain those authored
     * positions, so project each authenticated glyph as a device TextField
     * child under one placement container. This intentionally remains a
     * source-shaped static projection: named/static-text runtime semantics and
     * unresolved glyph mappings still fail closed.
     */
    private createPositionedStaticTextRuns(
        asset: Record<string, any>,
        operation: Record<string, any>,
        instanceId: string,
        assets: Record<string, any>,
        projection: StaticTextProjection,
        runs: ReadonlyArray<unknown>,
        initialText: string,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "text.characterId");
        if (operation.name !== undefined)
            fail("FLASH_LIBRARY_NAMED_POSITIONED_STATIC_TEXT_UNSUPPORTED",
                `Text ${characterId} has positioned runs and cannot preserve named StaticText identity.`);
        const linkage = flashLibraryAssetName(asset, characterId);
        const children: NeutralAuthoredNode[] = [];
        let authenticatedText = "";

        runs.forEach((candidate, runIndex) => {
            const runPath = `library.assets.${characterId}.staticText.runs[${runIndex}]`;
            const run = object(candidate, runPath);
            exactKeys(run, new Set(["color", "fontId", "fontSize", "glyphs", "text", "width", "x", "y"]),
                runPath, "FLASH_LIBRARY_STATIC_TEXT_RUN_UNSUPPORTED");
            const runText = string(run.text, `${runPath}.text`);
            const runX = finite(run.x, `${runPath}.x`);
            const runY = finite(run.y, `${runPath}.y`);
            // DefineText glyph advances are signed. Positioned-run evidence can
            // therefore have a negative aggregate width when the authored pen
            // moves backwards (for example, exact quarter-turn labels). The
            // per-glyph x positions below remain the runtime layout authority;
            // validate this redundant aggregate as finite without rewriting its
            // sign. Bounds and every other geometric extent remain subject to
            // their existing nonnegative validators.
            finite(run.width, `${runPath}.width`);
            const fontSize = positive(run.fontSize, `${runPath}.fontSize`);
            const fontId = positiveInteger(run.fontId, `${runPath}.fontId`);
            const fontAsset = object(assets[String(fontId)], `library.assets.${fontId}`);
            if (fontAsset.kind !== "font")
                fail("FLASH_LIBRARY_TEXT_FONT_REQUIRED", `Text ${characterId} does not reference a font asset.`);
            const font = object(fontAsset.font, `library.assets.${fontId}.font`);
            const family = string(font.family, `library.assets.${fontId}.font.family`);
            const bold = boolean(font.bold, `library.assets.${fontId}.font.bold`);
            const italic = boolean(font.italic, `library.assets.${fontId}.font.italic`);
            const color = object(run.color, `${runPath}.color`);
            exactKeys(color, new Set(["alpha", "color"]), `${runPath}.color`,
                "FLASH_LIBRARY_TEXT_COLOR_UNSUPPORTED");
            exactValue(color.alpha, 1, "FLASH_LIBRARY_TEXT_COLOR_ALPHA_UNSUPPORTED",
                `Text ${characterId} run ${runIndex} color alpha is unsupported.`);
            const colorValue = finite(color.color, `${runPath}.color.color`);
            const glyphs = array(run.glyphs, `${runPath}.glyphs`);
            if (glyphs.length === 0)
                fail("FLASH_LIBRARY_STATIC_TEXT_GLYPHS_REQUIRED", `Text ${characterId} run ${runIndex} has no glyphs.`);
            let glyphText = "";
            glyphs.forEach((candidateGlyph, glyphIndex) => {
                const glyphPath = `${runPath}.glyphs[${glyphIndex}]`;
                const glyph = object(candidateGlyph, glyphPath);
                exactKeys(glyph, new Set(["advance", "character", "glyphIndex", "x"]), glyphPath,
                    "FLASH_LIBRARY_STATIC_TEXT_GLYPH_UNSUPPORTED");
                const character = string(glyph.character, `${glyphPath}.character`);
                if (Array.from(character).length !== 1)
                    fail("FLASH_LIBRARY_STATIC_TEXT_GLYPH_CHARACTER_UNSUPPORTED",
                        `${glyphPath}.character must be one Unicode scalar.`);
                nonnegativeInteger(glyph.glyphIndex, `${glyphPath}.glyphIndex`);
                const glyphX = finite(glyph.x, `${glyphPath}.x`);
                const advance = finite(glyph.advance, `${glyphPath}.advance`);
                glyphText += character;
                const childInstanceId = `${instanceId}$static-run-${runIndex + 1}-glyph-${glyphIndex + 1}`;
                children.push({
                    linkage: `${linkage}$static-glyph`,
                    instanceId: childInstanceId,
                    name: childInstanceId,
                    kind: "dynamic-text",
                    depth: children.length + 1,
                    x: glyphX - projection.localX,
                    y: runY - fontSize - projection.localY,
                    width: Math.max(fontSize + 4, Math.abs(advance) + 4),
                    height: fontSize + 4,
                    variable: false,
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
                        filters: [],
                        gutter: 2,
                        overflow: "hidden",
                        initialText: character,
                        format: {
                            fontMode: "device",
                            font: family,
                            size: fontSize,
                            color: colorValue,
                            bold,
                            italic,
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
                });
            });
            if (glyphText !== runText)
                fail("FLASH_LIBRARY_STATIC_TEXT_GLYPH_TEXT_MISMATCH",
                    `Text ${characterId} run ${runIndex} glyph characters disagree with its string.`);
            authenticatedText += runText;
            // The first glyph position is separately authenticated above; the
            // redundant run x channel must agree with it rather than becoming
            // an unauthenticated alternate layout authority.
            const firstGlyph = object(glyphs[0], `${runPath}.glyphs[0]`);
            if (finite(firstGlyph.x, `${runPath}.glyphs[0].x`) !== runX)
                fail("FLASH_LIBRARY_STATIC_TEXT_RUN_POSITION_MISMATCH",
                    `Text ${characterId} run ${runIndex} x authorities disagree.`);
        });
        if (authenticatedText !== initialText)
            fail("FLASH_LIBRARY_TEXT_INITIAL_VALUE_MISMATCH", `Text ${characterId} initial-text authorities disagree.`);

        return {
            linkage,
            instanceId,
            kind: "container",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: projection.x,
            y: projection.y,
            matrix: projection.matrix,
            width: projection.width,
            height: projection.height,
            variable: false,
            ...(operation.filters === undefined ? {} : { filters: authoredFilters(operation.filters, characterId) }),
            children,
        };
    }

    private createTextMapNode(
        asset: Record<string, any>,
        operation: Record<string, any>,
        instanceId: string,
        characterId: number,
        dynamic: boolean,
    ): NeutralAuthoredNode {
        const source = dynamic
            ? object(asset.textField, `library.assets.${characterId}.textField`)
            : asset;
        const initialText = text(source.initialText, `library.assets.${characterId}.initialText`);
        const html = dynamic && source.html === true;
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = placementTransform(operation);
        const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
        const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
        return {
            linkage: flashLibraryAssetName(asset, characterId),
            instanceId,
            ...(operation.name === undefined ? {} : { name: operation.name }),
            kind: "dynamic-text",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x + placement.a * boundsX + placement.c * boundsY,
            y: placement.y + placement.b * boundsX + placement.d * boundsY,
            matrix: placement.matrix,
            width: Math.max(0, finite(bounds.width, `library.assets.${characterId}.bounds.width`)),
            height: Math.max(0, finite(bounds.height, `library.assets.${characterId}.bounds.height`)),
            variable: typeof operation.name === "string",
            textField: {
                sourceId: characterId,
                type: dynamic && source.fieldType === "input" ? "input" : "dynamic",
                multiline: false,
                wordWrap: false,
                selectable: false,
                displayAsPassword: false,
                autoSize: "none",
                html,
                useOutlines: false,
                filters: [],
                gutter: 2,
                overflow: "hidden",
                initialText,
                format: {
                    fontMode: "device",
                    font: "Arial",
                    size: 12,
                    color: 0,
                    bold: false,
                    italic: false,
                    underline: false,
                    align: "left",
                    leftMargin: 0,
                    rightMargin: 0,
                    indent: 0,
                    leading: 0,
                    letterSpacing: 0,
                    kerning: false,
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
    allowDeviceFaceOverride = false,
): ReturnType<typeof parseRestrictedFlashHtmlText> {
    let layout: ReturnType<typeof parseRestrictedFlashHtmlText>;
    try {
        layout = parseRestrictedFlashHtmlText(value, {
            align: oneOf(textField.align, ["left", "center", "right", "justify"], `Text ${characterId} align`),
            font: string(font.family, `Text ${characterId} font family`),
            size: finite(textField.fontSize, `Text ${characterId} font size`),
            color: finite(color.color, `Text ${characterId} color`),
            letterSpacing: 0,
            kerning: false,
            bold: boolean(font.bold, `Text ${characterId} font bold`),
        });
    }
    catch (error) {
        fail("FLASH_LIBRARY_TEXT_HTML_UNSUPPORTED", `Text ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!allowDeviceFaceOverride && layout.font !== string(font.family, `Text ${characterId} font family`)
        || layout.size !== finite(textField.fontSize, `Text ${characterId} font size`)
        || layout.color !== finite(color.color, `Text ${characterId} color`)
        || layout.align !== string(textField.align, `Text ${characterId} align`)) {
        fail("FLASH_LIBRARY_TEXT_HTML_AUTHORITY_MISMATCH", `Text ${characterId} HTML formatting disagrees with its field metadata.`);
    }
    return layout;
}

function admitEmbeddedFontAsDevice(
    fontAsset: Record<string, any>,
    font: Record<string, any>,
    fontId: number,
    resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
): void {
    exactValue(fontAsset.sourceTag, "DefineFont3Tag", "FLASH_LIBRARY_FONT_FORMAT_UNSUPPORTED", `Font ${fontId} is not an embedded DefineFont3 resource.`);
    exactValue(font.embedded, true, "FLASH_LIBRARY_FONT_NOT_EMBEDDED", `Font ${fontId} is not embedded.`);
    exactValue(font.hasLayout, false, "FLASH_LIBRARY_FONT_LAYOUT_AUTHORITY_MISMATCH", `Font ${fontId} unexpectedly retains layout metrics.`);
    exactValue(font.ascent, 0, "FLASH_LIBRARY_FONT_LAYOUT_AUTHORITY_MISMATCH", `Font ${fontId} has an ascent without layout authority.`);
    exactValue(font.descent, 0, "FLASH_LIBRARY_FONT_LAYOUT_AUTHORITY_MISMATCH", `Font ${fontId} has a descent without layout authority.`);
    exactValue(font.leading, 0, "FLASH_LIBRARY_FONT_LAYOUT_AUTHORITY_MISMATCH", `Font ${fontId} has leading without layout authority.`);
    positive(font.unitsPerEm, `library.assets.${fontId}.font.unitsPerEm`);
    boolean(font.bold, `library.assets.${fontId}.font.bold`);
    boolean(font.italic, `library.assets.${fontId}.font.italic`);
    string(font.family, `library.assets.${fontId}.font.family`);

    const sourcePath = string(fontAsset.path, `library.assets.${fontId}.path`);
    if (!sourcePath.toLocaleLowerCase("en-US").endsWith(".ttf"))
        fail("FLASH_LIBRARY_FONT_RESOURCE_FORMAT_UNSUPPORTED", `Font ${fontId} must identify a .ttf resource.`);
    const authority = resourceAuthorities.get(sourcePath);
    if (!authority || authority.sourcePath !== sourcePath || authority.mediaType !== "font/ttf")
        fail("FLASH_LIBRARY_FONT_RESOURCE_AUTHORITY_MISSING", `No authenticated TrueType authority exists for '${sourcePath}'.`);

    const glyphCount = positiveInteger(font.glyphCount, `library.assets.${fontId}.font.glyphCount`);
    const glyphs = array(font.glyphs, `library.assets.${fontId}.font.glyphs`);
    if (glyphs.length !== glyphCount)
        fail("FLASH_LIBRARY_FONT_GLYPH_COUNT_MISMATCH", `Font ${fontId} glyph count does not match its retained outline inventory.`);
    let previousCodePoint = -1;
    glyphs.forEach((candidate, index) => {
        const glyph = object(candidate, `library.assets.${fontId}.font.glyphs[${index}]`);
        exactKeys(glyph, FONT_GLYPH_WITHOUT_LAYOUT_FIELDS, `library.assets.${fontId}.font.glyphs[${index}]`, "FLASH_LIBRARY_FONT_LAYOUT_AUTHORITY_MISMATCH");
        exactValue(glyph.index, index, "FLASH_LIBRARY_FONT_GLYPH_INDEX_MISMATCH", `Font ${fontId} glyph indices must be contiguous source order.`);
        const codePoint = unicodeScalar(glyph.codePoint, `font ${fontId} glyph ${index}.codePoint`);
        if (codePoint <= previousCodePoint)
            fail("FLASH_LIBRARY_FONT_GLYPH_ORDER_UNSUPPORTED", `Font ${fontId} glyph code points must be strictly ordered.`);
        previousCodePoint = codePoint;
    });
    exactValue(array(font.kerning, `library.assets.${fontId}.font.kerning`).length, 0,
        "FLASH_LIBRARY_FONT_LAYOUT_AUTHORITY_MISMATCH", `Font ${fontId} has kerning without layout authority.`);
    authoredFontAlignZones(fontAsset.fontAlignZones, fontId, glyphCount);
}

function admitZeroGlyphOutlineFontAsDevice(
    fontAsset: Record<string, any>,
    font: Record<string, any>,
    fontId: number,
): void {
    // Some authored SWFs retain a DefineFont3 selector for an installed device
    // face while embedding no glyphs at all. Flash still records useOutlines on
    // the TextField in that case, but there are no outlines to consume. Admit
    // only that exact zero-glyph signature and keep every partial/mixed font
    // representation fail-closed.
    exactValue(fontAsset.sourceTag, "DefineFont3Tag", "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED",
        `Font ${fontId} is not a zero-glyph DefineFont3 device-face selector.`);
    exactValue(font.embedded, false, "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED",
        `Font ${fontId} unexpectedly claims embedded outlines.`);
    exactValue(font.hasLayout, false, "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED",
        `Font ${fontId} unexpectedly retains outline layout metrics.`);
    exactValue(font.glyphCount, 0, "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED",
        `Font ${fontId} retains glyph outlines and cannot use device-font fallback.`);
    exactValue(array(font.glyphs, `library.assets.${fontId}.font.glyphs`).length, 0,
        "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED", `Font ${fontId} retains undeclared glyph outlines.`);
    exactValue(array(font.kerning, `library.assets.${fontId}.font.kerning`).length, 0,
        "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED", `Font ${fontId} retains kerning without layout authority.`);
    exactValue(font.ascent, 0, "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED",
        `Font ${fontId} retains ascent without layout authority.`);
    exactValue(font.descent, 0, "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED",
        `Font ${fontId} retains descent without layout authority.`);
    exactValue(font.leading, 0, "FLASH_LIBRARY_TEXT_OUTLINES_FONT_REQUIRED",
        `Font ${fontId} retains leading without layout authority.`);
    positive(font.unitsPerEm, `library.assets.${fontId}.font.unitsPerEm`);
    boolean(font.bold, `library.assets.${fontId}.font.bold`);
    boolean(font.italic, `library.assets.${fontId}.font.italic`);
    string(font.family, `library.assets.${fontId}.font.family`);
    authoredFontAlignZones(fontAsset.fontAlignZones, fontId, 0);
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
    const sourceKerning = array(font.kerning, `library.assets.${fontId}.font.kerning`).map((candidate, index) => {
        const pair = object(candidate, `font ${fontId} kerning ${index}`);
        exactKeys(pair, FONT_KERNING_FIELDS, `font ${fontId} kerning ${index}`, "FLASH_LIBRARY_FONT_KERNING_FIELD_UNSUPPORTED");
        const leftCodePoint = unicodeScalar(pair.leftCodePoint, `font ${fontId} kerning ${index}.leftCodePoint`);
        const rightCodePoint = unicodeScalar(pair.rightCodePoint, `font ${fontId} kerning ${index}.rightCodePoint`);
        return { leftCodePoint, rightCodePoint, adjustment: finite(pair.adjustment, `font ${fontId} kerning ${index}.adjustment`) };
    }).sort((left, right) => left.leftCodePoint - right.leftCodePoint || left.rightCodePoint - right.rightCodePoint);
    const glyphCodePoints = new Set(glyphs.map(glyph => glyph.codePoint));
    const kerning: typeof sourceKerning = [];
    for (let start = 0; start < sourceKerning.length;) {
        let end = start + 1;
        while (end < sourceKerning.length
            && sourceKerning[end].leftCodePoint === sourceKerning[start].leftCodePoint
            && sourceKerning[end].rightCodePoint === sourceKerning[start].rightCodePoint)
            end++;
        if (end - start > 1) {
            const pair = sourceKerning[start];
            if (glyphCodePoints.has(pair.leftCodePoint) && glyphCodePoints.has(pair.rightCodePoint))
                fail("FLASH_LIBRARY_FONT_KERNING_DUPLICATE", `Font ${fontId} kerning pairs must be unique.`);
            // DefineFont kerning can retain pairs for characters omitted from a
            // subset font. Such a pair can never participate in this embedded
            // font's glyph layout. If it is duplicated, discard the entire
            // unobservable group instead of inventing first/last precedence.
        }
        else kerning.push(sourceKerning[start]);
        start = end;
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

function authoredFontAlignZones(value: unknown, fontId: number, glyphCount: number): NeutralFontAlignZones {
    const source = object(value, `library.assets.${fontId}.fontAlignZones`);
    exactKeys(source, FONT_ALIGN_ZONES_FIELDS, `library.assets.${fontId}.fontAlignZones`, "FLASH_LIBRARY_FONT_ALIGN_ZONE_FIELD_UNSUPPORTED");
    exactValue(source.fontId, fontId, "FLASH_LIBRARY_FONT_ALIGN_ZONE_ID_MISMATCH", `Font ${fontId} align zones identify another font.`);
    exactValue(source.sourceTag, "DefineFontAlignZonesTag", "FLASH_LIBRARY_FONT_ALIGN_ZONE_FORMAT_UNSUPPORTED", `Font ${fontId} align zones lack DefineFontAlignZones authority.`);
    const table = authoredFontAlignZoneTableHint(source.tableHint, source.tableHintName, fontId);
    const zones = array(source.zones, `library.assets.${fontId}.fontAlignZones.zones`);
    if (zones.length !== glyphCount)
        fail("FLASH_LIBRARY_FONT_ALIGN_ZONE_COUNT_MISMATCH", `Font ${fontId} align-zone count does not match its glyph count.`);
    return {
        ...table,
        zones: zones.map((candidate, zoneIndex) => {
            const zone = object(candidate, `font ${fontId} align zone ${zoneIndex}`);
            exactKeys(zone, FONT_ALIGN_ZONE_FIELDS, `font ${fontId} align zone ${zoneIndex}`, "FLASH_LIBRARY_FONT_ALIGN_ZONE_FIELD_UNSUPPORTED");
            const data = array(zone.data, `font ${fontId} align zone ${zoneIndex}.data`);
            if (data.length !== 2)
                fail("FLASH_LIBRARY_FONT_ALIGN_ZONE_DATA_COUNT", `Font ${fontId} align zone ${zoneIndex} must retain X and Y records.`);
            return {
                data: [
                    authoredFontAlignZoneData(data[0], fontId, zoneIndex, 0),
                    authoredFontAlignZoneData(data[1], fontId, zoneIndex, 1),
                ],
                maskX: boolean(zone.maskX, `font ${fontId} align zone ${zoneIndex}.maskX`),
                maskY: boolean(zone.maskY, `font ${fontId} align zone ${zoneIndex}.maskY`),
            };
        }),
    };
}

function authoredFontAlignZoneData(value: unknown, fontId: number, zoneIndex: number, dataIndex: number): NeutralFontAlignZoneData {
    const datum = object(value, `font ${fontId} align zone ${zoneIndex}.data[${dataIndex}]`);
    exactKeys(datum, FONT_ALIGN_ZONE_DATA_FIELDS, `font ${fontId} align zone ${zoneIndex}.data[${dataIndex}]`, "FLASH_LIBRARY_FONT_ALIGN_ZONE_DATA_FIELD_UNSUPPORTED");
    return {
        alignmentCoordinate: nonnegativeFinite(datum.alignmentCoordinate, `font ${fontId} align zone ${zoneIndex}.alignmentCoordinate`),
        alignmentCoordinateBits: uint16(datum.alignmentCoordinateBits, `font ${fontId} align zone ${zoneIndex}.alignmentCoordinateBits`),
        range: nonnegativeFinite(datum.range, `font ${fontId} align zone ${zoneIndex}.range`),
        rangeBits: uint16(datum.rangeBits, `font ${fontId} align zone ${zoneIndex}.rangeBits`),
    };
}

function authoredFontAlignZoneTableHint(
    value: unknown,
    name: unknown,
    fontId: number,
): Pick<NeutralFontAlignZones, "tableHint" | "tableHintName"> {
    if (value === 0 && name === "thin") return { tableHint: 0, tableHintName: "thin" };
    if (value === 1 && name === "medium") return { tableHint: 1, tableHintName: "medium" };
    if (value === 2 && name === "thick") return { tableHint: 2, tableHintName: "thick" };
    fail("FLASH_LIBRARY_FONT_ALIGN_ZONE_TABLE_UNSUPPORTED",
        `Font ${fontId} align zones use an unsupported or mismatched table hint.`);
}

function authoredAdvancedTextRasterization(asset: Record<string, any>, characterId: number) {
    const rendering = object(asset.textRendering, `library.assets.${characterId}.textRendering`);
    exactKeys(rendering, TEXT_RENDERING_FIELDS, `library.assets.${characterId}.textRendering`, "FLASH_LIBRARY_TEXT_RENDERING_FIELD_UNSUPPORTED");
    exactValue(rendering.sourceTag, "CSMSettingsTag", "FLASH_LIBRARY_TEXT_RENDERER_UNSUPPORTED", `Text ${characterId} does not retain CSM settings.`);
    exactValue(rendering.textId, characterId, "FLASH_LIBRARY_TEXT_RENDERING_ID_MISMATCH", `Text ${characterId} rendering authority identifies another field.`);
    exactValue(rendering.renderer, "advanced", "FLASH_LIBRARY_TEXT_RENDERER_UNSUPPORTED", `Text ${characterId} renderer is unsupported.`);
    exactValue(rendering.useFlashType, 1, "FLASH_LIBRARY_TEXT_RENDERER_UNSUPPORTED", `Text ${characterId} does not use FlashType.`);
    const gridFit = finite(rendering.gridFit, `library.assets.${characterId}.textRendering.gridFit`);
    let gridFitType: "none" | "pixel" | "subpixel";
    if (gridFit === 0) gridFitType = "none";
    else if (gridFit === 1) gridFitType = "pixel";
    else if (gridFit === 2) gridFitType = "subpixel";
    else fail("FLASH_LIBRARY_TEXT_GRID_FIT_UNSUPPORTED", `Text ${characterId} grid-fit code is unsupported.`);
    exactValue(rendering.gridFitMode, gridFitType, "FLASH_LIBRARY_TEXT_GRID_FIT_UNSUPPORTED", `Text ${characterId} grid-fit mode is unsupported.`);
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
    const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
    const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
    const boundsWidth = finite(bounds.width, `library.assets.${characterId}.bounds.width`);
    const boundsHeight = finite(bounds.height, `library.assets.${characterId}.bounds.height`);
    if ((child.x ?? 0) !== boundsX || (child.y ?? 0) !== boundsY
        || !isCoveredEdgeRasterExtent(child.width, boundsWidth)
        || !isCoveredEdgeRasterExtent(child.height, boundsHeight))
        fail("FLASH_LIBRARY_SCALING_GRID_RASTER_BOUNDS_MISMATCH", `Scaling grid ${characterId} image child does not cover the authored bounds.`);
    const rect = object(source.rect, `library.assets.${characterId}.scalingGrid.rect`);
    exactKeys(rect, SCALING_GRID_RECT_FIELDS, `library.assets.${characterId}.scalingGrid.rect`, "FLASH_LIBRARY_SCALING_GRID_RECT_FIELD_UNSUPPORTED");
    const x = finite(rect.x, `library.assets.${characterId}.scalingGrid.rect.x`);
    const y = finite(rect.y, `library.assets.${characterId}.scalingGrid.rect.y`);
    const width = finite(rect.width, `library.assets.${characterId}.scalingGrid.rect.width`);
    const height = finite(rect.height, `library.assets.${characterId}.scalingGrid.rect.height`);
    if (x < boundsX || y < boundsY || width <= 0 || height <= 0
        || x + width > boundsX + boundsWidth || y + height > boundsY + boundsHeight)
        fail("FLASH_LIBRARY_SCALING_GRID_RECT_INVALID", `Scaling grid ${characterId} lies outside the authored bounds.`);
    const values = array(source.sizeGrid, `library.assets.${characterId}.scalingGrid.sizeGrid`);
    if (values.length !== 5)
        fail("FLASH_LIBRARY_SCALING_GRID_SIZE_INVALID", `Scaling grid ${characterId} sizeGrid must contain five values.`);
    const sizeGrid = values.map((item, index) => finite(item, `library.assets.${characterId}.scalingGrid.sizeGrid[${index}]`));
    const localX = x - boundsX;
    const localY = y - boundsY;
    const expected = [localY, boundsX + boundsWidth - x - width, boundsY + boundsHeight - y - height, localX, 0];
    if (sizeGrid.some((item, index) => item !== expected[index]))
        fail("FLASH_LIBRARY_SCALING_GRID_INSETS_MISMATCH", `Scaling grid ${characterId} insets disagree with its rectangle.`);
    return {
        x: localX,
        y: localY,
        width,
        height,
        sizeGrid: sizeGrid as [number, number, number, number, 0],
        target: child.name ?? child.instanceId ?? child.linkage,
    };
}

function isCoveredEdgeRasterExtent(rasterExtent: number | undefined, authoredExtent: number): boolean {
    if (rasterExtent === undefined || !Number.isFinite(rasterExtent)) return false;
    // JPEXS may retain the covered terminal edge of an integer Flash bound as
    // one additional pixel. Non-integral extents round up to that same covered
    // pixel. Both representations cover the authored logical extent without
    // admitting unrelated padding into a scale-9 texture.
    return rasterExtent === Math.ceil(authoredExtent)
        || (Number.isInteger(authoredExtent) && rasterExtent === authoredExtent + 1);
}

function spriteBounds(
    asset: Record<string, any>,
    characterId: number,
    boundslessNonvisualSprite: boolean,
): Record<string, any> {
    if (asset.bounds !== undefined)
        return object(asset.bounds, `library.assets.${characterId}.bounds`);
    if (!boundslessNonvisualSprite)
        fail("FLASH_LIBRARY_SPRITE_BOUNDS_MISSING", `Sprite ${characterId} requires bounds unless it is an authenticated nonvisual placeholder or named anchor tree.`);
    return { x: 0, y: 0, width: 0, height: 0 };
}

function isBoundslessEmptyPlaceholder(
    operation: Record<string, any> | undefined,
    sourceTimeline: Record<string, any>,
): boolean {
    // Flash libraries can retain an unnamed placed DefineSprite whose sole
    // frame is exactly empty. It has no visual extent to infer, but remains a
    // real display-list placeholder and must survive as a zero-size container.
    // Root symbols and animated/labeled placeholders remain fail-closed.
    if (operation === undefined)
        return false;
    const frames = validatedTimelineFrames(sourceTimeline);
    if (frames.length !== 1)
        return false;
    const current = object(frames[0], `timeline ${sourceTimeline.symbolId} frame 1`);
    return current.label === undefined
        && indexedDisplayOperations(current, positiveInteger(sourceTimeline.symbolId, "placeholder symbolId")).length === 0;
}

function isBoundslessNamedAnchorTree(
    operation: Record<string, any> | undefined,
    sourceTimeline: Record<string, any>,
    assets: Record<string, any>,
    timelines: ReadonlyMap<number, unknown>,
    visited: ReadonlySet<number>,
): boolean {
    if (operation === undefined || typeof operation.name !== "string")
        return false;
    const frames = validatedTimelineFrames(sourceTimeline);
    let containsNestedAnchor = false;
    const valid = frames.every((value, index) => {
        const current = object(value, `timeline ${sourceTimeline.symbolId} frame ${index + 1}`);
        if (current.label !== undefined) return false;
        return indexedDisplayOperations(current, positiveInteger(sourceTimeline.symbolId, "anchor symbolId"))
            .every(({ operation: placed }) => {
                containsNestedAnchor = true;
                if (typeof placed.name !== "string") return false;
                const childId = positiveInteger(placed.characterId, "anchor child characterId");
                if (visited.has(childId)) return false;
                const child = object(assets[String(childId)], `library.assets.${childId}`);
                if (child.kind !== "sprite" || child.bounds !== undefined) return false;
                return isBoundslessNamedAnchorTree(
                    placed,
                    timeline(timelines, childId),
                    assets,
                    timelines,
                    new Set([...visited, childId]),
                );
            });
    });
    return valid && (!containsNestedAnchor || frames.length === 1);
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

function registerBitmapResource(
    resources: Map<string, NeutralResourceInput>,
    fallbackBitmapId: number,
    authority: FlashLibraryResourceAuthority,
    smoothing: boolean,
): string {
    const suffix = smoothing ? "-smooth" : "";
    const normalized = authority.sourcePath.replace(/\\/g, "/");
    const match = /(?:^|\/)([1-9][0-9]*)\.(?:jpe?g|png)$/i.exec(normalized);
    const bitmapId = match === null ? fallbackBitmapId : Number(match[1]);
    const resourceId = `flash-bitmap-${bitmapId}${suffix}`;
    registerResource(resources, resourceId, authority);
    return resourceId;
}

/** Resolves the sole bitmap authority for a one-piece rectangular projection. */
export function resolveFlashLibraryShapeResourcePath(
    assetValue: unknown,
    assetsValue: unknown,
    resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
): string {
    const projections = resolveFlashLibraryShapeProjections(assetValue, assetsValue, resourceAuthorities);
    if (projections.length !== 1)
        fail("FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED", "The shape is an authenticated bitmap mosaic, not a sole bitmap projection.");
    return projections[0].sourcePath;
}

/**
 * Resolves an exact signed axis-aligned Flash bitmap projection. FFDec may introduce
 * new local fill tables within one shape; after conversion those tables have
 * global indices. Every real bitmap fill must own one rectangular tile, and
 * the tile union must have the exact authored outer bounds. Transparent gaps
 * and authored overlap remain meaningful Flash geometry. This
 * retains the original bitmap authorities without flattening the shape to a
 * diagnostic preview raster.
 */
function resolveFlashLibraryShapeProjections(
    assetValue: unknown,
    assetsValue: unknown,
    resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
): ReadonlyArray<FlashLibraryShapeProjection> {
    const asset = object(assetValue, "shape asset");
    const assets = object(assetsValue, "library.assets");
    const characterId = positiveInteger(asset.characterId, "shape.characterId");
    if (asset.path !== undefined) {
        const sourcePath = string(asset.path, `library.assets.${characterId}.path`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        return [{
            bitmapId: characterId,
            sourcePath,
            styleIndex: 1,
            smoothing: true,
            x: finite(bounds.x, `library.assets.${characterId}.bounds.x`),
            y: finite(bounds.y, `library.assets.${characterId}.bounds.y`),
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            flipX: false,
            flipY: false,
        }];
    }

    const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
    const shape = object(asset.shape, `library.assets.${characterId}.shape`);
    const fillStyles = array(shape.fillStyles, `library.assets.${characterId}.shape.fillStyles`)
        .map((value, index) => ({ value: object(value, `shape ${characterId} fill ${index}`), styleIndex: index + 1 }))
        .filter(value => !(value.value.kind === "bitmap" && value.value.bitmapId === 65535));
    if (fillStyles.length === 0)
        fail("FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED", `Shape ${characterId} must contain at least one non-sentinel bitmap fill.`);
    if (array(shape.lineStyles, `shape ${characterId}.lineStyles`).length !== 0 || shape.usesFillWindingRule !== false)
        fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} is not an axis-aligned bitmap projection.`);
    const segments = array(shape.segments, `shape ${characterId}.segments`);
    const realStyleIndices = new Set(fillStyles.map(value => value.styleIndex));
    for (const value of segments) {
        const segment = object(value, `shape ${characterId} segment`);
        const fillStyle0 = nonnegativeInteger(segment.fillStyle0, `shape ${characterId} segment.fillStyle0`);
        const fillStyle1 = nonnegativeInteger(segment.fillStyle1, `shape ${characterId} segment.fillStyle1`);
        if (segment.kind !== "line" || segment.lineStyle !== 0 || fillStyle0 === fillStyle1
            || (fillStyle0 !== 0 && !realStyleIndices.has(fillStyle0))
            || (fillStyle1 !== 0 && !realStyleIndices.has(fillStyle1))
            || (fillStyle0 === 0 && fillStyle1 === 0))
            fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} contains geometry outside its authenticated bitmap fills.`);
    }

    const tiles = new Map(fillStyles.map(({ styleIndex }) => [
        styleIndex,
        rectangleForFill(segments, styleIndex, characterId),
    ]));
    const repeatedMosaic = resolveRepeatedBitmapMosaicProjection(
        fillStyles,
        tiles,
        bounds,
        characterId,
        assets,
        resourceAuthorities,
    );
    if (repeatedMosaic !== undefined) return [repeatedMosaic];

    const projections = fillStyles.map(({ value: fill, styleIndex }): FlashLibraryShapeProjection => {
        if (fill.kind !== "bitmap" || fill.repeat !== false || typeof fill.smooth !== "boolean")
            fail("FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED", `Shape ${characterId} bitmap fill mode is unsupported.`);
        const tile = tiles.get(styleIndex)!;
        const matrix = object(fill.startMatrix, `shape ${characterId} bitmap matrix`);
        exactKeys(matrix, MATRIX_FIELDS, `shape ${characterId} bitmap matrix`, "FLASH_LIBRARY_BITMAP_FILL_MATRIX_FIELD_UNSUPPORTED");
        const scaleX = finite(matrix.a, `shape ${characterId} bitmap matrix.a`);
        const scaleY = finite(matrix.d, `shape ${characterId} bitmap matrix.d`);
        if (scaleX === 0 || scaleY === 0 || matrix.b !== 0 || matrix.c !== 0)
            fail("FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED", `Shape ${characterId} bitmap matrix is not a signed axis-aligned tile projection.`);

        const bitmapId = positiveInteger(fill.bitmapId, `shape ${characterId}.bitmapId`);
        const bitmapAsset = object(assets[String(bitmapId)], `library.assets.${bitmapId}`);
        if (bitmapAsset.kind !== "image" || bitmapAsset.characterId !== bitmapId)
            fail("FLASH_LIBRARY_BITMAP_FILL_IMAGE_REQUIRED", `Shape ${characterId} bitmap ${bitmapId} does not identify an image asset.`);
        const isLegacyUnitProjection = scaleX === 20 && scaleY === 20
            && matrix.tx === tile.x && matrix.ty === tile.y;
        if (!isLegacyUnitProjection) {
            if (bitmapAsset.bitmap === undefined)
                fail("FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED", `Shape ${characterId} bitmap projection lacks authenticated dimensions.`);
            const bitmap = object(bitmapAsset.bitmap, `library.assets.${bitmapId}.bitmap`);
            const bitmapWidth = positive(bitmap.width, `library.assets.${bitmapId}.bitmap.width`);
            const bitmapHeight = positive(bitmap.height, `library.assets.${bitmapId}.bitmap.height`);
            const projectedX0 = finite(matrix.tx, `shape ${characterId} bitmap matrix.tx`);
            const projectedY0 = finite(matrix.ty, `shape ${characterId} bitmap matrix.ty`);
            const projectedX1 = projectedX0 + bitmapWidth * scaleX / 20;
            const projectedY1 = projectedY0 + bitmapHeight * scaleY / 20;
            if (Math.abs(Math.min(projectedX0, projectedX1) - tile.x) > 0.05
                || Math.abs(Math.max(projectedX0, projectedX1) - (tile.x + tile.width)) > 0.05
                || Math.abs(Math.min(projectedY0, projectedY1) - tile.y) > 0.05
                || Math.abs(Math.max(projectedY0, projectedY1) - (tile.y + tile.height)) > 0.05)
                fail("FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED", `Shape ${characterId} bitmap matrix does not project the full authenticated bitmap into its tile.`);
        }
        const sourcePath = string(bitmapAsset.path, `library.assets.${bitmapId}.path`);
        const authority = resourceAuthorities.get(sourcePath);
        const lower = sourcePath.replace(/\\/g, "/").toLowerCase();
        const mediaMatches = authority !== undefined && authority.sourcePath === sourcePath
            && ((lower.endsWith(".png") && authority.mediaType === "image/png")
                || ((lower.endsWith(".jpg") || lower.endsWith(".jpeg")) && authority.mediaType === "image/jpeg"));
        if (!mediaMatches)
            fail("FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED", `Shape ${characterId} bitmap ${bitmapId} has no unique authenticated image authority.`);
        return { bitmapId, sourcePath, styleIndex, smoothing: fill.smooth, ...tile,
            flipX: scaleX < 0, flipY: scaleY < 0 };
    });
    if (!rectanglesTileBounds(projections, bounds))
        fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} bitmap tiles do not exactly cover its bounds.`);
    return projections;
}

/**
 * FFDec can split one repeating bitmap fill into a rectangular mosaic while
 * retaining the same bitmap and transform on every region. When that mosaic
 * partitions exactly one full bitmap projection, repetition is inert and the
 * authored result is the original bitmap. Anything less exact stays rejected.
 */
function resolveRepeatedBitmapMosaicProjection(
    fillStyles: ReadonlyArray<{ readonly value: Record<string, any>; readonly styleIndex: number }>,
    tiles: ReadonlyMap<number, { readonly x: number; readonly y: number; readonly width: number; readonly height: number }>,
    bounds: Record<string, any>,
    characterId: number,
    assets: Record<string, any>,
    resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
): FlashLibraryShapeProjection | undefined {
    if (!fillStyles.some(({ value }) => value.repeat === true)) return undefined;
    if (!fillStyles.every(({ value }) => value.kind === "bitmap" && value.repeat === true && value.smooth === false))
        fail("FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED", `Shape ${characterId} mixes incompatible repeating bitmap fill modes.`);

    const first = fillStyles[0].value;
    const bitmapId = positiveInteger(first.bitmapId, `shape ${characterId}.bitmapId`);
    const matrix = object(first.startMatrix, `shape ${characterId} repeating bitmap matrix`);
    exactKeys(matrix, MATRIX_FIELDS, `shape ${characterId} repeating bitmap matrix`, "FLASH_LIBRARY_BITMAP_FILL_MATRIX_FIELD_UNSUPPORTED");
    const matrixIdentity = JSON.stringify(matrix);
    for (const { value: fill } of fillStyles) {
        if (positiveInteger(fill.bitmapId, `shape ${characterId}.bitmapId`) !== bitmapId
            || JSON.stringify(object(fill.startMatrix, `shape ${characterId} repeating bitmap matrix`)) !== matrixIdentity)
            fail("FLASH_LIBRARY_BITMAP_FILL_PROJECTION_UNSUPPORTED", `Shape ${characterId} repeating bitmap fills do not share one exact source projection.`);
    }

    const bitmapAsset = object(assets[String(bitmapId)], `library.assets.${bitmapId}`);
    if (bitmapAsset.kind !== "image" || bitmapAsset.characterId !== bitmapId)
        fail("FLASH_LIBRARY_BITMAP_FILL_IMAGE_REQUIRED", `Shape ${characterId} bitmap ${bitmapId} does not identify an image asset.`);
    const bitmap = object(bitmapAsset.bitmap, `library.assets.${bitmapId}.bitmap`);
    const bitmapWidth = positive(bitmap.width, `library.assets.${bitmapId}.bitmap.width`);
    const bitmapHeight = positive(bitmap.height, `library.assets.${bitmapId}.bitmap.height`);
    const x = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
    const y = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
    const width = finite(bounds.width, `library.assets.${characterId}.bounds.width`);
    const height = finite(bounds.height, `library.assets.${characterId}.bounds.height`);
    const scaleX = finite(matrix.a, `shape ${characterId} repeating bitmap matrix.a`);
    const scaleY = finite(matrix.d, `shape ${characterId} repeating bitmap matrix.d`);
    if (scaleX === 0 || scaleY === 0 || matrix.b !== 0 || matrix.c !== 0)
        fail("FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED", `Shape ${characterId} repeating bitmap matrix is not signed axis-aligned.`);
    const projectedX0 = finite(matrix.tx, `shape ${characterId} repeating bitmap matrix.tx`);
    const projectedY0 = finite(matrix.ty, `shape ${characterId} repeating bitmap matrix.ty`);
    const projectedX1 = projectedX0 + bitmapWidth * scaleX / 20;
    const projectedY1 = projectedY0 + bitmapHeight * scaleY / 20;
    if (Math.abs(Math.min(projectedX0, projectedX1) - x) > 0.05
        || Math.abs(Math.max(projectedX0, projectedX1) - (x + width)) > 0.05
        || Math.abs(Math.min(projectedY0, projectedY1) - y) > 0.05
        || Math.abs(Math.max(projectedY0, projectedY1) - (y + height)) > 0.05)
        fail("FLASH_LIBRARY_BITMAP_FILL_MATRIX_UNSUPPORTED", `Shape ${characterId} repeating bitmap does not project exactly once across its bounds.`);

    const tileProjections = fillStyles.map(({ styleIndex }): FlashLibraryShapeProjection => ({
        bitmapId,
        sourcePath: "",
        styleIndex,
        smoothing: false,
        ...tiles.get(styleIndex)!,
        flipX: false,
        flipY: false,
    }));
    if (!rectanglesExactlyPartitionBounds(tileProjections, bounds))
        fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} repeating bitmap regions do not exactly partition its bounds.`);

    const sourcePath = string(bitmapAsset.path, `library.assets.${bitmapId}.path`);
    const authority = resourceAuthorities.get(sourcePath);
    const lower = sourcePath.replace(/\\/g, "/").toLowerCase();
    const mediaMatches = authority !== undefined && authority.sourcePath === sourcePath
        && ((lower.endsWith(".png") && authority.mediaType === "image/png")
            || ((lower.endsWith(".jpg") || lower.endsWith(".jpeg")) && authority.mediaType === "image/jpeg"));
    if (!mediaMatches)
        fail("FLASH_LIBRARY_BITMAP_FILL_RESOURCE_UNRESOLVED", `Shape ${characterId} bitmap ${bitmapId} has no unique authenticated image authority.`);
    return {
        bitmapId, sourcePath, styleIndex: fillStyles[0].styleIndex, smoothing: false,
        x, y, width, height, flipX: scaleX < 0, flipY: scaleY < 0,
    };
}

function flashLibraryAssetName(asset: Record<string, any>, characterId: number): string {
    return asset.symbolName === undefined
        ? `character_${characterId}`
        : string(asset.symbolName, `library.assets.${characterId}.symbolName`);
}

function rectangleForFill(
    segmentsValue: ReadonlyArray<unknown>,
    styleIndex: number,
    characterId: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
    const segments = segmentsValue.filter(value => {
        const segment = object(value, `shape ${characterId} segment`);
        return segment.fillStyle0 === styleIndex || segment.fillStyle1 === styleIndex;
    });
    const points = segments.flatMap(value => {
        const edge = object(object(value, `shape ${characterId} segment`).end, `shape ${characterId} segment.end`);
        return [array(edge.from, `shape ${characterId} segment.end.from`), array(edge.to, `shape ${characterId} segment.end.to`)]
            .map(point => {
                if (point.length !== 2) fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} has an incomplete tile edge.`);
                return [finite(point[0], `shape ${characterId} tile x`), finite(point[1], `shape ${characterId} tile y`)] as const;
            });
    });
    if (points.length === 0)
        fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} bitmap fill ${styleIndex} has no geometry.`);
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const rectangle = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    if (!isBoundsRectangle(segments, rectangle, styleIndex))
        fail("FLASH_LIBRARY_BITMAP_FILL_GEOMETRY_UNSUPPORTED", `Shape ${characterId} bitmap fill ${styleIndex} is not one exact rectangle.`);
    return rectangle;
}

function rectanglesTileBounds(
    projections: ReadonlyArray<FlashLibraryShapeProjection>,
    bounds: Record<string, any>,
): boolean {
    const x = finite(bounds.x, "shape.bounds.x");
    const y = finite(bounds.y, "shape.bounds.y");
    const width = finite(bounds.width, "shape.bounds.width");
    const height = finite(bounds.height, "shape.bounds.height");
    if (width <= 0 || height <= 0) return false;
    for (const current of projections) {
        if (current.width <= 0 || current.height <= 0
            || current.x < x || current.y < y
            || current.x + current.width > x + width
            || current.y + current.height > y + height) return false;
    }
    return Math.min(...projections.map(projection => projection.x)) === x
        && Math.min(...projections.map(projection => projection.y)) === y
        && Math.max(...projections.map(projection => projection.x + projection.width)) === x + width
        && Math.max(...projections.map(projection => projection.y + projection.height)) === y + height;
}

function rectanglesExactlyPartitionBounds(
    projections: ReadonlyArray<FlashLibraryShapeProjection>,
    bounds: Record<string, any>,
): boolean {
    if (!rectanglesTileBounds(projections, bounds)) return false;
    const width = finite(bounds.width, "shape.bounds.width");
    const height = finite(bounds.height, "shape.bounds.height");
    let area = 0;
    for (let index = 0; index < projections.length; index++) {
        const current = projections[index];
        area += current.width * current.height;
        for (let otherIndex = index + 1; otherIndex < projections.length; otherIndex++) {
            const other = projections[otherIndex];
            const overlapWidth = Math.min(current.x + current.width, other.x + other.width) - Math.max(current.x, other.x);
            const overlapHeight = Math.min(current.y + current.height, other.y + other.height) - Math.max(current.y, other.y);
            if (overlapWidth > 0 && overlapHeight > 0) return false;
        }
    }
    return Math.abs(area - width * height) <= 0.0001;
}

function isBoundsRectangle(segmentsValue: ReadonlyArray<unknown>, bounds: Record<string, any>, styleIndex: number): boolean {
    const x = finite(bounds.x, "shape.bounds.x");
    const y = finite(bounds.y, "shape.bounds.y");
    const width = finite(bounds.width, "shape.bounds.width");
    const height = finite(bounds.height, "shape.bounds.height");
    if (width <= 0 || height <= 0) return false;
    const top: Array<readonly [number, number]> = [];
    const right: Array<readonly [number, number]> = [];
    const bottom: Array<readonly [number, number]> = [];
    const left: Array<readonly [number, number]> = [];
    for (const value of segmentsValue) {
        const segment = object(value, "shape segment");
        if (segment.kind !== "line"
            || (segment.fillStyle0 !== styleIndex && segment.fillStyle1 !== styleIndex)
            || segment.lineStyle !== 0)
            return false;
        const edge = object(segment.end, "shape segment.end");
        const from = array(edge.from, "shape segment.end.from");
        const to = array(edge.to, "shape segment.end.to");
        if (from.length !== 2 || to.length !== 2 || !from.every(Number.isFinite) || !to.every(Number.isFinite))
            return false;
        const [fromX, fromY] = from as [number, number];
        const [toX, toY] = to as [number, number];
        if (fromX === toX) {
            const interval = [Math.min(fromY, toY), Math.max(fromY, toY)] as const;
            if (interval[0] === interval[1]) return false;
            if (fromX === x) left.push(interval);
            else if (fromX === x + width) right.push(interval);
            else return false;
        }
        else if (fromY === toY) {
            const interval = [Math.min(fromX, toX), Math.max(fromX, toX)] as const;
            if (interval[0] === interval[1]) return false;
            if (fromY === y) top.push(interval);
            else if (fromY === y + height) bottom.push(interval);
            else return false;
        }
        else return false;
    }
    return intervalsCoverExactly(top, x, x + width)
        && intervalsCoverExactly(right, y, y + height)
        && intervalsCoverExactly(bottom, x, x + width)
        && intervalsCoverExactly(left, y, y + height);
}

function intervalsCoverExactly(
    intervalsValue: ReadonlyArray<readonly [number, number]>,
    start: number,
    end: number,
): boolean {
    const intervals = [...intervalsValue].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let cursor = start;
    for (const interval of intervals) {
        if (interval[0] !== cursor || interval[1] <= interval[0]) return false;
        cursor = interval[1];
    }
    return cursor === end;
}

function createDisplayState(
    operation: Record<string, any>,
    firstFrame: number,
    instanceId: number,
    assets: Record<string, any>,
    inheritedAlpha = 1,
    inheritedVisible = true,
    evidenceContext?: PlacementEvidenceContext,
    inertPlacementRatios?: Map<string, NeutralInertPlacementRatio>,
    inheritedColorTransform?: DisplayColorTransform,
    inheritedFilters: ReadonlyArray<NeutralAuthoredFilter> = [],
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
            : displayColorTransform(operation.colorTransform).alphaMultiplier,
        visible: operation.visible === undefined
            ? inheritedVisible
            : boolean(operation.visible, "place.visible"),
        colorTransform: operation.colorTransform === undefined
            ? inheritedColorTransform ?? identityColorTransform(inheritedAlpha)
            : displayColorTransform(operation.colorTransform),
        filters: operation.filters === undefined
            ? inheritedFilters
            : authoredFilters(operation.filters, characterId),
        animatedVisualState: false,
    };
}

function displayMatrix(value: unknown): DisplayMatrix {
    const matrix = object(value, "place.matrix");
    exactKeys(matrix, MATRIX_FIELDS, "place.matrix", "FLASH_LIBRARY_MATRIX_FIELD_UNSUPPORTED");
    const a = finite(matrix.a, "place.matrix.a");
    const b = finite(matrix.b, "place.matrix.b");
    const c = finite(matrix.c, "place.matrix.c");
    const d = finite(matrix.d, "place.matrix.d");
    if (a * d - b * c === 0)
        fail("FLASH_LIBRARY_ANIMATED_MATRIX_SINGULAR", "Animated display-list projection requires an invertible 2D affine matrix.");
    return { a, b, c, d, tx: finite(matrix.tx, "place.matrix.tx"), ty: finite(matrix.ty, "place.matrix.ty") };
}

function displayAlpha(value: unknown): number {
    const transform = displayColorTransform(value);
    for (const channel of ["red", "green", "blue"] as const) {
        if (transform[`${channel}Multiplier`] !== 1 || transform[`${channel}Offset`] !== 0)
            fail("FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED", "Animated display-list projection only admits alpha transforms.");
    }
    if (transform.alphaOffset !== 0)
        fail("FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED", "Animated display-list projection does not admit alpha offsets.");
    return transform.alphaMultiplier;
}

function displayColorTransform(value: unknown): DisplayColorTransform {
    const transform = object(value, "place.colorTransform");
    exactKeys(transform, COLOR_TRANSFORM_FIELDS, "place.colorTransform", "FLASH_LIBRARY_COLOR_TRANSFORM_FIELD_UNSUPPORTED");
    const result = {
        redMultiplier: finite(transform.redMultiplier, "colorTransform.redMultiplier"),
        greenMultiplier: finite(transform.greenMultiplier, "colorTransform.greenMultiplier"),
        blueMultiplier: finite(transform.blueMultiplier, "colorTransform.blueMultiplier"),
        alphaMultiplier: finite(transform.alphaMultiplier, "colorTransform.alphaMultiplier"),
        redOffset: finite(transform.redOffset, "colorTransform.redOffset"),
        greenOffset: finite(transform.greenOffset, "colorTransform.greenOffset"),
        blueOffset: finite(transform.blueOffset, "colorTransform.blueOffset"),
        alphaOffset: finite(transform.alphaOffset, "colorTransform.alphaOffset"),
    };
    if (result.alphaMultiplier < 0 || result.alphaMultiplier > 1)
        fail("FLASH_LIBRARY_COLOR_TRANSFORM_UNSUPPORTED", "Animated display-list alpha multiplier must be between zero and one.");
    return result;
}

function identityColorTransform(alphaMultiplier = 1): DisplayColorTransform {
    return {
        redMultiplier: 1, greenMultiplier: 1, blueMultiplier: 1, alphaMultiplier,
        redOffset: 0, greenOffset: 0, blueOffset: 0, alphaOffset: 0,
    };
}

function isIdentityColorTransform(value: DisplayColorTransform): boolean {
    return value.alphaMultiplier === 1 && sameRgbColorTransform(value, identityColorTransform());
}

function sameRgbColorTransform(left: DisplayColorTransform, right: DisplayColorTransform): boolean {
    return left.redMultiplier === right.redMultiplier
        && left.greenMultiplier === right.greenMultiplier
        && left.blueMultiplier === right.blueMultiplier
        && left.redOffset === right.redOffset
        && left.greenOffset === right.greenOffset
        && left.blueOffset === right.blueOffset
        && left.alphaOffset === right.alphaOffset;
}

function sameAuthoredFilters(
    left: ReadonlyArray<NeutralAuthoredFilter>,
    right: ReadonlyArray<NeutralAuthoredFilter>,
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
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
        string(operation.name, "place.name");
    if (operation.visible !== undefined)
        boolean(operation.visible, "place.visible");
    const characterId = positiveInteger(asset.characterId, "asset.characterId");
    const depth = positiveInteger(operation.depth, "place.depth");
    if (!Number.isSafeInteger(firstFrame) || firstFrame < 1
        || !Number.isSafeInteger(ordinal) || ordinal < 1)
        fail("FLASH_LIBRARY_INSTANCE_ID_AUTHORITY_INVALID", "Placement frame and ordinal must be positive safe integers.");
    return `${flashLibraryAssetName(asset, characterId)}$d${depth}$f${firstFrame}$i${ordinal}`;
}

function admitNonvisualFontAuthorityPlacement(
    operation: Record<string, any>,
    assets: Record<string, any>,
): boolean {
    if (operation.op !== "place" || operation.depth !== 0
        || !Number.isSafeInteger(operation.characterId) || operation.characterId < 1)
        return false;
    const characterId = operation.characterId as number;
    const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
    if (asset.kind !== "font") return false;
    exactKeys(operation, PLACEMENT_FIELDS, "nonvisual font placement", "FLASH_LIBRARY_PLACE_FIELD_UNSUPPORTED");
    const placement = placementTransform(operation);
    const displayState = operation.name !== undefined || operation.clipDepth !== undefined
        || operation.colorTransform !== undefined || operation.filters !== undefined
        || operation.blendMode !== undefined || operation.blendModeCode !== undefined
        || operation.visible !== undefined;
    if (displayState || (operation.move !== undefined && operation.move !== false)
        || (operation.ratio !== undefined && operation.ratio !== 0)
        || placement.a !== 1 || placement.b !== 0 || placement.c !== 0 || placement.d !== 1
        || placement.x !== 0 || placement.y !== 0)
        fail("FLASH_LIBRARY_NONVISUAL_FONT_PLACEMENT_UNSUPPORTED",
            `Font ${characterId} at reserved depth zero must be an inert identity authority reference.`);
    return true;
}

function admitMissingStaticTextPlaceholder(
    asset: Record<string, any>,
    staticText: Record<string, any>,
    initialText: string,
    issues: any[],
    runs: any[],
    characterId: number,
): boolean {
    if (staticText.exactGlyphs !== false
        || issues.length !== 1 || issues[0] !== "SWF text records are missing")
        return false;
    if (asset.bounds !== undefined)
        fail("FLASH_LIBRARY_STATIC_TEXT_MISSING_RECORDS_BOUNDS_UNSUPPORTED",
            `Text ${characterId} has missing records but still declares display bounds.`);
    if (runs.length > 1)
        fail("FLASH_LIBRARY_STATIC_TEXT_MISSING_RECORDS_RUNS_UNSUPPORTED",
            `Text ${characterId} has missing records with multiple diagnostic runs.`);
    if (runs.length === 1) {
        const run = object(runs[0], `library.assets.${characterId}.staticText.runs[0]`);
        exactKeys(run, new Set(["text"]), `library.assets.${characterId}.staticText.runs[0]`,
            "FLASH_LIBRARY_STATIC_TEXT_MISSING_RECORDS_RUN_UNSUPPORTED");
        if (text(run.text, `library.assets.${characterId}.staticText.runs[0].text`) !== initialText)
            fail("FLASH_LIBRARY_TEXT_INITIAL_VALUE_MISMATCH", `Text ${characterId} diagnostic authorities disagree.`);
    }
    if (initialText !== "" && !/^\[\r?\nxmin -?\d+(?:\.\d+)?\r?\nymin -?\d+(?:\.\d+)?\r?\nxmax -?\d+(?:\.\d+)?\r?\nymax -?\d+(?:\.\d+)?\r?\n(?:translatex -?\d+(?:\.\d+)?\r?\n)?translatey -?\d+(?:\.\d+)?\r?\nscalexf -?\d+(?:\.\d+)?\r?\nscaleyf -?\d+(?:\.\d+)?\r?\nrotateskew0f -?\d+(?:\.\d+)?\r?\nrotateskew1f -?\d+(?:\.\d+)?\r?\n\]$/.test(initialText))
        fail("FLASH_LIBRARY_STATIC_TEXT_MISSING_RECORDS_DIAGNOSTIC_UNSUPPORTED",
            `Text ${characterId} has missing records with an unrecognized diagnostic payload.`);
    return true;
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
    const operationLabels = labelOperations.map(operation => {
        exactKeys(operation, FRAME_LABEL_OPERATION_FIELDS, "label", "FLASH_LIBRARY_FRAME_LABEL_OPERATION_FIELD_UNSUPPORTED");
        return validFrameLabel(operation.name, `timeline ${symbolId} label operation`);
    });
    if (operationLabels.length !== 0
        && (frameLabel === undefined || !operationLabels.includes(frameLabel)))
        fail("FLASH_LIBRARY_FRAME_LABEL_OPERATION_MISMATCH", `Timeline ${symbolId} label operations do not include frame.label.`);
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
        const operations = array(current.operations, `timeline ${symbolId}.operations`)
            .map((operation, operationIndex) => object(
                operation,
                `timeline ${symbolId}.operations[${operationIndex}]`,
            ))
            .filter(operation => operation.op === "label");
        const frameLabels = operations.length === 0 && current.label !== undefined
            ? [validFrameLabel(current.label, `timeline ${symbolId} frame ${index + 1}.label`)]
            : operations.map(operation => validFrameLabel(
                operation.name,
                `timeline ${symbolId} label operation`,
            ));
        for (const label of frameLabels) {
            if (Object.prototype.hasOwnProperty.call(labels, label))
                fail("FLASH_LIBRARY_FRAME_LABEL_DUPLICATE", `Timeline ${symbolId} repeats frame label '${label}'.`);
            Object.defineProperty(labels, label, { value: index + 1, enumerable: true });
        }
    });
    return Object.freeze(labels);
}

function validFrameLabel(value: unknown, label: string): string {
    const result = string(value, label);
    if (result.length === 0 || result.length > 128 || /[\u0000-\u001f\u007f]/.test(result))
        fail("FLASH_LIBRARY_FRAME_LABEL_INVALID", `${label} must be nonempty, control-free, and at most 128 UTF-16 units.`);
    return result;
}

function exactPlace(operation: Record<string, any>, mode: "static" | "replacement" = "static"): void {
    exactKeys(operation, PLACEMENT_FIELDS, "place", "FLASH_LIBRARY_PLACE_FIELD_UNSUPPORTED");
    if (operation.op !== "place")
        fail("FLASH_LIBRARY_DISPLAY_OPERATION_UNSUPPORTED", `Display operation '${String(operation.op)}' is unsupported.`);
    positiveInteger(operation.characterId, "place.characterId");
    const depth = positiveInteger(operation.depth, "place.depth");
    if (operation.clipDepth !== undefined && positiveInteger(operation.clipDepth, "place.clipDepth") <= depth)
        fail("FLASH_LIBRARY_MASK_RANGE_INVALID", "place.clipDepth must end after place.depth.");
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
    authoredBlendMode(operation);
    if (operation.matrix !== undefined) {
        const placement = placementTransform(operation);
        if (mode === "replacement" && (placement.x !== 0 || placement.y !== 0))
            fail("FLASH_LIBRARY_REPLACEMENT_MATRIX_UNSUPPORTED", "Replacement timelines require a zero-translation retained depth transform.");
    }
}

function authoredBlendMode(operation: Record<string, any>): "add" | "layer" | "mask" | "overlay" | undefined {
    const hasMode = operation.blendMode !== undefined;
    const hasCode = operation.blendModeCode !== undefined;
    if (hasMode !== hasCode)
        fail("FLASH_LIBRARY_BLEND_MODE_AUTHORITY_INCOMPLETE", "Authored blendMode and blendModeCode must be retained together.");
    if (!hasMode)
        return undefined;
    const mode = operation.blendMode;
    const expectedCode = mode === "add" ? 8 : mode === "alpha" ? 11 : mode === "layer" ? 2 : mode === "overlay" ? 13 : undefined;
    if (expectedCode === undefined)
        fail("FLASH_LIBRARY_BLEND_MODE_UNSUPPORTED", `Blend mode '${String(mode)}' is unsupported.`);
    exactValue(operation.blendModeCode, expectedCode, "FLASH_LIBRARY_BLEND_MODE_CODE_MISMATCH",
        `Blend mode '${String(mode)}' requires code ${expectedCode}.`);
    // Flash alpha compositing retains the destination only where the source
    // has coverage. Laya's native mask blend is the same ZERO/SRC_ALPHA
    // equation, so the neutral/native seam carries the render operation rather
    // than a Flash-only spelling.
    return mode === "alpha" ? "mask" : mode;
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

/**
 * Some authenticated SWFs retain a display list whose depth domain begins at
 * zero. Neutral authored content reserves zero, so translate the complete
 * timeline domain by one. The translation is deliberately all-or-nothing:
 * every place/move/remove depth and mask clipDepth moves together, preserving
 * operation order, collisions, and display-list relationships. An isolated
 * identity font placement at depth zero remains the separately authenticated
 * nonvisual authority case and does not trigger translation.
 */
function normalizeReservedZeroDepthTimeline(
    sourceTimeline: Record<string, any>,
    assets: Record<string, any>,
): Record<string, any> {
    const symbolId = positiveInteger(sourceTimeline.symbolId, "timeline.symbolId");
    const frames = validatedTimelineFrames(sourceTimeline);
    const operations = frames.flatMap(frameValue => indexedDisplayOperations(object(frameValue, `timeline ${symbolId} frame`), symbolId)
        .map(value => value.operation));
    const zeroDepthOperations = operations.filter(operation => operation.depth === 0);
    if (zeroDepthOperations.length === 0)
        return sourceTimeline;
    const zeroDepthFontAuthorities = zeroDepthOperations.filter(operation =>
        operation.op === "place" && admitNonvisualFontAuthorityPlacement(operation, assets));
    if (zeroDepthFontAuthorities.length === zeroDepthOperations.length)
        return sourceTimeline;
    if (zeroDepthFontAuthorities.length !== 0)
        fail("FLASH_LIBRARY_ZERO_DEPTH_NORMALIZATION_AMBIGUOUS",
            `Timeline ${symbolId} mixes nonvisual font authority and display content at reserved depth zero.`);

    const shiftedFrames = frames.map((frameValue, frameIndex) => {
        const current = object(frameValue, `timeline ${symbolId} frame ${frameIndex + 1}`);
        const shiftedOperations = array(current.operations, `timeline ${symbolId}.operations`).map((value, operationIndex) => {
            const operation = object(value, `timeline ${symbolId}.operations[${operationIndex}]`);
            if (operation.op === "label") return operation;
            const depth = finite(operation.depth, `${operation.op}.depth`);
            if (!Number.isSafeInteger(depth) || depth < 0 || depth >= 0xffff)
                fail("FLASH_LIBRARY_ZERO_DEPTH_NORMALIZATION_UNSUPPORTED",
                    `Timeline ${symbolId} cannot shift display depth ${String(operation.depth)} into the native range.`);
            let clipDepth: number | undefined;
            if (operation.clipDepth !== undefined) {
                clipDepth = finite(operation.clipDepth, "place.clipDepth");
                if (!Number.isSafeInteger(clipDepth) || clipDepth < 0 || clipDepth >= 0xffff)
                    fail("FLASH_LIBRARY_ZERO_DEPTH_NORMALIZATION_UNSUPPORTED",
                        `Timeline ${symbolId} cannot shift clip depth ${String(operation.clipDepth)} into the native range.`);
            }
            return {
                ...operation,
                depth: depth + 1,
                ...(clipDepth === undefined ? {} : { clipDepth: clipDepth + 1 }),
            };
        });
        return { ...current, operations: shiftedOperations };
    });
    return { ...sourceTimeline, frames: shiftedFrames };
}

interface StaticTextProjection {
    readonly x: number;
    readonly y: number;
    readonly localX: number;
    readonly localY: number;
    readonly width: number;
    readonly height: number;
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

function staticTextProjection(
    staticMatrix: Record<string, any>,
    bounds: Record<string, any>,
    placement: PlacementTransform,
    characterId: number,
): StaticTextProjection {
    const path = `library.assets.${characterId}.staticText.matrix`;
    const a = finite(staticMatrix.a, `${path}.a`);
    const b = finite(staticMatrix.b, `${path}.b`);
    const c = finite(staticMatrix.c, `${path}.c`);
    const d = finite(staticMatrix.d, `${path}.d`);
    const tx = finite(staticMatrix.tx, `${path}.tx`);
    const ty = finite(staticMatrix.ty, `${path}.ty`);
    const determinant = a * d - b * c;
    if (determinant === 0)
        fail("FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED", `Text ${characterId} has a singular text matrix.`);
    const identity = a === 1 && b === 0 && c === 0 && d === 1;
    const clockwiseQuarterTurn = a === 0 && b === 1 && c === -1 && d === 0;
    const counterclockwiseQuarterTurn = a === 0 && b === -1 && c === 1 && d === 0;
    if (!identity && !clockwiseQuarterTurn && !counterclockwiseQuarterTurn)
        fail("FLASH_LIBRARY_STATIC_TEXT_MATRIX_UNSUPPORTED",
            `Text ${characterId} has an unsupported scaled, skewed, or non-quarter-turn text matrix.`);

    const boundsX = finite(bounds.x, `library.assets.${characterId}.bounds.x`);
    const boundsY = finite(bounds.y, `library.assets.${characterId}.bounds.y`);
    const boundsWidth = positive(bounds.width, `Text ${characterId} width`);
    const boundsHeight = positive(bounds.height, `Text ${characterId} height`);
    const inversePoint = (x: number, y: number): readonly [number, number] => {
        const translatedX = x - tx;
        const translatedY = y - ty;
        return [
            (d * translatedX - c * translatedY) / determinant,
            (-b * translatedX + a * translatedY) / determinant,
        ];
    };
    const corners = [
        inversePoint(boundsX, boundsY),
        inversePoint(boundsX + boundsWidth, boundsY),
        inversePoint(boundsX, boundsY + boundsHeight),
        inversePoint(boundsX + boundsWidth, boundsY + boundsHeight),
    ];
    const localX = Math.min(...corners.map(point => point[0]));
    const localY = Math.min(...corners.map(point => point[1]));
    const localRight = Math.max(...corners.map(point => point[0]));
    const localBottom = Math.max(...corners.map(point => point[1]));
    const transformedX = a * localX + c * localY + tx;
    const transformedY = b * localX + d * localY + ty;
    const composedA = placement.a * a + placement.c * b;
    const composedB = placement.b * a + placement.d * b;
    const composedC = placement.a * c + placement.c * d;
    const composedD = placement.b * c + placement.d * d;
    return {
        x: placement.x + placement.a * transformedX + placement.c * transformedY,
        y: placement.y + placement.b * transformedX + placement.d * transformedY,
        localX,
        localY,
        width: positive(localRight - localX, `Text ${characterId} projected width`),
        height: positive(localBottom - localY, `Text ${characterId} projected height`),
        ...(composedA === 1 && composedB === 0 && composedC === 0 && composedD === 1
            ? {}
            : { matrix: { a: composedA, b: composedB, c: composedC, d: composedD } }),
    };
}

function authoredFilters(value: unknown, characterId: number): ReadonlyArray<NeutralAuthoredFilter> {
    if (value === undefined) return [];
    return array(value, `place ${characterId}.filters`).map((filterValue, index) => {
        const label = `place ${characterId}.filters[${index}]`;
        const filter = object(filterValue, label);
        if (filter.kind === "blur") {
            exactKeys(filter, BLUR_FILTER_FIELDS, label, "FLASH_LIBRARY_FILTER_FIELD_UNSUPPORTED");
            exactValue(filter.sourceType, "BLURFILTER", "FLASH_LIBRARY_FILTER_SOURCE_TYPE_UNSUPPORTED", `${label}.sourceType is unsupported.`);
            const blurX = finite(filter.blurX, `${label}.blurX`);
            const blurY = finite(filter.blurY, `${label}.blurY`);
            if (blurX < 0 || blurX > 255 || blurY < 0 || blurY > 255)
                fail("FLASH_LIBRARY_FILTER_BLUR_INVALID", `${label} blur dimensions must be between zero and 255.`);
            const quality = positiveInteger(filter.passes, `${label}.passes`);
            if (quality > 15)
                fail("FLASH_LIBRARY_FILTER_QUALITY_INVALID", `${label}.passes exceeds the Flash quality range.`);
            return { kind: "blur", blurX, blurY, quality };
        }
        if (filter.kind === "gradient-bevel" || filter.kind === "gradient-glow")
            return authoredGradientFilter(filter, label);
        if (filter.kind === "bevel")
            return authoredBevelFilter(filter, label);
        if (filter.kind === "drop-shadow")
            return authoredDropShadowFilter(filter, label);
        if (filter.kind === "color-matrix") {
            exactKeys(filter, COLOR_MATRIX_FILTER_FIELDS, label, "FLASH_LIBRARY_FILTER_FIELD_UNSUPPORTED");
            exactValue(filter.sourceType, "COLORMATRIXFILTER", "FLASH_LIBRARY_FILTER_SOURCE_TYPE_UNSUPPORTED", `${label}.sourceType is unsupported.`);
            const matrix = array(filter.matrix, `${label}.matrix`).map((candidate, matrixIndex) =>
                finite(candidate, `${label}.matrix[${matrixIndex}]`));
            if (matrix.length !== 20)
                fail("FLASH_LIBRARY_COLOR_MATRIX_LENGTH_INVALID", `${label}.matrix must contain exactly 20 values.`);
            return { kind: "color-matrix", matrix };
        }
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

function authoredBevelFilter(filter: Record<string, any>, label: string): NeutralAuthoredFilter {
    exactKeys(filter, BEVEL_FILTER_FIELDS, label, "FLASH_LIBRARY_FILTER_FIELD_UNSUPPORTED");
    exactValue(filter.sourceType, "BEVELFILTER", "FLASH_LIBRARY_FILTER_SOURCE_TYPE_UNSUPPORTED", `${label}.sourceType is unsupported.`);
    const highlight = authoredFilterColor(filter.highlightColor, `${label}.highlightColor`);
    const shadow = authoredFilterColor(filter.shadowColor, `${label}.shadowColor`);
    const innerShadow = boolean(filter.innerShadow, `${label}.innerShadow`);
    const onTop = boolean(filter.onTop, `${label}.onTop`);
    const type = onTop && !innerShadow ? "full" : innerShadow ? "inner" : "outer";
    exactValue(filter.type, type, "FLASH_LIBRARY_FILTER_TYPE_MISMATCH", `${label}.type disagrees with its serialized flags.`);
    const blurX = finite(filter.blurX, `${label}.blurX`);
    const blurY = finite(filter.blurY, `${label}.blurY`);
    const strength = finite(filter.strength, `${label}.strength`);
    const passes = positiveInteger(filter.passes, `${label}.passes`);
    if (blurX < 0 || blurX > 255 || blurY < 0 || blurY > 255)
        fail("FLASH_LIBRARY_FILTER_BLUR_INVALID", `${label} blur dimensions must be between zero and 255.`);
    if (strength < 0 || strength > 255.99609375)
        fail("FLASH_LIBRARY_FILTER_STRENGTH_INVALID", `${label}.strength is outside the Flash range.`);
    if (passes > 15)
        fail("FLASH_LIBRARY_FILTER_QUALITY_INVALID", `${label}.passes exceeds the Flash quality range.`);
    return {
        kind: "bevel", sourceType: "BEVELFILTER",
        distance: finite(filter.distance, `${label}.distance`),
        angleRadians: finite(filter.angleRadians, `${label}.angleRadians`),
        highlightColor: highlight.color, highlightAlpha: highlight.alpha,
        shadowColor: shadow.color, shadowAlpha: shadow.alpha,
        blurX, blurY, strength, passes, innerShadow, onTop,
        knockout: boolean(filter.knockout, `${label}.knockout`),
        compositeSource: boolean(filter.compositeSource, `${label}.compositeSource`),
    };
}

function authoredFilterColor(value: unknown, label: string): { readonly color: number; readonly alpha: number } {
    const color = object(value, label);
    exactKeys(color, FILTER_COLOR_FIELDS, label, "FLASH_LIBRARY_FILTER_COLOR_FIELD_UNSUPPORTED");
    const rgb = finite(color.color, `${label}.color`);
    const alpha = finite(color.alpha, `${label}.alpha`);
    if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff)
        fail("FLASH_LIBRARY_FILTER_COLOR_INVALID", `${label}.color must be an RGB integer.`);
    if (alpha < 0 || alpha > 1)
        fail("FLASH_LIBRARY_FILTER_ALPHA_INVALID", `${label}.alpha must be between zero and one.`);
    return { color: rgb, alpha };
}

function authoredDropShadowFilter(filter: Record<string, any>, label: string): NeutralAuthoredFilter {
    exactKeys(filter, DROP_SHADOW_FILTER_FIELDS, label, "FLASH_LIBRARY_DROP_SHADOW_FIELD_UNSUPPORTED");
    exactValue(filter.sourceType, "DROPSHADOWFILTER", "FLASH_LIBRARY_DROP_SHADOW_SOURCE_TYPE_UNSUPPORTED", `${label}.sourceType is unsupported.`);
    const color = object(filter.color, `${label}.color`);
    exactKeys(color, FILTER_COLOR_FIELDS, `${label}.color`, "FLASH_LIBRARY_DROP_SHADOW_COLOR_FIELD_UNSUPPORTED");
    const rgb = finite(color.color, `${label}.color.color`);
    if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff)
        fail("FLASH_LIBRARY_DROP_SHADOW_COLOR_INVALID", `${label}.color.color must be an RGB integer.`);
    const alpha = finite(color.alpha, `${label}.color.alpha`);
    if (alpha < 0 || alpha > 1)
        fail("FLASH_LIBRARY_DROP_SHADOW_ALPHA_INVALID", `${label}.color.alpha must be between zero and one.`);
    const blurX = finite(filter.blurX, `${label}.blurX`);
    const blurY = finite(filter.blurY, `${label}.blurY`);
    if (blurX < 0 || blurX > 255 || blurY < 0 || blurY > 255)
        fail("FLASH_LIBRARY_DROP_SHADOW_BLUR_INVALID", `${label} blur dimensions must be between zero and 255.`);
    const strength = finite(filter.strength, `${label}.strength`);
    if (strength < 0 || strength > 255)
        fail("FLASH_LIBRARY_DROP_SHADOW_STRENGTH_INVALID", `${label}.strength must be between zero and 255.`);
    const quality = positiveInteger(filter.passes, `${label}.passes`);
    if (quality > 15)
        fail("FLASH_LIBRARY_DROP_SHADOW_QUALITY_INVALID", `${label}.passes exceeds the Flash quality range.`);
    return {
        kind: "drop-shadow",
        distance: finite(filter.distance, `${label}.distance`),
        angleRadians: finite(filter.angleRadians, `${label}.angleRadians`),
        color: rgb,
        alpha,
        blurX,
        blurY,
        strength,
        quality,
        inner: boolean(filter.innerShadow, `${label}.innerShadow`),
        knockout: boolean(filter.knockout, `${label}.knockout`),
        hideObject: !boolean(filter.compositeSource, `${label}.compositeSource`),
    };
}

function animatedPlacementInstanceId(
    asset: Record<string, any>,
    operation: Record<string, any>,
    firstFrame: number,
    ordinal: number,
): string {
    const characterId = positiveInteger(asset.characterId, "asset.characterId");
    const depth = positiveInteger(operation.depth, "place.depth");
    if (!Number.isSafeInteger(firstFrame) || firstFrame < 1
        || !Number.isSafeInteger(ordinal) || ordinal < 1)
        fail("FLASH_LIBRARY_INSTANCE_ID_AUTHORITY_INVALID", "Placement frame and ordinal must be positive safe integers.");
    const base = operation.name === undefined
        ? flashLibraryAssetName(asset, characterId)
        : string(operation.name, "place.name");
    return `${base}$d${depth}$f${firstFrame}$i${ordinal}`;
}

function authoredGradientFilter(filter: Record<string, any>, label: string): NeutralAuthoredFilter {
    exactKeys(filter, GRADIENT_FILTER_FIELDS, label, "FLASH_LIBRARY_FILTER_FIELD_UNSUPPORTED");
    const kind = filter.kind === "gradient-glow" ? "gradient-glow" : "gradient-bevel";
    exactValue(filter.sourceType, kind === "gradient-glow" ? "GRADIENTGLOWFILTER" : "GRADIENTBEVELFILTER",
        "FLASH_LIBRARY_FILTER_SOURCE_TYPE_UNSUPPORTED", `${label}.sourceType is unsupported.`);
    exactValue(filter.compositeSource, true, "FLASH_LIBRARY_FILTER_COMPOSITE_SOURCE_UNSUPPORTED", `${label}.compositeSource is unsupported.`);
    const colors = array(filter.colors, `${label}.colors`).map((value, index) => {
        const stop = object(value, `${label}.colors[${index}]`);
        exactKeys(stop, FILTER_COLOR_FIELDS, `${label}.colors[${index}]`, "FLASH_LIBRARY_FILTER_COLOR_FIELD_UNSUPPORTED");
        const color = finite(stop.color, `${label}.colors[${index}].color`);
        const alpha = finite(stop.alpha, `${label}.colors[${index}].alpha`);
        if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
            fail("FLASH_LIBRARY_FILTER_COLOR_INVALID", `${label}.colors[${index}].color must be an RGB integer.`);
        if (alpha < 0 || alpha > 1)
            fail("FLASH_LIBRARY_FILTER_ALPHA_INVALID", `${label}.colors[${index}].alpha must be between zero and one.`);
        return { color, alpha };
    });
    const ratios = array(filter.ratios, `${label}.ratios`).map((value, index) => {
        const ratio = finite(value, `${label}.ratios[${index}]`);
        if (!Number.isInteger(ratio) || ratio < 0 || ratio > 255)
            fail("FLASH_LIBRARY_FILTER_RATIO_INVALID", `${label}.ratios[${index}] must be an integer from zero through 255.`);
        return ratio;
    });
    if (colors.length < 2 || colors.length !== ratios.length)
        fail("FLASH_LIBRARY_FILTER_STOPS_INVALID", `${label} requires matching gradient stops and ratios.`);
    const innerShadow = boolean(filter.innerShadow, `${label}.innerShadow`);
    const onTop = boolean(filter.onTop, `${label}.onTop`);
    const type = onTop && !innerShadow ? "full" : innerShadow ? "inner" : "outer";
    exactValue(filter.type, type, "FLASH_LIBRARY_FILTER_TYPE_MISMATCH", `${label}.type disagrees with its serialized flags.`);
    return {
        kind,
        distance: finite(filter.distance, `${label}.distance`),
        angleRadians: finite(filter.angleRadians, `${label}.angleRadians`),
        colors: colors.map(stop => stop.color), alphas: colors.map(stop => stop.alpha), ratios,
        blurX: finite(filter.blurX, `${label}.blurX`), blurY: finite(filter.blurY, `${label}.blurY`),
        strength: finite(filter.strength, `${label}.strength`), quality: positiveInteger(filter.passes, `${label}.passes`),
        type, knockout: boolean(filter.knockout, `${label}.knockout`), compositeSource: true,
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
