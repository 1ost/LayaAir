export type SwfCompression = "FWS" | "CWS" | "ZWS";

export interface SwfRect {
    xMinTwips: number;
    xMaxTwips: number;
    yMinTwips: number;
    yMaxTwips: number;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    width: number;
    height: number;
}

export interface SwfHeader {
    compression: SwfCompression;
    version: number;
    fileLength: number;
    frameSize: SwfRect;
    frameRate: number;
    frameCount: number;
}

export interface SwfRgb {
    red: number;
    green: number;
    blue: number;
}

export interface SwfRgba extends SwfRgb {
    alpha: number;
}

export interface SwfMatrix {
    scaleX: number;
    scaleY: number;
    rotateSkew0: number;
    rotateSkew1: number;
    translateXTwips: number;
    translateYTwips: number;
    translateX: number;
    translateY: number;
}

export interface SwfGradientRecord {
    ratio: number;
    color: SwfRgba;
}

export interface SwfFillStyle {
    index: number;
    type: number;
    color?: SwfRgba;
    bitmapId?: number;
    bitmapMatrix?: SwfMatrix;
    gradientMatrix?: SwfMatrix;
    spreadMode?: number;
    interpolationMode?: number;
    focalPoint?: number;
    gradientRecords?: SwfGradientRecord[];
}

export interface SwfLineStyle {
    index: number;
    widthTwips: number;
    width: number;
    color?: SwfRgba;
    fillStyle?: SwfFillStyle;
    startCapStyle?: number;
    joinStyle?: number;
    hasFill?: boolean;
    noHScale?: boolean;
    noVScale?: boolean;
    pixelHinting?: boolean;
    noClose?: boolean;
    endCapStyle?: number;
    miterLimitFactor?: number;
}

export interface SwfShapePoint {
    xTwips: number;
    yTwips: number;
    x: number;
    y: number;
}

export type SwfShapeSegment =
    | {
        type: "line";
        start: SwfShapePoint;
        end: SwfShapePoint;
    }
    | {
        type: "curve";
        start: SwfShapePoint;
        control: SwfShapePoint;
        end: SwfShapePoint;
    };

export interface SwfShapePath {
    fillStyleIndex: number;
    fillStyle0Index?: number;
    fillStyle1Index?: number;
    lineStyleIndex: number;
    points: SwfShapePoint[];
    segments: SwfShapeSegment[];
}

export interface SwfColorTransformWithAlpha {
    redMultiplier?: number;
    greenMultiplier?: number;
    blueMultiplier?: number;
    alphaMultiplier?: number;
    redAdd?: number;
    greenAdd?: number;
    blueAdd?: number;
    alphaAdd?: number;
}

export interface SwfTag {
    code: number;
    name: string;
    length: number;
    offset: number;
    dataOffset: number;
    data: Uint8Array;
    parsed?: SwfParsedTag;
}

export interface SwfFileAttributes {
    useDirectBlit: boolean;
    useGPU: boolean;
    hasMetadata: boolean;
    actionScript3: boolean;
    noCrossDomainCaching: boolean;
    swfRelativeUrls: boolean;
    useNetwork: boolean;
    rawFlags: number;
}

export interface SwfExportAsset {
    characterId: number;
    name: string;
}

export interface SwfDefineSprite {
    characterId: number;
    frameCount: number;
    tags: SwfTag[];
    placements: SwfPlaceObject[];
    namedPlacements: Map<string, SwfPlaceObject>;
    frames: SwfFrame[];
    frameLabels: SwfFrameLabel[];
    frameLabelsByName: Map<string, SwfFrameLabel>;
    initActions: SwfDoInitAction[];
}

export type SwfButtonStateName = "up" | "over" | "down" | "hit";

export interface SwfButtonRecord {
    tagCode: number;
    characterId: number;
    depth: number;
    states: {
        up: boolean;
        over: boolean;
        down: boolean;
        hitTest: boolean;
    };
    matrix: SwfMatrix;
    colorTransform?: SwfColorTransformWithAlpha;
    filters?: SwfFilter[];
    blendMode?: number;
    rawFlags: number;
}

export interface SwfButtonAction {
    conditions: {
        idleToOverDown: boolean;
        outDownToIdle: boolean;
        outDownToOverDown: boolean;
        overDownToOutDown: boolean;
        overDownToOverUp: boolean;
        overUpToOverDown: boolean;
        overUpToIdle: boolean;
        idleToOverUp: boolean;
        overDownToIdle: boolean;
    };
    keyPress: number;
    actions: Uint8Array;
    decodedActions: SwfAvm1ActionRecord[];
    rawConditionFlags: number;
    rawSize: number;
}

export interface SwfDefineButton {
    characterId: number;
    tagCode: number;
    trackAsMenu: boolean;
    actionOffset?: number;
    records: SwfButtonRecord[];
    actions: SwfButtonAction[];
    sounds?: SwfDefineButtonSound;
    colorTransform?: SwfColorTransformWithAlpha;
    statePlacements: Record<SwfButtonStateName, SwfPlaceObject[]>;
    frames: SwfFrame[];
    frameLabels: SwfFrameLabel[];
    frameLabelsByName: Map<string, SwfFrameLabel>;
}

export interface SwfButtonSoundInfo {
    soundId: number;
    soundInfo: SwfSoundInfo;
}

export interface SwfDefineButtonSound {
    buttonId: number;
    upToOver?: SwfButtonSoundInfo;
    overToUp?: SwfButtonSoundInfo;
    overToDown?: SwfButtonSoundInfo;
    downToOver?: SwfButtonSoundInfo;
}

export interface SwfSoundInfo {
    syncStop: boolean;
    syncNoMultiple: boolean;
    hasEnvelope: boolean;
    hasLoops: boolean;
    hasOutPoint: boolean;
    hasInPoint: boolean;
    inPoint?: number;
    outPoint?: number;
    loopCount?: number;
    envelopeRecords?: SwfSoundEnvelopeRecord[];
    rawFlags: number;
}

export interface SwfSoundEnvelopeRecord {
    position44: number;
    leftLevel: number;
    rightLevel: number;
}

export interface SwfPlaceObject {
    tagCode: number;
    depth: number;
    move?: boolean;
    characterId?: number;
    className?: string;
    name?: string;
    matrix?: SwfMatrix;
    colorTransform?: SwfColorTransformWithAlpha;
    ratio?: number;
    clipDepth?: number;
    blendMode?: number;
    visible?: boolean;
    cacheAsBitmap?: boolean;
    hasClipActions?: boolean;
    hasImage?: boolean;
    opaqueBackground?: SwfRgba;
    filters?: SwfFilter[];
    rawFlags: number[];
}

export interface SwfRemoveObject {
    tagCode: number;
    depth: number;
    characterId?: number;
}

export interface SwfFrame {
    index: number;
    placements: SwfPlaceObject[];
    byDepth: Map<number, SwfPlaceObject>;
    namedPlacements: Map<string, SwfPlaceObject>;
    labels: SwfFrameLabel[];
    actions: SwfDoAction[];
}

export interface SwfFrameLabel {
    name: string;
    frameIndex: number;
    namedAnchor?: boolean;
}

export interface SwfFilter {
    id: number;
    name: string;
    color?: SwfRgba;
    highlightColor?: SwfRgba;
    shadowColor?: SwfRgba;
    colors?: SwfRgba[];
    ratios?: number[];
    blurX?: number;
    blurY?: number;
    angle?: number;
    distance?: number;
    strength?: number;
    inner?: boolean;
    knockout?: boolean;
    compositeSource?: boolean;
    onTop?: boolean;
    passes?: number;
    matrixX?: number;
    matrixY?: number;
    divisor?: number;
    bias?: number;
    matrix?: number[];
    defaultColor?: SwfRgba;
    clamp?: boolean;
    preserveAlpha?: boolean;
}

export interface SwfDefineBitsJpeg {
    characterId: number;
    imageData: Uint8Array;
    alphaData?: Uint8Array;
    alphaDataOffset?: number;
    deblockParam?: number;
    jpegTables?: Uint8Array;
    requiresJpegTables?: boolean;
}

export interface SwfJpegTables {
    jpegData: Uint8Array;
}

export interface SwfDefineBitsLossless {
    characterId: number;
    bitmapFormat: number;
    width: number;
    height: number;
    colorTableSize?: number;
    zlibBitmapData: Uint8Array;
    hasAlpha: boolean;
}

export interface SwfDefineEditText {
    characterId: number;
    bounds: SwfRect;
    flags: Record<string, boolean>;
    fontId?: number;
    fontClass?: string;
    fontHeightTwips?: number;
    fontHeight?: number;
    textColor?: SwfRgba;
    maxLength?: number;
    layout?: {
        align: number;
        leftMarginTwips: number;
        rightMarginTwips: number;
        indentTwips: number;
        leadingTwips: number;
    };
    variableName: string;
    initialText?: string;
    csmTextSettings?: SwfCsmTextSettings;
}

export interface SwfDefineFont {
    characterId: number;
    tagCode: number;
    flags: {
        hasLayout: boolean;
        shiftJis: boolean;
        smallText: boolean;
        ansi: boolean;
        wideOffsets: boolean;
        wideCodes: boolean;
        italic: boolean;
        bold: boolean;
    };
    languageCode: number;
    fontName: string;
    glyphCount: number;
    glyphOffsets: number[];
    codeTableOffset: number;
    glyphShapeBytes: Uint8Array;
    glyphs: SwfFontGlyph[];
    codes: number[];
    layout?: {
        ascentTwips: number;
        descentTwips: number;
        leadingTwips: number;
        advancesTwips: number[];
        bounds: SwfRect[];
        kerning: SwfKerningRecord[];
    };
    alignZones?: SwfFontAlignZones;
    fontDisplayName?: string;
    fontCopyright?: string;
    fontInfo?: SwfDefineFontInfo;
    scalingGrid?: SwfDefineScalingGrid;
}

export interface SwfFontGlyph {
    index: number;
    shapeBytes: Uint8Array;
    paths: SwfShapePath[];
}

export interface SwfKerningRecord {
    code1: number;
    code2: number;
    adjustmentTwips: number;
}

export interface SwfFontAlignZones {
    fontId: number;
    csmTableHint: number;
    zones: SwfFontZoneRecord[];
}

export interface SwfFontZoneRecord {
    data: { alignmentCoordinate: number; range: number }[];
    maskX: boolean;
    maskY: boolean;
}

export interface SwfDefineFontName {
    fontId: number;
    fontName: string;
    fontCopyright: string;
}

export interface SwfDefineText {
    characterId: number;
    tagCode: number;
    bounds: SwfRect;
    matrix: SwfMatrix;
    glyphBits: number;
    advanceBits: number;
    records: SwfTextRecord[];
    csmTextSettings?: SwfCsmTextSettings;
    scalingGrid?: SwfDefineScalingGrid;
}

export interface SwfDefineFontInfo {
    fontId: number;
    tagCode: number;
    fontName: string;
    flags: {
        smallText: boolean;
        shiftJis: boolean;
        ansi: boolean;
        italic: boolean;
        bold: boolean;
        wideCodes: boolean;
    };
    languageCode?: number;
    codes: number[];
}

export interface SwfCsmTextSettings {
    textId: number;
    useFlashType: number;
    gridFit: number;
    thickness: number;
    sharpness: number;
}

export interface SwfDefineScalingGrid {
    characterId: number;
    splitter: SwfRect;
}

export interface SwfTextRecord {
    fontId?: number;
    textColor?: SwfRgba;
    xOffsetTwips?: number;
    yOffsetTwips?: number;
    textHeightTwips?: number;
    glyphs: { glyphIndex: number; advanceTwips: number }[];
}

export interface SwfDefineShape {
    characterId: number;
    shapeBounds: SwfRect;
    edgeBounds?: SwfRect;
    usesFillWindingRule?: boolean;
    usesNonScalingStrokes?: boolean;
    usesScalingStrokes?: boolean;
    fillStyles?: SwfFillStyle[];
    lineStyles?: SwfLineStyle[];
    paths?: SwfShapePath[];
}

export interface SwfMorphFillStyle {
    index: number;
    type: number;
    startColor?: SwfRgba;
    endColor?: SwfRgba;
    bitmapId?: number;
    startBitmapMatrix?: SwfMatrix;
    endBitmapMatrix?: SwfMatrix;
    startGradientMatrix?: SwfMatrix;
    endGradientMatrix?: SwfMatrix;
    gradientRecords?: SwfMorphGradientRecord[];
    focalPoint?: number;
}

export interface SwfMorphGradientRecord {
    startRatio: number;
    startColor: SwfRgba;
    endRatio: number;
    endColor: SwfRgba;
}

export interface SwfMorphLineStyle {
    index: number;
    startWidthTwips: number;
    endWidthTwips: number;
    startWidth: number;
    endWidth: number;
    startColor?: SwfRgba;
    endColor?: SwfRgba;
    fillStyle?: SwfMorphFillStyle;
    startCapStyle?: number;
    joinStyle?: number;
    hasFill?: boolean;
    noHScale?: boolean;
    noVScale?: boolean;
    pixelHinting?: boolean;
    noClose?: boolean;
    endCapStyle?: number;
    miterLimitFactor?: number;
}

export interface SwfDefineMorphShape {
    characterId: number;
    tagCode: number;
    startBounds: SwfRect;
    endBounds: SwfRect;
    startEdgeBounds?: SwfRect;
    endEdgeBounds?: SwfRect;
    usesNonScalingStrokes?: boolean;
    usesScalingStrokes?: boolean;
    offset: number;
    fillStyles: SwfMorphFillStyle[];
    lineStyles: SwfMorphLineStyle[];
    startPaths: SwfShapePath[];
    endPaths: SwfShapePath[];
}

export interface SwfDoAbc {
    flags: number;
    name: string;
    abcData: Uint8Array;
}

export interface SwfDoAction {
    actions: Uint8Array;
    decodedActions: SwfAvm1ActionRecord[];
}

export interface SwfDoInitAction {
    spriteId: number;
    actions: Uint8Array;
    decodedActions: SwfAvm1ActionRecord[];
}

export type SwfAvm1ActionValue =
    | string
    | number
    | boolean
    | null
    | undefined;

export interface SwfAvm1ActionRecord {
    opcode: number;
    name: string;
    offset: number;
    size: number;
    data: Uint8Array;
    constantPool?: string[];
    values?: SwfAvm1ActionValue[];
    frame?: number;
    label?: string;
    url?: string;
    target?: string;
    branchOffset?: number;
}

export interface SwfMetadata {
    metadata: string;
}

export interface SwfSceneAndFrameLabelData {
    scenes: SwfSceneData[];
    frameLabels: SwfSceneFrameLabelData[];
}

export interface SwfSceneData {
    offset: number;
    name: string;
}

export interface SwfSceneFrameLabelData {
    frameNumber: number;
    name: string;
}

export interface SwfSymbolClass {
    characterId: number;
    name: string;
}

export type SwfParsedTag =
    | SwfFileAttributes
    | SwfRgb
    | SwfExportAsset[]
    | SwfSymbolClass[]
    | SwfDefineSprite
    | SwfDefineButton
    | SwfPlaceObject
    | SwfRemoveObject
    | SwfDefineBitsJpeg
    | SwfDefineBitsLossless
    | SwfDefineEditText
    | SwfDefineFont
    | SwfDefineText
    | SwfFontAlignZones
    | SwfDefineFontName
    | SwfDefineShape
    | SwfDefineMorphShape
    | SwfDoAction
    | SwfDoInitAction
    | SwfFrameLabel
    | SwfJpegTables
    | SwfDefineFontInfo
    | SwfCsmTextSettings
    | SwfDefineScalingGrid
    | SwfDefineButtonSound
    | SwfDoAbc
    | SwfMetadata
    | SwfSceneAndFrameLabelData;

export type SwfCharacter =
    | SwfDefineSprite
    | SwfDefineButton
    | SwfDefineBitsJpeg
    | SwfDefineBitsLossless
    | SwfDefineEditText
    | SwfDefineFont
    | SwfDefineText
    | SwfDefineShape
    | SwfDefineMorphShape;

export class SwfMovie {
    readonly header: SwfHeader;
    readonly tags: SwfTag[];
    readonly characters: Map<number, SwfCharacter>;
    readonly exports: SwfExportAsset[];
    readonly symbolClasses: SwfSymbolClass[];
    readonly exportsByName: Map<string, SwfExportAsset>;
    readonly exportsByCharacterId: Map<number, SwfExportAsset[]>;
    readonly symbolClassesByName: Map<string, SwfSymbolClass>;
    readonly symbolClassesByCharacterId: Map<number, SwfSymbolClass[]>;

    constructor(header: SwfHeader, tags: SwfTag[], characters: Map<number, SwfCharacter>, exports: SwfExportAsset[], symbolClasses: SwfSymbolClass[] = []) {
        this.header = header;
        this.tags = tags;
        this.characters = characters;
        this.exports = exports;
        this.symbolClasses = symbolClasses;
        this.exportsByName = new Map();
        this.exportsByCharacterId = new Map();
        this.symbolClassesByName = new Map();
        this.symbolClassesByCharacterId = new Map();
        for (const character of characters.values()) {
            (character as any).__rawSwfMovie = this;
        }
        for (const asset of exports) {
            this.exportsByName.set(asset.name, asset);
            let characterExports = this.exportsByCharacterId.get(asset.characterId);
            if (!characterExports) {
                characterExports = [];
                this.exportsByCharacterId.set(asset.characterId, characterExports);
            }
            characterExports.push(asset);
        }
        for (const symbolClass of symbolClasses) {
            this.symbolClassesByName.set(symbolClass.name, symbolClass);
            let characterSymbols = this.symbolClassesByCharacterId.get(symbolClass.characterId);
            if (!characterSymbols) {
                characterSymbols = [];
                this.symbolClassesByCharacterId.set(symbolClass.characterId, characterSymbols);
            }
            characterSymbols.push(symbolClass);
        }
    }

    getExport(name: string): SwfExportAsset | undefined {
        return this.exportsByName.get(name);
    }

    getCharacter(characterId: number): SwfCharacter | undefined {
        return this.characters.get(characterId);
    }

    getExportedCharacter(name: string): SwfCharacter | undefined {
        const asset = this.getExport(name);
        return asset ? this.getCharacter(asset.characterId) : undefined;
    }

    getSprite(characterIdOrExportName: number | string): SwfDefineSprite | undefined {
        const character = typeof characterIdOrExportName === "string"
            ? this.getExportedCharacter(characterIdOrExportName)
            : this.getCharacter(characterIdOrExportName);
        return character && "tags" in character ? character : undefined;
    }

    getButton(characterIdOrExportName: number | string): SwfDefineButton | undefined {
        const character = typeof characterIdOrExportName === "string"
            ? this.getExportedCharacter(characterIdOrExportName)
            : this.getCharacter(characterIdOrExportName);
        return character && "statePlacements" in character ? character : undefined;
    }
}

export const SwfTagNames: { [code: number]: string } = {
    0: "End",
    1: "ShowFrame",
    2: "DefineShape",
    4: "PlaceObject",
    5: "RemoveObject",
    6: "DefineBitsJPEG",
    7: "DefineButton",
    8: "JPEGTables",
    9: "SetBackgroundColor",
    10: "DefineFont",
    11: "DefineText",
    12: "DoAction",
    13: "DefineFontInfo",
    14: "DefineSound",
    15: "StartSound",
    17: "DefineButtonSound",
    18: "SoundStreamHead",
    19: "SoundStreamBlock",
    20: "DefineBitsLossless",
    21: "DefineBitsJPEG2",
    22: "DefineShape2",
    23: "DefineButtonCxform",
    24: "Protect",
    26: "PlaceObject2",
    28: "RemoveObject2",
    32: "DefineShape3",
    33: "DefineText2",
    34: "DefineButton2",
    35: "DefineBitsJPEG3",
    36: "DefineBitsLossless2",
    37: "DefineEditText",
    39: "DefineSprite",
    43: "FrameLabel",
    45: "SoundStreamHead2",
    46: "DefineMorphShape",
    48: "DefineFont2",
    56: "ExportAssets",
    57: "ImportAssets",
    58: "EnableDebugger",
    59: "DoInitAction",
    60: "DefineVideoStream",
    61: "VideoFrame",
    62: "DefineFontInfo2",
    64: "EnableDebugger2",
    65: "ScriptLimits",
    66: "SetTabIndex",
    69: "FileAttributes",
    70: "PlaceObject3",
    71: "ImportAssets2",
    73: "DefineFontAlignZones",
    74: "CSMTextSettings",
    75: "DefineFont3",
    76: "SymbolClass",
    77: "Metadata",
    78: "DefineScalingGrid",
    82: "DoABC",
    83: "DefineShape4",
    84: "DefineMorphShape2",
    86: "DefineSceneAndFrameLabelData",
    87: "DefineBinaryData",
    88: "DefineFontName",
    89: "StartSound2",
    90: "DefineBitsJPEG4"
};
