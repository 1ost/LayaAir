import {
    SwfCharacter,
    SwfColorTransformWithAlpha,
    SwfDefineBitsJpeg,
    SwfDefineBitsLossless,
    SwfDefineEditText,
    SwfDefineShape,
    SwfDefineSprite,
    SwfExportAsset,
    SwfFillStyle,
    SwfFileAttributes,
    SwfFilter,
    SwfGradientRecord,
    SwfHeader,
    SwfLineStyle,
    SwfMatrix,
    SwfMovie,
    SwfParsedTag,
    SwfPlaceObject,
    SwfRemoveObject,
    SwfRect,
    SwfRgb,
    SwfRgba,
    SwfShapePath,
    SwfShapePoint,
    SwfShapeSegment,
    SwfSymbolClass,
    SwfTag,
    SwfTagNames
} from "./SwfTypes";

export interface SwfParserOptions {
    inflateCws?: (compressedBody: Uint8Array, expectedLength: number) => Promise<Uint8Array>;
}

export class SwfParser {
    static async parse(data: ArrayBuffer | Uint8Array, options: SwfParserOptions = {}): Promise<SwfMovie> {
        const bytes = toBytes(data);
        if (bytes.length < 8) {
            throw new Error("Invalid SWF: header is shorter than 8 bytes.");
        }

        const compression = readAscii(bytes, 0, 3);
        const version = bytes[3];
        const fileLength = readUI32(bytes, 4);
        let body: Uint8Array;
        if (compression === "FWS") {
            body = bytes.subarray(8);
        }
        else if (compression === "CWS") {
            const inflate = options.inflateCws ?? SwfParser.inflateCwsWithPlatform;
            body = await inflate(bytes.subarray(8), fileLength - 8);
            if (body.length !== fileLength - 8) {
                throw new Error(`Invalid CWS: decompressed body length ${body.length} does not match header length ${fileLength - 8}.`);
            }
        }
        else if (compression === "ZWS") {
            throw new Error("Unsupported SWF compression ZWS (LZMA).");
        }
        else {
            throw new Error(`Invalid SWF signature '${compression}'.`);
        }

        const reader = new SwfDataReader(body);
        const frameSize = parseRect(reader);
        const frameRateRaw = reader.readUI16();
        const frameRate = frameRateRaw / 256;
        const frameCount = reader.readUI16();
        const header: SwfHeader = {
            compression: compression as "FWS" | "CWS",
            version,
            fileLength,
            frameSize,
            frameRate,
            frameCount
        };

        const parser = new SwfTagParser();
        const tags = parser.parseTags(reader, body.length);
        return new SwfMovie(header, tags, parser.characters, parser.exports, parser.symbolClasses);
    }

    private static async inflateCwsWithPlatform(compressedBody: Uint8Array, _expectedLength: number): Promise<Uint8Array> {
        const decompressionStream = (globalThis as any).DecompressionStream;
        if (typeof decompressionStream !== "function" || typeof Blob !== "function" || typeof Response !== "function") {
            throw new Error("CWS compressed SWF requires platform DecompressionStream support or a custom inflateCws option.");
        }

        const stream = new Blob([compressedBody]).stream().pipeThrough(new decompressionStream("deflate"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
}

class SwfTagParser {
    readonly characters: Map<number, SwfCharacter> = new Map();
    readonly exports: SwfExportAsset[] = [];
    readonly symbolClasses: SwfSymbolClass[] = [];

    parseTags(reader: SwfDataReader, end: number): SwfTag[] {
        const tags: SwfTag[] = [];
        while (reader.pos < end) {
            const offset = reader.pos;
            const tagAndLength = reader.readUI16();
            const code = tagAndLength >> 6;
            let length = tagAndLength & 0x3f;
            if (length === 0x3f) {
                length = reader.readUI32();
            }
            const dataOffset = reader.pos;
            const tagEnd = dataOffset + length;
            if (tagEnd > end) {
                throw new Error(`Invalid SWF tag ${code}: body extends past containing stream.`);
            }
            const data = reader.bytes.subarray(dataOffset, tagEnd);
            const tag: SwfTag = {
                code,
                name: SwfTagNames[code] ?? `Tag${code}`,
                length,
                offset,
                dataOffset,
                data
            };
            tag.parsed = this.parseTag(tag);
            tags.push(tag);
            reader.pos = tagEnd;
            if (code === 0) {
                break;
            }
        }
        return tags;
    }

    private parseTag(tag: SwfTag): SwfParsedTag | undefined {
        const reader = new SwfDataReader(tag.data);
        switch (tag.code) {
            case 9:
                return parseRgb(reader);
            case 4:
                return parsePlaceObject(reader, tag.code);
            case 5:
                return parseRemoveObject(reader, tag.code);
            case 20:
                return this.rememberCharacter(parseDefineBitsLossless(reader, false));
            case 21:
                return this.rememberCharacter(parseDefineBitsJpeg2(reader));
            case 36:
                return this.rememberCharacter(parseDefineBitsLossless(reader, true));
            case 35:
                return this.rememberCharacter(parseDefineBitsJpeg3(reader));
            case 90:
                return this.rememberCharacter(parseDefineBitsJpeg4(reader));
            case 2:
            case 22:
            case 32:
            case 83:
                return this.rememberCharacter(parseDefineShape(reader, tag.code));
            case 26:
                return parsePlaceObject2(reader, tag.code);
            case 28:
                return parseRemoveObject(reader, tag.code);
            case 37:
                return this.rememberCharacter(parseDefineEditText(reader));
            case 39:
                return this.rememberCharacter(this.parseDefineSprite(reader));
            case 56:
                return this.parseExportAssets(reader);
            case 69:
                return parseFileAttributes(reader);
            case 70:
                return parsePlaceObject3(reader, tag.code);
            case 76:
                return this.parseSymbolClass(reader);
            default:
                return undefined;
        }
    }

    private rememberCharacter<T extends SwfCharacter>(character: T): T {
        this.characters.set(character.characterId, character);
        return character;
    }

    private parseDefineSprite(reader: SwfDataReader): SwfDefineSprite {
        const characterId = reader.readUI16();
        const frameCount = reader.readUI16();
        const tags = this.parseTags(reader, reader.length);
        const placements = tags
            .map(tag => tag.parsed)
            .filter((parsed): parsed is SwfPlaceObject => isPlaceObject(parsed));
        const namedPlacements = new Map<string, SwfPlaceObject>();
        for (const placement of placements) {
            if (placement.name) {
                namedPlacements.set(placement.name, placement);
            }
        }
        const frames = buildTimelineFrames(tags);
        return {
            characterId,
            frameCount,
            tags,
            placements,
            namedPlacements,
            frames
        };
    }

    private parseExportAssets(reader: SwfDataReader): SwfExportAsset[] {
        const count = reader.readUI16();
        const assets: SwfExportAsset[] = [];
        for (let index = 0; index < count; index++) {
            assets.push({
                characterId: reader.readUI16(),
                name: reader.readString()
            });
        }
        this.exports.push(...assets);
        return assets;
    }

    private parseSymbolClass(reader: SwfDataReader): SwfSymbolClass[] {
        const count = reader.readUI16();
        const symbols: SwfSymbolClass[] = [];
        for (let index = 0; index < count; index++) {
            symbols.push({
                characterId: reader.readUI16(),
                name: reader.readString()
            });
        }
        this.symbolClasses.push(...symbols);
        return symbols;
    }
}

function parseFileAttributes(reader: SwfDataReader): SwfFileAttributes {
    const flags = reader.readUI32();
    return {
        useDirectBlit: !!(flags & 0x40),
        useGPU: !!(flags & 0x80),
        hasMetadata: !!(flags & 0x100),
        actionScript3: !!(flags & 0x200),
        noCrossDomainCaching: !!(flags & 0x400),
        swfRelativeUrls: !!(flags & 0x800),
        useNetwork: !!(flags & 0x1000),
        rawFlags: flags
    };
}

function parseDefineBitsJpeg2(reader: SwfDataReader): SwfDefineBitsJpeg {
    const characterId = reader.readUI16();
    return {
        characterId,
        imageData: reader.readRemaining()
    };
}

function parseDefineBitsJpeg3(reader: SwfDataReader): SwfDefineBitsJpeg {
    const characterId = reader.readUI16();
    const alphaDataOffset = reader.readUI32();
    const payload = reader.readRemaining();
    return {
        characterId,
        alphaDataOffset,
        imageData: payload.subarray(0, alphaDataOffset),
        alphaData: payload.subarray(alphaDataOffset)
    };
}

function parseDefineBitsJpeg4(reader: SwfDataReader): SwfDefineBitsJpeg {
    const characterId = reader.readUI16();
    const alphaDataOffset = reader.readUI32();
    const deblockParam = reader.readUI16();
    const payload = reader.readRemaining();
    return {
        characterId,
        alphaDataOffset,
        deblockParam,
        imageData: payload.subarray(0, alphaDataOffset),
        alphaData: payload.subarray(alphaDataOffset)
    };
}

function parseDefineBitsLossless(reader: SwfDataReader, hasAlpha: boolean): SwfDefineBitsLossless {
    const characterId = reader.readUI16();
    const bitmapFormat = reader.readUI8();
    const width = reader.readUI16();
    const height = reader.readUI16();
    let colorTableSize: number | undefined;
    if (bitmapFormat === 3) {
        colorTableSize = reader.readUI8() + 1;
    }
    return {
        characterId,
        bitmapFormat,
        width,
        height,
        colorTableSize,
        hasAlpha,
        zlibBitmapData: reader.readRemaining()
    };
}

function parseDefineShape(reader: SwfDataReader, tagCode: number): SwfDefineShape {
    const characterId = reader.readUI16();
    const shapeBounds = parseRect(reader);
    let edgeBounds: SwfRect | undefined;
    let usesFillWindingRule: boolean | undefined;
    let usesNonScalingStrokes: boolean | undefined;
    let usesScalingStrokes: boolean | undefined;
    if (tagCode !== 83) {
        const shape = parseShapeWithStyle(reader, tagCode);
        return {
            characterId,
            shapeBounds,
            fillStyles: shape.fillStyles,
            lineStyles: shape.lineStyles,
            paths: shape.paths
        };
    }
    edgeBounds = parseRect(reader);
    const flags = reader.readUI8();
    usesFillWindingRule = !!(flags & 0x04);
    usesNonScalingStrokes = !!(flags & 0x02);
    usesScalingStrokes = !!(flags & 0x01);
    const shape = parseShapeWithStyle(reader, tagCode);
    return {
        characterId,
        shapeBounds,
        edgeBounds,
        usesFillWindingRule,
        usesNonScalingStrokes,
        usesScalingStrokes,
        fillStyles: shape.fillStyles,
        lineStyles: shape.lineStyles,
        paths: shape.paths
    };
}

function parseShapeWithStyle(reader: SwfDataReader, tagCode: number): { fillStyles: SwfFillStyle[]; lineStyles: SwfLineStyle[]; paths: SwfShapePath[] } {
    const fillStyles = parseFillStyleArray(reader, tagCode);
    const lineStyles = parseLineStyleArray(reader, tagCode);
    const bits = new SwfBitReader(reader.bytes, reader.pos);
    let fillBits = bits.readUB(4);
    let lineBits = bits.readUB(4);
    let xTwips = 0;
    let yTwips = 0;
    let fillStyle0 = 0;
    let fillStyle1 = 0;
    let lineStyle = 0;
    let currentPath: SwfShapePath | null = null;
    const paths: SwfShapePath[] = [];

    const closePath = (): void => {
        if (currentPath && currentPath.points.length > 1) {
            paths.push(currentPath);
        }
        currentPath = null;
    };
    const beginPath = (): void => {
        const fillStyleIndex = fillStyle1 || fillStyle0;
        if (!fillStyleIndex && !lineStyle) {
            currentPath = null;
            return;
        }
        currentPath = {
            fillStyleIndex,
            fillStyle0Index: fillStyle0,
            fillStyle1Index: fillStyle1,
            lineStyleIndex: lineStyle,
            points: [toShapePoint(xTwips, yTwips)],
            segments: []
        };
    };
    const addSegment = (segment: SwfShapeSegment): void => {
        if (!currentPath) {
            beginPath();
        }
        currentPath?.segments.push(segment);
    };
    const addPoint = (): void => {
        if (!currentPath) {
            beginPath();
        }
        currentPath?.points.push(toShapePoint(xTwips, yTwips));
    };

    while (bits.bytePos < reader.length) {
        if (bits.readUB(1)) {
            const straight = bits.readUB(1) !== 0;
            const nbits = bits.readUB(4) + 2;
            if (straight) {
                const startXTwips = xTwips;
                const startYTwips = yTwips;
                const generalLine = bits.readUB(1) !== 0;
                let deltaX = 0;
                let deltaY = 0;
                if (generalLine) {
                    deltaX = bits.readSB(nbits);
                    deltaY = bits.readSB(nbits);
                }
                else {
                    const verticalLine = bits.readUB(1) !== 0;
                    if (verticalLine) {
                        deltaY = bits.readSB(nbits);
                    }
                    else {
                        deltaX = bits.readSB(nbits);
                    }
                }
                xTwips += deltaX;
                yTwips += deltaY;
                addSegment({
                    type: "line",
                    start: toShapePoint(startXTwips, startYTwips),
                    end: toShapePoint(xTwips, yTwips)
                });
                addPoint();
            }
            else {
                const startXTwips = xTwips;
                const startYTwips = yTwips;
                const controlDeltaX = bits.readSB(nbits);
                const controlDeltaY = bits.readSB(nbits);
                const anchorDeltaX = bits.readSB(nbits);
                const anchorDeltaY = bits.readSB(nbits);
                const controlXTwips = xTwips + controlDeltaX;
                const controlYTwips = yTwips + controlDeltaY;
                xTwips = controlXTwips + anchorDeltaX;
                yTwips = controlYTwips + anchorDeltaY;
                addSegment({
                    type: "curve",
                    start: toShapePoint(startXTwips, startYTwips),
                    control: toShapePoint(controlXTwips, controlYTwips),
                    end: toShapePoint(xTwips, yTwips)
                });
                addPoint();
            }
            continue;
        }

        const flags = bits.readUB(5);
        if (flags === 0) {
            closePath();
            break;
        }

        let moved = false;
        if (flags & 0x01) {
            const moveBits = bits.readUB(5);
            xTwips = bits.readSB(moveBits);
            yTwips = bits.readSB(moveBits);
            moved = true;
        }
        if (flags & 0x02) {
            fillStyle0 = bits.readUB(fillBits);
        }
        if (flags & 0x04) {
            fillStyle1 = bits.readUB(fillBits);
        }
        if (flags & 0x08) {
            lineStyle = bits.readUB(lineBits);
        }
        if (flags & 0x10) {
            bits.align();
            reader.pos = bits.bytePos;
            fillStyles.push(...parseFillStyleArray(reader, tagCode));
            lineStyles.push(...parseLineStyleArray(reader, tagCode, lineStyles.length));
            bits.bytePos = reader.pos;
            fillBits = bits.readUB(4);
            lineBits = bits.readUB(4);
        }
        if (moved || (flags & 0x0e)) {
            closePath();
            beginPath();
        }
    }

    bits.align();
    reader.pos = bits.bytePos;
    return { fillStyles, lineStyles, paths };
}

function parseFillStyleArray(reader: SwfDataReader, tagCode: number): SwfFillStyle[] {
    const count = readExtendedCount(reader, tagCode);
    const fillStyles: SwfFillStyle[] = [];
    for (let index = 1; index <= count; index++) {
        fillStyles.push(parseFillStyle(reader, tagCode, index));
    }
    return fillStyles;
}

function parseFillStyle(reader: SwfDataReader, tagCode: number, index: number): SwfFillStyle {
    const type = reader.readUI8();
    const style: SwfFillStyle = { index, type };
    switch (type) {
        case 0x00:
            style.color = tagCode >= 32 ? parseRgba(reader) : rgbToRgba(parseRgb(reader));
            break;
        case 0x10:
        case 0x12:
        case 0x13:
            style.gradientMatrix = parseMatrix(reader);
            style.gradientRecords = parseGradientRecords(reader, tagCode);
            break;
        case 0x40:
        case 0x41:
        case 0x42:
        case 0x43:
            style.bitmapId = reader.readUI16();
            style.bitmapMatrix = parseMatrix(reader);
            break;
        default:
            throw new Error(`Unsupported SWF fill style type 0x${type.toString(16)}.`);
    }
    return style;
}

function parseGradientRecords(reader: SwfDataReader, tagCode: number): SwfGradientRecord[] {
    const packed = reader.readUI8();
    const count = packed & 0x0f;
    const records: SwfGradientRecord[] = [];
    for (let index = 0; index < count; index++) {
        records.push({
            ratio: reader.readUI8(),
            color: tagCode >= 32 ? parseRgba(reader) : rgbToRgba(parseRgb(reader))
        });
    }
    return records;
}

function parseLineStyleArray(reader: SwfDataReader, tagCode: number, indexOffset: number = 0): SwfLineStyle[] {
    const count = readExtendedCount(reader, tagCode);
    const lineStyles: SwfLineStyle[] = [];
    for (let index = 0; index < count; index++) {
        lineStyles.push(parseLineStyle(reader, tagCode, indexOffset + index + 1));
    }
    return lineStyles;
}

function parseLineStyle(reader: SwfDataReader, tagCode: number, index: number): SwfLineStyle {
    const widthTwips = reader.readUI16();
    const lineStyle: SwfLineStyle = {
        index,
        widthTwips,
        width: widthTwips / 20
    };
    if (tagCode === 83) {
        const flags = reader.readUI16();
        lineStyle.startCapStyle = (flags >> 14) & 0x03;
        lineStyle.joinStyle = (flags >> 12) & 0x03;
        const hasFill = !!(flags & 0x0008);
        lineStyle.hasFill = hasFill;
        lineStyle.noHScale = !!(flags & 0x0400);
        lineStyle.noVScale = !!(flags & 0x0200);
        lineStyle.pixelHinting = !!(flags & 0x0100);
        lineStyle.noClose = !!(flags & 0x0004);
        lineStyle.endCapStyle = flags & 0x03;
        if (lineStyle.joinStyle === 2) {
            lineStyle.miterLimitFactor = reader.readUI16() / 256;
        }
        if (hasFill) {
            lineStyle.fillStyle = parseFillStyle(reader, tagCode, 0);
        }
        else {
            lineStyle.color = parseRgba(reader);
        }
        return lineStyle;
    }
    if (tagCode >= 32) {
        lineStyle.color = parseRgba(reader);
    }
    else {
        lineStyle.color = rgbToRgba(parseRgb(reader));
    }
    return lineStyle;
}

function readExtendedCount(reader: SwfDataReader, tagCode: number): number {
    const count = reader.readUI8();
    return count === 0xff && tagCode !== 2 ? reader.readUI16() : count;
}

function rgbToRgba(color: SwfRgb): SwfRgba {
    return {
        red: color.red,
        green: color.green,
        blue: color.blue,
        alpha: 255
    };
}

function toShapePoint(xTwips: number, yTwips: number): SwfShapePoint {
    return {
        xTwips,
        yTwips,
        x: xTwips / 20,
        y: yTwips / 20
    };
}

function parseDefineEditText(reader: SwfDataReader): SwfDefineEditText {
    const characterId = reader.readUI16();
    const bounds = parseRect(reader);
    const flags1 = reader.readUI8();
    const flags2 = reader.readUI8();
    const flags = {
        hasText: !!(flags1 & 0x80),
        wordWrap: !!(flags1 & 0x40),
        multiline: !!(flags1 & 0x20),
        password: !!(flags1 & 0x10),
        readOnly: !!(flags1 & 0x08),
        hasTextColor: !!(flags1 & 0x04),
        hasMaxLength: !!(flags1 & 0x02),
        hasFont: !!(flags1 & 0x01),
        hasFontClass: !!(flags2 & 0x80),
        autoSize: !!(flags2 & 0x40),
        hasLayout: !!(flags2 & 0x20),
        noSelect: !!(flags2 & 0x10),
        border: !!(flags2 & 0x08),
        wasStatic: !!(flags2 & 0x04),
        html: !!(flags2 & 0x02),
        useOutlines: !!(flags2 & 0x01)
    };
    const editText: SwfDefineEditText = {
        characterId,
        bounds,
        flags,
        variableName: ""
    };

    if (flags.hasFont) {
        editText.fontId = reader.readUI16();
    }
    if (flags.hasFontClass) {
        editText.fontClass = reader.readString();
    }
    if (flags.hasFont || flags.hasFontClass) {
        editText.fontHeightTwips = reader.readUI16();
        editText.fontHeight = editText.fontHeightTwips / 20;
    }
    if (flags.hasTextColor) {
        editText.textColor = parseRgba(reader);
    }
    if (flags.hasMaxLength) {
        editText.maxLength = reader.readUI16();
    }
    if (flags.hasLayout) {
        editText.layout = {
            align: reader.readUI8(),
            leftMarginTwips: reader.readUI16(),
            rightMarginTwips: reader.readUI16(),
            indentTwips: reader.readSI16(),
            leadingTwips: reader.readSI16()
        };
    }
    editText.variableName = reader.readString();
    if (flags.hasText) {
        editText.initialText = reader.readString();
    }
    return editText;
}

function parsePlaceObject2(reader: SwfDataReader, tagCode: number): SwfPlaceObject {
    const flags = reader.readUI8();
    const placement: SwfPlaceObject = {
        tagCode,
        move: !!(flags & 0x01),
        depth: reader.readUI16(),
        rawFlags: [flags],
        hasClipActions: !!(flags & 0x80)
    };
    parsePlaceObjectCommon(reader, placement, flags);
    return placement;
}

function parsePlaceObject(reader: SwfDataReader, tagCode: number): SwfPlaceObject {
    const placement: SwfPlaceObject = {
        tagCode,
        characterId: reader.readUI16(),
        depth: reader.readUI16(),
        rawFlags: []
    };
    placement.matrix = parseMatrix(reader);
    if (reader.pos < reader.length) {
        placement.colorTransform = parseColorTransform(reader);
    }
    return placement;
}

function parseRemoveObject(reader: SwfDataReader, tagCode: number): SwfRemoveObject {
    let characterId: number | undefined;
    if (tagCode === 5) {
        characterId = reader.readUI16();
    }
    return {
        tagCode,
        characterId,
        depth: reader.readUI16()
    };
}

function parsePlaceObject3(reader: SwfDataReader, tagCode: number): SwfPlaceObject {
    const flags1 = reader.readUI8();
    const flags2 = reader.readUI8();
    const placement: SwfPlaceObject = {
        tagCode,
        move: !!(flags1 & 0x01),
        depth: reader.readUI16(),
        rawFlags: [flags1, flags2],
        hasClipActions: !!(flags1 & 0x80),
        hasImage: !!(flags2 & 0x10)
    };
    if ((flags2 & 0x08) || ((flags2 & 0x10) && (flags1 & 0x02))) {
        placement.className = reader.readString();
    }
    parsePlaceObjectCommon(reader, placement, flags1);
    if (flags2 & 0x01) {
        placement.filters = parseFilterList(reader);
    }
    if (flags2 & 0x02) {
        placement.blendMode = reader.readUI8();
    }
    if (flags2 & 0x04) {
        placement.cacheAsBitmap = reader.readUI8() !== 0;
    }
    if (flags2 & 0x20) {
        placement.visible = reader.readUI8() !== 0;
    }
    if (flags2 & 0x40) {
        placement.opaqueBackground = parseRgba(reader);
    }
    return placement;
}

function parsePlaceObjectCommon(reader: SwfDataReader, placement: SwfPlaceObject, flags: number): void {
    if (flags & 0x02) {
        placement.characterId = reader.readUI16();
    }
    if (flags & 0x04) {
        placement.matrix = parseMatrix(reader);
    }
    if (flags & 0x08) {
        placement.colorTransform = parseColorTransformWithAlpha(reader);
    }
    if (flags & 0x10) {
        placement.ratio = reader.readUI16();
    }
    if (flags & 0x20) {
        placement.name = reader.readString();
    }
    if (flags & 0x40) {
        placement.clipDepth = reader.readUI16();
    }
}

function parseFilterList(reader: SwfDataReader): SwfFilter[] {
    const count = reader.readUI8();
    const filters: SwfFilter[] = [];
    for (let index = 0; index < count; index++) {
        const id = reader.readUI8();
        filters.push(parseFilterPayload(reader, id));
    }
    return filters;
}

function parseFilterPayload(reader: SwfDataReader, id: number): SwfFilter {
    const filter: SwfFilter = { id, name: filterName(id) };
    switch (id) {
        case 0:
            filter.color = parseRgba(reader);
            readBlurAndShadow(reader, filter);
            readFilterFlags(reader, filter);
            return filter;
        case 1:
            filter.blurX = reader.readFixed();
            filter.blurY = reader.readFixed();
            filter.passes = reader.readUI8() >> 3;
            return filter;
        case 2:
            filter.color = parseRgba(reader);
            filter.blurX = reader.readFixed();
            filter.blurY = reader.readFixed();
            filter.strength = reader.readFixed8();
            readFilterFlags(reader, filter);
            return filter;
        case 3:
            filter.shadowColor = parseRgba(reader);
            filter.highlightColor = parseRgba(reader);
            readBlurAndShadow(reader, filter);
            readFilterFlags(reader, filter);
            return filter;
        case 4:
        case 7: {
            const count = reader.readUI8();
            filter.colors = [];
            filter.ratios = [];
            for (let index = 0; index < count; index++) {
                filter.colors.push(parseRgba(reader));
            }
            for (let index = 0; index < count; index++) {
                filter.ratios.push(reader.readUI8());
            }
            readBlurAndShadow(reader, filter);
            readFilterFlags(reader, filter);
            return filter;
        }
        case 5: {
            filter.matrixX = reader.readUI8();
            filter.matrixY = reader.readUI8();
            filter.divisor = reader.readFloat32();
            filter.bias = reader.readFloat32();
            filter.matrix = [];
            for (let index = 0; index < filter.matrixX * filter.matrixY; index++) {
                filter.matrix.push(reader.readFloat32());
            }
            filter.defaultColor = parseRgba(reader);
            const flags = reader.readUI8();
            filter.clamp = !!(flags & 0x02);
            filter.preserveAlpha = !!(flags & 0x01);
            return filter;
        }
        case 6: {
            filter.matrix = [];
            for (let index = 0; index < 20; index++) {
                filter.matrix.push(reader.readFloat32());
            }
            return filter;
        }
        default:
            throw new Error(`Unsupported SWF filter id ${id} while parsing PlaceObject3.`);
    }
}

function readBlurAndShadow(reader: SwfDataReader, filter: SwfFilter): void {
    filter.blurX = reader.readFixed();
    filter.blurY = reader.readFixed();
    filter.angle = reader.readFixed();
    filter.distance = reader.readFixed();
    filter.strength = reader.readFixed8();
}

function readFilterFlags(reader: SwfDataReader, filter: SwfFilter): void {
    const flags = reader.readUI8();
    filter.inner = !!(flags & 0x80);
    filter.knockout = !!(flags & 0x40);
    filter.compositeSource = !!(flags & 0x20);
    filter.onTop = !!(flags & 0x10);
    filter.passes = flags & 0x0f;
}

function filterName(id: number): string {
    switch (id) {
        case 0: return "DropShadowFilter";
        case 1: return "BlurFilter";
        case 2: return "GlowFilter";
        case 3: return "BevelFilter";
        case 4: return "GradientGlowFilter";
        case 5: return "ConvolutionFilter";
        case 6: return "ColorMatrixFilter";
        case 7: return "GradientBevelFilter";
        default: return `Filter${id}`;
    }
}

function parseColorTransformWithAlpha(reader: SwfDataReader): SwfColorTransformWithAlpha {
    return parseColorTransform(reader);
}

function parseColorTransform(reader: SwfDataReader): SwfColorTransformWithAlpha {
    const bits = new SwfBitReader(reader.bytes, reader.pos);
    const hasAdd = bits.readUB(1) !== 0;
    const hasMult = bits.readUB(1) !== 0;
    const nbits = bits.readUB(4);
    const transform: SwfColorTransformWithAlpha = {};
    if (hasMult) {
        transform.redMultiplier = bits.readSB(nbits);
        transform.greenMultiplier = bits.readSB(nbits);
        transform.blueMultiplier = bits.readSB(nbits);
        transform.alphaMultiplier = bits.readSB(nbits);
    }
    if (hasAdd) {
        transform.redAdd = bits.readSB(nbits);
        transform.greenAdd = bits.readSB(nbits);
        transform.blueAdd = bits.readSB(nbits);
        transform.alphaAdd = bits.readSB(nbits);
    }
    bits.align();
    reader.pos = bits.bytePos;
    return transform;
}

function parseRect(reader: SwfDataReader): SwfRect {
    const bits = new SwfBitReader(reader.bytes, reader.pos);
    const nbits = bits.readUB(5);
    const xMinTwips = bits.readSB(nbits);
    const xMaxTwips = bits.readSB(nbits);
    const yMinTwips = bits.readSB(nbits);
    const yMaxTwips = bits.readSB(nbits);
    bits.align();
    reader.pos = bits.bytePos;
    return {
        xMinTwips,
        xMaxTwips,
        yMinTwips,
        yMaxTwips,
        xMin: xMinTwips / 20,
        xMax: xMaxTwips / 20,
        yMin: yMinTwips / 20,
        yMax: yMaxTwips / 20,
        width: (xMaxTwips - xMinTwips) / 20,
        height: (yMaxTwips - yMinTwips) / 20
    };
}

function parseMatrix(reader: SwfDataReader): SwfMatrix {
    const bits = new SwfBitReader(reader.bytes, reader.pos);
    let scaleX = 1;
    let scaleY = 1;
    let rotateSkew0 = 0;
    let rotateSkew1 = 0;
    if (bits.readUB(1)) {
        const nScaleBits = bits.readUB(5);
        scaleX = bits.readSB(nScaleBits) / 65536;
        scaleY = bits.readSB(nScaleBits) / 65536;
    }
    if (bits.readUB(1)) {
        const nRotateBits = bits.readUB(5);
        rotateSkew0 = bits.readSB(nRotateBits) / 65536;
        rotateSkew1 = bits.readSB(nRotateBits) / 65536;
    }
    const nTranslateBits = bits.readUB(5);
    const translateXTwips = bits.readSB(nTranslateBits);
    const translateYTwips = bits.readSB(nTranslateBits);
    bits.align();
    reader.pos = bits.bytePos;
    return {
        scaleX,
        scaleY,
        rotateSkew0,
        rotateSkew1,
        translateXTwips,
        translateYTwips,
        translateX: translateXTwips / 20,
        translateY: translateYTwips / 20
    };
}

function parseRgb(reader: SwfDataReader): SwfRgb {
    return {
        red: reader.readUI8(),
        green: reader.readUI8(),
        blue: reader.readUI8()
    };
}

function parseRgba(reader: SwfDataReader): SwfRgba {
    return {
        red: reader.readUI8(),
        green: reader.readUI8(),
        blue: reader.readUI8(),
        alpha: reader.readUI8()
    };
}

function isPlaceObject(parsed: SwfParsedTag | undefined): parsed is SwfPlaceObject {
    return !!parsed && "depth" in parsed && "rawFlags" in parsed;
}

function isRemoveObject(parsed: SwfParsedTag | undefined): parsed is SwfRemoveObject {
    return !!parsed && "depth" in parsed && !("rawFlags" in parsed) && (parsed as SwfRemoveObject).tagCode !== undefined;
}

function buildTimelineFrames(tags: SwfTag[]): import("./SwfTypes").SwfFrame[] {
    const frames: import("./SwfTypes").SwfFrame[] = [];
    const byDepth = new Map<number, SwfPlaceObject>();
    for (const tag of tags) {
        const parsed = tag.parsed;
        if (isPlaceObject(parsed)) {
            applyPlacementToDisplayList(byDepth, parsed);
            continue;
        }
        if (isRemoveObject(parsed)) {
            byDepth.delete(parsed.depth);
            continue;
        }
        if (tag.code === 1) {
            frames.push(snapshotFrame(frames.length, byDepth));
            continue;
        }
        if (tag.code === 0) {
            break;
        }
    }
    return frames;
}

function applyPlacementToDisplayList(byDepth: Map<number, SwfPlaceObject>, placement: SwfPlaceObject): void {
    const previous = byDepth.get(placement.depth);
    if (placement.move && previous) {
        byDepth.set(placement.depth, {
            ...previous,
            ...placement,
            characterId: placement.characterId ?? previous.characterId,
            className: placement.className ?? previous.className,
            name: placement.name ?? previous.name,
            matrix: placement.matrix ?? previous.matrix,
            colorTransform: placement.colorTransform ?? previous.colorTransform,
            ratio: placement.ratio ?? previous.ratio,
            clipDepth: placement.clipDepth ?? previous.clipDepth,
            blendMode: placement.blendMode ?? previous.blendMode,
            visible: placement.visible ?? previous.visible,
            cacheAsBitmap: placement.cacheAsBitmap ?? previous.cacheAsBitmap,
            opaqueBackground: placement.opaqueBackground ?? previous.opaqueBackground,
            filters: placement.filters ?? previous.filters
        });
        return;
    }
    byDepth.set(placement.depth, placement);
}

function snapshotFrame(index: number, byDepth: Map<number, SwfPlaceObject>): import("./SwfTypes").SwfFrame {
    const snapshot = new Map<number, SwfPlaceObject>();
    for (const [depth, placement] of byDepth) {
        snapshot.set(depth, { ...placement, rawFlags: [...placement.rawFlags] });
    }
    const placements = [...snapshot.values()].sort((left, right) => left.depth - right.depth);
    const namedPlacements = new Map<string, SwfPlaceObject>();
    for (const placement of placements) {
        if (placement.name) {
            namedPlacements.set(placement.name, placement);
        }
    }
    return {
        index,
        placements,
        byDepth: snapshot,
        namedPlacements
    };
}

class SwfDataReader {
    readonly bytes: Uint8Array;
    pos: number;

    constructor(bytes: Uint8Array, pos: number = 0) {
        this.bytes = bytes;
        this.pos = pos;
    }

    get length(): number {
        return this.bytes.length;
    }

    readUI8(): number {
        this.require(1);
        return this.bytes[this.pos++];
    }

    readUI16(): number {
        this.require(2);
        const value = this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8);
        this.pos += 2;
        return value;
    }

    readSI16(): number {
        const value = this.readUI16();
        return value & 0x8000 ? value - 0x10000 : value;
    }

    readFixed(): number {
        return this.readSI32() / 65536;
    }

    readFixed8(): number {
        return this.readSI16() / 256;
    }

    readUI32(): number {
        this.require(4);
        const value = (this.bytes[this.pos]
            | (this.bytes[this.pos + 1] << 8)
            | (this.bytes[this.pos + 2] << 16)
            | (this.bytes[this.pos + 3] << 24)) >>> 0;
        this.pos += 4;
        return value;
    }

    readSI32(): number {
        this.require(4);
        const value = (this.bytes[this.pos]
            | (this.bytes[this.pos + 1] << 8)
            | (this.bytes[this.pos + 2] << 16)
            | (this.bytes[this.pos + 3] << 24));
        this.pos += 4;
        return value;
    }

    readFloat32(): number {
        this.require(4);
        const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4);
        const value = view.getFloat32(0, true);
        this.pos += 4;
        return value;
    }

    readString(): string {
        const start = this.pos;
        while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0) {
            this.pos++;
        }
        if (this.pos >= this.bytes.length) {
            throw new Error("Invalid SWF string: missing null terminator.");
        }
        const value = decodeString(this.bytes.subarray(start, this.pos));
        this.pos++;
        return value;
    }

    readRemaining(): Uint8Array {
        const value = this.bytes.subarray(this.pos);
        this.pos = this.bytes.length;
        return value;
    }

    skip(length: number): void {
        this.require(length);
        this.pos += length;
    }

    private require(length: number): void {
        if (this.pos + length > this.bytes.length) {
            throw new Error("Invalid SWF: unexpected end of tag data.");
        }
    }
}

class SwfBitReader {
    readonly bytes: Uint8Array;
    bytePos: number;
    private bitPos: number = 0;

    constructor(bytes: Uint8Array, bytePos: number) {
        this.bytes = bytes;
        this.bytePos = bytePos;
    }

    readUB(count: number): number {
        let value = 0;
        for (let index = 0; index < count; index++) {
            if (this.bytePos >= this.bytes.length) {
                throw new Error("Invalid SWF bit field: unexpected end of data.");
            }
            value = (value << 1) | ((this.bytes[this.bytePos] >> (7 - this.bitPos)) & 1);
            this.bitPos++;
            if (this.bitPos === 8) {
                this.bitPos = 0;
                this.bytePos++;
            }
        }
        return value;
    }

    readSB(count: number): number {
        if (count === 0) {
            return 0;
        }
        const value = this.readUB(count);
        const signBit = 1 << (count - 1);
        return value & signBit ? value - (1 << count) : value;
    }

    align(): void {
        if (this.bitPos !== 0) {
            this.bitPos = 0;
            this.bytePos++;
        }
    }
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    let text = "";
    for (let index = 0; index < length; index++) {
        text += String.fromCharCode(bytes[offset + index]);
    }
    return text;
}

function readUI32(bytes: Uint8Array, offset: number): number {
    return (bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)) >>> 0;
}

function decodeString(bytes: Uint8Array): string {
    if (typeof TextDecoder !== "undefined") {
        return new TextDecoder("utf-8").decode(bytes);
    }
    let value = "";
    for (let index = 0; index < bytes.length; index++) {
        value += String.fromCharCode(bytes[index]);
    }
    return value;
}
