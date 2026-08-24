export const NEUTRAL_AUTHORED_CONTENT_SCHEMA = "neutral-authored-content@1" as const;

export type NeutralNodeKind = "container" | "dynamic-text" | "image" | "text";
export type NeutralImageMediaType = "image/jpeg" | "image/png";
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
    readonly linkage: string;
    readonly kind: NeutralNodeKind;
    /** Native node name and generated-accessor name; defaults to linkage. */
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
    readonly html: false;
    readonly filters: ReadonlyArray<NeutralGlowFilter>;
    readonly gutter: 2;
    readonly overflow: "hidden";
    readonly initialText: string;
    readonly format: NeutralDynamicTextFormat;
}

export interface NeutralDynamicTextFormat {
    readonly fontMode: "device";
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
}

export interface NeutralAuthoredResource {
    readonly id: string;
    /** Normalized path relative to the immutable authored-content manifest. */
    readonly sourcePath: string;
    readonly mediaType: NeutralImageMediaType;
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
}

const NODE_KINDS: ReadonlySet<string> = new Set(["container", "dynamic-text", "image", "text"]);
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);
const TIMELINE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "scaleX", "scaleY", "rotation", "alpha", "visible"]);
const SCALED_NODE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "width", "height", "fontSize"]);
const SCALED_TRACK_PROPERTIES: ReadonlySet<string> = new Set(["x", "y"]);

/** Validates untrusted adapter output and returns a deterministic normalized IR. */
export function normalizeNeutralAuthoredContent(input: unknown, scale = 1): NeutralAuthoredContentIR {
    const source = record(input, "document");
    allowedKeys(source, ["schema", "documentId", "resources", "root", "timeline", "stage", "controller"], "document");
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
    };
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
        "linkage", "kind", "name", "depth", "x", "y", "width", "height", "alpha", "visible", "matrix",
        "filters", "scale9Grid", "text", "fontSize", "color", "resourceId", "runtimeLinkage", "variable", "textField", "timeline", "children"
    ], path);
    const rawLinkage = requiredString(source.linkage, `${path}.linkage`);
    const linkage = canonicalLinkage(rawLinkage);

    const kind = requiredString(source.kind, `${path}.kind`);
    if (!NODE_KINDS.has(kind))
        fail("AUTHORED_CONTENT_NODE_KIND_UNSUPPORTED", `${path}.kind '${kind}' is unsupported.`);

    const node: NeutralAuthoredNode = {
        linkage,
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
        const targets = node.children.filter(child => (child.name ?? child.linkage) === node.scale9Grid!.target);
        if (targets.length !== 1 || targets[0].kind !== "image")
            fail("AUTHORED_CONTENT_SCALE9_GRID_RASTER_TARGET_INVALID", `${path}.scale9Grid must identify one direct image child.`);
    }
    if (node.kind === "dynamic-text") {
        if (node.x === undefined || node.y === undefined || node.width === undefined || node.height === undefined)
            fail("AUTHORED_CONTENT_DYNAMIC_TEXT_BOUNDS_MISSING", `${path} requires exact x, y, width, and height.`);
    }
    if (node.kind !== "container" && node.children.length !== 0)
        fail("AUTHORED_CONTENT_LEAF_CHILDREN_UNSUPPORTED", `${path} ${node.kind} nodes cannot contain children.`);
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
        "overflow", "selectable", "sourceId", "type", "wordWrap"
    ], path);
    const format = record(source.format, `${path}.format`);
    allowedKeys(format, [
        "align", "bold", "color", "font", "fontMode", "indent", "italic", "leading", "leftMargin",
        "rightMargin", "size", "underline"
    ], `${path}.format`);
    const sourceId = requiredFiniteNumber(source.sourceId, `${path}.sourceId`);
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0)
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_SOURCE_ID_INVALID", `${path}.sourceId must be a positive safe integer.`);
    const type = requiredString(source.type, `${path}.type`);
    if (type !== "dynamic" && type !== "input")
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_TYPE_UNSUPPORTED", `${path}.type '${type}' is unsupported.`);
    const fontMode = requiredString(format.fontMode, `${path}.format.fontMode`);
    if (fontMode !== "device")
        fail("AUTHORED_CONTENT_DYNAMIC_TEXT_FONT_MODE_UNSUPPORTED", `${path}.format.fontMode '${fontMode}' is unsupported.`);
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
        html: exactLiteral(source.html, false, `${path}.html`),
        filters: array(source.filters, `${path}.filters`).map((filter, index) =>
            normalizeGlowFilter(filter, `${path}.filters[${index}]`, scale)),
        gutter: exactLiteral(source.gutter, 2, `${path}.gutter`),
        overflow: exactLiteral(source.overflow, "hidden", `${path}.overflow`),
        initialText: requiredText(source.initialText, `${path}.initialText`),
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
        }
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
    const linkageOwners = new Map<string, string>();
    const instanceOwners = new Map<string, string>();
    const depthOwners = new Map<number, string>();
    const nodes = values.map((value, index) => {
        const source = record(value, `${path}[${index}]`);
        const rawLinkage = requiredString(source.linkage, `${path}[${index}].linkage`);
        const collisionKey = canonicalLinkage(rawLinkage).toLocaleLowerCase("en-US");
        const previous = linkageOwners.get(collisionKey);
        if (previous !== undefined)
            fail("AUTHORED_CONTENT_LINKAGE_COLLISION", `'${rawLinkage}' duplicates or normalizes to the same sibling semantic ID as '${previous}'.`);
        linkageOwners.set(collisionKey, rawLinkage);
        const rawInstanceName = source.name === undefined
            ? rawLinkage
            : requiredString(source.name, `${path}[${index}].name`);
        const instanceKey = canonicalLinkage(rawInstanceName).toLocaleLowerCase("en-US");
        const previousInstance = instanceOwners.get(instanceKey);
        if (previousInstance !== undefined)
            fail("AUTHORED_CONTENT_INSTANCE_NAME_COLLISION", `'${rawInstanceName}' duplicates or normalizes to the same sibling native name as '${previousInstance}'.`);
        instanceOwners.set(instanceKey, rawInstanceName);
        const node = normalizeNode(value, `${path}[${index}]`, scale);
        const depth = node.depth ?? index + 1;
        const previousDepth = depthOwners.get(depth);
        if (previousDepth !== undefined)
            fail("AUTHORED_CONTENT_DEPTH_COLLISION", `${path} depth ${depth} is shared by '${previousDepth}' and '${rawInstanceName}'.`);
        depthOwners.set(depth, rawInstanceName);
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
        if (!IMAGE_MEDIA_TYPES.has(mediaType))
            fail("AUTHORED_CONTENT_RESOURCE_MEDIA_UNSUPPORTED", `${path}.mediaType '${mediaType}' is unsupported.`);
        const expectedExtension = mediaType === "image/png" ? ".png" : ".jpg";
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
            mediaType: mediaType as NeutralImageMediaType,
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
        node.children.forEach(visit);
    };
    visit(root);
    const unreferenced = resources.filter(resource => !referenced.has(resource.id));
    if (unreferenced.length !== 0)
        fail("AUTHORED_CONTENT_RESOURCE_UNREFERENCED", `Unreferenced resources: ${unreferenced.map(resource => resource.id).join(", ")}.`);
}

function normalizeTimeline(value: unknown, scale: number, nodePaths: ReadonlySet<string>): NeutralTimeline {
    const source = record(value, "timeline");
    allowedKeys(source, ["frameRate", "duration", "loop", "tracks"], "timeline");
    const frameRate = requiredFiniteNumber(source.frameRate, "timeline.frameRate");
    const duration = requiredFiniteNumber(source.duration, "timeline.duration");
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 0x7fff)
        fail("AUTHORED_CONTENT_FRAME_RATE_RANGE", "Frame rate must be an integer from 1 through 32767 for the signed native parser field.");
    if (duration < 0)
        fail("AUTHORED_CONTENT_TIMELINE_RANGE", "Timeline duration cannot be negative.");
    const loop = requiredBoolean(source.loop, "timeline.loop");
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
    return { frameRate, duration, loop, tracks };
}

function collectNodePaths(root: NeutralAuthoredNode): ReadonlySet<string> {
    const paths = new Set<string>();
    const visit = (node: NeutralAuthoredNode, parent: ReadonlyArray<string>) => {
        const path = [...parent, node.linkage];
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
