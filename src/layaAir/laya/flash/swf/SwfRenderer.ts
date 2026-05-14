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
    SwfDefineBitsLossless,
    SwfDefineFont,
    SwfDefineShape,
    SwfDefineSprite,
    SwfDefineText,
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
    bitmapFillCount: number;
}

export interface SwfRenderOptions {
    frameIndex?: number;
}

const imageUrlCache = new WeakMap<object, Promise<string>>();

interface OrientedShapePath {
    path: SwfShapePath;
    reverse: boolean;
}

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
            renderedShapeCount: (root as any).__rawSwfRenderedShapeCount ?? 0,
            bitmapFillCount: (root as any).__rawSwfBitmapFillCount ?? 0
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
    const maskStack: { clipDepth: number; group: Sprite }[] = [];
    for (const placement of placements) {
        while (maskStack.length && placement.depth > maskStack[maskStack.length - 1].clipDepth) {
            maskStack.pop();
        }
        if (placement.characterId == null) {
            continue;
        }
        const character = movie.getCharacter(placement.characterId);
        const node = await createNodeForCharacter(movie, character, namedInstances, frameIndex);
        node.name = placement.name ?? "";
        applyPlacement(node, placement, character);
        if (placement.clipDepth != null) {
            const group = new Sprite();
            group.mask = node as Sprite;
            currentMaskContainer(root, maskStack).addChild(group);
            maskStack.push({ clipDepth: placement.clipDepth, group });
            if (placement.name) {
                namedInstances.set(placement.name, node);
            }
            continue;
        }
        currentMaskContainer(root, maskStack).addChild(node);
        renderedShapeCount += renderedShapeCountFor(node);
        if (placement.name) {
            namedInstances.set(placement.name, node);
        }
    }
    (root as any).__rawSwfRenderedShapeCount = renderedShapeCount;
    (root as any).__rawSwfBitmapFillCount = childrenDebugCount(root, "__rawSwfBitmapFillCount");
    return root;
}

function currentMaskContainer(root: Sprite, maskStack: { clipDepth: number; group: Sprite }[]): Sprite {
    return maskStack.length ? maskStack[maskStack.length - 1].group : root;
}

function renderedShapeCountFor(node: Sprite | Text): number {
    return (node as any).__rawSwfRenderedShapeCount ?? ((node as any).__rawSwfRenderedShape ? 1 : 0);
}

function childrenDebugCount(root: Sprite, key: string): number {
    let count = Number((root as any)[key] ?? 0);
    const childCount = Number((root as any).numChildren ?? 0);
    for (let index = 0; index < childCount; index++) {
        const child = (root as any).getChildAt?.(index);
        if (child) {
            count += childrenDebugCount(child, key);
        }
    }
    return count;
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
        return createTextNode(movie, character);
    }
    if (character?.records) {
        return await createStaticTextNode(movie, character);
    }
    if (character?.zlibBitmapData) {
        return createBitmapNode(character);
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

async function createBitmapNode(character: SwfDefineBitsLossless): Promise<Sprite> {
    const sprite = new Sprite();
    sprite.size(character.width, character.height);
    const imageUrl = await imageCharacterToObjectUrl(character);
    await loadImageOntoSprite(sprite, imageUrl);
    return sprite;
}

async function createStaticTextNode(movie: SwfMovie, character: SwfDefineText): Promise<Sprite | Text> {
    const outline = await createStaticTextOutlineNode(movie, character);
    if (outline) {
        return outline;
    }
    return createFallbackStaticTextNode(movie, character);
}

async function createStaticTextOutlineNode(movie: SwfMovie, character: SwfDefineText): Promise<Sprite | null> {
    const root = new Sprite();
    root.size(Math.max(1, character.bounds.width), Math.max(1, character.bounds.height));
    let renderedGlyphs = 0;
    let quadraticCommandCount = 0;
    let compoundMoveToCount = 0;
    let compoundClosePathCount = 0;
    const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
    const context = canvas?.getContext("2d") ?? null;
    if (canvas && context) {
        canvas.width = Math.max(1, Math.ceil(character.bounds.xMax));
        canvas.height = Math.max(1, Math.ceil(character.bounds.yMax));
    }
    for (const record of character.records) {
        if (record.fontId == null) {
            return null;
        }
        const font = movie.getCharacter(record.fontId) as SwfDefineFont | undefined;
        if (!font?.glyphs) {
            return null;
        }
        const textHeightTwips = record.textHeightTwips ?? 1024;
        const glyphScale = textHeightTwips / fontGlyphCoordinateDivisor(font);
        let xCursor = (record.xOffsetTwips ?? 0) / 20;
        const yOffset = (record.yOffsetTwips ?? 0) / 20;
        const fillStyle = rgbaToCss(record.textColor) ?? "#ffffff";
        for (const entry of record.glyphs) {
            const glyph = font.glyphs[entry.glyphIndex];
            if (!glyph) {
                return null;
            }
            const orientedGlyphPaths = orientedFillPathsForStyle(glyph.paths, 1);
            if (orientedGlyphPaths.length > 0) {
                if (context) {
                    context.fillStyle = fillStyle;
                    buildCanvasTextGlyphPath(context, orientedGlyphPaths, character, xCursor, yOffset, glyphScale);
                    context.fill("nonzero");
                    applyFlashTypeThickness(context, character, fillStyle);
                }
                else {
                    drawTransformedCompoundVectorPaths(root, orientedGlyphPaths, character, xCursor, yOffset, glyphScale, fillStyle);
                }
                for (const orientedPath of orientedGlyphPaths) {
                    const commands = transformedDrawPathCommands(orientedPath.path, character, xCursor, yOffset, glyphScale, orientedPath.reverse);
                    compoundMoveToCount += commands.filter(command => command[0] === "moveTo").length;
                    compoundClosePathCount += commands.filter(command => command[0] === "closePath").length;
                    quadraticCommandCount += commands.filter(command => command[0] === "quadraticCurveTo").length;
                }
                renderedGlyphs++;
            }
            xCursor += entry.advanceTwips * glyphScale / 20;
        }
    }
    if (renderedGlyphs === 0) {
        return null;
    }
    if (canvas && context) {
        await loadImageOntoSprite(root, await canvasToObjectUrl(canvas));
    }
    (root as any).__rawSwfTextCharacterId = character.characterId;
    (root as any).__rawSwfTextRenderedAsGlyphOutlines = true;
    (root as any).__rawSwfTextQuadraticCommandCount = quadraticCommandCount;
    (root as any).__rawSwfTextCompoundMoveToCount = compoundMoveToCount;
    (root as any).__rawSwfTextCompoundClosePathCount = compoundClosePathCount;
    if (character.csmTextSettings) {
        (root as any).__rawSwfCsmTextSettings = character.csmTextSettings;
        (root as any).__rawSwfTextGridFitApplied = character.csmTextSettings.gridFit > 0;
        (root as any).__rawSwfTextFlashTypeThicknessApplied = character.csmTextSettings.thickness > 0;
    }
    if ((character as any).scalingGrid) {
        (root as any).__rawSwfScalingGrid = (character as any).scalingGrid;
    }
    (root as any).__rawSwfRenderedShape = true;
    (root as any).__rawSwfRenderedShapeCount = renderedGlyphs;
    return root;
}

function buildCanvasTextGlyphPath(
    context: CanvasRenderingContext2D,
    paths: OrientedShapePath[],
    text: SwfDefineText,
    xOffset: number,
    yOffset: number,
    glyphScale: number
): void {
    context.beginPath();
    for (const orientedPath of paths) {
        const commands = transformedDrawPathCommands(orientedPath.path, text, xOffset, yOffset, glyphScale, orientedPath.reverse);
        for (const command of commands) {
            switch (command[0]) {
                case "moveTo":
                    context.moveTo(command[1], command[2]);
                    break;
                case "lineTo":
                    context.lineTo(command[1], command[2]);
                    break;
                case "quadraticCurveTo":
                    context.quadraticCurveTo(command[1], command[2], command[3], command[4]);
                    break;
                case "closePath":
                    context.closePath();
                    break;
            }
        }
    }
}

function applyFlashTypeThickness(context: CanvasRenderingContext2D, text: SwfDefineText, fillStyle: string): void {
    const thickness = text.csmTextSettings?.thickness ?? 0;
    if (thickness <= 0) {
        return;
    }
    context.save();
    context.strokeStyle = fillStyle;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = Math.max(0.25, Math.min(8, thickness));
    context.stroke();
    context.restore();
}

function fontGlyphCoordinateDivisor(font: SwfDefineFont): number {
    return font.tagCode === 75 ? 20480 : 1024;
}

function createFallbackStaticTextNode(movie: SwfMovie, character: SwfDefineText): Text {
    const text = new Text();
    text.text = textRecordsToString(movie, character);
    const firstRecord = character.records.find(record => record.textColor || record.textHeightTwips || record.fontId);
    text.color = rgbaToCss(firstRecord?.textColor) ?? "#ffffff";
    text.overflow = "hidden";
    text.width = Math.max(1, character.bounds.width);
    text.height = Math.max(1, character.bounds.height);
    if (firstRecord?.textHeightTwips) {
        text.fontSize = Math.max(1, Math.round(firstRecord.textHeightTwips / 20));
    }
    if (firstRecord?.fontId != null) {
        const font = movie.getCharacter(firstRecord.fontId) as any;
        if (font?.fontDisplayName || font?.fontName) {
            text.font = font.fontDisplayName ?? font.fontName;
        }
    }
    text.pos(character.bounds.xMin + character.matrix.translateX, character.bounds.yMin + character.matrix.translateY);
    text.scale(character.matrix.scaleX, character.matrix.scaleY);
    (text as any).__rawSwfTextCharacterId = character.characterId;
    (text as any).__rawSwfTextRenderedAsGlyphOutlines = false;
    if (character.csmTextSettings) {
        (text as any).__rawSwfCsmTextSettings = character.csmTextSettings;
    }
    if ((character as any).scalingGrid) {
        (text as any).__rawSwfScalingGrid = (character as any).scalingGrid;
    }
    return text;
}

function textRecordsToString(movie: SwfMovie, character: SwfDefineText): string {
    let output = "";
    for (const record of character.records) {
        const font = record.fontId == null ? null : movie.getCharacter(record.fontId) as any;
        for (const glyph of record.glyphs) {
            const code = font?.codes?.[glyph.glyphIndex];
            output += code == null ? "" : String.fromCodePoint(code);
        }
    }
    return output;
}

function createTextNode(movie: SwfMovie, character: SwfDefineEditText): Text {
    const text = new Text();
    text.text = character.initialText ?? "";
    text.color = rgbaToCss(character.textColor) ?? "#ffffff";
    text.align = character.layout?.align === 2 ? "center" : character.layout?.align === 1 ? "right" : "left";
    text.valign = "middle";
    text.overflow = "hidden";
    text.wordWrap = !!character.flags.wordWrap || !!character.flags.multiline;
    text.html = !!character.flags.html;
    if (character.bounds) {
        text.width = character.bounds.width;
        text.height = character.bounds.height;
    }
    if (character.fontHeight) {
        text.fontSize = Math.max(1, Math.round(character.fontHeight));
    }
    if (character.fontId != null) {
        const font = movie.getCharacter(character.fontId) as any;
        if (font?.fontDisplayName || font?.fontName) {
            text.font = font.fontDisplayName ?? font.fontName;
        }
        (text as any).__rawSwfFontId = character.fontId;
    }
    if (character.layout) {
        text.padding = [
            0,
            character.layout.rightMarginTwips / 20,
            0,
            character.layout.leftMarginTwips / 20
        ];
        text.leading = character.layout.leadingTwips / 20;
    }
    if (character.flags.password) {
        (text as any)._asPassword = true;
    }
    if (character.flags.border) {
        text.borderColor = rgbaToCss(character.textColor) ?? "#000000";
    }
    (text as any).__rawSwfVariableName = character.variableName;
    (text as any).__rawSwfReadOnly = character.flags.readOnly;
    (text as any).__rawSwfSelectable = !character.flags.noSelect;
    if (character.csmTextSettings) {
        (text as any).__rawSwfCsmTextSettings = character.csmTextSettings;
    }
    return text;
}

async function renderShapeNode(movie: SwfMovie, shape: SwfDefineShape): Promise<Sprite> {
    const root = new Sprite();
    const bounds = shape.shapeBounds;
    root.size(Math.max(1, bounds.width), Math.max(1, bounds.height));
    const fillLayer = new Sprite();
    const strokeLayer = new Sprite();
    root.addChild(fillLayer);
    root.addChild(strokeLayer);
    const paths = shape.paths?.filter(path => (path.fillStyleIndex > 0 || path.lineStyleIndex > 0) && path.points.length >= 2) ?? [];
    let renderedShapeCount = 0;

    for (const fill of shape.fillStyles ?? []) {
        const fillPaths = orientedFillPathsForStyle(paths, fill.index);
        if (fillPaths.length > 0 && await renderFillPaths(fillLayer, movie, fillPaths, fill)) {
            renderedShapeCount++;
        }
    }

    for (const path of paths) {
        const line = shape.lineStyles?.find(candidate => candidate.index === path.lineStyleIndex);
        if (renderStrokePath(strokeLayer, path, line)) {
            renderedShapeCount++;
        }
    }

    (root as any).__rawSwfRenderedShape = renderedShapeCount > 0;
    (root as any).__rawSwfRenderedShapeCount = renderedShapeCount;
    (root as any).__rawSwfBitmapFillCount = childrenDebugCount(fillLayer, "__rawSwfBitmapFillCount");
    return root;
}

async function renderFillPaths(root: Sprite, movie: SwfMovie, paths: OrientedShapePath[], fill: SwfFillStyle): Promise<boolean> {
    const pathBounds = boundsForPaths(paths);
    if (fill?.bitmapId != null || fill?.gradientRecords?.length || fill?.color) {
        const image = fill?.bitmapId == null ? null : movie.getCharacter(fill.bitmapId) as any;
        const rasterUrl = await rasterizeCompoundFill(paths, pathBounds, fill, image);
        if (rasterUrl) {
            const child = new Sprite();
            child.pos(pathBounds.xMin, pathBounds.yMin);
            child.size(Math.max(1, Math.ceil(pathBounds.width)), Math.max(1, Math.ceil(pathBounds.height)));
            await loadImageOntoSprite(child, rasterUrl);
            if (fill?.bitmapId != null) {
                (child as any).__rawSwfBitmapFillCount = 1;
                (child as any).__rawSwfBitmapFillType = fill.type;
                (child as any).__rawSwfBitmapFillMatrix = fill.bitmapMatrix;
            }
            if (fill?.gradientRecords?.length) {
                (child as any).__rawSwfGradientFillType = fill.type;
            }
            root.addChild(child);
            return true;
        }
    }

    if (fill?.bitmapId != null) {
        const image = movie.getCharacter(fill.bitmapId) as any;
        if (image?.imageData || image?.zlibBitmapData) {
            const imageUrl = await imageCharacterToObjectUrl(image);
            const child = new Sprite();
            child.pos(pathBounds.xMin, pathBounds.yMin);
            child.size(Math.max(1, pathBounds.width), Math.max(1, pathBounds.height));
            await loadImageOntoSprite(child, imageUrl);
            if (paths.length !== 1 || !isAxisAlignedRectanglePath(paths[0].path)) {
                child.mask = maskForPaths(paths, pathBounds);
            }
            (child as any).__rawSwfBitmapFillCount = 1;
            root.addChild(child);
            return true;
        }
    }

    if (fill?.gradientRecords?.length) {
        drawLinearGradientApproximation(root, pathBounds, fill.gradientRecords);
        return true;
    }

    if (fill?.color && root.graphics?.drawPath) {
        drawCompoundVectorPaths(root, paths, { fillStyle: rgbaToCss(fill.color) ?? "#000000" }, null);
        return true;
    }
    if (fill?.color && root.graphics?.drawRect) {
        root.graphics.drawRect(pathBounds.xMin, pathBounds.yMin, Math.max(1, pathBounds.width), Math.max(1, pathBounds.height), rgbaToCss(fill.color) ?? "#000000");
        return true;
    }
    return false;
}

function renderStrokePath(root: Sprite, path: SwfShapePath, line: SwfLineStyle | undefined): boolean {
    const lineColor = colorForLineStyle(line);
    if (lineColor && root.graphics?.drawPath) {
        drawVectorPath(root, path, null, penForLineStyle(line, lineColor), false);
        return true;
    }
    return false;
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
    if (placement.cacheAsBitmap || shouldIsolatePlacement(placement)) {
        (node as any).cacheAs = "bitmap";
    }
    applyFlashFilters(node, placement.filters);
}

function shouldIsolatePlacement(placement: SwfPlaceObject): boolean {
    const blendMode = flashBlendModeToLaya(placement.blendMode);
    return !!blendMode && blendMode !== "normal" || !!placement.filters?.length;
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
        case 1: return "normal";
        case 2: return "layer";
        case 3: return "multiply";
        case 4: return "screen";
        case 5: return "destination-out";
        case 8: return "add";
        case 11: return "alpha";
        case 13: return "overlay";
        case 14: return "hardlight";
        default: return null;
    }
}

async function rasterizeCompoundFill(
    paths: OrientedShapePath[],
    bounds: SwfRect,
    fill: SwfFillStyle,
    image: any
): Promise<string | null> {
    if (typeof document === "undefined") {
        return null;
    }
    const width = Math.max(1, Math.ceil(bounds.width));
    const height = Math.max(1, Math.ceil(bounds.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        return null;
    }
    buildCanvasCompoundPath(context, paths, -bounds.xMin, -bounds.yMin);
    context.save();
    context.clip("nonzero");
    if (fill.bitmapId != null) {
        if (!image?.imageData && !image?.zlibBitmapData) {
            context.restore();
            return null;
        }
        const imageUrl = await imageCharacterToObjectUrl(image);
        const bitmap = await loadDomImage(imageUrl);
        drawBitmapFill(context, bitmap, bounds, fill);
    }
    else if (fill.gradientRecords?.length) {
        context.fillStyle = canvasGradientForFill(context, bounds, fill);
        context.fillRect(0, 0, width, height);
    }
    else if (fill.color) {
        context.fillStyle = rgbaToCss(fill.color) ?? "#000000";
        context.fillRect(0, 0, width, height);
    }
    else {
        context.restore();
        return null;
    }
    context.restore();
    return canvasToObjectUrl(canvas);
}

function buildCanvasCompoundPath(
    context: CanvasRenderingContext2D,
    paths: OrientedShapePath[],
    dx: number,
    dy: number
): void {
    context.beginPath();
    for (const orientedPath of paths) {
        const commands = orientedDrawPathCommands(orientedPath, true);
        for (const command of commands) {
            switch (command[0]) {
                case "moveTo":
                    context.moveTo(command[1] + dx, command[2] + dy);
                    break;
                case "lineTo":
                    context.lineTo(command[1] + dx, command[2] + dy);
                    break;
                case "quadraticCurveTo":
                    context.quadraticCurveTo(
                        command[1] + dx,
                        command[2] + dy,
                        command[3] + dx,
                        command[4] + dy
                    );
                    break;
                case "closePath":
                    context.closePath();
                    break;
            }
        }
    }
}

function drawBitmapFill(
    context: CanvasRenderingContext2D,
    bitmap: HTMLImageElement,
    bounds: SwfRect,
    fill: SwfFillStyle
): void {
    const matrix = fill.bitmapMatrix;
    const a = (matrix?.scaleX ?? 20) / 20;
    const b = (matrix?.rotateSkew1 ?? 0) / 20;
    const c = (matrix?.rotateSkew0 ?? 0) / 20;
    const d = (matrix?.scaleY ?? 20) / 20;
    const tx = (matrix?.translateX ?? 0) - bounds.xMin;
    const ty = (matrix?.translateY ?? 0) - bounds.yMin;
    const repeat = fill.type === 0x40 || fill.type === 0x42;
    context.imageSmoothingEnabled = fill.type === 0x40 || fill.type === 0x41;
    context.save();
    context.transform(a, b, c, d, tx, ty);
    if (repeat) {
        const inverse = inverseBitmapMatrix(a, b, c, d, tx, ty);
        const corners = [
            transformPoint(inverse, 0, 0),
            transformPoint(inverse, bounds.width, 0),
            transformPoint(inverse, 0, bounds.height),
            transformPoint(inverse, bounds.width, bounds.height)
        ];
        const minX = Math.floor(Math.min(...corners.map(point => point.x)) / bitmap.width) - 1;
        const maxX = Math.ceil(Math.max(...corners.map(point => point.x)) / bitmap.width) + 1;
        const minY = Math.floor(Math.min(...corners.map(point => point.y)) / bitmap.height) - 1;
        const maxY = Math.ceil(Math.max(...corners.map(point => point.y)) / bitmap.height) + 1;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                context.drawImage(bitmap, x * bitmap.width, y * bitmap.height);
            }
        }
    }
    else {
        context.drawImage(bitmap, 0, 0);
    }
    context.restore();
}

function inverseBitmapMatrix(a: number, b: number, c: number, d: number, tx: number, ty: number): { a: number; b: number; c: number; d: number; tx: number; ty: number } {
    const det = a * d - b * c;
    if (Math.abs(det) < 0.000001) {
        return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    }
    const invA = d / det;
    const invB = -b / det;
    const invC = -c / det;
    const invD = a / det;
    return {
        a: invA,
        b: invB,
        c: invC,
        d: invD,
        tx: -(invA * tx + invC * ty),
        ty: -(invB * tx + invD * ty)
    };
}

function transformPoint(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number }, x: number, y: number): { x: number; y: number } {
    return {
        x: matrix.a * x + matrix.c * y + matrix.tx,
        y: matrix.b * x + matrix.d * y + matrix.ty
    };
}

function canvasGradientForFill(context: CanvasRenderingContext2D, bounds: SwfRect, fill: SwfFillStyle): CanvasGradient {
    const records = [...(fill.gradientRecords ?? [])].sort((left, right) => left.ratio - right.ratio);
    const matrix = fill.gradientMatrix;
    const scaleX = Math.max(0.0001, Math.abs((matrix?.scaleX ?? 32768) / 20));
    const scaleY = Math.max(0.0001, Math.abs((matrix?.scaleY ?? 32768) / 20));
    const centerX = (matrix?.translateX ?? (bounds.xMin + bounds.width / 2)) - bounds.xMin;
    const centerY = (matrix?.translateY ?? (bounds.yMin + bounds.height / 2)) - bounds.yMin;
    const gradient = fill.type === 0x12 || fill.type === 0x13
        ? context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(scaleX, scaleY))
        : context.createLinearGradient(centerX - scaleX, centerY, centerX + scaleX, centerY);
    for (const record of records) {
        gradient.addColorStop(Math.max(0, Math.min(1, record.ratio / 255)), rgbaToCss(record.color) ?? "#000000");
    }
    return gradient;
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
    const pending = image.zlibBitmapData
        ? losslessBitmapToObjectUrl(image)
        : image.alphaData
        ? composeJpeg3Alpha(image.imageData, image.alphaData)
        : Promise.resolve(URL.createObjectURL(new Blob([jpegBytesForImage(image)], { type: "image/jpeg" })));
    imageUrlCache.set(image, pending);
    return pending;
}

function jpegBytesForImage(image: any): Uint8Array {
    if (!image.requiresJpegTables || !image.jpegTables?.length) {
        return image.imageData;
    }
    const tables = stripTrailingJpegEoi(image.jpegTables);
    const data = stripLeadingJpegSoi(image.imageData);
    const output = new Uint8Array(tables.length + data.length);
    output.set(tables, 0);
    output.set(data, tables.length);
    return output;
}

function stripTrailingJpegEoi(bytes: Uint8Array): Uint8Array {
    if (bytes.length >= 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
        return bytes.subarray(0, bytes.length - 2);
    }
    return bytes;
}

function stripLeadingJpegSoi(bytes: Uint8Array): Uint8Array {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        return bytes.subarray(2);
    }
    return bytes;
}

async function losslessBitmapToObjectUrl(image: SwfDefineBitsLossless): Promise<string> {
    const decoded = await inflateDeflate(image.zlibBitmapData);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
        throw new Error(`Invalid SWF lossless bitmap ${image.characterId}.`);
    }
    const pixels = context.createImageData(canvas.width, canvas.height);
    switch (image.bitmapFormat) {
        case 3:
            decodeLossless8(decoded, image, pixels.data);
            break;
        case 4:
            decodeLossless15(decoded, image, pixels.data);
            break;
        case 5:
            decodeLossless32(decoded, image, pixels.data);
            break;
        default:
            throw new Error(`Unsupported SWF lossless bitmap format ${image.bitmapFormat}.`);
    }
    context.putImageData(pixels, 0, 0);
    return canvasToObjectUrl(canvas);
}

function decodeLossless8(decoded: Uint8Array, image: SwfDefineBitsLossless, output: Uint8ClampedArray): void {
    const colorCount = image.colorTableSize ?? 0;
    const entrySize = image.hasAlpha ? 4 : 3;
    const paletteBytes = colorCount * entrySize;
    const rowStride = align4(image.width);
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const paletteIndex = decoded[paletteBytes + y * rowStride + x] ?? 0;
            const paletteOffset = paletteIndex * entrySize;
            writePixel(output, (y * image.width + x) * 4,
                decoded[paletteOffset] ?? 0,
                decoded[paletteOffset + 1] ?? 0,
                decoded[paletteOffset + 2] ?? 0,
                image.hasAlpha ? decoded[paletteOffset + 3] ?? 255 : 255);
        }
    }
}

function decodeLossless15(decoded: Uint8Array, image: SwfDefineBitsLossless, output: Uint8ClampedArray): void {
    const rowStride = align4(image.width * 2);
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const source = y * rowStride + x * 2;
            const packed = (decoded[source] ?? 0) | ((decoded[source + 1] ?? 0) << 8);
            writePixel(output, (y * image.width + x) * 4,
                expand5((packed >> 10) & 0x1f),
                expand5((packed >> 5) & 0x1f),
                expand5(packed & 0x1f),
                255);
        }
    }
}

function decodeLossless32(decoded: Uint8Array, image: SwfDefineBitsLossless, output: Uint8ClampedArray): void {
    const rowStride = image.width * 4;
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const source = y * rowStride + x * 4;
            const alpha = image.hasAlpha ? decoded[source] ?? 255 : 255;
            writePixel(output, (y * image.width + x) * 4,
                decoded[source + 1] ?? 0,
                decoded[source + 2] ?? 0,
                decoded[source + 3] ?? 0,
                alpha);
        }
    }
}

function writePixel(output: Uint8ClampedArray, offset: number, red: number, green: number, blue: number, alpha: number): void {
    output[offset] = red;
    output[offset + 1] = green;
    output[offset + 2] = blue;
    output[offset + 3] = alpha;
}

function align4(value: number): number {
    return (value + 3) & ~3;
}

function expand5(value: number): number {
    return (value << 3) | (value >> 2);
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

function boundsForPaths(paths: OrientedShapePath[]): SwfRect {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    let xMinTwips = Infinity;
    let xMaxTwips = -Infinity;
    let yMinTwips = Infinity;
    let yMaxTwips = -Infinity;
    for (const orientedPath of paths) {
        const bounds = boundsForPath(orientedPath.path);
        xMin = Math.min(xMin, bounds.xMin);
        xMax = Math.max(xMax, bounds.xMax);
        yMin = Math.min(yMin, bounds.yMin);
        yMax = Math.max(yMax, bounds.yMax);
        xMinTwips = Math.min(xMinTwips, bounds.xMinTwips);
        xMaxTwips = Math.max(xMaxTwips, bounds.xMaxTwips);
        yMinTwips = Math.min(yMinTwips, bounds.yMinTwips);
        yMaxTwips = Math.max(yMaxTwips, bounds.yMaxTwips);
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

function orientedFillPathsForStyle(paths: SwfShapePath[], fillStyleIndex: number): OrientedShapePath[] {
    const oriented: OrientedShapePath[] = [];
    for (const path of paths) {
        if ((path.fillStyle1Index ?? 0) === fillStyleIndex) {
            oriented.push({ path, reverse: false });
        }
        if ((path.fillStyle0Index ?? 0) === fillStyleIndex) {
            oriented.push({ path, reverse: true });
        }
    }
    return oriented.filter(candidate => candidate.path.points.length >= 2 || candidate.path.segments.length > 0);
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

function drawCompoundVectorPaths(root: Sprite, paths: OrientedShapePath[], brush: any, pen: any): void {
    root.graphics.drawPath(0, 0, compoundDrawPathCommands(paths, true), brush, pen);
}

function drawTransformedCompoundVectorPaths(
    root: Sprite,
    paths: OrientedShapePath[],
    text: SwfDefineText,
    xOffset: number,
    yOffset: number,
    glyphScale: number,
    fillStyle: string
): void {
    if (!root.graphics?.drawPath) {
        return;
    }
    const commands: any[] = [];
    for (const orientedPath of paths) {
        commands.push(...transformedDrawPathCommands(orientedPath.path, text, xOffset, yOffset, glyphScale, orientedPath.reverse));
    }
    root.graphics.drawPath(0, 0, commands, { fillStyle }, null);
}

function transformedDrawPathCommands(
    path: SwfShapePath,
    text: SwfDefineText,
    xOffset: number,
    yOffset: number,
    glyphScale: number,
    reverse: boolean = false
): any[] {
    if (path.segments?.length) {
        const segments = reverse ? reversedSegments(path) : path.segments;
        const first = transformTextPoint(segments[0].start.x, segments[0].start.y, text, xOffset, yOffset, glyphScale);
        const commands: any[] = [["moveTo", first.x, first.y]];
        for (const segment of segments) {
            if (segment.type === "line") {
                const end = transformTextPoint(segment.end.x, segment.end.y, text, xOffset, yOffset, glyphScale);
                commands.push(["lineTo", end.x, end.y]);
                continue;
            }
            const control = transformTextPoint(segment.control.x, segment.control.y, text, xOffset, yOffset, glyphScale);
            const end = transformTextPoint(segment.end.x, segment.end.y, text, xOffset, yOffset, glyphScale);
            commands.push(["quadraticCurveTo", control.x, control.y, end.x, end.y]);
        }
        commands.push(["closePath"]);
        return commands;
    }
    const points = reverse ? reversedFlatPoints(path) : flattenPathForLaya(path);
    if (points.length < 2) {
        return [];
    }
    const first = transformTextPoint(points[0], points[1], text, xOffset, yOffset, glyphScale);
    const commands: any[] = [["moveTo", first.x, first.y]];
    for (let index = 2; index + 1 < points.length; index += 2) {
        const point = transformTextPoint(points[index], points[index + 1], text, xOffset, yOffset, glyphScale);
        commands.push(["lineTo", point.x, point.y]);
    }
    commands.push(["closePath"]);
    return commands;
}

function transformTextPoint(
    x: number,
    y: number,
    text: SwfDefineText,
    xOffset: number,
    yOffset: number,
    glyphScale: number
): { x: number; y: number } {
    const localX = xOffset + x * glyphScale;
    const localY = yOffset + y * glyphScale;
    const transformed = {
        x: text.matrix.scaleX * localX + text.matrix.rotateSkew0 * localY + text.matrix.translateX,
        y: text.matrix.rotateSkew1 * localX + text.matrix.scaleY * localY + text.matrix.translateY
    };
    if ((text.csmTextSettings?.gridFit ?? 0) > 0) {
        return {
            x: Math.round(transformed.x),
            y: Math.round(transformed.y)
        };
    }
    return transformed;
}

function drawPathCommands(path: SwfShapePath, close: boolean): any[] {
    return orientedDrawPathCommands({ path, reverse: false }, close);
}

function compoundDrawPathCommands(paths: OrientedShapePath[], close: boolean): any[] {
    const commands: any[] = [];
    for (const path of paths) {
        commands.push(...orientedDrawPathCommands(path, close));
    }
    return commands;
}

function orientedDrawPathCommands(orientedPath: OrientedShapePath, close: boolean): any[] {
    const path = orientedPath.path;
    if (path.segments?.length) {
        const segments = orientedPath.reverse ? reversedSegments(path) : path.segments;
        const commands: any[] = [["moveTo", segments[0].start.x, segments[0].start.y]];
        for (const segment of segments) {
            if (segment.type === "line") {
                commands.push(["lineTo", segment.end.x, segment.end.y]);
                continue;
            }
            commands.push(["quadraticCurveTo", segment.control.x, segment.control.y, segment.end.x, segment.end.y]);
        }
        if (close) {
            commands.push(["closePath"]);
        }
        return commands;
    }
    const points = orientedPath.reverse ? reversedFlatPoints(path) : flattenPathForLaya(path);
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

function reversedSegments(path: SwfShapePath): NonNullable<SwfShapePath["segments"]> {
    const segments = path.segments ?? [];
    return segments.slice().reverse().map(segment => {
        if (segment.type === "line") {
            return {
                type: "line",
                start: segment.end,
                end: segment.start
            };
        }
        return {
            type: "curve",
            start: segment.end,
            control: segment.control,
            end: segment.start
        };
    });
}

function reversedFlatPoints(path: SwfShapePath): number[] {
    const points = flattenPathForLaya(path);
    const reversed: number[] = [];
    for (let index = points.length - 2; index >= 0; index -= 2) {
        reversed.push(points[index], points[index + 1]);
    }
    return reversed;
}

function maskForPaths(paths: OrientedShapePath[], bounds: SwfRect): Sprite {
    const mask = new Sprite();
    const commands = compoundDrawPathCommands(paths, true).map(command => {
        if (command[0] === "moveTo" || command[0] === "lineTo") {
            return [command[0], command[1] - bounds.xMin, command[2] - bounds.yMin];
        }
        if (command[0] === "quadraticCurveTo") {
            return [
                command[0],
                command[1] - bounds.xMin,
                command[2] - bounds.yMin,
                command[3] - bounds.xMin,
                command[4] - bounds.yMin
            ];
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
