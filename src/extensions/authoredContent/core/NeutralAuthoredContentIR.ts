export const NEUTRAL_AUTHORED_CONTENT_SCHEMA = "neutral-authored-content@1" as const;

export type NeutralNodeKind = "button" | "button-state" | "container" | "dynamic-text" | "image" | "text";
export type NeutralImageMediaType = "image/jpeg" | "image/png";
export type NeutralFontMediaType = "font/ttf";
export type NeutralAuthoredMediaType = NeutralImageMediaType | NeutralFontMediaType;
export type NeutralTimelineProperty = "x" | "y" | "scaleX" | "scaleY" | "rotation" | "alpha" | "visible";
export type NeutralKeyframeValue = number | boolean;

export interface NeutralAuthoredMatrix {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
}

export interface NeutralGlowFilter {
    readonly kind: "glow";
    readonly color: number;
    readonly alpha: number;
    readonly blurX: number;
    readonly blurY: number;
    readonly strength: number;
    readonly quality: number;
    readonly inner: boolean;
    readonly knockout: boolean;
}

export interface NeutralScale9Grid {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Laya's top, right, bottom, left, repeat representation. */
    readonly sizeGrid: readonly [number, number, number, number, 0 | 1];
    /** Direct image child which is the authenticated raster projection. */
    readonly target: string;
}

export interface NeutralAuthoredNode {
    /** Reusable authored definition identity (for example a Flash character/linkage). */
    readonly linkage: string;
    /**
     * Deterministic placement identity within its parent semantic path. A
     * definition may be placed repeatedly, but sibling placement IDs remain
     * unique. Legacy adapters default this to linkage.
     */
    readonly instanceId?: string;
    readonly kind: NeutralNodeKind;
    /** Native node name and generated-accessor name; defaults to instanceId. */
    readonly name?: string;
    /** Authored display-list depth. Siblings are emitted in ascending depth order. */
    readonly depth?: number;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly alpha?: number;
    readonly visible?: boolean;
    readonly matrix?: NeutralAuthoredMatrix;
    /** Closed authored display filter set applied by the native MovieClip primitive. */
    readonly filters?: ReadonlyArray<NeutralGlowFilter>;
    /** Closed nine-slice projection for a single raster-backed authored sprite. */
    readonly scale9Grid?: NeutralScale9Grid;
    readonly text?: string;
    readonly fontSize?: number;
    readonly color?: string;
    /** Required only for image nodes and resolved through the authenticated resource closure. */
    readonly resourceId?: string;
    /** Application-owned root/linkage class; primitive children use Laya-owned runtime IDs. */
    readonly runtimeLinkage?: string;
    readonly variable?: boolean;
    readonly textField?: NeutralDynamicTextField;
    /** Independently clocked timeline owned by this nested symbol. */
    readonly timeline?: NeutralTimeline;
    readonly children: ReadonlyArray<NeutralAuthoredNode>;
}

export interface NeutralDynamicTextField {
    readonly sourceId: number;
    readonly type: "dynamic" | "input";
    readonly multiline: boolean;
    readonly wordWrap: boolean;
    readonly selectable: boolean;
    readonly displayAsPassword: boolean;
    readonly autoSize: "none";
    readonly html: boolean;
    /** Omitted by native bundles emitted before source useOutlines retention. */
    readonly useOutlines?: boolean;
    readonly filters: ReadonlyArray<NeutralGlowFilter>;
    readonly gutter: 2;
    readonly overflow: "hidden";
    readonly initialText: string;
    readonly rasterization?: NeutralAdvancedTextRasterization;
    readonly format: NeutralDynamicTextFormat;
}

export interface NeutralDynamicTextFormat {
    readonly fontMode: "device" | "embedded";
    readonly font: string;
    readonly size: number;
    readonly color: number;
    readonly bold: boolean;
    readonly italic: boolean;
    readonly underline: boolean;
    readonly align: "left" | "center" | "right" | "justify";
    readonly leftMargin: number;
    readonly rightMargin: number;
    readonly indent: number;
    readonly leading: number;
    readonly letterSpacing: number;
    readonly kerning: boolean;
    readonly embeddedFont?: NeutralEmbeddedFont;
}

export interface NeutralEmbeddedFontGlyph {
    readonly index: number;
    readonly codePoint: number;
    readonly advance: number;
    readonly bounds: { readonly xmin: number; readonly xmax: number; readonly ymin: number; readonly ymax: number };
}

export interface NeutralEmbeddedFontKerning {
    readonly leftCodePoint: number;
    readonly rightCodePoint: number;
    readonly adjustment: number;
}

export interface NeutralFontAlignZoneData {
    readonly alignmentCoordinate: number;
    readonly alignmentCoordinateBits: number;
    readonly range: number;
    readonly rangeBits: number;
}

export interface NeutralFontAlignZone {
    readonly data: readonly [NeutralFontAlignZoneData, NeutralFontAlignZoneData];
    readonly maskX: boolean;
    readonly maskY: boolean;
}

export interface NeutralFontAlignZones {
    readonly tableHint: 1;
    readonly tableHintName: "medium";
    readonly zones: ReadonlyArray<NeutralFontAlignZone>;
}

export interface NeutralEmbeddedFont {
    readonly resourceId: string;
    readonly sourceSha256: string;
    readonly fontId: number;
    readonly fontType: "embedded";
    readonly fontStyle: "regular" | "bold" | "italic" | "boldItalic";
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly leading: number;
    readonly glyphs: ReadonlyArray<NeutralEmbeddedFontGlyph>;
    readonly kerning: ReadonlyArray<NeutralEmbeddedFontKerning>;
    readonly alignZones: NeutralFontAlignZones;
}

export interface NeutralAdvancedTextRasterization {
    readonly antiAliasType: "advanced";
    readonly gridFitType: "subpixel";
    readonly sharpness: number;
    readonly thickness: number;
}

export interface NeutralAuthoredResource {
    readonly id: string;
    /** Normalized path relative to the immutable authored-content manifest. */
    readonly sourcePath: string;
    readonly mediaType: NeutralAuthoredMediaType;
    readonly byteLength: number;
    readonly sha256: string;
    /** Deterministic standard Laya asset path within the generated bundle. */
    readonly outputPath: string;
}

export interface NeutralKeyframe {
    readonly time: number;
    readonly value: NeutralKeyframeValue;
    readonly tweenType?: string;
}

export interface NeutralTimelineTrack {
    readonly targetPath: ReadonlyArray<string>;
    readonly property: NeutralTimelineProperty;
    readonly keyframes: ReadonlyArray<NeutralKeyframe>;
}

export interface NeutralTimeline {
    readonly frameRate: number;
    readonly duration: number;
    readonly loop: boolean;
    /** One-based Flash frame labels retained for native MovieClip navigation. */
    readonly frameLabels: Readonly<Record<string, number>>;
    readonly tracks: ReadonlyArray<NeutralTimelineTrack>;
}

export interface NeutralAuthoredStage {
    readonly width: number;
    readonly height: number;
    readonly frameRate: number;
    readonly frameCount: number;
    readonly backgroundColor: {
        readonly alpha: number;
        readonly color: number;
    };
}

export interface NeutralAuthoredContentIR {
    readonly schema: typeof NEUTRAL_AUTHORED_CONTENT_SCHEMA;
    readonly documentId: string;
    readonly resources: ReadonlyArray<NeutralAuthoredResource>;
    readonly root: NeutralAuthoredNode;
    readonly timeline: NeutralTimeline;
    readonly stage?: NeutralAuthoredStage;
    /** Auditable source coordinates for PlaceObject ratios with no native runtime effect. */
    readonly inertPlacementRatios?: ReadonlyArray<NeutralInertPlacementRatio>;
}

export interface NeutralInertPlacementRatio {
    readonly timelineSymbolId: number;
    readonly frameIndex: number;
    readonly operationIndex: number;
    readonly depth: number;
    readonly characterId: number;
    readonly characterKind: "button" | "image" | "input-text" | "morph-rasterized" | "shape" | "sprite" | "text";
    readonly ratio: number;
}

const NODE_KINDS: ReadonlySet<string> = new Set(["button", "button-state", "container", "dynamic-text", "image", "text"]);
const BUTTON_STATE_ORDER = ["upState", "overState", "downState", "hitTestState"] as const;
const BUTTON_STATE_NAMES: ReadonlySet<string> = new Set(BUTTON_STATE_ORDER);
const RESOURCE_MEDIA_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "font/ttf"]);
const TIMELINE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "scaleX", "scaleY", "rotation", "alpha", "visible"]);
const SCALED_NODE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "width", "height", "fontSize"]);
const SCALED_TRACK_PROPERTIES: ReadonlySet<string> = new Set(["x", "y"]);

/** Validates untrusted adapter output and returns a deterministic normalized IR. */
export function normalizeNeutralAuthoredContent(input: unknown, scale = 1): NeutralAuthoredContentIR {
    const source = record(input, "document");
    allowedKeys(source, ["schema", "documentId", "resources", "root", "timeline", "stage", "controller", "inertPlacementRatios"], "document");
    if ("controller" in source)
        fail("AUTHORED_CONTENT_CONTROLLER_CAPTURE_REQUIRED", "Animation-controller capture is not implemented.");
    if (source.schema !== NEUTRAL_AUTHORED_CONTENT_SCHEMA)
        fail("AUTHORED_CONTENT_SCHEMA_UNSUPPORTED", `Expected '${NEUTRAL_AUTHORED_CONTENT_SCHEMA}'.`);
    if (!Number.isFinite(scale) || scale <= 0)
        fail("AUTHORED_CONTENT_INVALID_SCALE", "Import scale must be a positive finite number.");

    const documentId = stableLabel(source.documentId, "documentId");
    const root = normalizeNode(source.root, "root", scale);
    if (root.depth !== undefined)
        fail("AUTHORED_CONTENT_ROOT_DEPTH_UNSUPPORTED", "The document root cannot have an authored display-list depth.");
    const resources = normalizeResources(source.resources ?? []);
    validateResourceClosure(root, resources);
    const nodePaths = collectNodePaths(root);
    const timeline = normalizeTimeline(source.timeline, scale, nodePaths);
    const stage = source.stage === undefined ? undefined : normalizeStage(source.stage, scale);
    const inertPlacementRatios = source.inertPlacementRatios === undefined
        ? undefined
        : normalizeInertPlacementRatios(source.inertPlacementRatios);
    if (stage !== undefined) {
        if (root.width !== stage.width || root.height !== stage.height)
            fail("AUTHORED_CONTENT_STAGE_BOUNDS_MISMATCH", "Stage dimensions must match the emitted document root.");
        if (timeline.frameRate !== stage.frameRate)
            fail("AUTHORED_CONTENT_STAGE_FRAME_RATE_MISMATCH", "Stage and root timeline frame rates must match.");
        if (Math.abs(timeline.duration * timeline.frameRate - stage.frameCount) > 1e-9)
            fail("AUTHORED_CONTENT_STAGE_FRAME_COUNT_MISMATCH", "Stage frame count must match the root timeline duration.");
    }
    return {
        schema: NEUTRAL_AUTHORED_CONTENT_SCHEMA,
        documentId,
        resources,
        root,
        timeline,
        ...(stage === undefined ? {} : { stage }),
        ...(inertPlacementRatios === undefined ? {} : { inertPlacementRatios }),
    };
}

function normalizeInertPlacementRatios(value: unknown): ReadonlyArray<NeutralInertPlacementRatio> {
    const admittedKinds = new Set(["button", "image", "input-text", "morph-rasterized", "shape", "sprite", "text"]);
    const normalized = array(value, "inertPlacementRatios").map((entry, index) => {
        const path = `inertPlacementRatios[${index}]`;
        const source = record(entry, path);
        allowedKeys(source, [
            "timelineSymbolId", "frameIndex", "operationIndex", "depth", "characterId", "characterKind", "ratio"
        ], path);
        const timelineSymbolId = positiveSafeInteger(source.timelineSymbolId, `${path}.timelineSymbolId`);
        const frameIndex = positiveSafeInteger(source.frameIndex, `${path}.frameIndex`);
        const operationIndex = nonNegativeSafeInteger(source.operationIndex, `${path}.operationIndex`);
        const depth = positiveSafeInteger(source.depth, `${path}.depth`);
        const characterId = positiveSafeInteger(source.characterId, `${path}.characterId`);
        const characterKind = requiredString(source.characterKind, `${path}.characterKind`);
        if (!admittedKinds.has(characterKind))
            fail("AUTHORED_CONTENT_INERT_RATIO_KIND_INVALID", `${path}.characterKind is not an admitted inert or raster-baked kind.`);
        const ratio = requiredFiniteNumber(source.ratio, `${path}.ratio`);
        if (!Number.isInteger(ratio) || ratio < 1 || ratio > 0xffff)
            fail("AUTHORED_CONTENT_INERT_RATIO_RANGE", `${path}.ratio must be an integer from 1 through 65535.`);
        return {
            timelineSymbolId, frameIndex, operationIndex, depth, characterId,
            characterKind: characterKind as NeutralInertPlacementRatio["characterKind"], ratio,
        };
    });
    normalized.sort((left, right) =>
        left.timelineSymbolId - right.timelineSymbolId
        || left.frameIndex - right.frameIndex
        || left.operationIndex - right.operationIndex
        || left.depth - right.depth
        || left.characterId - right.characterId
        || left.ratio - right.ratio
        || left.characterKind.localeCompare(right.characterKind));
    const coordinates = new Set<string>();
    for (const entry of normalized) {
        const coordinate = `${entry.timelineSymbolId}/${entry.frameIndex}/${entry.operationIndex}`;
        if (coordinates.has(coordinate))
            fail("AUTHORED_CONTENT_INERT_RATIO_DUPLICATE", `Duplicate inert placement ratio evidence at ${coordinate}.`);
        coordinates.add(coordinate);
    }
    return normalized;
}

function normalizeStage(value: unknown, scale: number): NeutralAuthoredStage {
    const source = record(value, "stage");
    allowedKeys(source, ["width", "height", "frameRate", "frameCount", "backgroundColor"], "stage");
    const background = record(source.backgroundColor, "stage.backgroundColor");
    allowedKeys(background, ["alpha", "color"], "stage.backgroundColor");
    const width = positiveNumber(source.width, "stage.width") * scale;
    const height = positiveNumber(source.height, "stage.height") * scale;
    const frameRate = requiredFiniteNumber(source.frameRate, "stage.frameRate");
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 0x7fff)
        fail("AUTHORED_CONTENT_FRAME_RATE_RANGE", "Stage frame rate must be an integer from 1 through 32767.");
    const frameCount = requiredFiniteNumber(source.frameCount, "stage.frameCount");
    if (!Number.isSafeInteger(frameCount) || frameCount < 1)
        fail("AUTHORED_CONTENT_STAGE_FRAME_COUNT_INVALID", "Stage frame count must be a positive safe integer.");
    const alpha = requiredFiniteNumber(background.alpha, "stage.backgroundColor.alpha");
    if (alpha < 0 || alpha > 1)
        fail("AUTHORED_CONTENT_STAGE_BACKGROUND_ALPHA_INVALID", "Stage background alpha must be between zero and one.");
    const color = requiredFiniteNumber(background.color, "stage.backgroundColor.color");
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
        fail("AUTHORED_CONTENT_STAGE_BACKGROUND_COLOR_INVALID", "Stage background color must be an RGB integer.");
    return { width, height, frameRate, frameCount, backgroundColor: { alpha, color } };
}

function normalizeNode(
    value: unknown,
    path: string,
    scale: number
): NeutralAuthoredNode {
    const source = record(value, path);
    allowedKeys(source, [
        "linkage", "instanceId", "kind", "name", "depth", "x", "y", "width", "height", "alpha", "visible", "matrix",
        "filters", "scale9Grid", "text", "fontSize", "color", "resourceId", "runtimeLinkage", "variable", "textField", "timeline", "children"
    ], path);
    const rawLinkage = requiredString(source.linkage, `${path}.linkage`);
    const linkage = canonicalLinkage(rawLinkage);

    const kind = requiredString(source.kind, `${path}.kind`);
    if (!NODE_KINDS.has(kind))
        fail("AUTHORED_CONTENT_NODE_KIND_UNSUPPORTED", `${path}.kind '${kind}' is unsupported.`);

    const node: NeutralAuthoredNode = {
        linkage,
        instanceId: canonicalLinkage(source.instanceId === undefined
            ? rawLinkage
            : requiredString(source.instanceId, `${path}.instanceId`)),
        kind: kind as NeutralNodeKind,
        name: source.name === undefined
            ? undefined
            : canonicalLinkage(requiredString(source.name, `${path}.name`)),
        depth: optionalDepth(source.depth, `${path}.depth`),
        x: optionalNumber(source.x, `${path}.x`, scale),
        y: optionalNumber(source.y, `${path}.y`, scale),
        width: optionalNumber(source.width, `${path}.width`, scale),
        height: optionalNumber(source.height, `${path}.height`, scale),
        alpha: optionalNumber(source.alpha, `${path}.alpha`),
        visible: optionalBoolean(source.visible, `${path}.visible`),
        matrix: source.matrix === undefined ? undefined : normalizeMatrix(source.matrix, `${path}.matrix`),
        filters: source.filters === undefined ? undefined : array(source.filters, `${path}.filters`).map((filter, index) =>
            normalizeGlowFilter(filter, `${path}.filters[${index}]`, scale)),
        scale9Grid: source.scale9Grid === undefined
            ? undefined
            : normalizeScale9Grid(source.scale9Grid, `${path}.scale9Grid`, scale),
        text: optionalString(source.text, `${path}.text`),
        fontSize: optionalNumber(source.fontSize, `${path}.fontSize`, scale),
        color: optionalString(source.color, `${path}.color`),
        resourceId: source.resourceId === undefined
            ? undefined
            : canonicalResourceId(requiredString(source.resourceId, `${path}.resourceId`)),
        runtimeLinkage: source.runtimeLinkage === undefined
            ? undefined
            : canonicalRuntimeLinkage(requiredString(source.runtimeLinkage, `${path}.runtimeLinkage`)),
        variable: optionalBoolean(source.variable, `${path}.variable`),
        textField: source.textField === undefined
            ? undefined
            : normalizeDynamicTextField(source.textField, `${path}.textField`, scale),
        children: normalizeSiblings(array(source.children, `${path}.children`), `${path}.children`, scale)
    };
    if (node.kind === "text" && node.text === undefined)
        fail("AUTHORED_CONTENT_TEXT_MISSING", `${path}.text is required for a text node.`);
    if (node.kind === "image" && node.resourceId === undefined)
        fail("AUTHORED_CONTENT_IMAGE_RESOURCE_MISSING", `${path}.resourceId is required for an image node.`);
    if (node.kind !== "image" && node.resourceId !== undefined)
        fail("AUTHORED_CONTENT_RESOURCE_ON_NON_IMAGE", `${path}.resourceId is only valid on an image node.`);
    if (node.kind !== "text" && (node.text !== undefined || node.fontSize !== undefined || node.color !== undefined))
        fail("AUTHORED_CONTENT_TEXT_PROPERTY_ON_NON_TEXT", `${path} contains text-only properties.`);
    if (node.kind === "dynamic-text" && node.textField === undefined)
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_CONFIGURATION_MISSING", `${path}.textField is required for a dynamic-text node.`);
    if (node.kind !== "dynamic-text" && node.textField !== undefined)
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_CONFIGURATION_UNEXPECTED", `${path}.textField is only valid on a dynamic-text node.`);
    if (node.filters !== undefined && node.kind !== "container")
        fail("AUTHORED_CONTENT_DISPLAY_FILTER_TARGET_UNSUPPORTED", `${path}.filters requires a container node.`);
    if (node.scale9Grid !== undefined && node.kind !== "container")
        fail("AUTHORED_CONTENT_SCALE9_GRID_TARGET_UNSUPPORTED", `${path}.scale9Grid requires a container node.`);
    if (node.scale9Grid !== undefined) {
        const targets = node.children.filter(child => (child.name ?? child.instanceId ?? child.linkage) === node.scale9Grid!.target);
        if (targets.length !== 1 || targets[0].kind !== "image")
            fail("AUTHORED_CONTENT_SCALE9_GRID_RASTER_TARGET_INVALID", `${path}.scale9Grid must identify one direct image child.`);
    }
    if (node.kind === "dynamic-text") {
        if (node.x === undefined || node.y === undefined || node.width === undefined || node.height === undefined)
            fail("AUTHORED_CONTENT_DYNAMIC_TEXT_BOUNDS_MISSING", `${path} requires exact x, y, width, and height.`);
    }
    if (node.kind !== "button" && node.kind !== "button-state" && node.kind !== "container" && node.children.length !== 0)
        fail("AUTHORED_CONTENT_LEAF_CHILDREN_UNSUPPORTED", `${path} ${node.kind} nodes cannot contain children.`);
    if (node.kind === "button") {
        if (node.width === undefined || node.height === undefined || node.width <= 0 || node.height <= 0)
            fail("AUTHORED_CONTENT_BUTTON_BOUNDS_MISSING", `${path} requires positive width and height.`);
        if (node.children.length !== BUTTON_STATE_ORDER.length
            || node.children.some(child => child.kind !== "button-state" || !BUTTON_STATE_NAMES.has(child.name ?? ""))
            || new Set(node.children.map(child => child.name)).size !== BUTTON_STATE_ORDER.length
            || node.children.some((child, index) => child.name !== BUTTON_STATE_ORDER[index]))
            fail("AUTHORED_CONTENT_BUTTON_STATE_CLOSURE", `${path} requires exactly one upState, overState, downState, and hitTestState child in canonical order.`);
    }
    if (node.kind === "button-state" && !BUTTON_STATE_NAMES.has(node.name ?? ""))
        fail("AUTHORED_CONTENT_BUTTON_STATE_NAME_INVALID", `${path} requires a canonical SimpleButton state name.`);
    if (source.timeline !== undefined && node.kind !== "container")
        fail("AUTHORED_CONTENT_NESTED_TIMELINE_HOST_INVALID", `${path}.timeline requires a container node.`);
    return source.timeline === undefined
        ? node
        : { ...node, timeline: normalizeTimeline(source.timeline, scale, collectNodePaths(node)) };
}

function normalizeScale9Grid(value: unknown, path: string, scale: number): NeutralScale9Grid {
    const source = record(value, path);
    allowedKeys(source, ["height", "sizeGrid", "target", "width", "x", "y"], path);
    const rawSizeGrid = array(source.sizeGrid, `${path}.sizeGrid`);
    if (rawSizeGrid.length !== 5)
        fail("AUTHORED_CONTENT_SCALE9_GRID_SIZE_INVALID", `${path}.sizeGrid must contain five values.`);
    const sizeGrid = rawSizeGrid.map((item, index) => {
        const number = requiredFiniteNumber(item, `${path}.sizeGrid[${index}]`);
        if (index < 4 && number < 0)
            fail("AUTHORED_CONTENT_SCALE9_GRID_INSET_INVALID", `${path}.sizeGrid[${index}] must be nonnegative.`);
        if (index === 4 && number !== 0 && number !== 1)
            fail("AUTHORED_CONTENT_SCALE9_GRID_REPEAT_INVALID", `${path}.sizeGrid[4] must be zero or one.`);
        return index < 4 ? number * scale : number;
    }) as [number, number, number, number, 0 | 1];
    return {
        x: requiredFiniteNumber(source.x, `${path}.x`) * scale,
        y: requiredFiniteNumber(source.y, `${path}.y`) * scale,
        width: positiveNumber(source.width, `${path}.width`) * scale,
        height: positiveNumber(source.height, `${path}.height`) * scale,
        sizeGrid,
        target: canonicalLinkage(requiredString(source.target, `${path}.target`)),
    };
}

function normalizeDynamicTextField(value: unknown, path: string, scale: number): NeutralDynamicTextField {
    const source = record(value, path);
    allowedKeys(source, [
        "autoSize", "displayAsPassword", "filters", "format", "gutter", "html", "initialText", "multiline",
        "overflow", "rasterization", "selectable", "sourceId", "type", "useOutlines", "wordWrap"
    ], path);
    const format = record(source.format, `${path}.format`);
    allowedKeys(format, [
        "align", "bold", "color", "font", "fontMode", "indent", "italic", "leading", "leftMargin",
        "rightMargin", "size", "underline", "letterSpacing", "kerning", "embeddedFont"
    ], `${path}.format`);
    const sourceId = requiredFiniteNumber(source.sourceId, `${path}.sourceId`);
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0)
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_SOURCE_ID_INVALID", `${path}.sourceId must be a positive safe integer.`);
    const type = requiredString(source.type, `${path}.type`);
    if (type !== "dynamic" && type !== "input")
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_TYPE_UNSUPPORTED", `${path}.type '${type}' is unsupported.`);
    const fontMode = requiredString(format.fontMode, `${path}.format.fontMode`);
    if (fontMode !== "device" && fontMode !== "embedded")
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_FONT_MODE_UNSUPPORTED", `${path}.format.fontMode '${fontMode}' is unsupported.`);
    const embeddedFont = format.embeddedFont === undefined
        ? undefined
        : normalizeEmbeddedFont(format.embeddedFont, `${path}.format.embeddedFont`);
    const rasterization = source.rasterization === undefined
        ? undefined
        : normalizeAdvancedTextRasterization(source.rasterization, `${path}.rasterization`);
    const useOutlines = source.useOutlines === undefined
        ? false
        : requiredBoolean(source.useOutlines, `${path}.useOutlines`);
    if (fontMode === "device" && (embeddedFont !== undefined || rasterization !== undefined || useOutlines))
        fail("AUTHORED_CONTENT_DEVICE_TEXT_EMBEDDED_CONFIGURATION", `${path} device text cannot declare embedded-font state.`);
    if (fontMode === "embedded" && embeddedFont === undefined)
        fail("AUTHORED_CONTENT_EMBEDDED_TEXT_CONFIGURATION_MISSING", `${path} embedded text requires exact font authority.`);
    if (fontMode === "embedded" && useOutlines && rasterization === undefined)
        fail("AUTHORED_CONTENT_OUTLINED_TEXT_RASTERIZATION_MISSING", `${path} outlined text requires exact rasterization authority.`);
    if (fontMode === "embedded" && type !== "dynamic")
        fail("AUTHORED_CONTENT_EMBEDDED_INPUT_UNSUPPORTED", `${path} embedded input text is outside the admitted subset.`);
    const align = requiredString(format.align, `${path}.format.align`);
    if (!new Set(["left", "center", "right", "justify"]).has(align))
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_ALIGN_UNSUPPORTED", `${path}.format.align '${align}' is unsupported.`);
    const color = requiredFiniteNumber(format.color, `${path}.format.color`);
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_COLOR_INVALID", `${path}.format.color must be an RGB integer.`);
    return {
        sourceId,
        type,
        multiline: requiredBoolean(source.multiline, `${path}.multiline`),
        wordWrap: requiredBoolean(source.wordWrap, `${path}.wordWrap`),
        selectable: requiredBoolean(source.selectable, `${path}.selectable`),
        displayAsPassword: requiredBoolean(source.displayAsPassword, `${path}.displayAsPassword`),
        autoSize: exactLiteral(source.autoSize, "none", `${path}.autoSize`),
        html: requiredBoolean(source.html, `${path}.html`),
        useOutlines,
        filters: array(source.filters, `${path}.filters`).map((filter, index) =>
            normalizeGlowFilter(filter, `${path}.filters[${index}]`, scale)),
        gutter: exactLiteral(source.gutter, 2, `${path}.gutter`),
        overflow: exactLiteral(source.overflow, "hidden", `${path}.overflow`),
        initialText: requiredText(source.initialText, `${path}.initialText`),
        ...(rasterization === undefined ? {} : { rasterization }),
        format: {
            fontMode,
            font: requiredString(format.font, `${path}.format.font`),
            size: positiveNumber(format.size, `${path}.format.size`) * scale,
            color,
            bold: requiredBoolean(format.bold, `${path}.format.bold`),
            italic: requiredBoolean(format.italic, `${path}.format.italic`),
            underline: requiredBoolean(format.underline, `${path}.format.underline`),
            align: align as NeutralDynamicTextFormat["align"],
            leftMargin: requiredFiniteNumber(format.leftMargin, `${path}.format.leftMargin`) * scale,
            rightMargin: requiredFiniteNumber(format.rightMargin, `${path}.format.rightMargin`) * scale,
            indent: requiredFiniteNumber(format.indent, `${path}.format.indent`) * scale,
            leading: requiredFiniteNumber(format.leading, `${path}.format.leading`) * scale,
            letterSpacing: (format.letterSpacing === undefined
                ? 0
                : requiredFiniteNumber(format.letterSpacing, `${path}.format.letterSpacing`)) * scale,
            kerning: format.kerning === undefined
                ? false
                : requiredBoolean(format.kerning, `${path}.format.kerning`),
            ...(embeddedFont === undefined ? {} : { embeddedFont }),
        }
    };
}

function normalizeEmbeddedFont(value: unknown, path: string): NeutralEmbeddedFont {
    const source = record(value, path);
    allowedKeys(source, [
        "alignZones", "ascent", "descent", "fontId", "fontStyle", "fontType", "glyphs", "kerning", "leading", "resourceId", "sourceSha256", "unitsPerEm"
    ], path);
    const fontId = requiredFiniteNumber(source.fontId, `${path}.fontId`);
    if (!Number.isSafeInteger(fontId) || fontId <= 0)
        fail("AUTHORED_CONTENT_EMBEDDED_FONT_ID_INVALID", `${path}.fontId must be a positive safe integer.`);
    const fontStyle = requiredString(source.fontStyle, `${path}.fontStyle`);
    if (!new Set(["regular", "bold", "italic", "boldItalic"]).has(fontStyle))
        fail("AUTHORED_CONTENT_EMBEDDED_FONT_STYLE_UNSUPPORTED", `${path}.fontStyle '${fontStyle}' is unsupported.`);
    const unitsPerEm = positiveNumber(source.unitsPerEm, `${path}.unitsPerEm`);
    const ascent = nonnegativeNumber(source.ascent, `${path}.ascent`);
    const descent = nonnegativeNumber(source.descent, `${path}.descent`);
    const leading = requiredFiniteNumber(source.leading, `${path}.leading`);
    const glyphsValue = array(source.glyphs, `${path}.glyphs`);
    if (glyphsValue.length === 0)
        fail("AUTHORED_CONTENT_EMBEDDED_FONT_GLYPHS_MISSING", `${path}.glyphs must not be empty.`);
    let previousCodePoint = -1;
    const glyphs = glyphsValue.map((value, index): NeutralEmbeddedFontGlyph => {
        const glyph = record(value, `${path}.glyphs[${index}]`);
        allowedKeys(glyph, ["advance", "bounds", "codePoint", "index"], `${path}.glyphs[${index}]`);
        if (requiredFiniteNumber(glyph.index, `${path}.glyphs[${index}].index`) !== index)
            fail("AUTHORED_CONTENT_EMBEDDED_FONT_GLYPH_INDEX", `${path}.glyphs indices must be contiguous.`);
        const codePoint = requiredFiniteNumber(glyph.codePoint, `${path}.glyphs[${index}].codePoint`);
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff
            || codePoint >= 0xd800 && codePoint <= 0xdfff)
            fail("AUTHORED_CONTENT_EMBEDDED_FONT_CODE_POINT_INVALID", `${path}.glyphs[${index}].codePoint must be a Unicode scalar value.`);
        if (codePoint <= previousCodePoint)
            fail("AUTHORED_CONTENT_EMBEDDED_FONT_GLYPH_ORDER", `${path}.glyphs must be strictly ordered by code point.`);
        previousCodePoint = codePoint;
        const bounds = record(glyph.bounds, `${path}.glyphs[${index}].bounds`);
        allowedKeys(bounds, ["xmax", "xmin", "ymax", "ymin"], `${path}.glyphs[${index}].bounds`);
        return {
            index,
            codePoint,
            advance: nonnegativeNumber(glyph.advance, `${path}.glyphs[${index}].advance`),
            bounds: {
                xmin: requiredFiniteNumber(bounds.xmin, `${path}.glyphs[${index}].bounds.xmin`),
                xmax: requiredFiniteNumber(bounds.xmax, `${path}.glyphs[${index}].bounds.xmax`),
                ymin: requiredFiniteNumber(bounds.ymin, `${path}.glyphs[${index}].bounds.ymin`),
                ymax: requiredFiniteNumber(bounds.ymax, `${path}.glyphs[${index}].bounds.ymax`),
            },
        };
    });
    const kerning = normalizeEmbeddedFontKerning(source.kerning, `${path}.kerning`);
    const alignZones = normalizeFontAlignZones(source.alignZones, `${path}.alignZones`, glyphs.length);
    return {
        resourceId: canonicalResourceId(requiredString(source.resourceId, `${path}.resourceId`)),
        sourceSha256: sha256(source.sourceSha256, `${path}.sourceSha256`),
        fontId,
        fontType: exactLiteral(source.fontType, "embedded", `${path}.fontType`),
        fontStyle: fontStyle as NeutralEmbeddedFont["fontStyle"],
        unitsPerEm, ascent, descent, leading, glyphs, kerning, alignZones,
    };
}

function normalizeEmbeddedFontKerning(value: unknown, path: string): ReadonlyArray<NeutralEmbeddedFontKerning> {
    let previous = "";
    return array(value, path).map((candidate, index) => {
        const pair = record(candidate, `${path}[${index}]`);
        allowedKeys(pair, ["adjustment", "leftCodePoint", "rightCodePoint"], `${path}[${index}]`);
        const leftCodePoint = unicodeScalar(pair.leftCodePoint, `${path}[${index}].leftCodePoint`);
        const rightCodePoint = unicodeScalar(pair.rightCodePoint, `${path}[${index}].rightCodePoint`);
        const key = `${leftCodePoint.toString().padStart(7, "0")}:${rightCodePoint.toString().padStart(7, "0")}`;
        if (key <= previous)
            fail("AUTHORED_CONTENT_EMBEDDED_FONT_KERNING_ORDER", `${path} must be unique and sorted by code-point pair.`);
        previous = key;
        return { leftCodePoint, rightCodePoint, adjustment: requiredFiniteNumber(pair.adjustment, `${path}[${index}].adjustment`) };
    });
}

function normalizeFontAlignZones(value: unknown, path: string, glyphCount: number): NeutralFontAlignZones {
    const source = record(value, path);
    allowedKeys(source, ["tableHint", "tableHintName", "zones"], path);
    const zones = array(source.zones, `${path}.zones`).map((candidate, index): NeutralFontAlignZone => {
        const zone = record(candidate, `${path}.zones[${index}]`);
        allowedKeys(zone, ["data", "maskX", "maskY"], `${path}.zones[${index}]`);
        const values = array(zone.data, `${path}.zones[${index}].data`);
        if (values.length !== 2)
            fail("AUTHORED_CONTENT_FONT_ALIGN_ZONE_DATA_COUNT", `${path}.zones[${index}].data must contain X and Y records.`);
        const data = values.map((datumValue, dataIndex): NeutralFontAlignZoneData => {
            const datum = record(datumValue, `${path}.zones[${index}].data[${dataIndex}]`);
            allowedKeys(datum, ["alignmentCoordinate", "alignmentCoordinateBits", "range", "rangeBits"], `${path}.zones[${index}].data[${dataIndex}]`);
            const alignmentCoordinateBits = uint16(datum.alignmentCoordinateBits, `${path}.zones[${index}].data[${dataIndex}].alignmentCoordinateBits`);
            const rangeBits = uint16(datum.rangeBits, `${path}.zones[${index}].data[${dataIndex}].rangeBits`);
            return {
                alignmentCoordinate: nonnegativeNumber(datum.alignmentCoordinate, `${path}.zones[${index}].data[${dataIndex}].alignmentCoordinate`),
                alignmentCoordinateBits,
                range: nonnegativeNumber(datum.range, `${path}.zones[${index}].data[${dataIndex}].range`),
                rangeBits,
            };
        }) as [NeutralFontAlignZoneData, NeutralFontAlignZoneData];
        return { data, maskX: requiredBoolean(zone.maskX, `${path}.zones[${index}].maskX`), maskY: requiredBoolean(zone.maskY, `${path}.zones[${index}].maskY`) };
    });
    if (zones.length !== glyphCount)
        fail("AUTHORED_CONTENT_FONT_ALIGN_ZONE_COUNT", `${path}.zones must match the glyph count.`);
    return {
        tableHint: exactLiteral(source.tableHint, 1, `${path}.tableHint`),
        tableHintName: exactLiteral(source.tableHintName, "medium", `${path}.tableHintName`),
        zones,
    };
}

function normalizeAdvancedTextRasterization(value: unknown, path: string): NeutralAdvancedTextRasterization {
    const source = record(value, path);
    allowedKeys(source, ["antiAliasType", "gridFitType", "sharpness", "thickness"], path);
    const sharpness = requiredFiniteNumber(source.sharpness, `${path}.sharpness`);
    const thickness = requiredFiniteNumber(source.thickness, `${path}.thickness`);
    if (sharpness < -400 || sharpness > 400)
        fail("AUTHORED_CONTENT_TEXT_SHARPNESS_RANGE", `${path}.sharpness must be from -400 through 400.`);
    if (thickness < -200 || thickness > 200)
        fail("AUTHORED_CONTENT_TEXT_THICKNESS_RANGE", `${path}.thickness must be from -200 through 200.`);
    return {
        antiAliasType: exactLiteral(source.antiAliasType, "advanced", `${path}.antiAliasType`),
        gridFitType: exactLiteral(source.gridFitType, "subpixel", `${path}.gridFitType`),
        sharpness,
        thickness,
    };
}

function normalizeMatrix(value: unknown, path: string): NeutralAuthoredMatrix {
    const source = record(value, path);
    allowedKeys(source, ["a", "b", "c", "d"], path);
    return {
        a: requiredFiniteNumber(source.a, `${path}.a`),
        b: requiredFiniteNumber(source.b, `${path}.b`),
        c: requiredFiniteNumber(source.c, `${path}.c`),
        d: requiredFiniteNumber(source.d, `${path}.d`),
    };
}

function normalizeGlowFilter(value: unknown, path: string, scale: number): NeutralGlowFilter {
    const source = record(value, path);
    allowedKeys(source, ["alpha", "blurX", "blurY", "color", "inner", "kind", "knockout", "quality", "strength"], path);
    const color = requiredFiniteNumber(source.color, `${path}.color`);
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
        fail("AUTHORED_CONTENT_GLOW_FILTER_COLOR_INVALID", `${path}.color must be an RGB integer.`);
    const alpha = requiredFiniteNumber(source.alpha, `${path}.alpha`);
    if (alpha < 0 || alpha > 1)
        fail("AUTHORED_CONTENT_GLOW_FILTER_ALPHA_INVALID", `${path}.alpha must be between zero and one.`);
    const blurX = requiredFiniteNumber(source.blurX, `${path}.blurX`);
    const blurY = requiredFiniteNumber(source.blurY, `${path}.blurY`);
    if (blurX < 0 || blurX > 255 || blurY < 0 || blurY > 255)
        fail("AUTHORED_CONTENT_GLOW_FILTER_BLUR_INVALID", `${path} blur dimensions must be between zero and 255.`);
    const strength = requiredFiniteNumber(source.strength, `${path}.strength`);
    if (strength < 0 || strength > 255)
        fail("AUTHORED_CONTENT_GLOW_FILTER_STRENGTH_INVALID", `${path}.strength must be between zero and 255.`);
    const quality = requiredFiniteNumber(source.quality, `${path}.quality`);
    if (!Number.isInteger(quality) || quality < 1 || quality > 15)
        fail("AUTHORED_CONTENT_GLOW_FILTER_QUALITY_INVALID", `${path}.quality must be an integer from one through 15.`);
    return {
        kind: exactLiteral(source.kind, "glow", `${path}.kind`),
        color, alpha, blurX: blurX * scale, blurY: blurY * scale, strength, quality,
        inner: requiredBoolean(source.inner, `${path}.inner`),
        knockout: requiredBoolean(source.knockout, `${path}.knockout`),
    };
}

function normalizeSiblings(values: ReadonlyArray<unknown>, path: string, scale: number): ReadonlyArray<NeutralAuthoredNode> {
    const explicitDepthCount = values.filter(value => record(value, path).depth !== undefined).length;
    if (explicitDepthCount !== 0 && explicitDepthCount !== values.length)
        fail("AUTHORED_CONTENT_MIXED_DEPTH_AUTHORITY", `${path} must either declare every sibling depth or preserve source order for every sibling.`);
    const instanceOwners = new Map<string, string>();
    const nativeNameOwners = new Map<string, string>();
    const depthOwners = new Map<number, string>();
    const nodes = values.map((value, index) => {
        const source = record(value, `${path}[${index}]`);
        const rawLinkage = requiredString(source.linkage, `${path}[${index}].linkage`);
        const rawInstanceId = source.instanceId === undefined
            ? rawLinkage
            : requiredString(source.instanceId, `${path}[${index}].instanceId`);
        const instanceKey = canonicalLinkage(rawInstanceId).toLocaleLowerCase("en-US");
        const previousInstance = instanceOwners.get(instanceKey);
        if (previousInstance !== undefined)
            fail("AUTHORED_CONTENT_INSTANCE_ID_COLLISION", `'${rawInstanceId}' duplicates or normalizes to the same sibling placement ID as '${previousInstance}'.`);
        instanceOwners.set(instanceKey, rawInstanceId);
        const rawInstanceName = source.name === undefined
            ? rawInstanceId
            : requiredString(source.name, `${path}[${index}].name`);
        const nativeNameKey = canonicalLinkage(rawInstanceName).toLocaleLowerCase("en-US");
        const previousNativeName = nativeNameOwners.get(nativeNameKey);
        if (previousNativeName !== undefined)
            fail("AUTHORED_CONTENT_INSTANCE_NAME_COLLISION", `'${rawInstanceName}' duplicates or normalizes to the same sibling native name as '${previousNativeName}'.`);
        nativeNameOwners.set(nativeNameKey, rawInstanceName);
        const node = normalizeNode(value, `${path}[${index}]`, scale);
        const depth = node.depth ?? index + 1;
        const previousDepth = depthOwners.get(depth);
        if (previousDepth !== undefined)
            fail("AUTHORED_CONTENT_DEPTH_COLLISION", `${path} depth ${depth} is shared by '${previousDepth}' and '${rawInstanceId}'.`);
        depthOwners.set(depth, rawInstanceId);
        return { ...node, depth };
    });
    return nodes.sort((left, right) => left.depth! - right.depth!);
}

function normalizeResources(value: unknown): ReadonlyArray<NeutralAuthoredResource> {
    const ids = new Set<string>();
    const paths = new Set<string>();
    return array(value, "resources").map((entry, index) => {
        const path = `resources[${index}]`;
        const source = record(entry, path);
        allowedKeys(source, ["id", "sourcePath", "mediaType", "byteLength", "sha256"], path);
        const id = canonicalResourceId(requiredString(source.id, `${path}.id`));
        if (ids.has(id))
            fail("AUTHORED_CONTENT_RESOURCE_ID_COLLISION", `Resource '${id}' is duplicated.`);
        ids.add(id);
        const sourcePath = canonicalRelativePath(requiredString(source.sourcePath, `${path}.sourcePath`), `${path}.sourcePath`);
        const foldedPath = sourcePath.toLocaleLowerCase("en-US");
        if (paths.has(foldedPath))
            fail("AUTHORED_CONTENT_RESOURCE_PATH_COLLISION", `Resource source path '${sourcePath}' is duplicated.`);
        paths.add(foldedPath);
        const mediaType = requiredString(source.mediaType, `${path}.mediaType`);
        if (!RESOURCE_MEDIA_TYPES.has(mediaType))
            fail("AUTHORED_CONTENT_RESOURCE_MEDIA_UNSUPPORTED", `${path}.mediaType '${mediaType}' is unsupported.`);
        const expectedExtension = mediaType === "image/png" ? ".png" : mediaType === "font/ttf" ? ".ttf" : ".jpg";
        if (!sourcePath.toLocaleLowerCase("en-US").endsWith(expectedExtension)
            && !(mediaType === "image/jpeg" && sourcePath.toLocaleLowerCase("en-US").endsWith(".jpeg")))
            fail("AUTHORED_CONTENT_RESOURCE_EXTENSION_MISMATCH", `${path}.sourcePath does not match ${mediaType}.`);
        const byteLength = requiredFiniteNumber(source.byteLength, `${path}.byteLength`);
        if (!Number.isSafeInteger(byteLength) || byteLength <= 0)
            fail("AUTHORED_CONTENT_RESOURCE_SIZE_INVALID", `${path}.byteLength must be a positive safe integer.`);
        const sha256 = requiredString(source.sha256, `${path}.sha256`);
        if (!/^[0-9a-f]{64}$/.test(sha256))
            fail("AUTHORED_CONTENT_RESOURCE_HASH_INVALID", `${path}.sha256 must be a lowercase SHA-256 digest.`);
        return {
            id,
            sourcePath,
            mediaType: mediaType as NeutralAuthoredMediaType,
            byteLength,
            sha256,
            outputPath: `resources/${id}${expectedExtension}`
        };
    }).sort((left, right) => compareText(left.id, right.id));
}

function validateResourceClosure(root: NeutralAuthoredNode, resources: ReadonlyArray<NeutralAuthoredResource>): void {
    const declared = new Set(resources.map(resource => resource.id));
    const referenced = new Set<string>();
    const visit = (node: NeutralAuthoredNode) => {
        if (node.kind === "image") {
            if (!declared.has(node.resourceId!))
                fail("AUTHORED_CONTENT_IMAGE_RESOURCE_UNKNOWN", `Image '${node.name ?? node.linkage}' references unknown resource '${node.resourceId}'.`);
            referenced.add(node.resourceId!);
        }
        const embeddedFont = node.textField?.format.embeddedFont;
        if (embeddedFont !== undefined) {
            const resource = resources.find(candidate => candidate.id === embeddedFont.resourceId);
            if (!resource)
                fail("AUTHORED_CONTENT_EMBEDDED_FONT_RESOURCE_UNKNOWN", `Text '${node.name ?? node.linkage}' references unknown font resource '${embeddedFont.resourceId}'.`);
            if (resource.mediaType !== "font/ttf")
                fail("AUTHORED_CONTENT_EMBEDDED_FONT_RESOURCE_MEDIA_MISMATCH", `Text '${node.name ?? node.linkage}' font resource '${embeddedFont.resourceId}' is not TrueType.`);
            if (resource.sha256 !== embeddedFont.sourceSha256)
                fail("AUTHORED_CONTENT_EMBEDDED_FONT_RESOURCE_IDENTITY_MISMATCH", `Text '${node.name ?? node.linkage}' font digest does not match resource '${embeddedFont.resourceId}'.`);
            referenced.add(embeddedFont.resourceId);
        }
        node.children.forEach(visit);
    };
    visit(root);
    const unreferenced = resources.filter(resource => !referenced.has(resource.id));
    if (unreferenced.length !== 0)
        fail("AUTHORED_CONTENT_RESOURCE_UNREFERENCED", `Unreferenced resources: ${unreferenced.map(resource => resource.id).join(", ")}.`);
}

function normalizeTimeline(value: unknown, scale: number, nodePaths: ReadonlySet<string>): NeutralTimeline {
    const source = record(value, "timeline");
    allowedKeys(source, ["frameRate", "duration", "loop", "frameLabels", "tracks"], "timeline");
    const frameRate = requiredFiniteNumber(source.frameRate, "timeline.frameRate");
    const duration = requiredFiniteNumber(source.duration, "timeline.duration");
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 0x7fff)
        fail("AUTHORED_CONTENT_FRAME_RATE_RANGE", "Frame rate must be an integer from 1 through 32767 for the signed native parser field.");
    if (duration < 0)
        fail("AUTHORED_CONTENT_TIMELINE_RANGE", "Timeline duration cannot be negative.");
    const loop = requiredBoolean(source.loop, "timeline.loop");
    const frameLabels = normalizeFrameLabels(source.frameLabels ?? {}, Math.round(duration * frameRate));
    const trackKeys = new Set<string>();
    const tracks = array(source.tracks, "timeline.tracks").map((value2, index) => {
        const trackSource = record(value2, `timeline.tracks[${index}]`);
        allowedKeys(trackSource, ["targetPath", "property", "keyframes"], `timeline.tracks[${index}]`);
        const targetPath = array(trackSource.targetPath, `timeline.tracks[${index}].targetPath`)
            .map((segment, segmentIndex) => canonicalLinkage(requiredString(segment, `timeline.tracks[${index}].targetPath[${segmentIndex}]`)));
        const joinedPath = targetPath.join("/");
        if (!nodePaths.has(joinedPath))
            fail("AUTHORED_CONTENT_TIMELINE_TARGET_MISSING", `Timeline target '${joinedPath}' does not exist.`);
        const property = requiredString(trackSource.property, `timeline.tracks[${index}].property`);
        if (!TIMELINE_PROPERTIES.has(property))
            fail("AUTHORED_CONTENT_TIMELINE_PROPERTY_UNSUPPORTED", `Timeline property '${property}' is unsupported.`);
        const trackKey = `${joinedPath}\0${property}`;
        if (trackKeys.has(trackKey))
            fail("AUTHORED_CONTENT_DUPLICATE_TRACK", `Timeline track '${joinedPath}.${property}' is duplicated.`);
        trackKeys.add(trackKey);

        const times = new Set<number>();
        const keyframes = array(trackSource.keyframes, `timeline.tracks[${index}].keyframes`).map((value3, keyIndex) => {
            const keySource = record(value3, `timeline.tracks[${index}].keyframes[${keyIndex}]`);
            allowedKeys(keySource, ["time", "value", "tweenType"], `timeline.tracks[${index}].keyframes[${keyIndex}]`);
            const time = requiredFiniteNumber(keySource.time, `timeline.tracks[${index}].keyframes[${keyIndex}].time`);
            if (time < 0 || time > duration || times.has(time))
                fail("AUTHORED_CONTENT_KEYFRAME_TIME_INVALID", `Keyframe time '${time}' is outside the timeline or duplicated.`);
            times.add(time);
            let keyValue = keySource.value;
            if (property === "visible") {
                if (typeof keyValue !== "boolean")
                    fail("AUTHORED_CONTENT_KEYFRAME_TYPE_INVALID", "Visible keyframes require boolean values.");
            }
            else {
                keyValue = requiredFiniteNumber(keyValue, `timeline.tracks[${index}].keyframes[${keyIndex}].value`);
                if (SCALED_TRACK_PROPERTIES.has(property))
                    keyValue *= scale;
            }
            return {
                time,
                value: keyValue as NeutralKeyframeValue,
                tweenType: optionalString(keySource.tweenType, `timeline.tracks[${index}].keyframes[${keyIndex}].tweenType`)
            };
        }).sort((a, b) => a.time - b.time);
        if (keyframes.length === 0)
            fail("AUTHORED_CONTENT_EMPTY_TRACK", `Timeline track '${joinedPath}.${property}' has no keyframes.`);
        return { targetPath, property: property as NeutralTimelineProperty, keyframes };
    }).sort((a, b) => `${a.targetPath.join("/")}.${a.property}`.localeCompare(`${b.targetPath.join("/")}.${b.property}`));
    return { frameRate, duration, loop, frameLabels, tracks };
}

function normalizeFrameLabels(value: unknown, totalFrames: number): Readonly<Record<string, number>> {
    const source = record(value, "timeline.frameLabels");
    const result: Record<string, number> = {};
    for (const label of Object.keys(source).sort(compareText)) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/.test(label))
            fail("AUTHORED_CONTENT_FRAME_LABEL_INVALID", `Frame label '${label}' is not a stable identifier.`);
        const frame = requiredFiniteNumber(source[label], `timeline.frameLabels.${label}`);
        if (!Number.isSafeInteger(frame) || frame < 1 || frame > totalFrames)
            fail("AUTHORED_CONTENT_FRAME_LABEL_RANGE", `Frame label '${label}' points outside 1..${totalFrames}.`);
        Object.defineProperty(result, label, { value: frame, enumerable: true });
    }
    return Object.freeze(result);
}

function collectNodePaths(root: NeutralAuthoredNode): ReadonlySet<string> {
    const paths = new Set<string>();
    const visit = (node: NeutralAuthoredNode, parent: ReadonlyArray<string>) => {
        const path = [...parent, node.instanceId ?? node.linkage];
        paths.add(path.join("/"));
        node.children.forEach(child => visit(child, path));
    };
    visit(root, []);
    return paths;
}

function canonicalLinkage(value: string): string {
    const normalized = value.trim().normalize("NFC");
    if (!/^[A-Za-z0-9_.:$-]+$/.test(normalized))
        fail("AUTHORED_CONTENT_LINKAGE_INVALID", `Linkage '${value}' contains unsupported characters.`);
    return normalized;
}

function canonicalRuntimeLinkage(value: string): string {
    const normalized = value.trim().normalize("NFC");
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(normalized)
        || normalized === "flash" || normalized.startsWith("flash.")
        || normalized === "laya" || normalized.startsWith("laya.")
        || normalized === "Laya" || normalized.startsWith("Laya."))
        fail("AUTHORED_CONTENT_RUNTIME_LINKAGE_INVALID", `Runtime linkage '${value}' is not application-owned.`);
    return normalized;
}

function canonicalResourceId(value: string): string {
    const normalized = value.trim().normalize("NFC");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(normalized))
        fail("AUTHORED_CONTENT_RESOURCE_ID_INVALID", `Resource id '${value}' is invalid.`);
    return normalized;
}

function canonicalRelativePath(value: string, path: string): string {
    const normalized = value.normalize("NFC");
    if (normalized.includes("\\") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
        || normalized.includes("\0") || normalized.split("/").some(segment => segment === "" || segment === "." || segment === ".."))
        fail("AUTHORED_CONTENT_RESOURCE_PATH_INVALID", `${path} must be a normalized relative POSIX path.`);
    return normalized;
}

function stableLabel(value: unknown, path: string): string {
    const label = requiredString(value, path).trim().normalize("NFC");
    if (label.length === 0 || label.indexOf("\0") >= 0)
        fail("AUTHORED_CONTENT_ID_INVALID", `${path} must be a stable non-empty label.`);
    return label;
}

function record(value: unknown, path: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("AUTHORED_CONTENT_OBJECT_REQUIRED", `${path} must be an object.`);
    return value as Record<string, any>;
}

function allowedKeys(source: Record<string, any>, allowed: ReadonlyArray<string>, path: string): void {
    const keys = new Set(allowed);
    const unsupported = Object.keys(source).filter(key => !keys.has(key)).sort(compareText);
    if (unsupported.length !== 0)
        fail("AUTHORED_CONTENT_FIELD_UNSUPPORTED", `${path} contains unsupported fields: ${unsupported.join(", ")}.`);
}

function array(value: unknown, path: string): any[] {
    if (!Array.isArray(value))
        fail("AUTHORED_CONTENT_ARRAY_REQUIRED", `${path} must be an array.`);
    return value;
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0)
        fail("AUTHORED_CONTENT_STRING_REQUIRED", `${path} must be a non-empty string.`);
    return value;
}

function requiredText(value: unknown, path: string): string {
    if (typeof value !== "string")
        fail("AUTHORED_CONTENT_STRING_REQUIRED", `${path} must be a string.`);
    return value;
}

function positiveNumber(value: unknown, path: string): number {
    const result = requiredFiniteNumber(value, path);
    if (result <= 0)
        fail("AUTHORED_CONTENT_POSITIVE_NUMBER_REQUIRED", `${path} must be positive.`);
    return result;
}

function nonnegativeNumber(value: unknown, path: string): number {
    const result = requiredFiniteNumber(value, path);
    if (result < 0)
        fail("AUTHORED_CONTENT_NONNEGATIVE_NUMBER_REQUIRED", `${path} must be nonnegative.`);
    return result;
}

function exactLiteral<T extends string | number | boolean>(value: unknown, expected: T, path: string): T {
    if (value !== expected)
        fail("AUTHORED_CONTENT_LITERAL_REQUIRED", `${path} must be ${String(expected)}.`);
    return expected;
}

function optionalString(value: unknown, path: string): string | undefined {
    if (value === undefined)
        return undefined;
    return requiredString(value, path);
}

function requiredFiniteNumber(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        fail("AUTHORED_CONTENT_NUMBER_REQUIRED", `${path} must be a finite number.`);
    return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
    const result = requiredFiniteNumber(value, path);
    if (!Number.isSafeInteger(result) || result < 1)
        fail("AUTHORED_CONTENT_POSITIVE_INTEGER_REQUIRED", `${path} must be a positive safe integer.`);
    return result;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
    const result = requiredFiniteNumber(value, path);
    if (!Number.isSafeInteger(result) || result < 0)
        fail("AUTHORED_CONTENT_NON_NEGATIVE_INTEGER_REQUIRED", `${path} must be a non-negative safe integer.`);
    return result;
}

function sha256(value: unknown, path: string): string {
    const result = requiredString(value, path);
    if (!/^[0-9a-f]{64}$/.test(result))
        fail("AUTHORED_CONTENT_SHA256_REQUIRED", `${path} must be a lowercase SHA-256 digest.`);
    return result;
}

function unicodeScalar(value: unknown, path: string): number {
    const result = requiredFiniteNumber(value, path);
    if (!Number.isInteger(result) || result < 0 || result > 0x10ffff
        || result >= 0xd800 && result <= 0xdfff)
        fail("AUTHORED_CONTENT_UNICODE_SCALAR_REQUIRED", `${path} must be a Unicode scalar value.`);
    return result;
}

function uint16(value: unknown, path: string): number {
    const result = requiredFiniteNumber(value, path);
    if (!Number.isInteger(result) || result < 0 || result > 0xffff)
        fail("AUTHORED_CONTENT_UINT16_REQUIRED", `${path} must be a uint16 value.`);
    return result;
}

function optionalNumber(value: unknown, path: string, scale = 1): number | undefined {
    if (value === undefined)
        return undefined;
    const numberValue = requiredFiniteNumber(value, path);
    return SCALED_NODE_PROPERTIES.has(path.slice(path.lastIndexOf(".") + 1)) ? numberValue * scale : numberValue;
}

function optionalDepth(value: unknown, path: string): number | undefined {
    if (value === undefined)
        return undefined;
    const depth = requiredFiniteNumber(value, path);
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > 0xffff)
        fail("AUTHORED_CONTENT_DEPTH_RANGE", `${path} must be an integer from 1 through 65535.`);
    return depth;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
    if (value === undefined)
        return undefined;
    if (typeof value !== "boolean")
        fail("AUTHORED_CONTENT_BOOLEAN_REQUIRED", `${path} must be a boolean.`);
    return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
    const result = optionalBoolean(value, path);
    if (result === undefined)
        fail("AUTHORED_CONTENT_BOOLEAN_REQUIRED", `${path} must be a boolean.`);
    return result;
}

function fail(code: string, message: string): never {
    throw new Error(`${code}: ${message}`);
}
