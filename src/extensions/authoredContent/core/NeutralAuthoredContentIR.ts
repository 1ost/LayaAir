export const NEUTRAL_AUTHORED_CONTENT_SCHEMA = "neutral-authored-content@1" as const;

export type NeutralNodeKind = "container" | "text";
export type NeutralTimelineProperty = "x" | "y" | "scaleX" | "scaleY" | "rotation" | "alpha" | "visible";
export type NeutralKeyframeValue = number | boolean;

export interface NeutralAuthoredNode {
    readonly linkage: string;
    readonly kind: NeutralNodeKind;
    /** Native node name and generated-accessor name; defaults to linkage. */
    readonly name?: string;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly alpha?: number;
    readonly visible?: boolean;
    readonly text?: string;
    readonly fontSize?: number;
    readonly color?: string;
    readonly children: ReadonlyArray<NeutralAuthoredNode>;
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

export interface NeutralAuthoredContentIR {
    readonly schema: typeof NEUTRAL_AUTHORED_CONTENT_SCHEMA;
    readonly documentId: string;
    readonly root: NeutralAuthoredNode;
    readonly timeline: NeutralTimeline;
}

const NODE_KINDS: ReadonlySet<string> = new Set(["container", "text"]);
const TIMELINE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "scaleX", "scaleY", "rotation", "alpha", "visible"]);
const SCALED_NODE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "width", "height", "fontSize"]);
const SCALED_TRACK_PROPERTIES: ReadonlySet<string> = new Set(["x", "y"]);

/** Validates untrusted adapter output and returns a deterministic normalized IR. */
export function normalizeNeutralAuthoredContent(input: unknown, scale = 1): NeutralAuthoredContentIR {
    const source = record(input, "document");
    if ("controller" in source)
        fail("AUTHORED_CONTENT_CONTROLLER_CAPTURE_REQUIRED", "Animation-controller capture is not implemented.");
    if (source.schema !== NEUTRAL_AUTHORED_CONTENT_SCHEMA)
        fail("AUTHORED_CONTENT_SCHEMA_UNSUPPORTED", `Expected '${NEUTRAL_AUTHORED_CONTENT_SCHEMA}'.`);
    if (!Number.isFinite(scale) || scale <= 0)
        fail("AUTHORED_CONTENT_INVALID_SCALE", "Import scale must be a positive finite number.");

    const documentId = stableLabel(source.documentId, "documentId");
    const root = normalizeNode(source.root, "root", scale);
    const nodePaths = collectNodePaths(root);
    const timeline = normalizeTimeline(source.timeline, scale, nodePaths);
    return { schema: NEUTRAL_AUTHORED_CONTENT_SCHEMA, documentId, root, timeline };
}

function normalizeNode(
    value: unknown,
    path: string,
    scale: number
): NeutralAuthoredNode {
    const source = record(value, path);
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
        x: optionalNumber(source.x, `${path}.x`, scale),
        y: optionalNumber(source.y, `${path}.y`, scale),
        width: optionalNumber(source.width, `${path}.width`, scale),
        height: optionalNumber(source.height, `${path}.height`, scale),
        alpha: optionalNumber(source.alpha, `${path}.alpha`),
        visible: optionalBoolean(source.visible, `${path}.visible`),
        text: optionalString(source.text, `${path}.text`),
        fontSize: optionalNumber(source.fontSize, `${path}.fontSize`, scale),
        color: optionalString(source.color, `${path}.color`),
        children: normalizeSiblings(array(source.children, `${path}.children`), `${path}.children`, scale)
    };
    if (node.kind === "text" && node.text === undefined)
        fail("AUTHORED_CONTENT_TEXT_MISSING", `${path}.text is required for a text node.`);
    return node;
}

function normalizeSiblings(values: ReadonlyArray<unknown>, path: string, scale: number): ReadonlyArray<NeutralAuthoredNode> {
    const linkageOwners = new Map<string, string>();
    const instanceOwners = new Map<string, string>();
    return values.map((value, index) => {
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
        return normalizeNode(value, `${path}[${index}]`, scale);
    });
}

function normalizeTimeline(value: unknown, scale: number, nodePaths: ReadonlySet<string>): NeutralTimeline {
    const source = record(value, "timeline");
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
