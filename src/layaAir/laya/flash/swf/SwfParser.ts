import {
    SwfCharacter,
    SwfAvm1ActionRecord,
    SwfAvm1ActionValue,
    SwfButtonAction,
    SwfButtonRecord,
    SwfButtonStateName,
    SwfColorTransformWithAlpha,
    SwfCsmTextSettings,
    SwfDefineBitsJpeg,
    SwfDefineBitsLossless,
    SwfDefineButton,
    SwfDefineButtonSound,
    SwfDefineEditText,
    SwfDefineFont,
    SwfDefineFontInfo,
    SwfDefineFontName,
    SwfDefineMorphShape,
    SwfDefineScalingGrid,
    SwfDefineShape,
    SwfDefineSprite,
    SwfDefineText,
    SwfDoAction,
    SwfDoInitAction,
    SwfExportAsset,
    SwfFillStyle,
    SwfFileAttributes,
    SwfFilter,
    SwfFrameLabel,
    SwfFontAlignZones,
    SwfFontGlyph,
    SwfFontZoneRecord,
    SwfGradientRecord,
    SwfHeader,
    SwfJpegTables,
    SwfLineStyle,
    SwfMatrix,
    SwfMorphFillStyle,
    SwfMorphGradientRecord,
    SwfMorphLineStyle,
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
    SwfSoundInfo,
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
        if (typeof decompressionStream !== "function" || typeof Response !== "function") {
            throw new Error("CWS compressed SWF requires platform DecompressionStream support or a custom inflateCws option.");
        }

        const body = new Response(compressedBody).body;
        if (body == null) {
            throw new Error("CWS compressed SWF could not create a byte stream.");
        }
        const stream = body.pipeThrough(new decompressionStream("deflate"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }
}

class SwfTagParser {
    readonly characters: Map<number, SwfCharacter> = new Map();
    readonly exports: SwfExportAsset[] = [];
    readonly symbolClasses: SwfSymbolClass[] = [];
    jpegTables?: Uint8Array;

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
            case 12:
                return parseDoAction(reader);
            case 4:
                return parsePlaceObject(reader, tag.code);
            case 5:
                return parseRemoveObject(reader, tag.code);
            case 20:
                return this.rememberCharacter(parseDefineBitsLossless(reader, false));
            case 6:
                return this.rememberCharacter(parseDefineBitsJpeg(reader, this.jpegTables));
            case 8:
                return this.parseJpegTables(reader);
            case 10:
                return this.rememberCharacter(parseDefineFont(reader));
            case 7:
            case 34:
                return this.rememberCharacter(parseDefineButton(reader, tag.code));
            case 17:
                return this.parseDefineButtonSound(reader);
            case 11:
            case 33:
                return this.rememberCharacter(parseDefineText(reader, tag.code));
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
            case 13:
            case 62:
                return this.parseDefineFontInfo(reader, tag.code);
            case 39:
                return this.rememberCharacter(this.parseDefineSprite(reader));
            case 43:
                return parseFrameLabel(reader);
            case 46:
            case 84:
                return this.rememberCharacter(parseDefineMorphShape(reader, tag.code));
            case 48:
            case 75:
                return this.rememberCharacter(parseDefineFont2Or3(reader, tag.code));
            case 56:
                return this.parseExportAssets(reader);
            case 59:
                return this.parseDoInitAction(reader);
            case 69:
                return parseFileAttributes(reader);
            case 73:
                return this.parseDefineFontAlignZones(reader);
            case 74:
                return this.parseCsmTextSettings(reader);
            case 70:
                return parsePlaceObject3(reader, tag.code);
            case 76:
                return this.parseSymbolClass(reader);
            case 77:
                return parseMetadata(reader);
            case 78:
                return this.parseDefineScalingGrid(reader);
            case 82:
                return parseDoAbc(reader);
            case 86:
                return parseDefineSceneAndFrameLabelData(reader);
            case 88:
                return this.parseDefineFontName(reader);
            case 23:
                return this.parseDefineButtonCxform(reader);
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
        const frameLabels = frames.flatMap(frame => frame.labels);
        const frameLabelsByName = new Map<string, SwfFrameLabel>();
        for (const label of frameLabels) {
            if (!frameLabelsByName.has(label.name)) {
                frameLabelsByName.set(label.name, label);
            }
        }
        return {
            characterId,
            frameCount,
            tags,
            placements,
            namedPlacements,
            frames,
            frameLabels,
            frameLabelsByName,
            initActions: []
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

    private parseJpegTables(reader: SwfDataReader): SwfJpegTables {
        const jpegData = reader.readRemaining();
        this.jpegTables = jpegData;
        return { jpegData };
    }

    private parseDoInitAction(reader: SwfDataReader): SwfDoInitAction {
        const initAction = parseDoInitAction(reader);
        const sprite = this.characters.get(initAction.spriteId) as SwfDefineSprite | undefined;
        if (sprite && "tags" in sprite) {
            sprite.initActions.push(initAction);
        }
        return initAction;
    }

    private parseDefineButtonSound(reader: SwfDataReader): SwfDefineButtonSound {
        const buttonSound = parseDefineButtonSound(reader);
        const button = this.characters.get(buttonSound.buttonId) as SwfDefineButton | undefined;
        if (button && "statePlacements" in button) {
            button.sounds = buttonSound;
        }
        return buttonSound;
    }

    private parseDefineButtonCxform(reader: SwfDataReader): { buttonId: number; colorTransform: SwfColorTransformWithAlpha } {
        const buttonId = reader.readUI16();
        const colorTransform = parseColorTransformNoAlpha(reader);
        const button = this.characters.get(buttonId) as SwfDefineButton | undefined;
        if (button && "statePlacements" in button) {
            button.colorTransform = colorTransform;
            for (const state of Object.keys(button.statePlacements) as SwfButtonStateName[]) {
                button.statePlacements[state] = button.statePlacements[state].map(placement => ({
                    ...placement,
                    colorTransform: composeColorTransforms(placement.colorTransform, colorTransform)
                }));
            }
            button.frames = buildButtonFrames(button.statePlacements);
        }
        return { buttonId, colorTransform };
    }

    private parseDefineFontAlignZones(reader: SwfDataReader): SwfFontAlignZones {
        const fontId = reader.readUI16();
        const packed = reader.readUI8();
        const zones: SwfFontZoneRecord[] = [];
        const font = this.characters.get(fontId) as SwfDefineFont | undefined;
        const glyphCount = font?.glyphCount ?? 0;
        for (let glyph = 0; glyph < glyphCount && reader.pos < reader.length; glyph++) {
            const count = reader.readUI8();
            const data: { alignmentCoordinate: number; range: number }[] = [];
            for (let index = 0; index < count; index++) {
                data.push({
                    alignmentCoordinate: reader.readUI16() / 65536,
                    range: reader.readUI16() / 65536
                });
            }
            const flags = reader.readUI8();
            zones.push({
                data,
                maskX: !!(flags & 0x01),
                maskY: !!(flags & 0x02)
            });
        }
        const alignZones = {
            fontId,
            csmTableHint: packed >> 6,
            zones
        };
        if (font) {
            font.alignZones = alignZones;
        }
        return alignZones;
    }

    private parseDefineFontInfo(reader: SwfDataReader, tagCode: number): SwfDefineFontInfo {
        const fontInfo = parseDefineFontInfo(reader, tagCode);
        const font = this.characters.get(fontInfo.fontId) as SwfDefineFont | undefined;
        if (font) {
            font.fontName = fontInfo.fontName;
            font.codes = fontInfo.codes;
            font.fontInfo = fontInfo;
            font.flags = {
                ...font.flags,
                shiftJis: fontInfo.flags.shiftJis,
                smallText: fontInfo.flags.smallText,
                ansi: fontInfo.flags.ansi,
                italic: fontInfo.flags.italic,
                bold: fontInfo.flags.bold,
                wideCodes: fontInfo.flags.wideCodes
            };
            if (fontInfo.languageCode != null) {
                font.languageCode = fontInfo.languageCode;
            }
        }
        return fontInfo;
    }

    private parseCsmTextSettings(reader: SwfDataReader): SwfCsmTextSettings {
        const csmTextSettings = parseCsmTextSettings(reader);
        const character = this.characters.get(csmTextSettings.textId) as SwfDefineText | SwfDefineEditText | undefined;
        if (character && ("records" in character || "variableName" in character)) {
            character.csmTextSettings = csmTextSettings;
        }
        return csmTextSettings;
    }

    private parseDefineScalingGrid(reader: SwfDataReader): SwfDefineScalingGrid {
        const scalingGrid = parseDefineScalingGrid(reader);
        const character = this.characters.get(scalingGrid.characterId) as SwfCharacter | undefined;
        if (character) {
            (character as any).scalingGrid = scalingGrid;
        }
        return scalingGrid;
    }

    private parseDefineFontName(reader: SwfDataReader): SwfDefineFontName {
        const fontId = reader.readUI16();
        const fontName = reader.readString();
        const fontCopyright = reader.readString();
        const font = this.characters.get(fontId) as SwfDefineFont | undefined;
        if (font) {
            font.fontDisplayName = fontName;
            font.fontCopyright = fontCopyright;
        }
        return { fontId, fontName, fontCopyright };
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

function parseDefineBitsJpeg(reader: SwfDataReader, jpegTables: Uint8Array | undefined): SwfDefineBitsJpeg {
    const characterId = reader.readUI16();
    return {
        characterId,
        imageData: reader.readRemaining(),
        jpegTables,
        requiresJpegTables: true
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

function parseDefineButton(reader: SwfDataReader, tagCode: number): SwfDefineButton {
    const characterId = reader.readUI16();
    let trackAsMenu = false;
    let actionOffset: number | undefined;
    if (tagCode === 34) {
        trackAsMenu = (reader.readUI8() & 0x01) !== 0;
        actionOffset = reader.readUI16();
    }
    const records: SwfButtonRecord[] = [];
    while (reader.pos < reader.length) {
        const flags = reader.readUI8();
        if (flags === 0) {
            break;
        }
        records.push(parseButtonRecord(reader, tagCode, flags));
    }
    const actions = tagCode === 34 && actionOffset !== 0 ? parseButtonActions(reader) : [];
    const statePlacements = buildButtonStatePlacements(tagCode, records);
    const frames = buildButtonFrames(statePlacements);
    const frameLabels = frames.flatMap(frame => frame.labels);
    const frameLabelsByName = new Map<string, SwfFrameLabel>();
    for (const label of frameLabels) {
        frameLabelsByName.set(label.name, label);
    }
    return {
        characterId,
        tagCode,
        trackAsMenu,
        actionOffset,
        records,
        actions,
        statePlacements,
        frames,
        frameLabels,
        frameLabelsByName
    };
}

function parseButtonRecord(reader: SwfDataReader, tagCode: number, flags: number): SwfButtonRecord {
    const characterId = reader.readUI16();
    const depth = reader.readUI16();
    const matrix = parseMatrix(reader);
    const record: SwfButtonRecord = {
        tagCode,
        characterId,
        depth,
        matrix,
        states: {
            up: !!(flags & 0x01),
            over: !!(flags & 0x02),
            down: !!(flags & 0x04),
            hitTest: !!(flags & 0x08)
        },
        rawFlags: flags
    };
    if (tagCode === 34) {
        record.colorTransform = parseColorTransformWithAlpha(reader);
        if (flags & 0x10) {
            record.filters = parseFilterList(reader);
        }
        if (flags & 0x20) {
            record.blendMode = reader.readUI8();
        }
    }
    return record;
}

function parseButtonActions(reader: SwfDataReader): SwfButtonAction[] {
    const actions: SwfButtonAction[] = [];
    while (reader.pos < reader.length) {
        const actionStart = reader.pos;
        const rawSize = reader.readUI16();
        const rawConditionFlags = reader.readUI16();
        const actionEnd = rawSize === 0
            ? reader.length
            : Math.min(reader.length, actionStart + 2 + rawSize);
        const keyPress = (rawConditionFlags >> 9) & 0x7f;
        const actionBytes = reader.readBytes(Math.max(0, actionEnd - reader.pos));
        actions.push({
            conditions: {
                idleToOverDown: !!(rawConditionFlags & 0x0001),
                outDownToIdle: !!(rawConditionFlags & 0x0002),
                outDownToOverDown: !!(rawConditionFlags & 0x0004),
                overDownToOutDown: !!(rawConditionFlags & 0x0008),
                overDownToOverUp: !!(rawConditionFlags & 0x0010),
                overUpToOverDown: !!(rawConditionFlags & 0x0020),
                overUpToIdle: !!(rawConditionFlags & 0x0040),
                idleToOverUp: !!(rawConditionFlags & 0x0080),
                overDownToIdle: !!(rawConditionFlags & 0x0100)
            },
            keyPress,
            actions: actionBytes,
            decodedActions: decodeAvm1Actions(actionBytes),
            rawConditionFlags,
            rawSize
        });
        if (rawSize === 0) {
            break;
        }
    }
    return actions;
}

function parseDefineButtonSound(reader: SwfDataReader): SwfDefineButtonSound {
    const buttonSound: SwfDefineButtonSound = {
        buttonId: reader.readUI16()
    };
    const slots: (keyof Omit<SwfDefineButtonSound, "buttonId">)[] = [
        "upToOver",
        "overToUp",
        "overToDown",
        "downToOver"
    ];
    for (const slot of slots) {
        const soundId = reader.readUI16();
        if (soundId !== 0) {
            buttonSound[slot] = {
                soundId,
                soundInfo: parseSoundInfo(reader)
            };
        }
    }
    return buttonSound;
}

function parseSoundInfo(reader: SwfDataReader): SwfSoundInfo {
    const flags = reader.readUI8();
    const soundInfo: SwfSoundInfo = {
        syncStop: !!(flags & 0x20),
        syncNoMultiple: !!(flags & 0x10),
        hasEnvelope: !!(flags & 0x08),
        hasLoops: !!(flags & 0x04),
        hasOutPoint: !!(flags & 0x02),
        hasInPoint: !!(flags & 0x01),
        rawFlags: flags
    };
    if (soundInfo.hasInPoint) {
        soundInfo.inPoint = reader.readUI32();
    }
    if (soundInfo.hasOutPoint) {
        soundInfo.outPoint = reader.readUI32();
    }
    if (soundInfo.hasLoops) {
        soundInfo.loopCount = reader.readUI16();
    }
    if (soundInfo.hasEnvelope) {
        const count = reader.readUI8();
        soundInfo.envelopeRecords = [];
        for (let index = 0; index < count; index++) {
            soundInfo.envelopeRecords.push({
                position44: reader.readUI32(),
                leftLevel: reader.readUI16(),
                rightLevel: reader.readUI16()
            });
        }
    }
    return soundInfo;
}

function composeColorTransforms(
    placement: SwfColorTransformWithAlpha | undefined,
    button: SwfColorTransformWithAlpha
): SwfColorTransformWithAlpha {
    return {
        ...button,
        ...placement
    };
}

function buildButtonStatePlacements(tagCode: number, records: SwfButtonRecord[]): Record<SwfButtonStateName, SwfPlaceObject[]> {
    const statePlacements: Record<SwfButtonStateName, SwfPlaceObject[]> = {
        up: [],
        over: [],
        down: [],
        hit: []
    };
    for (const record of records) {
        const placement: SwfPlaceObject = {
            tagCode,
            depth: record.depth,
            characterId: record.characterId,
            matrix: record.matrix,
            colorTransform: record.colorTransform,
            filters: record.filters,
            blendMode: record.blendMode,
            rawFlags: [record.rawFlags]
        };
        if (record.states.up) {
            statePlacements.up.push({ ...placement, rawFlags: [...placement.rawFlags] });
        }
        if (record.states.over) {
            statePlacements.over.push({ ...placement, rawFlags: [...placement.rawFlags] });
        }
        if (record.states.down) {
            statePlacements.down.push({ ...placement, rawFlags: [...placement.rawFlags] });
        }
        if (record.states.hitTest) {
            statePlacements.hit.push({ ...placement, rawFlags: [...placement.rawFlags] });
        }
    }
    for (const state of Object.keys(statePlacements) as SwfButtonStateName[]) {
        statePlacements[state].sort(comparePlacementDepth);
    }
    return statePlacements;
}

function buildButtonFrames(statePlacements: Record<SwfButtonStateName, SwfPlaceObject[]>): import("./SwfTypes").SwfFrame[] {
    return (["up", "over", "down", "hit"] as SwfButtonStateName[]).map((state, index) => {
        const labels = [
            { name: state, frameIndex: index },
            { name: `_${state}`, frameIndex: index }
        ];
        return snapshotButtonFrame(index, statePlacements[state], labels);
    });
}

function snapshotButtonFrame(index: number, placements: SwfPlaceObject[], labels: SwfFrameLabel[]): import("./SwfTypes").SwfFrame {
    const byDepth = new Map<number, SwfPlaceObject>();
    for (const placement of placements) {
        byDepth.set(placement.depth, { ...placement, rawFlags: [...placement.rawFlags] });
    }
    return {
        index,
        placements: [...byDepth.values()].sort(comparePlacementDepth),
        byDepth,
        namedPlacements: new Map(),
        labels,
        actions: []
    };
}

function comparePlacementDepth(left: SwfPlaceObject, right: SwfPlaceObject): number {
    return left.depth - right.depth;
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

function parseDefineMorphShape(reader: SwfDataReader, tagCode: number): SwfDefineMorphShape {
    const characterId = reader.readUI16();
    const startBounds = parseRect(reader);
    const endBounds = parseRect(reader);
    let startEdgeBounds: SwfRect | undefined;
    let endEdgeBounds: SwfRect | undefined;
    let usesNonScalingStrokes: boolean | undefined;
    let usesScalingStrokes: boolean | undefined;
    if (tagCode === 84) {
        startEdgeBounds = parseRect(reader);
        endEdgeBounds = parseRect(reader);
        const flags = reader.readUI8();
        usesNonScalingStrokes = !!(flags & 0x02);
        usesScalingStrokes = !!(flags & 0x01);
    }
    const offsetPosition = reader.pos;
    const offset = reader.readUI32();
    const fillStyles = parseMorphFillStyleArray(reader, tagCode);
    const lineStyles = parseMorphLineStyleArray(reader, tagCode);
    const edgeStart = reader.pos;
    const edgeCandidates = [
        offsetPosition + offset,
        offsetPosition + 4 + offset
    ].filter(candidate => candidate > edgeStart && candidate <= reader.length);
    let parsedEdges: { startPaths: SwfShapePath[]; endPaths: SwfShapePath[] } | null = null;
    for (const endEdgesOffset of edgeCandidates) {
        parsedEdges = tryParseMorphEdges(reader.bytes, edgeStart, endEdgesOffset, reader.length, tagCode, fillStyles, lineStyles);
        if (parsedEdges) {
            break;
        }
    }
    if (!parsedEdges) {
        throw new Error(`Invalid DefineMorphShape ${characterId}: could not split start/end edge records.`);
    }
    reader.pos = reader.length;
    return {
        characterId,
        tagCode,
        startBounds,
        endBounds,
        startEdgeBounds,
        endEdgeBounds,
        usesNonScalingStrokes,
        usesScalingStrokes,
        offset,
        fillStyles,
        lineStyles,
        startPaths: parsedEdges.startPaths,
        endPaths: parsedEdges.endPaths
    };
}

function tryParseMorphEdges(
    bytes: Uint8Array,
    startOffset: number,
    endEdgesOffset: number,
    endOffset: number,
    tagCode: number,
    fillStyles: SwfMorphFillStyle[],
    lineStyles: SwfMorphLineStyle[]
): { startPaths: SwfShapePath[]; endPaths: SwfShapePath[] } | null {
    try {
        const startShapeReader = new SwfDataReader(bytes.subarray(startOffset, endEdgesOffset));
        const endShapeReader = new SwfDataReader(bytes.subarray(endEdgesOffset, endOffset));
        return {
            startPaths: parseShapeRecords(startShapeReader, tagCode, morphFillStylesAtRatio(fillStyles, 0), morphLineStylesAtRatio(lineStyles, 0), false),
            endPaths: parseShapeRecords(endShapeReader, tagCode, morphFillStylesAtRatio(fillStyles, 65535), morphLineStylesAtRatio(lineStyles, 65535), false)
        };
    }
    catch (_error) {
        return null;
    }
}

function parseMorphFillStyleArray(reader: SwfDataReader, tagCode: number): SwfMorphFillStyle[] {
    const count = readExtendedCount(reader, tagCode);
    const fillStyles: SwfMorphFillStyle[] = [];
    for (let index = 1; index <= count; index++) {
        fillStyles.push(parseMorphFillStyle(reader, tagCode, index));
    }
    return fillStyles;
}

function parseMorphFillStyle(reader: SwfDataReader, tagCode: number, index: number): SwfMorphFillStyle {
    const type = reader.readUI8();
    const style: SwfMorphFillStyle = { index, type };
    switch (type) {
        case 0x00:
            style.startColor = parseRgba(reader);
            style.endColor = parseRgba(reader);
            break;
        case 0x10:
        case 0x12:
        case 0x13:
            style.startGradientMatrix = parseMatrix(reader);
            style.endGradientMatrix = parseMatrix(reader);
            style.gradientRecords = parseMorphGradientRecords(reader);
            if (type === 0x13) {
                style.focalPoint = reader.readFixed8();
            }
            break;
        case 0x40:
        case 0x41:
        case 0x42:
        case 0x43:
            style.bitmapId = reader.readUI16();
            style.startBitmapMatrix = parseMatrix(reader);
            style.endBitmapMatrix = parseMatrix(reader);
            break;
        default:
            throw new Error(`Unsupported SWF morph fill style type 0x${type.toString(16)} in tag ${tagCode}.`);
    }
    return style;
}

function parseMorphGradientRecords(reader: SwfDataReader): SwfMorphGradientRecord[] {
    const count = reader.readUI8() & 0x0f;
    const records: SwfMorphGradientRecord[] = [];
    for (let index = 0; index < count; index++) {
        records.push({
            startRatio: reader.readUI8(),
            startColor: parseRgba(reader),
            endRatio: reader.readUI8(),
            endColor: parseRgba(reader)
        });
    }
    return records;
}

function parseMorphLineStyleArray(reader: SwfDataReader, tagCode: number): SwfMorphLineStyle[] {
    const count = readExtendedCount(reader, tagCode);
    const lineStyles: SwfMorphLineStyle[] = [];
    for (let index = 1; index <= count; index++) {
        lineStyles.push(parseMorphLineStyle(reader, tagCode, index));
    }
    return lineStyles;
}

function parseMorphLineStyle(reader: SwfDataReader, tagCode: number, index: number): SwfMorphLineStyle {
    const startWidthTwips = reader.readUI16();
    const endWidthTwips = reader.readUI16();
    const lineStyle: SwfMorphLineStyle = {
        index,
        startWidthTwips,
        endWidthTwips,
        startWidth: startWidthTwips / 20,
        endWidth: endWidthTwips / 20
    };
    if (tagCode === 84) {
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
            lineStyle.fillStyle = parseMorphFillStyle(reader, tagCode, 0);
        }
        else {
            lineStyle.startColor = parseRgba(reader);
            lineStyle.endColor = parseRgba(reader);
        }
        return lineStyle;
    }
    lineStyle.startColor = parseRgba(reader);
    lineStyle.endColor = parseRgba(reader);
    return lineStyle;
}

function morphFillStylesAtRatio(styles: SwfMorphFillStyle[], ratio: number): SwfFillStyle[] {
    return styles.map(style => morphFillStyleAtRatio(style, ratio));
}

function morphFillStyleAtRatio(style: SwfMorphFillStyle, ratio: number): SwfFillStyle {
    const normalized = morphRatioToUnit(ratio);
    const fill: SwfFillStyle = {
        index: style.index,
        type: style.type
    };
    if (style.startColor || style.endColor) {
        fill.color = interpolateRgba(style.startColor, style.endColor, normalized);
    }
    if (style.bitmapId != null) {
        fill.bitmapId = style.bitmapId;
        fill.bitmapMatrix = interpolateMatrix(style.startBitmapMatrix, style.endBitmapMatrix, normalized);
    }
    if (style.gradientRecords?.length) {
        fill.gradientMatrix = interpolateMatrix(style.startGradientMatrix, style.endGradientMatrix, normalized);
        fill.gradientRecords = style.gradientRecords.map(record => ({
            ratio: Math.round(interpolateNumber(record.startRatio, record.endRatio, normalized)),
            color: interpolateRgba(record.startColor, record.endColor, normalized)
        }));
        fill.focalPoint = style.focalPoint;
    }
    return fill;
}

function morphLineStylesAtRatio(styles: SwfMorphLineStyle[], ratio: number): SwfLineStyle[] {
    const normalized = morphRatioToUnit(ratio);
    return styles.map(style => {
        const lineStyle: SwfLineStyle = {
            index: style.index,
            widthTwips: Math.round(interpolateNumber(style.startWidthTwips, style.endWidthTwips, normalized)),
            width: interpolateNumber(style.startWidth, style.endWidth, normalized),
            color: style.startColor || style.endColor ? interpolateRgba(style.startColor, style.endColor, normalized) : undefined,
            fillStyle: style.fillStyle ? morphFillStyleAtRatio(style.fillStyle, ratio) : undefined,
            startCapStyle: style.startCapStyle,
            joinStyle: style.joinStyle,
            hasFill: style.hasFill,
            noHScale: style.noHScale,
            noVScale: style.noVScale,
            pixelHinting: style.pixelHinting,
            noClose: style.noClose,
            endCapStyle: style.endCapStyle,
            miterLimitFactor: style.miterLimitFactor
        };
        return lineStyle;
    });
}

function parseShapeWithStyle(reader: SwfDataReader, tagCode: number): { fillStyles: SwfFillStyle[]; lineStyles: SwfLineStyle[]; paths: SwfShapePath[] } {
    const fillStyles = parseFillStyleArray(reader, tagCode);
    const lineStyles = parseLineStyleArray(reader, tagCode);
    const paths = parseShapeRecords(reader, tagCode, fillStyles, lineStyles, true);
    return { fillStyles, lineStyles, paths };
}

function parseGlyphShape(bytes: Uint8Array): SwfShapePath[] {
    if (bytes.length === 0) {
        return [];
    }
    const reader = new SwfDataReader(bytes);
    return parseShapeRecords(reader, 75, [], [], false);
}

function parseShapeRecords(
    reader: SwfDataReader,
    tagCode: number,
    fillStyles: SwfFillStyle[],
    lineStyles: SwfLineStyle[],
    allowNewStyles: boolean
): SwfShapePath[] {
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
            if (!allowNewStyles) {
                throw new Error("Unsupported SWF glyph SHAPE record with new styles.");
            }
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
    return paths;
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
            style.spreadMode = (style.gradientRecords as any).spreadMode;
            style.interpolationMode = (style.gradientRecords as any).interpolationMode;
            if (type === 0x13) {
                style.focalPoint = reader.readFixed8();
            }
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
    const spreadMode = (packed >> 6) & 0x03;
    const interpolationMode = (packed >> 4) & 0x03;
    const count = packed & 0x0f;
    const records: SwfGradientRecord[] = [];
    for (let index = 0; index < count; index++) {
        records.push({
            ratio: reader.readUI8(),
            color: tagCode >= 32 ? parseRgba(reader) : rgbToRgba(parseRgb(reader))
        });
    }
    (records as any).spreadMode = spreadMode;
    (records as any).interpolationMode = interpolationMode;
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

function parseDefineFont(reader: SwfDataReader): SwfDefineFont {
    const characterId = reader.readUI16();
    const offsetTableStart = reader.pos;
    if (reader.pos >= reader.length) {
        return createDefineFont1(characterId, [], 0, reader.bytes.subarray(reader.pos, reader.pos), []);
    }
    const firstOffset = reader.readUI16();
    if ((firstOffset & 1) !== 0) {
        throw new Error(`Invalid DefineFont glyph offset table for font ${characterId}.`);
    }
    const glyphCount = firstOffset / 2;
    const glyphOffsets = [firstOffset];
    for (let index = 1; index < glyphCount; index++) {
        glyphOffsets.push(reader.readUI16());
    }
    const glyphShapeStart = offsetTableStart + glyphCount * 2;
    const glyphShapeEnd = reader.length;
    const glyphShapeBytes = reader.bytes.subarray(glyphShapeStart, glyphShapeEnd);
    const glyphs: SwfFontGlyph[] = [];
    for (let index = 0; index < glyphCount; index++) {
        const start = offsetTableStart + glyphOffsets[index];
        const end = index + 1 < glyphCount ? offsetTableStart + glyphOffsets[index + 1] : glyphShapeEnd;
        if (start < glyphShapeStart || end < start || end > glyphShapeEnd) {
            throw new Error(`Invalid DefineFont glyph offset ${index} for font ${characterId}.`);
        }
        const shapeBytes = reader.bytes.subarray(start, end);
        glyphs.push({
            index,
            shapeBytes,
            paths: parseGlyphShape(shapeBytes)
        });
    }
    reader.pos = reader.length;
    return createDefineFont1(characterId, glyphOffsets, glyphShapeEnd - offsetTableStart, glyphShapeBytes, glyphs);
}

function createDefineFont1(
    characterId: number,
    glyphOffsets: number[],
    codeTableOffset: number,
    glyphShapeBytes: Uint8Array,
    glyphs: SwfFontGlyph[]
): SwfDefineFont {
    return {
        characterId,
        tagCode: 10,
        flags: {
            hasLayout: false,
            shiftJis: false,
            smallText: false,
            ansi: false,
            wideOffsets: false,
            wideCodes: false,
            italic: false,
            bold: false
        },
        languageCode: 0,
        fontName: "",
        glyphCount: glyphOffsets.length,
        glyphOffsets,
        codeTableOffset,
        glyphShapeBytes,
        glyphs,
        codes: []
    };
}

function parseDefineFontInfo(reader: SwfDataReader, tagCode: number): SwfDefineFontInfo {
    const fontId = reader.readUI16();
    const fontNameLength = reader.readUI8();
    const fontName = decodeString(reader.readBytes(fontNameLength)).replace(/\0+$/g, "");
    const flagsByte = reader.readUI8();
    const flags = {
        smallText: !!(flagsByte & 0x20),
        shiftJis: !!(flagsByte & 0x10),
        ansi: !!(flagsByte & 0x08),
        italic: !!(flagsByte & 0x04),
        bold: !!(flagsByte & 0x02),
        wideCodes: !!(flagsByte & 0x01)
    };
    const languageCode = tagCode === 62 ? reader.readUI8() : undefined;
    const codes: number[] = [];
    while (reader.pos < reader.length) {
        codes.push(flags.wideCodes ? reader.readUI16() : reader.readUI8());
    }
    return { fontId, tagCode, fontName, flags, languageCode, codes };
}

function parseCsmTextSettings(reader: SwfDataReader): SwfCsmTextSettings {
    const textId = reader.readUI16();
    const packed = reader.readUI8();
    const thickness = reader.readFixed();
    const sharpness = reader.readFixed();
    if (reader.pos < reader.length) {
        reader.skip(1);
    }
    return {
        textId,
        useFlashType: packed >> 6,
        gridFit: (packed >> 3) & 0x07,
        thickness,
        sharpness
    };
}

function parseDefineScalingGrid(reader: SwfDataReader): SwfDefineScalingGrid {
    return {
        characterId: reader.readUI16(),
        splitter: parseRect(reader)
    };
}

function parseDefineText(reader: SwfDataReader, tagCode: number): SwfDefineText {
    const characterId = reader.readUI16();
    const bounds = parseRect(reader);
    const matrix = parseMatrix(reader);
    const glyphBits = reader.readUI8();
    const advanceBits = reader.readUI8();
    const records: import("./SwfTypes").SwfTextRecord[] = [];
    let currentFontId: number | undefined;
    let currentColor: SwfRgba | undefined;
    let currentXOffsetTwips: number | undefined;
    let currentYOffsetTwips: number | undefined;
    let currentTextHeightTwips: number | undefined;
    while (reader.pos < reader.length) {
        const flags = reader.readUI8();
        if (flags === 0) {
            break;
        }
        if ((flags & 0x80) === 0) {
            throw new Error(`Unsupported SWF text glyph record continuation byte 0x${flags.toString(16)}.`);
        }
        if (flags & 0x08) {
            currentFontId = reader.readUI16();
        }
        if (flags & 0x04) {
            currentColor = tagCode === 33 ? parseRgba(reader) : rgbToRgba(parseRgb(reader));
        }
        if (flags & 0x01) {
            currentXOffsetTwips = reader.readSI16();
        }
        if (flags & 0x02) {
            currentYOffsetTwips = reader.readSI16();
        }
        if (flags & 0x08) {
            currentTextHeightTwips = reader.readUI16();
        }
        const glyphCount = reader.readUI8();
        const bits = new SwfBitReader(reader.bytes, reader.pos);
        const glyphs: { glyphIndex: number; advanceTwips: number }[] = [];
        for (let index = 0; index < glyphCount; index++) {
            glyphs.push({
                glyphIndex: bits.readUB(glyphBits),
                advanceTwips: bits.readSB(advanceBits)
            });
        }
        bits.align();
        reader.pos = bits.bytePos;
        records.push({
            fontId: currentFontId,
            textColor: currentColor,
            xOffsetTwips: currentXOffsetTwips,
            yOffsetTwips: currentYOffsetTwips,
            textHeightTwips: currentTextHeightTwips,
            glyphs
        });
    }
    return { characterId, tagCode, bounds, matrix, glyphBits, advanceBits, records };
}

function parseDefineFont2Or3(reader: SwfDataReader, tagCode: number): SwfDefineFont {
    const characterId = reader.readUI16();
    const flagsByte = reader.readUI8();
    const flags = {
        hasLayout: !!(flagsByte & 0x80),
        shiftJis: !!(flagsByte & 0x40),
        smallText: !!(flagsByte & 0x20),
        ansi: !!(flagsByte & 0x10),
        wideOffsets: !!(flagsByte & 0x08),
        wideCodes: !!(flagsByte & 0x04),
        italic: !!(flagsByte & 0x02),
        bold: !!(flagsByte & 0x01)
    };
    const languageCode = reader.readUI8();
    const fontNameLength = reader.readUI8();
    const fontName = decodeString(reader.readBytes(fontNameLength)).replace(/\0+$/g, "");
    const glyphCount = reader.readUI16();
    const offsetTableStart = reader.pos;
    const glyphOffsets: number[] = [];
    let codeTableOffset = 0;
    if (glyphCount > 0) {
        for (let index = 0; index < glyphCount; index++) {
            glyphOffsets.push(flags.wideOffsets ? reader.readUI32() : reader.readUI16());
        }
        codeTableOffset = flags.wideOffsets ? reader.readUI32() : reader.readUI16();
    }
    const glyphShapeStart = reader.pos;
    const codeTableStart = offsetTableStart + codeTableOffset;
    if (codeTableStart < glyphShapeStart || codeTableStart > reader.length) {
        throw new Error(`Invalid DefineFont${tagCode === 75 ? "3" : "2"} code table offset for font ${characterId}.`);
    }
    const glyphShapeBytes = reader.bytes.subarray(glyphShapeStart, codeTableStart);
    const glyphs: SwfFontGlyph[] = [];
    for (let index = 0; index < glyphCount; index++) {
        const start = offsetTableStart + glyphOffsets[index];
        const end = index + 1 < glyphCount ? offsetTableStart + glyphOffsets[index + 1] : codeTableStart;
        if (start < glyphShapeStart || end < start || end > codeTableStart) {
            throw new Error(`Invalid DefineFont${tagCode === 75 ? "3" : "2"} glyph offset ${index} for font ${characterId}.`);
        }
        const shapeBytes = reader.bytes.subarray(start, end);
        glyphs.push({
            index,
            shapeBytes,
            paths: parseGlyphShape(shapeBytes)
        });
    }
    reader.pos = codeTableStart;
    const codes: number[] = [];
    for (let index = 0; index < glyphCount; index++) {
        codes.push(flags.wideCodes ? reader.readUI16() : reader.readUI8());
    }
    const font: SwfDefineFont = {
        characterId,
        tagCode,
        flags,
        languageCode,
        fontName,
        glyphCount,
        glyphOffsets,
        codeTableOffset,
        glyphShapeBytes,
        glyphs,
        codes
    };
    if (flags.hasLayout) {
        const advancesTwips: number[] = [];
        const bounds: SwfRect[] = [];
        const ascentTwips = reader.readSI16();
        const descentTwips = reader.readSI16();
        const leadingTwips = reader.readSI16();
        for (let index = 0; index < glyphCount; index++) {
            advancesTwips.push(reader.readSI16());
        }
        for (let index = 0; index < glyphCount; index++) {
            bounds.push(parseRect(reader));
        }
        const kerningCount = reader.readUI16();
        const kerning: import("./SwfTypes").SwfKerningRecord[] = [];
        for (let index = 0; index < kerningCount; index++) {
            kerning.push({
                code1: flags.wideCodes ? reader.readUI16() : reader.readUI8(),
                code2: flags.wideCodes ? reader.readUI16() : reader.readUI8(),
                adjustmentTwips: reader.readSI16()
            });
        }
        font.layout = { ascentTwips, descentTwips, leadingTwips, advancesTwips, bounds, kerning };
    }
    return font;
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

function parseFrameLabel(reader: SwfDataReader): SwfFrameLabel {
    const name = reader.readString();
    const namedAnchor = reader.pos < reader.length ? reader.readUI8() !== 0 : undefined;
    return {
        name,
        frameIndex: -1,
        namedAnchor
    };
}

function parseMetadata(reader: SwfDataReader): { metadata: string } {
    return { metadata: reader.readString() };
}

function decodeAvm1Actions(bytes: Uint8Array): SwfAvm1ActionRecord[] {
    const records: SwfAvm1ActionRecord[] = [];
    const reader = new SwfDataReader(bytes);
    while (reader.pos < reader.length) {
        const offset = reader.pos;
        const opcode = reader.readUI8();
        if (opcode === 0) {
            break;
        }
        const dataLength = opcode >= 0x80 ? reader.readUI16() : 0;
        const data = dataLength > 0 ? reader.readBytes(Math.min(dataLength, reader.length - reader.pos)) : new Uint8Array(0);
        const record: SwfAvm1ActionRecord = {
            opcode,
            name: avm1ActionName(opcode),
            offset,
            size: reader.pos - offset,
            data
        };
        decodeAvm1ActionPayload(record);
        records.push(record);
    }
    return records;
}

function decodeAvm1ActionPayload(record: SwfAvm1ActionRecord): void {
    const reader = new SwfDataReader(record.data);
    if (record.opcode === 0x81 && reader.length >= 2) {
        record.frame = reader.readUI16();
        return;
    }
    if (record.opcode === 0x8c) {
        record.label = reader.readString();
        return;
    }
    if (record.opcode === 0x83) {
        record.url = reader.readString();
        record.target = reader.readString();
        return;
    }
    if (record.opcode === 0x99 && reader.length >= 2) {
        record.branchOffset = reader.readSI16();
        return;
    }
    if (record.opcode === 0x88 && reader.length >= 2) {
        const count = reader.readUI16();
        const constantPool: string[] = [];
        for (let index = 0; index < count && reader.pos < reader.length; index++) {
            constantPool.push(reader.readString());
        }
        record.constantPool = constantPool;
        return;
    }
    if (record.opcode === 0x96) {
        const values: SwfAvm1ActionValue[] = [];
        while (reader.pos < reader.length) {
            const type = reader.readUI8();
            if (type === 0) {
                values.push(reader.readString());
            } else if (type === 1 && reader.pos + 4 <= reader.length) {
                values.push(reader.readFloat32());
            } else if (type === 2) {
                values.push(null);
            } else if (type === 3) {
                values.push(undefined);
            } else if (type === 4 && reader.pos < reader.length) {
                values.push(reader.readUI8());
            } else if (type === 5 && reader.pos < reader.length) {
                values.push(reader.readUI8() !== 0);
            } else if (type === 7 && reader.pos + 4 <= reader.length) {
                values.push(reader.readUI32());
            } else if (type === 8 && reader.pos < reader.length) {
                values.push(reader.readUI8());
            } else if (type === 9 && reader.pos + 2 <= reader.length) {
                values.push(reader.readUI16());
            } else {
                break;
            }
        }
        record.values = values;
    }
}

function avm1ActionName(opcode: number): string {
    switch (opcode) {
        case 0x04: return "ActionNextFrame";
        case 0x05: return "ActionPreviousFrame";
        case 0x06: return "ActionPlay";
        case 0x07: return "ActionStop";
        case 0x0a: return "ActionAdd";
        case 0x0b: return "ActionSubtract";
        case 0x0c: return "ActionMultiply";
        case 0x0d: return "ActionDivide";
        case 0x12: return "ActionNot";
        case 0x17: return "ActionPop";
        case 0x1c: return "ActionGetVariable";
        case 0x1d: return "ActionSetVariable";
        case 0x26: return "ActionTrace";
        case 0x3d: return "ActionCallFunction";
        case 0x81: return "ActionGotoFrame";
        case 0x83: return "ActionGetURL";
        case 0x88: return "ActionConstantPool";
        case 0x8c: return "ActionGotoLabel";
        case 0x96: return "ActionPush";
        case 0x99: return "ActionJump";
        case 0x9d: return "ActionIf";
        default: return `Action0x${opcode.toString(16).padStart(2, "0")}`;
    }
}

function parseDoAbc(reader: SwfDataReader): { flags: number; name: string; abcData: Uint8Array } {
    return {
        flags: reader.readUI32(),
        name: reader.readString(),
        abcData: reader.readRemaining()
    };
}

function parseDoAction(reader: SwfDataReader): SwfDoAction {
    const actions = reader.readRemaining();
    return {
        actions,
        decodedActions: decodeAvm1Actions(actions)
    };
}

function parseDoInitAction(reader: SwfDataReader): SwfDoInitAction {
    const spriteId = reader.readUI16();
    const actions = reader.readRemaining();
    return {
        spriteId,
        actions,
        decodedActions: decodeAvm1Actions(actions)
    };
}

function parseDefineSceneAndFrameLabelData(reader: SwfDataReader): {
    scenes: { offset: number; name: string }[];
    frameLabels: { frameNumber: number; name: string }[];
} {
    const scenes: { offset: number; name: string }[] = [];
    const sceneCount = reader.readEncodedU32();
    for (let index = 0; index < sceneCount; index++) {
        scenes.push({
            offset: reader.readEncodedU32(),
            name: reader.readString()
        });
    }
    const frameLabels: { frameNumber: number; name: string }[] = [];
    const frameLabelCount = reader.readEncodedU32();
    for (let index = 0; index < frameLabelCount; index++) {
        frameLabels.push({
            frameNumber: reader.readEncodedU32(),
            name: reader.readString()
        });
    }
    return { scenes, frameLabels };
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

function parseColorTransformNoAlpha(reader: SwfDataReader): SwfColorTransformWithAlpha {
    const bits = new SwfBitReader(reader.bytes, reader.pos);
    const hasAdd = bits.readUB(1) !== 0;
    const hasMult = bits.readUB(1) !== 0;
    const nbits = bits.readUB(4);
    const transform: SwfColorTransformWithAlpha = {};
    if (hasMult) {
        transform.redMultiplier = bits.readSB(nbits);
        transform.greenMultiplier = bits.readSB(nbits);
        transform.blueMultiplier = bits.readSB(nbits);
    }
    if (hasAdd) {
        transform.redAdd = bits.readSB(nbits);
        transform.greenAdd = bits.readSB(nbits);
        transform.blueAdd = bits.readSB(nbits);
    }
    bits.align();
    reader.pos = bits.bytePos;
    return transform;
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

function morphRatioToUnit(ratio: number): number {
    return Math.max(0, Math.min(1, ratio / 65535));
}

function interpolateNumber(start: number | undefined, end: number | undefined, ratio: number): number {
    const from = start ?? end ?? 0;
    const to = end ?? start ?? 0;
    return from + (to - from) * ratio;
}

function interpolateRgba(start: SwfRgba | undefined, end: SwfRgba | undefined, ratio: number): SwfRgba {
    const from = start ?? end ?? { red: 0, green: 0, blue: 0, alpha: 255 };
    const to = end ?? start ?? from;
    return {
        red: Math.round(interpolateNumber(from.red, to.red, ratio)),
        green: Math.round(interpolateNumber(from.green, to.green, ratio)),
        blue: Math.round(interpolateNumber(from.blue, to.blue, ratio)),
        alpha: Math.round(interpolateNumber(from.alpha, to.alpha, ratio))
    };
}

function interpolateMatrix(start: SwfMatrix | undefined, end: SwfMatrix | undefined, ratio: number): SwfMatrix | undefined {
    if (!start && !end) {
        return undefined;
    }
    const from = start ?? end!;
    const to = end ?? start!;
    return {
        scaleX: interpolateNumber(from.scaleX, to.scaleX, ratio),
        scaleY: interpolateNumber(from.scaleY, to.scaleY, ratio),
        rotateSkew0: interpolateNumber(from.rotateSkew0, to.rotateSkew0, ratio),
        rotateSkew1: interpolateNumber(from.rotateSkew1, to.rotateSkew1, ratio),
        translateXTwips: Math.round(interpolateNumber(from.translateXTwips, to.translateXTwips, ratio)),
        translateYTwips: Math.round(interpolateNumber(from.translateYTwips, to.translateYTwips, ratio)),
        translateX: interpolateNumber(from.translateX, to.translateX, ratio),
        translateY: interpolateNumber(from.translateY, to.translateY, ratio)
    };
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

function isFrameLabel(parsed: SwfParsedTag | undefined): parsed is SwfFrameLabel {
    return !!parsed && "name" in parsed && "frameIndex" in parsed;
}

function buildTimelineFrames(tags: SwfTag[]): import("./SwfTypes").SwfFrame[] {
    const frames: import("./SwfTypes").SwfFrame[] = [];
    const byDepth = new Map<number, SwfPlaceObject>();
    const pendingLabels: SwfFrameLabel[] = [];
    const pendingActions: SwfDoAction[] = [];
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
        if (isFrameLabel(parsed)) {
            pendingLabels.push(parsed);
            continue;
        }
        if (tag.code === 12 && isDoAction(parsed)) {
            pendingActions.push(parsed);
            continue;
        }
        if (tag.code === 1) {
            frames.push(snapshotFrame(frames.length, byDepth, pendingLabels.splice(0), pendingActions.splice(0)));
            continue;
        }
        if (tag.code === 0) {
            break;
        }
    }
    return frames;
}

function isDoAction(parsed: SwfParsedTag | undefined): parsed is SwfDoAction {
    return !!parsed && "actions" in parsed && "decodedActions" in parsed && !("spriteId" in parsed);
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

function snapshotFrame(index: number, byDepth: Map<number, SwfPlaceObject>, labels: SwfFrameLabel[], actions: SwfDoAction[]): import("./SwfTypes").SwfFrame {
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
        namedPlacements,
        labels: labels.map(label => ({ ...label, frameIndex: index })),
        actions
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

    readEncodedU32(): number {
        let result = 0;
        for (let index = 0; index < 5; index++) {
            const byte = this.readUI8();
            result |= (byte & 0x7f) << (7 * index);
            if ((byte & 0x80) === 0) {
                return result >>> 0;
            }
        }
        return result >>> 0;
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

    readBytes(length: number): Uint8Array {
        this.require(length);
        const value = this.bytes.subarray(this.pos, this.pos + length);
        this.pos += length;
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
