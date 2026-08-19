export const NEUTRAL_AUTHORED_CONTENT_SCHEMA = "neutral-authored-content@1" as const;

export type NeutralNodeKind = "container" | "image" | "text";
export type NeutralImageMediaType = "image/jpeg" | "image/png";
export type NeutralTimelineProperty = "x" | "y" | "scaleX" | "scaleY" | "rotation" | "alpha" | "visible";
export type NeutralKeyframeValue = number | boolean;

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
    readonly text?: string;
    readonly fontSize?: number;
    readonly color?: string;
    /** Required only for image nodes and resolved through the authenticated resource closure. */
    readonly resourceId?: string;
    readonly children: ReadonlyArray<NeutralAuthoredNode>;
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

export interface NeutralAuthoredContentIR {
    readonly schema: typeof NEUTRAL_AUTHORED_CONTENT_SCHEMA;
    readonly documentId: string;
    readonly resources: ReadonlyArray<NeutralAuthoredResource>;
    readonly root: NeutralAuthoredNode;
    readonly timeline: NeutralTimeline;
}

const NODE_KINDS: ReadonlySet<string> = new Set(["container", "image", "text"]);
const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);
const TIMELINE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "scaleX", "scaleY", "rotation", "alpha", "visible"]);
const SCALED_NODE_PROPERTIES: ReadonlySet<string> = new Set(["x", "y", "width", "height", "fontSize"]);
const SCALED_TRACK_PROPERTIES: ReadonlySet<string> = new Set(["x", "y"]);

/** Validates untrusted adapter output and returns a deterministic normalized IR. */
export function normalizeNeutralAuthoredContent(input: unknown, scale = 1): NeutralAuthoredContentIR {
    const source = record(input, "document");
    allowedKeys(source, ["schema", "documentId", "resources", "root", "timeline", "controller"], "document");
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
    return { schema: NEUTRAL_AUTHORED_CONTENT_SCHEMA, documentId, resources, root, timeline };
}

function normalizeNode(
    value: unknown,
    path: string,
    scale: number
): NeutralAuthoredNode {
    const source = record(value, path);
    allowedKeys(source, [
        "linkage", "kind", "name", "depth", "x", "y", "width", "height", "alpha", "visible",
        "text", "fontSize", "color", "resourceId", "children"
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
        text: optionalString(source.text, `${path}.text`),
        fontSize: optionalNumber(source.fontSize, `${path}.fontSize`, scale),
        color: optionalString(source.color, `${path}.color`),
        resourceId: source.resourceId === undefined
            ? undefined
            : canonicalResourceId(requiredString(source.resourceId, `${path}.resourceId`)),
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
    if (node.kind !== "container" && node.children.length !== 0)
        fail("AUTHORED_CONTENT_LEAF_CHILDREN_UNSUPPORTED", `${path} ${node.kind} nodes cannot contain children.`);
    return node;
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
