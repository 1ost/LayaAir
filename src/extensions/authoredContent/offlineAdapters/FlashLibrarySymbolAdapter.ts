import {
    NeutralAuthoredContentIR,
    NeutralAuthoredNode,
    NeutralTimeline,
    normalizeNeutralAuthoredContent,
} from "../core/NeutralAuthoredContentIR";

type NeutralResourceInput = {
    readonly id: string;
    readonly sourcePath: string;
    readonly mediaType: "image/jpeg" | "image/png";
    readonly byteLength: number;
    readonly sha256: string;
};

export interface FlashLibraryResourceAuthority {
    readonly sourcePath: string;
    readonly mediaType: "image/jpeg" | "image/png";
    readonly byteLength: number;
    readonly sha256: string;
}

export interface FlashLibrarySymbolRequest {
    readonly library: unknown;
    readonly timelines: ReadonlyMap<number, unknown>;
    readonly entrySymbolId: number;
    readonly runtimeLinkage: string;
    readonly resources: ReadonlyMap<string, FlashLibraryResourceAuthority>;
}

export class FlashLibrarySymbolAdapter {
    parse(request: FlashLibrarySymbolRequest): NeutralAuthoredContentIR {
        const library = object(request.library, "library");
        exactSchema(library, "flash-library@1", "library");
        const assets = object(library.assets, "library.assets");
        const stage = object(library.stage, "library.stage");
        const stageWidth = finite(stage.width, "library.stage.width");
        const stageHeight = finite(stage.height, "library.stage.height");
        const stageFrameRate = finite(stage.frameRate, "library.stage.frameRate");
        if (stageWidth <= 0 || stageHeight <= 0 || stageFrameRate <= 0)
            fail("FLASH_LIBRARY_STAGE_INVALID", "Stage width, height, and frame rate must be positive.");
        const frameLabels = array(library.frameLabels, "library.frameLabels");
        if (frameLabels.length !== 0)
            fail("FLASH_LIBRARY_FRAME_LABELS_UNSUPPORTED", "This native projection requires an empty frame-label set.");
        const resources = new Map<string, NeutralResourceInput>();
        const root = this.createSprite(
            request.entrySymbolId,
            undefined,
            undefined,
            assets,
            request.timelines,
            request.resources,
            resources,
            true,
        );
        const entryTimeline = timeline(request.timelines, request.entrySymbolId);
        const content = {
            schema: "neutral-authored-content@1",
            documentId: `flash-library-symbol-${request.entrySymbolId}`,
            resources: [...resources.values()],
            root: {
                ...root,
                runtimeLinkage: request.runtimeLinkage,
                width: stageWidth,
                height: stageHeight,
                timeline: undefined,
            },
            timeline: nativeTimeline(entryTimeline, root),
        };
        return normalizeNeutralAuthoredContent(content);
    }

    private createSprite(
        characterId: number,
        operation: Record<string, any> | undefined,
        forcedName: string | undefined,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
        root = false,
    ): NeutralAuthoredNode {
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind !== "sprite")
            fail("FLASH_LIBRARY_SPRITE_REQUIRED", `Character ${characterId} is not a sprite.`);
        const sourceTimeline = timeline(timelines, characterId);
        if (sourceTimeline.symbolId !== characterId)
            fail("FLASH_LIBRARY_TIMELINE_ID_MISMATCH", `Timeline ${characterId} identifies another symbol.`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const firstFrame = frame(sourceTimeline, 0);
        const initialOperations = array(firstFrame.operations, `timeline ${characterId} frame 1 operations`);
        const children = sourceTimeline.frameCount === 1
            ? initialOperations.map((value, index) => this.createPlacedNode(
                object(value, `timeline ${characterId} frame 1 operation ${index}`),
                assets,
                timelines,
                resourceAuthorities,
                resources,
            ))
            : this.createReplacementChildren(
                sourceTimeline,
                assets,
                resourceAuthorities,
                resources,
            );
        const placement = operation === undefined ? { x: 0, y: 0 } : translation(operation);
        const node: NeutralAuthoredNode = {
            linkage: string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            name: forcedName ?? operation?.name ?? string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            kind: "container",
            depth: root ? undefined : positiveInteger(operation?.depth, `sprite ${characterId} depth`),
            x: placement.x,
            y: placement.y,
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            variable: typeof operation?.name === "string",
            children,
            timeline: root ? undefined : nativeTimeline(sourceTimeline, {
                linkage: string(asset.symbolName, `library.assets.${characterId}.symbolName`),
                kind: "container",
                children,
            }),
        };
        return node;
    }

    private createPlacedNode(
        operation: Record<string, any>,
        assets: Record<string, any>,
        timelines: ReadonlyMap<number, unknown>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        exactPlace(operation);
        const characterId = positiveInteger(operation.characterId, "place.characterId");
        const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
        if (asset.kind === "sprite") {
            return this.createSprite(
                characterId,
                operation,
                operation.name,
                assets,
                timelines,
                resourceAuthorities,
                resources,
            );
        }
        if (asset.kind === "shape")
            return this.createImage(asset, operation, resourceAuthorities, resources);
        if (asset.kind === "input-text")
            return this.createDynamicText(asset, operation, assets);
        fail("FLASH_LIBRARY_CHARACTER_KIND_UNSUPPORTED", `Character ${characterId} kind '${String(asset.kind)}' is unsupported.`);
    }

    private createReplacementChildren(
        sourceTimeline: Record<string, any>,
        assets: Record<string, any>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): ReadonlyArray<NeutralAuthoredNode> {
        const seenDepths = new Set<number>();
        const poses: Array<{ characterId: number; depth: number; firstFrame: number }> = [];
        const frames = array(sourceTimeline.frames, `timeline ${sourceTimeline.symbolId}.frames`);
        frames.forEach((value, frameIndex) => {
            const current = object(value, `timeline ${sourceTimeline.symbolId} frame ${frameIndex + 1}`);
            rejectFrameSideEffects(current, sourceTimeline.symbolId);
            array(current.operations, `timeline ${sourceTimeline.symbolId} frame ${frameIndex + 1} operations`)
                .forEach((operationValue, operationIndex) => {
                    const operation = object(operationValue, `timeline operation ${operationIndex}`);
                    exactPlace(operation);
                    const depth = positiveInteger(operation.depth, "place.depth");
                    const characterId = positiveInteger(operation.characterId, "place.characterId");
                    const asset = object(assets[String(characterId)], `library.assets.${characterId}`);
                    if (asset.kind !== "shape")
                        fail("FLASH_LIBRARY_REPLACEMENT_KIND_UNSUPPORTED", "Multi-frame replacement timelines currently require rasterized shapes.");
                    if (!operation.move && seenDepths.has(depth))
                        fail("FLASH_LIBRARY_DEPTH_REPLACEMENT_INVALID", `Depth ${depth} is placed twice without move=true.`);
                    if (operation.move && !seenDepths.has(depth))
                        fail("FLASH_LIBRARY_DEPTH_REPLACEMENT_INVALID", `Depth ${depth} moves before it is placed.`);
                    seenDepths.add(depth);
                    poses.push({ characterId, depth, firstFrame: frameIndex + 1 });
                });
        });
        if (seenDepths.size !== 1 || poses.length < 2)
            fail("FLASH_LIBRARY_REPLACEMENT_TIMELINE_UNSUPPORTED", "Multi-frame timelines require one-depth discrete replacements.");
        return poses.map((pose, index) => {
            const asset = object(assets[String(pose.characterId)], `library.assets.${pose.characterId}`);
            return {
                ...this.createImage(asset, {
                    op: "place",
                    characterId: pose.characterId,
                    depth: index + 1,
                    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                }, resourceAuthorities, resources),
                visible: index === 0,
            };
        });
    }

    private createImage(
        asset: Record<string, any>,
        operation: Record<string, any>,
        resourceAuthorities: ReadonlyMap<string, FlashLibraryResourceAuthority>,
        resources: Map<string, NeutralResourceInput>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "shape.characterId");
        const sourcePath = string(asset.path, `library.assets.${characterId}.path`);
        const authority = resourceAuthorities.get(sourcePath);
        if (!authority || authority.sourcePath !== sourcePath)
            fail("FLASH_LIBRARY_RESOURCE_AUTHORITY_MISSING", `No authenticated resource authority exists for '${sourcePath}'.`);
        const resourceId = `flash-character-${characterId}`;
        const existing = resources.get(resourceId);
        const resource: NeutralResourceInput = {
            id: resourceId,
            sourcePath,
            mediaType: authority.mediaType,
            byteLength: authority.byteLength,
            sha256: authority.sha256,
        };
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(resource))
            fail("FLASH_LIBRARY_RESOURCE_IDENTITY_DRIFT", `Resource '${resourceId}' has conflicting authority.`);
        resources.set(resourceId, resource);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = translation(operation);
        return {
            linkage: string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            name: operation.name ?? string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            kind: "image",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x + finite(bounds.x, `library.assets.${characterId}.bounds.x`),
            y: placement.y + finite(bounds.y, `library.assets.${characterId}.bounds.y`),
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            resourceId,
            variable: typeof operation.name === "string",
            children: [],
        };
    }

    private createDynamicText(
        asset: Record<string, any>,
        operation: Record<string, any>,
        assets: Record<string, any>,
    ): NeutralAuthoredNode {
        const characterId = positiveInteger(asset.characterId, "text.characterId");
        const textField = object(asset.textField, `library.assets.${characterId}.textField`);
        if (textField.useOutlines !== false)
            fail("FLASH_LIBRARY_TEXT_OUTLINES_UNSUPPORTED", `Text ${characterId} is not a device-font field.`);
        const fontId = positiveInteger(textField.fontId, `library.assets.${characterId}.textField.fontId`);
        const fontAsset = object(assets[String(fontId)], `library.assets.${fontId}`);
        const font = object(fontAsset.font, `library.assets.${fontId}.font`);
        const bounds = object(asset.bounds, `library.assets.${characterId}.bounds`);
        const placement = translation(operation);
        return {
            linkage: string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            name: operation.name ?? string(asset.symbolName, `library.assets.${characterId}.symbolName`),
            kind: "dynamic-text",
            depth: positiveInteger(operation.depth, "place.depth"),
            x: placement.x,
            y: placement.y,
            width: finite(bounds.width, `library.assets.${characterId}.bounds.width`),
            height: finite(bounds.height, `library.assets.${characterId}.bounds.height`),
            variable: typeof operation.name === "string",
            textField: {
                sourceId: characterId,
                type: textField.fieldType,
                multiline: boolean(textField.multiline, "text.multiline"),
                wordWrap: boolean(textField.wordWrap, "text.wordWrap"),
                selectable: boolean(textField.selectable, "text.selectable"),
                displayAsPassword: boolean(textField.password, "text.password"),
                autoSize: "none",
                html: false,
                gutter: 2,
                overflow: "hidden",
                initialText: textField.initialText ?? "",
                format: {
                    fontMode: "device",
                    font: string(font.family, `library.assets.${fontId}.font.family`),
                    size: finite(textField.fontSize, "text.fontSize"),
                    color: finite(object(textField.color, "text.color").color, "text.color.color"),
                    bold: boolean(font.bold, "font.bold"),
                    italic: boolean(font.italic, "font.italic"),
                    underline: false,
                    align: textField.align,
                    leftMargin: finite(textField.leftMargin, "text.leftMargin"),
                    rightMargin: finite(textField.rightMargin, "text.rightMargin"),
                    indent: finite(textField.indent, "text.indent"),
                    leading: finite(textField.leading, "text.leading"),
                },
            },
            children: [],
        };
    }
}

function nativeTimeline(source: Record<string, any>, owner: NeutralAuthoredNode): NeutralTimeline {
    const frameRate = finite(source.frameRate, `timeline ${source.symbolId}.frameRate`);
    const frameCount = positiveInteger(source.frameCount, `timeline ${source.symbolId}.frameCount`);
    const frames = array(source.frames, `timeline ${source.symbolId}.frames`);
    if (frames.length !== frameCount)
        fail("FLASH_LIBRARY_FRAME_CLOSURE", `Timeline ${source.symbolId} frame count drifted.`);
    frames.forEach((value, index) => {
        const current = object(value, `timeline ${source.symbolId} frame ${index + 1}`);
        if (current.index !== index + 1 || (current.durationTicks !== undefined && current.durationTicks !== 1))
            fail("FLASH_LIBRARY_FRAME_INDEX_INVALID", `Timeline ${source.symbolId} frame indexing/duration is unsupported.`);
        rejectFrameSideEffects(current, source.symbolId);
    });
    const tracks = frameCount === 1 ? [] : owner.children.map(child => ({
        targetPath: [owner.linkage, child.linkage],
        property: "visible" as const,
        keyframes: frames.flatMap((value, index) => {
            const operations = array(object(value, "frame").operations, "frame.operations");
            if (operations.length === 0)
                return [];
            const activeId = positiveInteger(object(operations[0], "operation").characterId, "operation.characterId");
            const childId = positiveInteger(Number(child.linkage.replace("symbol", "")), "child.characterId");
            return [{ time: index / frameRate, value: activeId === childId }];
        }),
    }));
    return { frameRate, duration: frameCount / frameRate, loop: frameCount > 1, tracks };
}

function timeline(values: ReadonlyMap<number, unknown>, id: number): Record<string, any> {
    const value = object(values.get(id), `timeline ${id}`);
    exactSchema(value, "flash-timeline@1", `timeline ${id}`);
    return value;
}

function frame(sourceTimeline: Record<string, any>, index: number): Record<string, any> {
    return object(array(sourceTimeline.frames, `timeline ${sourceTimeline.symbolId}.frames`)[index], `timeline frame ${index + 1}`);
}

function rejectFrameSideEffects(value: Record<string, any>, symbolId: number): void {
    if (array(value.labels ?? [], `timeline ${symbolId}.labels`).length !== 0)
        fail("FLASH_LIBRARY_FRAME_LABELS_UNSUPPORTED", `Timeline ${symbolId} contains frame labels.`);
    if (array(value.sounds ?? [], `timeline ${symbolId}.sounds`).length !== 0)
        fail("FLASH_LIBRARY_FRAME_SOUNDS_UNSUPPORTED", `Timeline ${symbolId} contains frame sounds.`);
}

function exactPlace(operation: Record<string, any>): void {
    if (operation.op !== "place")
        fail("FLASH_LIBRARY_DISPLAY_OPERATION_UNSUPPORTED", `Display operation '${String(operation.op)}' is unsupported.`);
    if (operation.ratio !== undefined && operation.ratio !== 0)
        fail("FLASH_LIBRARY_MORPH_RATIO_UNSUPPORTED", "Non-zero morph ratios are unsupported.");
    if (operation.matrix !== undefined)
        translation(operation);
}

function translation(operation: Record<string, any>): { x: number; y: number } {
    if (operation.matrix === undefined)
        return { x: 0, y: 0 };
    const matrix = object(operation.matrix, "place.matrix");
    if (matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1)
        fail("FLASH_LIBRARY_MATRIX_UNSUPPORTED", "Only untranslated unit-scale retained placements are admitted by this projection.");
    return { x: finite(matrix.tx, "place.matrix.tx"), y: finite(matrix.ty, "place.matrix.ty") };
}

function exactSchema(value: Record<string, any>, expected: string, label: string): void {
    if (value.schema !== expected)
        fail("FLASH_LIBRARY_SCHEMA_UNSUPPORTED", `${label} schema must be '${expected}'.`);
}

function object(value: unknown, label: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("FLASH_LIBRARY_OBJECT_REQUIRED", `${label} must be an object.`);
    return value as Record<string, any>;
}

function array(value: unknown, label: string): any[] {
    if (!Array.isArray(value))
        fail("FLASH_LIBRARY_ARRAY_REQUIRED", `${label} must be an array.`);
    return value;
}

function string(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0)
        fail("FLASH_LIBRARY_STRING_REQUIRED", `${label} must be a non-empty string.`);
    return value;
}

function finite(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        fail("FLASH_LIBRARY_NUMBER_REQUIRED", `${label} must be finite.`);
    return value;
}

function positiveInteger(value: unknown, label: string): number {
    const result = finite(value, label);
    if (!Number.isSafeInteger(result) || result < 1)
        fail("FLASH_LIBRARY_POSITIVE_INTEGER_REQUIRED", `${label} must be a positive safe integer.`);
    return result;
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean")
        fail("FLASH_LIBRARY_BOOLEAN_REQUIRED", `${label} must be boolean.`);
    return value;
}

function fail(code: string, message: string): never {
    throw new Error(`${code}: ${message}`);
}
