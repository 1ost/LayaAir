import {
    SwfCharacter,
    SwfAvm1ActionRecord,
    SwfAvm1ActionValue,
    SwfAbcFile,
    SwfAbcInstruction,
    SwfAbcMetadata,
    SwfAbcMethodBody,
    SwfAbcMultiname,
    SwfAbcTrait,
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
    SwfTagNames,
    SwfUnsupportedFeature,
    reportSwfUnsupportedFeature
} from "./SwfTypes";

export interface SwfParserOptions {
    inflateCws?: (compressedBody: Uint8Array, expectedLength: number) => Promise<Uint8Array>;
    sourceUrl?: string;
    logUnsupported?: boolean;
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

        const parser = new SwfTagParser(options.sourceUrl ?? "unknown-swf");
        const tags = parser.parseTags(reader, body.length);
        const movie = new SwfMovie(
            header,
            tags,
            parser.characters,
            parser.exports,
            parser.symbolClasses,
            parser.unsupportedFeatures,
            options.sourceUrl
        );
        if (options.logUnsupported !== false) {
            for (const feature of parser.unsupportedFeatures) {
                reportSwfUnsupportedFeature(feature);
            }
        }
        return movie;
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
    readonly unsupportedFeatures: SwfUnsupportedFeature[] = [];
    jpegTables?: Uint8Array;

    constructor(private readonly sourceUrl: string) {
    }

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
            try {
                tag.parsed = this.parseTag(tag);
            }
            catch (error) {
                this.unsupportedFeatures.push({
                    source: this.sourceUrl,
                    kind: "tag-parse-error",
                    message: `Failed to parse SWF tag ${tag.name} (${tag.code}): ${String(error)}`,
                    tagCode: tag.code,
                    tagName: tag.name,
                    offset: tag.offset,
                    length: tag.length,
                    detail: error instanceof Error ? { stack: error.stack } : undefined
                });
                throw error;
            }
            if (tag.parsed == null && !isKnownUnparsedControlTag(tag.code)) {
                this.unsupportedFeatures.push({
                    source: this.sourceUrl,
                    kind: "unsupported-tag",
                    message: `Unsupported SWF tag ${tag.name} (${tag.code}) was skipped.`,
                    tagCode: tag.code,
                    tagName: tag.name,
                    offset: tag.offset,
                    length: tag.length
                });
            }
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

function isKnownUnparsedControlTag(code: number): boolean {
    switch (code) {
        case 0: // End
        case 1: // ShowFrame
        case 24: // Protect
        case 58: // EnableDebugger
        case 64: // EnableDebugger2
        case 65: // ScriptLimits
        case 66: // SetTabIndex
        case 71: // ImportAssets2; linkage is not needed by the observed local corpus.
        case 93: // EnableTelemetry
            return true;
        default:
            return false;
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
        offsetPosition + 4 + offset,
        offsetPosition + offset
    ].filter(candidate => candidate > edgeStart && candidate <= reader.length);
    let parsedEdges: { startPaths: SwfShapePath[]; endPaths: SwfShapePath[] } | null = null;
    let fallbackEdges: { startPaths: SwfShapePath[]; endPaths: SwfShapePath[] } | null = null;
    for (const endEdgesOffset of edgeCandidates) {
        const candidate = tryParseMorphEdges(reader.bytes, edgeStart, endEdgesOffset, reader.length, tagCode, fillStyles, lineStyles);
        if (!candidate) {
            continue;
        }
        fallbackEdges ??= candidate;
        if (candidate.endPaths.length > 0 || candidate.startPaths.length === 0) {
            parsedEdges = candidate;
            break;
        }
    }
    parsedEdges ??= fallbackEdges;
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
        const startPaths = parseShapeRecords(startShapeReader, tagCode, morphFillStylesAtRatio(fillStyles, 0), morphLineStylesAtRatio(lineStyles, 0), false);
        const endInitialStyles = startPaths.find(path => path.fillStyle0Index || path.fillStyle1Index || path.lineStyleIndex);
        return {
            startPaths,
            endPaths: parseShapeRecords(endShapeReader, tagCode, morphFillStylesAtRatio(fillStyles, 65535), morphLineStylesAtRatio(lineStyles, 65535), false, endInitialStyles ? {
                fillStyle0: endInitialStyles.fillStyle0Index,
                fillStyle1: endInitialStyles.fillStyle1Index,
                lineStyle: endInitialStyles.lineStyleIndex
            } : undefined)
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
    allowNewStyles: boolean,
    initialStyles?: { fillStyle0?: number; fillStyle1?: number; lineStyle?: number }
): SwfShapePath[] {
    const bits = new SwfBitReader(reader.bytes, reader.pos);
    let fillBits = bits.readUB(4);
    let lineBits = bits.readUB(4);
    let xTwips = 0;
    let yTwips = 0;
    let fillStyle0 = initialStyles?.fillStyle0 ?? 0;
    let fillStyle1 = initialStyles?.fillStyle1 ?? 0;
    let lineStyle = initialStyles?.lineStyle ?? 0;
    let fillStyleOffset = 0;
    let lineStyleOffset = 0;
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
            const styleIndex = bits.readUB(fillBits);
            fillStyle0 = styleIndex === 0 ? 0 : fillStyleOffset + styleIndex;
        }
        if (flags & 0x04) {
            const styleIndex = bits.readUB(fillBits);
            fillStyle1 = styleIndex === 0 ? 0 : fillStyleOffset + styleIndex;
        }
        if (flags & 0x08) {
            const styleIndex = bits.readUB(lineBits);
            lineStyle = styleIndex === 0 ? 0 : lineStyleOffset + styleIndex;
        }
        if (flags & 0x10) {
            if (!allowNewStyles) {
                throw new Error("Unsupported SWF glyph SHAPE record with new styles.");
            }
            bits.align();
            reader.pos = bits.bytePos;
            fillStyleOffset = fillStyles.length;
            lineStyleOffset = lineStyles.length;
            fillStyles.push(...parseFillStyleArray(reader, tagCode, fillStyleOffset));
            lineStyles.push(...parseLineStyleArray(reader, tagCode, lineStyleOffset));
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

function parseFillStyleArray(reader: SwfDataReader, tagCode: number, indexOffset: number = 0): SwfFillStyle[] {
    const count = readExtendedCount(reader, tagCode);
    const fillStyles: SwfFillStyle[] = [];
    for (let index = 0; index < count; index++) {
        fillStyles.push(parseFillStyle(reader, tagCode, indexOffset + index + 1));
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

function parseDoAbc(reader: SwfDataReader): { flags: number; name: string; abcData: Uint8Array; abc: SwfAbcFile; abcParseError?: string } {
    const flags = reader.readUI32();
    const name = reader.readString();
    const abcData = reader.readRemaining();
    let abc: SwfAbcFile;
    let abcParseError: string | undefined;
    try {
        abc = parseAbcFile(abcData);
    } catch (error) {
        abc = createEmptyAbcFile();
        abcParseError = error instanceof Error ? error.message : String(error);
    }
    return {
        flags,
        name,
        abcData,
        abc,
        abcParseError
    };
}

function createEmptyAbcFile(): SwfAbcFile {
    return {
        minorVersion: 0,
        majorVersion: 0,
        constantPool: {
            integers: [0],
            unsignedIntegers: [0],
            doubles: [Number.NaN],
            strings: [""],
            namespaces: [{ kind: 0, nameIndex: 0, name: "" }],
            namespaceSets: [[]],
            multinames: [{ kind: 0, name: "" }]
        },
        methods: [],
        metadata: [],
        instances: [],
        classes: [],
        scripts: [],
        methodBodies: [],
        methodBodiesByMethod: new Map()
    };
}

function parseAbcFile(bytes: Uint8Array): SwfAbcFile {
    const reader = new SwfDataReader(bytes);
    const minorVersion = reader.readUI16();
    const majorVersion = reader.readUI16();
    const constantPool = parseAbcConstantPool(reader);
    const methods = parseAbcMethods(reader, constantPool.strings);
    const metadata = parseAbcMetadata(reader, constantPool.strings);
    const classCount = reader.readEncodedU32();
    const instances = [];
    for (let index = 0; index < classCount; index++) {
        const nameIndex = reader.readEncodedU32();
        const superNameIndex = reader.readEncodedU32();
        const flags = reader.readUI8();
        const protectedNamespaceIndex = (flags & 0x08) !== 0 ? reader.readEncodedU32() : undefined;
        const interfaceCount = reader.readEncodedU32();
        const interfaceIndexes = [];
        for (let interfaceIndex = 0; interfaceIndex < interfaceCount; interfaceIndex++) {
            interfaceIndexes.push(reader.readEncodedU32());
        }
        instances.push({
            nameIndex,
            name: abcMultinameName(constantPool.multinames, nameIndex),
            superNameIndex,
            superName: abcMultinameName(constantPool.multinames, superNameIndex),
            flags,
            protectedNamespaceIndex,
            interfaceIndexes,
            initMethodIndex: reader.readEncodedU32(),
            traits: parseAbcTraits(reader, constantPool, metadata)
        });
    }
    const classes = [];
    for (let index = 0; index < classCount; index++) {
        classes.push({
            initMethodIndex: reader.readEncodedU32(),
            traits: parseAbcTraits(reader, constantPool, metadata)
        });
    }
    const scriptCount = reader.readEncodedU32();
    const scripts = [];
    for (let index = 0; index < scriptCount; index++) {
        scripts.push({
            initMethodIndex: reader.readEncodedU32(),
            traits: parseAbcTraits(reader, constantPool, metadata)
        });
    }
    const methodBodyCount = reader.readEncodedU32();
    const methodBodies: SwfAbcMethodBody[] = [];
    const methodBodiesByMethod = new Map<number, SwfAbcMethodBody>();
    for (let index = 0; index < methodBodyCount; index++) {
        const body = parseAbcMethodBody(reader, constantPool, metadata);
        methodBodies.push(body);
        methodBodiesByMethod.set(body.methodIndex, body);
    }
    return {
        minorVersion,
        majorVersion,
        constantPool,
        methods,
        metadata,
        instances,
        classes,
        scripts,
        methodBodies,
        methodBodiesByMethod
    };
}

function parseAbcConstantPool(reader: SwfDataReader): SwfAbcFile["constantPool"] {
    const integers = [0];
    for (let index = 1, count = reader.readEncodedU32(); index < count; index++) {
        integers.push(reader.readEncodedS32());
    }
    const unsignedIntegers = [0];
    for (let index = 1, count = reader.readEncodedU32(); index < count; index++) {
        unsignedIntegers.push(reader.readEncodedU32());
    }
    const doubles = [Number.NaN];
    for (let index = 1, count = reader.readEncodedU32(); index < count; index++) {
        doubles.push(reader.readFloat64());
    }
    const strings = [""];
    for (let index = 1, count = reader.readEncodedU32(); index < count; index++) {
        strings.push(decodeString(reader.readBytes(reader.readEncodedU32())));
    }
    const namespaces = [{ kind: 0, nameIndex: 0, name: "" }];
    for (let index = 1, count = reader.readEncodedU32(); index < count; index++) {
        const kind = reader.readUI8();
        const nameIndex = reader.readEncodedU32();
        namespaces.push({ kind, nameIndex, name: strings[nameIndex] ?? "" });
    }
    const namespaceSets = [[] as number[]];
    for (let index = 1, count = reader.readEncodedU32(); index < count; index++) {
        const setCount = reader.readEncodedU32();
        const set = [];
        for (let setIndex = 0; setIndex < setCount; setIndex++) {
            set.push(reader.readEncodedU32());
        }
        namespaceSets.push(set);
    }
    const multinames: SwfAbcMultiname[] = [{ kind: 0, name: "" }];
    for (let index = 1, count = reader.readEncodedU32(); index < count; index++) {
        const kind = reader.readUI8();
        const multiname: SwfAbcMultiname = { kind, name: "" };
        switch (kind) {
            case 0x07:
            case 0x0d:
                multiname.namespaceIndex = reader.readEncodedU32();
                multiname.name = strings[reader.readEncodedU32()] ?? "";
                break;
            case 0x0f:
            case 0x10:
                multiname.name = strings[reader.readEncodedU32()] ?? "";
                break;
            case 0x11:
            case 0x12:
                break;
            case 0x09:
            case 0x0e:
                multiname.name = strings[reader.readEncodedU32()] ?? "";
                multiname.namespaceSetIndex = reader.readEncodedU32();
                break;
            case 0x1b:
            case 0x1c:
                multiname.namespaceSetIndex = reader.readEncodedU32();
                break;
            case 0x1d: {
                multiname.qualifiedNameIndex = reader.readEncodedU32();
                const parameterCount = reader.readEncodedU32();
                multiname.parameterIndexes = [];
                for (let parameterIndex = 0; parameterIndex < parameterCount; parameterIndex++) {
                    multiname.parameterIndexes.push(reader.readEncodedU32());
                }
                multiname.name = abcMultinameName(multinames, multiname.qualifiedNameIndex);
                break;
            }
            default:
                throw new Error(`Unsupported ABC multiname kind 0x${kind.toString(16)}.`);
        }
        multinames.push(multiname);
    }
    return { integers, unsignedIntegers, doubles, strings, namespaces, namespaceSets, multinames };
}

function parseAbcMethods(reader: SwfDataReader, strings: string[]): SwfAbcFile["methods"] {
    const methods = [];
    for (let index = 0, count = reader.readEncodedU32(); index < count; index++) {
        const paramCount = reader.readEncodedU32();
        const returnType = reader.readEncodedU32();
        const paramTypes = [];
        for (let paramIndex = 0; paramIndex < paramCount; paramIndex++) {
            paramTypes.push(reader.readEncodedU32());
        }
        const nameIndex = reader.readEncodedU32();
        const flags = reader.readUI8();
        const method: SwfAbcFile["methods"][number] = {
            returnType,
            paramTypes,
            nameIndex,
            name: strings[nameIndex] ?? "",
            flags
        };
        if (flags & 0x08) {
            const optionCount = reader.readEncodedU32();
            method.options = [];
            for (let optionIndex = 0; optionIndex < optionCount; optionIndex++) {
                method.options.push({ valueIndex: reader.readEncodedU32(), kind: reader.readUI8() });
            }
        }
        if (flags & 0x80) {
            method.paramNames = [];
            for (let paramIndex = 0; paramIndex < paramCount; paramIndex++) {
                method.paramNames.push(strings[reader.readEncodedU32()] ?? "");
            }
        }
        methods.push(method);
    }
    return methods;
}

function parseAbcMetadata(reader: SwfDataReader, strings: string[]): SwfAbcMetadata[] {
    const metadata = [];
    for (let index = 0, count = reader.readEncodedU32(); index < count; index++) {
        const nameIndex = reader.readEncodedU32();
        const itemCount = reader.readEncodedU32();
        const keys: number[] = [];
        const values: number[] = [];
        for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
            keys.push(reader.readEncodedU32());
        }
        for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
            values.push(reader.readEncodedU32());
        }
        metadata.push({
            nameIndex,
            name: strings[nameIndex] ?? "",
            items: keys.map((keyIndex, itemIndex) => ({
                keyIndex,
                key: strings[keyIndex] ?? "",
                valueIndex: values[itemIndex] ?? 0,
                value: strings[values[itemIndex] ?? 0] ?? ""
            }))
        });
    }
    return metadata;
}

function parseAbcTraits(reader: SwfDataReader, constantPool: SwfAbcFile["constantPool"], metadata: SwfAbcMetadata[]): SwfAbcTrait[] {
    const traits: SwfAbcTrait[] = [];
    for (let index = 0, count = reader.readEncodedU32(); index < count; index++) {
        const nameIndex = reader.readEncodedU32();
        const kindAndAttributes = reader.readUI8();
        const kind = kindAndAttributes & 0x0f;
        const trait: SwfAbcTrait = {
            nameIndex,
            name: abcMultinameName(constantPool.multinames, nameIndex),
            kind,
            attributes: kindAndAttributes >> 4
        };
        if (kind === 0 || kind === 6) {
            trait.slotId = reader.readEncodedU32();
            trait.typeNameIndex = reader.readEncodedU32();
            trait.valueIndex = reader.readEncodedU32();
            if (trait.valueIndex !== 0) {
                trait.valueKind = reader.readUI8();
            }
        } else if (kind === 4) {
            trait.slotId = reader.readEncodedU32();
            trait.classIndex = reader.readEncodedU32();
        } else if (kind === 5) {
            trait.slotId = reader.readEncodedU32();
            trait.functionIndex = reader.readEncodedU32();
        } else if (kind === 1 || kind === 2 || kind === 3) {
            trait.slotId = reader.readEncodedU32();
            trait.methodIndex = reader.readEncodedU32();
        } else {
            throw new Error(`Unsupported ABC trait kind ${kind}.`);
        }
        if (trait.attributes & 0x04) {
            const metadataCount = reader.readEncodedU32();
            trait.metadataIndexes = [];
            for (let metadataIndex = 0; metadataIndex < metadataCount; metadataIndex++) {
                const indexValue = reader.readEncodedU32();
                if (metadata[indexValue]) {
                    trait.metadataIndexes.push(indexValue);
                }
            }
        }
        traits.push(trait);
    }
    return traits;
}

function parseAbcMethodBody(reader: SwfDataReader, constantPool: SwfAbcFile["constantPool"], metadata: SwfAbcMetadata[]): SwfAbcMethodBody {
    const methodIndex = reader.readEncodedU32();
    const maxStack = reader.readEncodedU32();
    const localCount = reader.readEncodedU32();
    const initScopeDepth = reader.readEncodedU32();
    const maxScopeDepth = reader.readEncodedU32();
    const code = reader.readBytes(reader.readEncodedU32());
    const exceptionCount = reader.readEncodedU32();
    const exceptions = [];
    for (let index = 0; index < exceptionCount; index++) {
        exceptions.push({
            from: reader.readEncodedU32(),
            to: reader.readEncodedU32(),
            target: reader.readEncodedU32(),
            exceptionTypeIndex: reader.readEncodedU32(),
            variableNameIndex: reader.readEncodedU32()
        });
    }
    return {
        methodIndex,
        maxStack,
        localCount,
        initScopeDepth,
        maxScopeDepth,
        code,
        instructions: decodeAbcInstructions(code),
        exceptions,
        traits: parseAbcTraits(reader, constantPool, metadata)
    };
}

function decodeAbcInstructions(code: Uint8Array): SwfAbcInstruction[] {
    const reader = new SwfDataReader(code);
    const instructions: SwfAbcInstruction[] = [];
    while (reader.pos < reader.length) {
        const offset = reader.pos;
        const opcode = reader.readUI8();
        const operands = readAbcInstructionOperands(reader, opcode);
        instructions.push({
            opcode,
            name: avm2OpcodeName(opcode),
            offset,
            size: reader.pos - offset,
            operands
        });
    }
    return instructions;
}

function readAbcInstructionOperands(reader: SwfDataReader, opcode: number): number[] {
    switch (opcode) {
        case 0x09:
        case 0x01:
        case 0x02:
        case 0x03:
        case 0x1d:
        case 0x1e:
        case 0x1f:
        case 0x1c:
        case 0x20:
        case 0x21:
        case 0x23:
        case 0x26:
        case 0x27:
        case 0x28:
        case 0x29:
        case 0x2a:
        case 0x2b:
        case 0x30:
        case 0x47:
        case 0x48:
        case 0x57:
        case 0x64:
        case 0x73:
        case 0x74:
        case 0x75:
        case 0x76:
        case 0x78:
        case 0x82:
        case 0x85:
        case 0x87:
        case 0x90:
        case 0x91:
        case 0x93:
        case 0x95:
        case 0x96:
        case 0x97:
        case 0xa0:
        case 0xa1:
        case 0xa2:
        case 0xa3:
        case 0xa4:
        case 0xa5:
        case 0xa6:
        case 0xa7:
        case 0xa8:
        case 0xa9:
        case 0xaa:
        case 0xab:
        case 0xac:
        case 0xad:
        case 0xae:
        case 0xaf:
        case 0xb0:
        case 0xb1:
        case 0xb3:
        case 0xb4:
        case 0xc0:
        case 0xc1:
        case 0xd0:
        case 0xd1:
        case 0xd2:
        case 0xd3:
        case 0xd4:
        case 0xd5:
        case 0xd6:
        case 0xd7:
        case 0xf7:
            return [];
        case 0x10:
        case 0x11:
        case 0x12:
        case 0x0c:
        case 0x0d:
        case 0x0e:
        case 0x0f:
        case 0x13:
        case 0x14:
        case 0x15:
        case 0x16:
        case 0x17:
        case 0x18:
        case 0x19:
        case 0x1a:
            return [reader.readSI24()];
        case 0x1b: {
            const defaultOffset = reader.readSI24();
            const caseCount = reader.readEncodedU32();
            const operands = [defaultOffset, caseCount];
            for (let index = 0; index <= caseCount; index++) {
                operands.push(reader.readSI24());
            }
            return operands;
        }
        case 0x25:
            return [reader.readEncodedS32()];
        case 0x24:
            return [reader.readSI8()];
        case 0x65:
            return [reader.readUI8()];
        case 0x08:
        case 0x04:
        case 0x05:
        case 0x2c:
        case 0x2d:
        case 0x2e:
        case 0x2f:
        case 0x31:
        case 0x40:
        case 0x41:
        case 0x42:
        case 0x49:
        case 0x53:
        case 0x56:
        case 0x58:
        case 0x59:
        case 0x5a:
        case 0x5d:
        case 0x5e:
        case 0x5f:
        case 0x60:
        case 0x61:
        case 0x62:
        case 0x63:
        case 0x66:
        case 0x68:
        case 0x6a:
        case 0x6c:
        case 0x6d:
        case 0x6e:
        case 0x80:
        case 0x86:
        case 0x92:
        case 0x94:
        case 0xb2:
        case 0xc2:
        case 0xc3:
            return [reader.readEncodedU32()];
        case 0x32:
        case 0x45:
        case 0x46:
        case 0x4a:
        case 0x4c:
        case 0x4e:
        case 0x4f:
        case 0x55:
            return [reader.readEncodedU32(), reader.readEncodedU32()];
        default:
            throw new Error(`Unsupported ABC opcode 0x${opcode.toString(16)} at ${reader.pos - 1}.`);
    }
}

function avm2OpcodeName(opcode: number): string {
    switch (opcode) {
        case 0x08: return "OP_kill";
        case 0x01: return "OP_bkpt";
        case 0x02: return "OP_nop";
        case 0x03: return "OP_throw";
        case 0x04: return "OP_getsuper";
        case 0x05: return "OP_setsuper";
        case 0x09: return "OP_label";
        case 0x0c: return "OP_ifnlt";
        case 0x0d: return "OP_ifnle";
        case 0x0e: return "OP_ifngt";
        case 0x0f: return "OP_ifnge";
        case 0x10: return "OP_jump";
        case 0x11: return "OP_iftrue";
        case 0x12: return "OP_iffalse";
        case 0x13: return "OP_ifeq";
        case 0x14: return "OP_ifne";
        case 0x15: return "OP_iflt";
        case 0x16: return "OP_ifle";
        case 0x17: return "OP_ifgt";
        case 0x18: return "OP_ifge";
        case 0x19: return "OP_ifstricteq";
        case 0x1a: return "OP_ifstrictne";
        case 0x1b: return "OP_lookupswitch";
        case 0x1c: return "OP_pushwith";
        case 0x1d: return "OP_popscope";
        case 0x20: return "OP_pushnull";
        case 0x21: return "OP_pushundefined";
        case 0x23: return "OP_nextvalue";
        case 0x24: return "OP_pushbyte";
        case 0x25: return "OP_pushshort";
        case 0x26: return "OP_pushtrue";
        case 0x27: return "OP_pushfalse";
        case 0x28: return "OP_pushnan";
        case 0x29: return "OP_pop";
        case 0x2a: return "OP_dup";
        case 0x2b: return "OP_swap";
        case 0x2c: return "OP_pushstring";
        case 0x2d: return "OP_pushint";
        case 0x2e: return "OP_pushuint";
        case 0x2f: return "OP_pushdouble";
        case 0x30: return "OP_pushscope";
        case 0x32: return "OP_hasnext2";
        case 0x40: return "OP_newfunction";
        case 0x41: return "OP_call";
        case 0x42: return "OP_construct";
        case 0x45: return "OP_callmethod";
        case 0x46: return "OP_callproperty";
        case 0x47: return "OP_returnvoid";
        case 0x48: return "OP_returnvalue";
        case 0x49: return "OP_constructsuper";
        case 0x4a: return "OP_constructprop";
        case 0x4c: return "OP_callproplex";
        case 0x4f: return "OP_callpropvoid";
        case 0x53: return "OP_applytype";
        case 0x55: return "OP_newobject";
        case 0x56: return "OP_newarray";
        case 0x57: return "OP_newactivation";
        case 0x58: return "OP_newclass";
        case 0x59: return "OP_getdescendants";
        case 0x5a: return "OP_newcatch";
        case 0x5d: return "OP_findpropstrict";
        case 0x5e: return "OP_findproperty";
        case 0x5f: return "OP_finddef";
        case 0x60: return "OP_getlex";
        case 0x61: return "OP_setproperty";
        case 0x62: return "OP_getlocal";
        case 0x63: return "OP_setlocal";
        case 0x64: return "OP_getglobalscope";
        case 0x65: return "OP_getscopeobject";
        case 0x66: return "OP_getproperty";
        case 0x68: return "OP_initproperty";
        case 0x6a: return "OP_deleteproperty";
        case 0x6c: return "OP_getslot";
        case 0x6d: return "OP_setslot";
        case 0x70: return "OP_convert_s";
        case 0x73: return "OP_convert_i";
        case 0x74: return "OP_convert_u";
        case 0x75: return "OP_convert_d";
        case 0x76: return "OP_convert_b";
        case 0x78: return "OP_checkfilter";
        case 0x80: return "OP_coerce";
        case 0x82: return "OP_coerce_a";
        case 0x85: return "OP_coerce_s";
        case 0x86: return "OP_astype";
        case 0x87: return "OP_astypelate";
        case 0x90: return "OP_negate";
        case 0x91: return "OP_increment";
        case 0x92: return "OP_inclocal";
        case 0x93: return "OP_decrement";
        case 0x94: return "OP_declocal";
        case 0x95: return "OP_typeof";
        case 0x96: return "OP_not";
        case 0x97: return "OP_bitnot";
        case 0xa0: return "OP_add";
        case 0xa1: return "OP_subtract";
        case 0xa2: return "OP_multiply";
        case 0xa3: return "OP_divide";
        case 0xa4: return "OP_modulo";
        case 0xa5: return "OP_lshift";
        case 0xa6: return "OP_rshift";
        case 0xa7: return "OP_urshift";
        case 0xa8: return "OP_bitand";
        case 0xa9: return "OP_bitor";
        case 0xaa: return "OP_bitxor";
        case 0xab: return "OP_equals";
        case 0xac: return "OP_strictequals";
        case 0xad: return "OP_lessthan";
        case 0xae: return "OP_lessequals";
        case 0xaf: return "OP_greaterthan";
        case 0xb0: return "OP_greaterequals";
        case 0xb1: return "OP_instanceof";
        case 0xb2: return "OP_istype";
        case 0xb3: return "OP_istypelate";
        case 0xb4: return "OP_in";
        case 0xc0: return "OP_increment_i";
        case 0xc1: return "OP_decrement_i";
        case 0xc2: return "OP_inclocal_i";
        case 0xc3: return "OP_declocal_i";
        case 0xd0: return "OP_getlocal0";
        case 0xd1: return "OP_getlocal1";
        case 0xd2: return "OP_getlocal2";
        case 0xd3: return "OP_getlocal3";
        case 0xd4: return "OP_setlocal0";
        case 0xd5: return "OP_setlocal1";
        case 0xd6: return "OP_setlocal2";
        case 0xd7: return "OP_setlocal3";
        case 0xf7: return "OP_timestamp";
        default: return `OP_0x${opcode.toString(16).padStart(2, "0")}`;
    }
}

function abcMultinameName(multinames: SwfAbcMultiname[], index: number | undefined): string {
    if (!index) {
        return "";
    }
    const multiname = multinames[index];
    return multiname?.name ?? "";
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

    readSI8(): number {
        const value = this.readUI8();
        return value & 0x80 ? value - 0x100 : value;
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

    readEncodedS32(): number {
        return this.readEncodedU32() | 0;
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

    readSI24(): number {
        this.require(3);
        let value = this.bytes[this.pos]
            | (this.bytes[this.pos + 1] << 8)
            | (this.bytes[this.pos + 2] << 16);
        this.pos += 3;
        if (value & 0x800000) {
            value -= 0x1000000;
        }
        return value;
    }

    readFloat32(): number {
        this.require(4);
        const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4);
        const value = view.getFloat32(0, true);
        this.pos += 4;
        return value;
    }

    readFloat64(): number {
        this.require(8);
        const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8);
        const value = view.getFloat64(0, true);
        this.pos += 8;
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
