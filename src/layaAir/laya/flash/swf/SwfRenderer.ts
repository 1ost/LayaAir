import { ILaya } from "../../../ILaya";
import { Sprite } from "../../display/Sprite";
import { Text } from "../../display/Text";
import { BevelFilter } from "../../filters/BevelFilter";
import { BlurFilter } from "../../filters/BlurFilter";
import { ColorFilter } from "../../filters/ColorFilter";
import { GlowFilter } from "../../filters/GlowFilter";
import { GradientBevelFilter } from "../../filters/GradientBevelFilter";
import { GradientGlowFilter } from "../../filters/GradientGlowFilter";
import { Loader } from "../../net/Loader";
import type {
    SwfDefineEditText,
    SwfDefineShape,
    SwfDefineSprite,
    SwfFillStyle,
    SwfFilter,
    SwfLineStyle,
    SwfMovie,
    SwfPlaceObject,
    SwfRect,
    SwfRgba,
    SwfShapePath
} from "./SwfTypes";

export interface SwfRenderResult {
    root: Sprite;
    namedInstances: Map<string, Sprite | Text>;
    renderedShapeCount: number;
}

export interface SwfRenderOptions {
    frameIndex?: number;
}

const imageUrlCache = new WeakMap<object, Promise<string>>();

export class SwfRenderer {
    static async renderExport(movie: SwfMovie, exportName: string, options: SwfRenderOptions = {}): Promise<SwfRenderResult> {
        const sprite = movie.getSprite(exportName);
        if (!sprite) {
            throw new Error(`Raw SWF export '${exportName}' is not a sprite.`);
        }
        return SwfRenderer.renderSprite(movie, sprite, options);
    }

    static async renderSprite(movie: SwfMovie, sprite: SwfDefineSprite, options: SwfRenderOptions = {}): Promise<SwfRenderResult> {
        const namedInstances = new Map<string, Sprite | Text>();
        const root = await instantiateSprite(movie, sprite, namedInstances, options.frameIndex ?? 0);
        return {
            root,
            namedInstances,
            renderedShapeCount: (root as any).__rawSwfRenderedShapeCount ?? 0
        };
    }
}

async function instantiateSprite(
    movie: SwfMovie,
    sprite: SwfDefineSprite,
    namedInstances: Map<string, Sprite | Text>,
    frameIndex: number
): Promise<Sprite> {
    const root = new Sprite();
    let renderedShapeCount = 0;
    const placements = framePlacements(sprite, frameIndex);
    for (const placement of placements) {
        if (placement.characterId == null) {
            continue;
        }
        const character = movie.getCharacter(placement.characterId);
        const node = await createNodeForCharacter(movie, character, namedInstances, frameIndex);
        node.name = placement.name ?? "";
        applyPlacement(node, placement, character);
        root.addChild(node);
        renderedShapeCount += (node as any).__rawSwfRenderedShapeCount ?? ((node as any).__rawSwfRenderedShape ? 1 : 0);
        if (placement.name) {
            namedInstances.set(placement.name, node);
        }
    }
    (root as any).__rawSwfRenderedShapeCount = renderedShapeCount;
    return root;
}

function framePlacements(sprite: SwfDefineSprite, frameIndex: number): SwfPlaceObject[] {
    if (sprite.frames.length === 0) {
        return [...sprite.placements].sort(comparePlacementDepth);
    }
    const clamped = Math.max(0, Math.min(sprite.frames.length - 1, frameIndex));
    return [...sprite.frames[clamped].placements].sort(comparePlacementDepth);
}

async function createNodeForCharacter(
    movie: SwfMovie,
    character: any,
    namedInstances: Map<string, Sprite | Text>,
    frameIndex: number
): Promise<Sprite | Text> {
    if (character?.tags) {
        return instantiateSprite(movie, character, namedInstances, frameIndex);
    }
    if (character?.variableName !== undefined || character?.initialText !== undefined) {
        return createTextNode(character);
    }
    if (character?.shapeBounds) {
        return renderShapeNode(movie, character);
    }
    const sprite = new Sprite();
    if (character?.bounds) {
        sprite.size(character.bounds.width, character.bounds.height);
    }
    return sprite;
}

function createTextNode(character: SwfDefineEditText): Text {
    const text = new Text();
    text.text = character.initialText ?? "";
    text.color = rgbaToCss(character.textColor) ?? "#ffffff";
    text.align = character.layout?.align === 2 ? "center" : character.layout?.align === 1 ? "right" : "left";
    text.valign = "middle";
    text.overflow = "hidden";
    if (character.bounds) {
        text.width = character.bounds.width;
        text.height = character.bounds.height;
    }
    if (character.fontHeight) {
        text.fontSize = Math.max(1, Math.round(character.fontHeight));
    }
    return text;
}

async function renderShapeNode(movie: SwfMovie, shape: SwfDefineShape): Promise<Sprite> {
    const root = new Sprite();
    const bounds = shape.shapeBounds;
    root.size(Math.max(1, bounds.width), Math.max(1, bounds.height));
    const paths = shape.paths?.filter(path => (path.fillStyleIndex > 0 || path.lineStyleIndex > 0) && path.points.length >= 2) ?? [];
    let renderedShapeCount = 0;

    for (const path of paths) {
        const fill = shape.fillStyles?.find(candidate => candidate.index === path.fillStyleIndex);
        const line = shape.lineStyles?.find(candidate => candidate.index === path.lineStyleIndex);
        if (await renderPath(root, movie, path, fill, line)) {
            renderedShapeCount++;
        }
    }

    (root as any).__rawSwfRenderedShape = renderedShapeCount > 0;
    (root as any).__rawSwfRenderedShapeCount = renderedShapeCount;
    return root;
}

async function renderPath(root: Sprite, movie: SwfMovie, path: SwfShapePath, fill: SwfFillStyle | undefined, line: SwfLineStyle | undefined): Promise<boolean> {
    const pathBounds = boundsForPath(path);
    let rendered = false;
    if (fill?.bitmapId != null) {
        const image = movie.getCharacter(fill.bitmapId) as any;
        if (image?.imageData) {
            const imageUrl = await imageCharacterToObjectUrl(image);
            const child = new Sprite();
            child.pos(pathBounds.xMin, pathBounds.yMin);
            child.size(Math.max(1, pathBounds.width), Math.max(1, pathBounds.height));
            await loadImageOntoSprite(child, imageUrl);
            if (!isAxisAlignedRectanglePath(path)) {
                child.mask = maskForPath(path, pathBounds);
            }
            root.addChild(child);
            rendered = true;
        }
    }

    if (!rendered && fill?.gradientRecords?.length) {
        drawLinearGradientApproximation(root, pathBounds, fill.gradientRecords);
        rendered = true;
    }

    if (!rendered && fill?.color && root.graphics?.drawPath) {
        drawVectorPath(root, path, { fillStyle: rgbaToCss(fill.color) ?? "#000000" }, null, true);
        rendered = true;
    }
    if (!rendered && fill?.color && root.graphics?.drawRect) {
        root.graphics.drawRect(pathBounds.xMin, pathBounds.yMin, Math.max(1, pathBounds.width), Math.max(1, pathBounds.height), rgbaToCss(fill.color) ?? "#000000");
        rendered = true;
    }
    const lineColor = colorForLineStyle(line);
    if (lineColor && root.graphics?.drawPath) {
        drawVectorPath(root, path, null, penForLineStyle(line, lineColor), false);
        rendered = true;
    }
    return rendered;
}

function drawLinearGradientApproximation(root: Sprite, bounds: SwfRect, records: any[]): void {
    if (!root.graphics?.drawRect) {
        return;
    }
    const sorted = [...records].sort((left, right) => Number(left.ratio ?? 0) - Number(right.ratio ?? 0));
    if (sorted.length === 1) {
        root.graphics.drawRect(bounds.xMin, bounds.yMin, Math.max(1, bounds.width), Math.max(1, bounds.height), rgbaToCss(sorted[0].color) ?? "#ffffff");
        return;
    }
    for (let index = 0; index < sorted.length; index++) {
        const startRatio = index === 0 ? 0 : Number(sorted[index].ratio ?? 0) / 255;
        const endRatio = index === sorted.length - 1 ? 1 : Number(sorted[index + 1].ratio ?? 255) / 255;
        const startX = bounds.xMin + bounds.width * Math.max(0, Math.min(1, startRatio));
        const endX = bounds.xMin + bounds.width * Math.max(0, Math.min(1, endRatio));
        root.graphics.drawRect(startX, bounds.yMin, Math.max(1, endX - startX), Math.max(1, bounds.height), rgbaToCss(sorted[index].color) ?? "#ffffff");
    }
}

function applyPlacement(node: Sprite | Text, placement: SwfPlaceObject, character: any): void {
    if (!placement.matrix) {
        applyPlacementDisplayState(node, placement);
        return;
    }
    const boundsOffset = character?.variableName !== undefined || character?.initialText !== undefined
        ? character.bounds
        : null;
    const tx = placement.matrix.translateX + (boundsOffset?.xMin ?? 0);
    const ty = placement.matrix.translateY + (boundsOffset?.yMin ?? 0);
    const a = placement.matrix.scaleX;
    const b = placement.matrix.rotateSkew1;
    const c = placement.matrix.rotateSkew0;
    const d = placement.matrix.scaleY;
    if (b === 0 && c === 0) {
        node.pos(tx, ty);
        node.scale(a, d);
        applyPlacementDisplayState(node, placement);
        return;
    }
    const MatrixCtor = (globalThis as any).Laya?.Matrix;
    if (typeof MatrixCtor === "function") {
        (node as any).transform = new MatrixCtor(a, b, c, d, tx, ty);
        applyPlacementDisplayState(node, placement);
        return;
    }
    node.x = tx;
    node.y = ty;
    node.scaleX = a;
    node.scaleY = d;
    applyPlacementDisplayState(node, placement);
}

function applyPlacementDisplayState(node: Sprite | Text, placement: SwfPlaceObject): void {
    if (placement.visible === false) {
        node.visible = false;
    }
    applyColorTransform(node, placement.colorTransform);
    const blendMode = flashBlendModeToLaya(placement.blendMode);
    if (blendMode) {
        (node as any).blendMode = blendMode;
    }
    if (placement.cacheAsBitmap) {
        (node as any).cacheAs = "bitmap";
    }
    applyFlashFilters(node, placement.filters);
}

function applyColorTransform(node: Sprite | Text, transform: SwfPlaceObject["colorTransform"]): void {
    if (!transform) {
        return;
    }
    if (needsColorFilter(transform)) {
        const colorFilter = new ColorFilter(colorTransformMatrix(transform));
        const existing = ((node as any).filters ?? []) as any[];
        (node as any).filters = [...existing, colorFilter];
        return;
    }
    const alpha = alphaFromColorTransform(transform);
    if (alpha != null) {
        node.alpha = alpha;
    }
}

function needsColorFilter(transform: SwfPlaceObject["colorTransform"]): boolean {
    if (!transform) {
        return false;
    }
    return transform.redMultiplier != null
        || transform.greenMultiplier != null
        || transform.blueMultiplier != null
        || transform.redAdd != null
        || transform.greenAdd != null
        || transform.blueAdd != null
        || transform.alphaAdd != null;
}

function colorTransformMatrix(transform: SwfPlaceObject["colorTransform"]): number[] {
    const redMultiplier = (transform?.redMultiplier ?? 256) / 256;
    const greenMultiplier = (transform?.greenMultiplier ?? 256) / 256;
    const blueMultiplier = (transform?.blueMultiplier ?? 256) / 256;
    const alphaMultiplier = (transform?.alphaMultiplier ?? 256) / 256;
    return [
        redMultiplier, 0, 0, 0, transform?.redAdd ?? 0,
        0, greenMultiplier, 0, 0, transform?.greenAdd ?? 0,
        0, 0, blueMultiplier, 0, transform?.blueAdd ?? 0,
        0, 0, 0, alphaMultiplier, transform?.alphaAdd ?? 0
    ];
}

function applyFlashFilters(node: Sprite | Text, filters: SwfFilter[] | undefined): void {
    if (!filters?.length) {
        return;
    }
    const layaFilters = filters.map(flashFilterToLaya).filter((filter): filter is any => !!filter);
    if (layaFilters.length === 0) {
        return;
    }
    const existing = ((node as any).filters ?? []) as any[];
    (node as any).filters = [...existing, ...layaFilters];
}

function flashFilterToLaya(filter: SwfFilter): any {
    switch (filter.id) {
        case 0: {
            const offset = offsetFromPolar(filter.angle ?? 0, filter.distance ?? 0);
            return new GlowFilter(rgbaToCss(filter.color) ?? "#000000", averageBlur(filter), offset.x, offset.y);
        }
        case 1:
            return new BlurFilter(averageBlur(filter));
        case 2:
            return new GlowFilter(rgbaToCss(filter.color) ?? "#000000", averageBlur(filter), 0, 0);
        case 3:
            return new BevelFilter(
                rgbaToCss(filter.highlightColor) ?? "#ffffff",
                rgbaToCss(filter.shadowColor) ?? "#000000",
                filter.blurX ?? averageBlur(filter),
                filter.blurY ?? averageBlur(filter),
                radiansToDegrees(filter.angle ?? 0),
                filter.distance ?? 0,
                filter.strength ?? 1,
                filter.inner ?? false,
                filter.knockout ?? false,
                filter.onTop ?? false,
                filter.compositeSource ?? true
            );
        case 4:
            return new GradientGlowFilter(
                (filter.colors ?? []).map(color => rgbaToCss(color) ?? "#000000"),
                filter.ratios ?? [],
                filter.blurX ?? averageBlur(filter),
                filter.blurY ?? averageBlur(filter),
                radiansToDegrees(filter.angle ?? 0),
                filter.distance ?? 0,
                filter.strength ?? 1,
                filter.inner ?? false,
                filter.knockout ?? false,
                filter.onTop ?? false,
                filter.compositeSource ?? true
            );
        case 6:
            return filter.matrix?.length === 20 ? new ColorFilter(filter.matrix) : null;
        case 7:
            return new GradientBevelFilter(
                (filter.colors ?? []).map(color => rgbaToCss(color) ?? "#000000"),
                filter.ratios ?? [],
                filter.blurX ?? averageBlur(filter),
                filter.blurY ?? averageBlur(filter),
                radiansToDegrees(filter.angle ?? 0),
                filter.distance ?? 0,
                filter.strength ?? 1,
                filter.inner ?? false,
                filter.knockout ?? false,
                filter.onTop ?? false,
                filter.compositeSource ?? true
            );
        default:
            return null;
    }
}

function averageBlur(filter: SwfFilter): number {
    return Math.max(0, ((filter.blurX ?? 0) + (filter.blurY ?? 0)) / 2);
}

function offsetFromPolar(angleRadians: number, distance: number): { x: number; y: number } {
    return {
        x: Math.cos(angleRadians) * distance,
        y: Math.sin(angleRadians) * distance
    };
}

function radiansToDegrees(radians: number): number {
    return radians * 180 / Math.PI;
}

function alphaFromColorTransform(transform: SwfPlaceObject["colorTransform"]): number | null {
    if (!transform || (transform.alphaMultiplier == null && transform.alphaAdd == null)) {
        return null;
    }
    const multiplier = transform.alphaMultiplier == null ? 256 : transform.alphaMultiplier;
    const add = transform.alphaAdd ?? 0;
    return Math.max(0, Math.min(1, ((255 * multiplier / 256) + add) / 255));
}

function flashBlendModeToLaya(blendMode: number | undefined): string | null {
    switch (blendMode) {
        case 2: return "layer";
        case 3: return "multiply";
        case 4: return "screen";
        case 8: return "add";
        case 13: return "overlay";
        case 14: return "hardlight";
        default: return null;
    }
}

async function loadImageOntoSprite(sprite: Sprite, url: string): Promise<void> {
    const texture = await ILaya.loader.load(url, Loader.IMAGE as any);
    if (texture) {
        (sprite as any).texture = texture;
    }
}

function imageCharacterToObjectUrl(image: any): Promise<string> {
    const cached = imageUrlCache.get(image);
    if (cached) {
        return cached;
    }
    const pending = image.alphaData
        ? composeJpeg3Alpha(image.imageData, image.alphaData)
        : Promise.resolve(URL.createObjectURL(new Blob([image.imageData], { type: "image/jpeg" })));
    imageUrlCache.set(image, pending);
    return pending;
}

async function composeJpeg3Alpha(imageData: Uint8Array, alphaData: Uint8Array): Promise<string> {
    const imageUrl = URL.createObjectURL(new Blob([imageData], { type: "image/jpeg" }));
    try {
        const image = await loadDomImage(imageUrl);
        const alpha = await inflateDeflate(alphaData);
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");
        if (!context || canvas.width <= 0 || canvas.height <= 0) {
            return imageUrl;
        }
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixelCount = Math.min(alpha.byteLength, canvas.width * canvas.height);
        for (let index = 0; index < pixelCount; index++) {
            pixels.data[index * 4 + 3] = alpha[index];
        }
        context.putImageData(pixels, 0, 0);
        return await canvasToObjectUrl(canvas);
    }
    finally {
        URL.revokeObjectURL(imageUrl);
    }
}

async function inflateDeflate(bytes: Uint8Array): Promise<Uint8Array> {
    const DecompressionStreamCtor = (globalThis as any).DecompressionStream;
    if (typeof DecompressionStreamCtor !== "function") {
        return bytes;
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamCtor("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function loadDomImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to decode SWF JPEG image ${url}`));
        image.src = url;
    });
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) {
                reject(new Error("Failed to encode SWF rasterized shape."));
                return;
            }
            resolve(URL.createObjectURL(blob));
        }, "image/png");
    });
}

function boundsForPath(path: SwfShapePath): SwfRect {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    let xMinTwips = Infinity;
    let xMaxTwips = -Infinity;
    let yMinTwips = Infinity;
    let yMaxTwips = -Infinity;
    for (const point of path.points) {
        xMin = Math.min(xMin, point.x);
        xMax = Math.max(xMax, point.x);
        yMin = Math.min(yMin, point.y);
        yMax = Math.max(yMax, point.y);
        xMinTwips = Math.min(xMinTwips, point.xTwips);
        xMaxTwips = Math.max(xMaxTwips, point.xTwips);
        yMinTwips = Math.min(yMinTwips, point.yTwips);
        yMaxTwips = Math.max(yMaxTwips, point.yTwips);
    }
    for (const segment of path.segments ?? []) {
        if (segment.type === "curve") {
            xMin = Math.min(xMin, segment.control.x);
            xMax = Math.max(xMax, segment.control.x);
            yMin = Math.min(yMin, segment.control.y);
            yMax = Math.max(yMax, segment.control.y);
            xMinTwips = Math.min(xMinTwips, segment.control.xTwips);
            xMaxTwips = Math.max(xMaxTwips, segment.control.xTwips);
            yMinTwips = Math.min(yMinTwips, segment.control.yTwips);
            yMaxTwips = Math.max(yMaxTwips, segment.control.yTwips);
        }
    }
    return {
        xMinTwips,
        xMaxTwips,
        yMinTwips,
        yMaxTwips,
        xMin,
        xMax,
        yMin,
        yMax,
        width: xMax - xMin,
        height: yMax - yMin
    };
}

function flattenPathForLaya(path: SwfShapePath): number[] {
    if (path.segments?.length) {
        const points: number[] = [];
        const first = path.segments[0].start;
        points.push(first.x, first.y);
        for (const segment of path.segments) {
            if (segment.type === "line") {
                points.push(segment.end.x, segment.end.y);
                continue;
            }
            for (let step = 1; step <= 12; step++) {
                const t = step / 12;
                const inv = 1 - t;
                points.push(
                    inv * inv * segment.start.x + 2 * inv * t * segment.control.x + t * t * segment.end.x,
                    inv * inv * segment.start.y + 2 * inv * t * segment.control.y + t * t * segment.end.y
                );
            }
        }
        return points;
    }
    const points: number[] = [];
    for (const point of path.points) {
        points.push(point.x, point.y);
    }
    return points;
}

function drawVectorPath(root: Sprite, path: SwfShapePath, brush: any, pen: any, close: boolean): void {
    root.graphics.drawPath(0, 0, drawPathCommands(path, close), brush, pen);
}

function drawPathCommands(path: SwfShapePath, close: boolean): any[] {
    const points = flattenPathForLaya(path);
    if (points.length < 2) {
        return [];
    }
    const commands: any[] = [["moveTo", points[0], points[1]]];
    for (let index = 2; index + 1 < points.length; index += 2) {
        commands.push(["lineTo", points[index], points[index + 1]]);
    }
    if (close) {
        commands.push(["closePath"]);
    }
    return commands;
}

function maskForPath(path: SwfShapePath, bounds: SwfRect): Sprite {
    const mask = new Sprite();
    const commands = drawPathCommands(path, true).map(command => {
        if (command[0] === "moveTo" || command[0] === "lineTo") {
            return [command[0], command[1] - bounds.xMin, command[2] - bounds.yMin];
        }
        return command;
    });
    mask.graphics.drawPath(0, 0, commands, { fillStyle: "#ffffff" }, null);
    return mask;
}

function isAxisAlignedRectanglePath(path: SwfShapePath): boolean {
    const points = path.points;
    if (points.length !== 5) {
        return false;
    }
    const first = points[0];
    const last = points[4];
    if (first.xTwips !== last.xTwips || first.yTwips !== last.yTwips) {
        return false;
    }
    const xs = new Set(points.slice(0, 4).map(point => point.xTwips));
    const ys = new Set(points.slice(0, 4).map(point => point.yTwips));
    return xs.size === 2 && ys.size === 2 && (path.segments?.every(segment => segment.type === "line") ?? true);
}

function penForLineStyle(line: SwfLineStyle | undefined, strokeStyle: string): any {
    return {
        strokeStyle,
        lineWidth: Math.max(1, line?.width ?? 1),
        lineJoin: flashLineJoinToLaya(line?.joinStyle),
        lineCap: flashLineCapToLaya(line?.startCapStyle),
        miterLimit: line?.miterLimitFactor ?? 3
    };
}

function colorForLineStyle(line: SwfLineStyle | undefined): string | null {
    if (!line) {
        return null;
    }
    if (line.color) {
        return rgbaToCss(line.color);
    }
    const fill = line.fillStyle;
    if (fill?.color) {
        return rgbaToCss(fill.color);
    }
    if (fill?.gradientRecords?.length) {
        const sorted = [...fill.gradientRecords].sort((left, right) => left.ratio - right.ratio);
        return rgbaToCss(sorted[Math.floor(sorted.length / 2)]?.color);
    }
    return null;
}

function flashLineCapToLaya(capStyle: number | undefined): string {
    switch (capStyle) {
        case 1: return "butt";
        case 2: return "square";
        case 0:
        default: return "round";
    }
}

function flashLineJoinToLaya(joinStyle: number | undefined): string {
    switch (joinStyle) {
        case 1: return "bevel";
        case 2: return "miter";
        case 0:
        default: return "round";
    }
}

function comparePlacementDepth(left: SwfPlaceObject, right: SwfPlaceObject): number {
    return left.depth - right.depth;
}

function rgbaToCss(color: SwfRgba | undefined): string | null {
    if (!color) {
        return null;
    }
    const alpha = color.alpha == null ? 1 : Math.max(0, Math.min(1, color.alpha / 255));
    if (alpha < 1) {
        return `rgba(${color.red},${color.green},${color.blue},${alpha})`;
    }
    const red = color.red.toString(16).padStart(2, "0");
    const green = color.green.toString(16).padStart(2, "0");
    const blue = color.blue.toString(16).padStart(2, "0");
    return `#${red}${green}${blue}`;
}
