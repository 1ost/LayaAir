import { Sprite } from "../../display/Sprite";
import { Input } from "../../display/Input";
import { Text } from "../../display/Text";
import { BevelFilter } from "../../filters/BevelFilter";
import { BlurFilter } from "../../filters/BlurFilter";
import { ColorFilter } from "../../filters/ColorFilter";
import { GlowFilter } from "../../filters/GlowFilter";
import { GradientBevelFilter } from "../../filters/GradientBevelFilter";
import { GradientGlowFilter } from "../../filters/GradientGlowFilter";
import type {
    SwfDefineEditText,
    SwfDefineBitsLossless,
    SwfButtonStateName,
    SwfDefineButton,
    SwfDefineFont,
    SwfDefineMorphShape,
    SwfDefineShape,
    SwfDefineSprite,
    SwfDefineText,
    SwfDoAction,
    SwfAvm1ActionRecord,
    SwfAvm1ActionValue,
    SwfFillStyle,
    SwfFilter,
    SwfLineStyle,
    SwfMatrix,
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

export interface SwfTimelineInstanceOptions {
    frameIndex?: number;
    autoPlay?: boolean;
}

export interface SwfDisplayObjectShell {
    root: Sprite;
    namedInstances: Map<string, Sprite | Text>;
    renderedShapeCount: number;
    bitmapFillCount: number;
}

const imageSurfaceCache = new WeakMap<object, Promise<DecodedSwfImage>>();
const fillRasterCanvasCache = new WeakMap<object, Promise<HTMLCanvasElement | null>>();
const staticTextOutlineCanvasCache = new WeakMap<object, Promise<HTMLCanvasElement>>();
const scale9TextureCache = new WeakMap<object, Promise<any | null>>();

interface DecodedSwfImage {
    source: CanvasImageSource;
    width: number;
    height: number;
    pixels?: ImageData;
}

interface OrientedShapePath {
    path: SwfShapePath;
    reverse: boolean;
}

interface SwfRuntimePlacementNode {
    characterId: number;
    ratio?: number;
    node: Sprite | Text;
    timeline?: SwfTimelineInstance;
}

function isSpriteCharacter(character: any): character is SwfDefineSprite {
    return !!character && "tags" in character;
}

function isButtonCharacter(character: any): character is SwfDefineButton {
    return !!character && "statePlacements" in character;
}

function isMorphShapeCharacter(character: any): character is SwfDefineMorphShape {
    return !!character && "startPaths" in character && "endPaths" in character;
}

export class SwfRenderer {
    static async renderExport(movie: SwfMovie, exportName: string, options: SwfRenderOptions = {}): Promise<SwfRenderResult> {
        const character = movie.getExportedCharacter(exportName);
        if (isButtonCharacter(character)) {
            const namedInstances = new Map<string, Sprite | Text>();
            const root = await createButtonNode(movie, character, namedInstances);
            return {
                root,
                namedInstances,
                renderedShapeCount: renderedShapeCountFor(root),
                bitmapFillCount: childrenDebugCount(root, "__rawSwfBitmapFillCount")
            };
        }
        if (!character || !("tags" in character)) {
            throw new Error(`Raw SWF export '${exportName}' is not a renderable sprite or button.`);
        }
        return SwfRenderer.renderSprite(movie, character, options);
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

    static async instantiateExport(movie: SwfMovie, exportName: string, options: SwfTimelineInstanceOptions = {}): Promise<SwfTimelineInstance> {
        const sprite = movie.getSprite(exportName);
        if (!sprite) {
            throw new Error(`Raw SWF export '${exportName}' is not a sprite.`);
        }
        return SwfRenderer.instantiateSprite(movie, sprite, options);
    }

    static async instantiateSprite(movie: SwfMovie, sprite: SwfDefineSprite, options: SwfTimelineInstanceOptions = {}): Promise<SwfTimelineInstance> {
        const instance = new SwfTimelineInstance(movie, sprite, options);
        await instance.ready;
        return instance;
    }

    static instantiateSpriteShell(movie: SwfMovie, sprite: SwfDefineSprite, options: SwfRenderOptions = {}): SwfDisplayObjectShell {
        return instantiateSpriteShell(movie, sprite, options.frameIndex ?? 0);
    }

    static instantiateCharacterShell(movie: SwfMovie, character: any, options: SwfRenderOptions = {}): SwfDisplayObjectShell | null {
        if (isSpriteCharacter(character)) {
            return instantiateSpriteShell(movie, character, options.frameIndex ?? 0);
        }
        if (isButtonCharacter(character)) {
            return instantiateButtonShell(movie, character);
        }
        const namedInstances = new Map<string, Sprite | Text>();
        const root = createShellNodeForCharacter(movie, character, namedInstances, options.frameIndex ?? 0) as Sprite;
        return {
            root,
            namedInstances,
            renderedShapeCount: renderedShapeCountFor(root),
            bitmapFillCount: childrenDebugCount(root, "__rawSwfBitmapFillCount")
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
        const node = await createNodeForCharacter(movie, character, namedInstances, frameIndex, placement.ratio);
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
    executeInitAvm1Actions(root, sprite);
    executeFrameAvm1Actions(root, sprite.frames[normalizeTimelineFrameIndex(frameIndex, Math.max(1, sprite.frames.length || sprite.frameCount || 1))]);
    return root;
}

function currentMaskContainer(root: Sprite, maskStack: { clipDepth: number; group: Sprite }[]): Sprite {
    return maskStack.length ? maskStack[maskStack.length - 1].group : root;
}

function instantiateSpriteShell(movie: SwfMovie, sprite: SwfDefineSprite, frameIndex: number): SwfDisplayObjectShell {
    const namedInstances = new Map<string, Sprite | Text>();
    const root = instantiateSpriteShellNode(movie, sprite, namedInstances, frameIndex);
    return {
        root,
        namedInstances,
        renderedShapeCount: (root as any).__rawSwfRenderedShapeCount ?? 0,
        bitmapFillCount: childrenDebugCount(root, "__rawSwfBitmapFillCount")
    };
}

function instantiateSpriteShellNode(
    movie: SwfMovie,
    sprite: SwfDefineSprite,
    namedInstances: Map<string, Sprite | Text>,
    frameIndex: number
): Sprite {
    const root = new Sprite();
    (root as any).__rawSwfLinkedCharacterId = sprite.characterId;
    (root as any).__rawSwfTimelineShell = true;
    (root as any).currentFrame = normalizeTimelineFrameIndex(frameIndex, Math.max(1, sprite.frames.length || sprite.frameCount || 1)) + 1;
    (root as any).totalFrames = Math.max(1, sprite.frames.length || sprite.frameCount || 1);
    (root as any).play = (): void => {};
    (root as any).stop = (): void => {};
    (root as any).gotoAndStop = (target: number | string): void => {
        const targetIndex = resolveTimelineFrameInput(target, Number((root as any).totalFrames ?? 1), sprite);
        replaceSpriteShellFrame(root, movie, sprite, namedInstances, targetIndex);
    };
    (root as any).gotoAndPlay = (target: number | string): void => {
        (root as any).gotoAndStop(target);
    };
    replaceSpriteShellFrame(root, movie, sprite, namedInstances, frameIndex);
    return root;
}

function replaceSpriteShellFrame(
    root: Sprite,
    movie: SwfMovie,
    sprite: SwfDefineSprite,
    namedInstances: Map<string, Sprite | Text>,
    frameIndex: number
): void {
    namedInstances.clear();
    root.removeChildren();
    const placements = framePlacements(sprite, frameIndex);
    const maskStack: { clipDepth: number; group: Sprite }[] = [];
    let renderedShapeCount = 0;
    for (const placement of placements) {
        while (maskStack.length && placement.depth > maskStack[maskStack.length - 1].clipDepth) {
            maskStack.pop();
        }
        if (placement.characterId == null) {
            continue;
        }
        const character = movie.getCharacter(placement.characterId);
        const node = createShellNodeForCharacter(movie, character, namedInstances, frameIndex, placement.ratio);
        node.name = placement.name ?? "";
        applyPlacement(node, placement, character);
        if (placement.name) {
            namedInstances.set(placement.name, node);
        }
        if (placement.clipDepth != null) {
            const group = new Sprite();
            group.mask = node as Sprite;
            currentMaskContainer(root, maskStack).addChild(group);
            maskStack.push({ clipDepth: placement.clipDepth, group });
            continue;
        }
        currentMaskContainer(root, maskStack).addChild(node);
        renderedShapeCount += renderedShapeCountFor(node);
    }
    (root as any).currentFrame = normalizeTimelineFrameIndex(frameIndex, Math.max(1, sprite.frames.length || sprite.frameCount || 1)) + 1;
    (root as any).currentLabel = frameLabelNameAt(sprite, frameIndex);
    (root as any).currentLabels = frameLabelNamesAt(sprite, frameIndex);
    (root as any).__rawSwfRenderedShapeCount = renderedShapeCount;
    (root as any).__rawSwfBitmapFillCount = childrenDebugCount(root, "__rawSwfBitmapFillCount");
}

function createShellNodeForCharacter(
    movie: SwfMovie,
    character: any,
    namedInstances: Map<string, Sprite | Text>,
    frameIndex: number,
    ratio: number = 0
): Sprite | Text {
    if (isSpriteCharacter(character)) {
        return instantiateSpriteShellNode(movie, character, namedInstances, frameIndex);
    }
    if (isButtonCharacter(character)) {
        return createButtonShellNode(movie, character, namedInstances);
    }
    if (isMorphShapeCharacter(character)) {
        const sprite = new Sprite();
        const bounds = interpolatedMorphBounds(character, ratio);
        sprite.size(Math.max(1, bounds.width), Math.max(1, bounds.height));
        (sprite as any).__rawSwfRenderedShape = true;
        (sprite as any).__rawSwfRenderedShapeCount = 1;
        (sprite as any).__rawSwfMorphShapeShell = true;
        (sprite as any).__rawSwfShapeCharacterId = character.characterId;
        (sprite as any).__rawSwfMorphRatio = ratio;
        return sprite;
    }
    if (character?.variableName !== undefined || character?.initialText !== undefined) {
        return createTextNode(movie, character);
    }
    if (character?.records) {
        return createFallbackStaticTextNode(movie, character);
    }
    const sprite = new Sprite();
    if (character?.zlibBitmapData || character?.imageData) {
        sprite.size(Math.max(1, character.width ?? 1), Math.max(1, character.height ?? 1));
        (sprite as any).__rawSwfBitmapShell = true;
        (sprite as any).__rawSwfBitmapCharacterId = character.characterId;
        return sprite;
    }
    if (character?.shapeBounds) {
        sprite.size(Math.max(1, character.shapeBounds.width), Math.max(1, character.shapeBounds.height));
        (sprite as any).__rawSwfRenderedShape = true;
        (sprite as any).__rawSwfRenderedShapeCount = 1;
        (sprite as any).__rawSwfShapeShell = true;
        (sprite as any).__rawSwfShapeCharacterId = character.characterId;
        return sprite;
    }
    if (character?.bounds) {
        sprite.size(character.bounds.width, character.bounds.height);
    }
    return sprite;
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
    frameIndex: number,
    ratio: number = 0
): Promise<Sprite | Text> {
    if (isSpriteCharacter(character)) {
        return instantiateSprite(movie, character, namedInstances, frameIndex);
    }
    if (isButtonCharacter(character)) {
        return createButtonNode(movie, character, namedInstances);
    }
    if (isMorphShapeCharacter(character)) {
        return renderMorphShapeNode(movie, character, ratio);
    }
    if (character?.variableName !== undefined || character?.initialText !== undefined) {
        return createTextNode(movie, character);
    }
    if (character?.records) {
        return await createStaticTextNode(movie, character);
    }
    if (character?.zlibBitmapData || character?.imageData) {
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

async function createBitmapNode(character: SwfDefineBitsLossless | any): Promise<Sprite> {
    const sprite = new Sprite();
    sprite.size(character.width, character.height);
    await loadImageCharacterOntoSprite(sprite, character);
    return sprite;
}

async function createButtonNode(
    movie: SwfMovie,
    button: SwfDefineButton,
    _namedInstances: Map<string, Sprite | Text>
): Promise<Sprite> {
    const stateRoots = new Map<SwfButtonStateName, Sprite>();
    for (const state of buttonStateNames()) {
        stateRoots.set(state, await createButtonStateNode(movie, button, state, false));
    }
    const root = new Sprite();
    installButtonBridge(root, movie, button, stateRoots);
    setButtonState(root, button, stateRoots, "up");
    return root;
}

function createButtonShellNode(
    movie: SwfMovie,
    button: SwfDefineButton,
    _namedInstances: Map<string, Sprite | Text>
): Sprite {
    const stateRoots = new Map<SwfButtonStateName, Sprite>();
    for (const state of buttonStateNames()) {
        stateRoots.set(state, createButtonStateShellNode(movie, button, state));
    }
    const root = new Sprite();
    installButtonBridge(root, movie, button, stateRoots);
    (root as any).__rawSwfButtonShell = true;
    setButtonState(root, button, stateRoots, "up");
    return root;
}

function instantiateButtonShell(movie: SwfMovie, button: SwfDefineButton): SwfDisplayObjectShell {
    const namedInstances = new Map<string, Sprite | Text>();
    const root = createButtonShellNode(movie, button, namedInstances);
    return {
        root,
        namedInstances,
        renderedShapeCount: renderedShapeCountFor(root),
        bitmapFillCount: childrenDebugCount(root, "__rawSwfBitmapFillCount")
    };
}

async function createButtonStateNode(movie: SwfMovie, button: SwfDefineButton, state: SwfButtonStateName, shell: boolean): Promise<Sprite> {
    const root = new Sprite();
    const placements = button.statePlacements[state] ?? [];
    const maskStack: { clipDepth: number; group: Sprite }[] = [];
    let renderedShapeCount = 0;
    for (const placement of placements) {
        while (maskStack.length && placement.depth > maskStack[maskStack.length - 1].clipDepth) {
            maskStack.pop();
        }
        if (placement.characterId == null) {
            continue;
        }
        const character = movie.getCharacter(placement.characterId);
        const node = shell
            ? createShellNodeForCharacter(movie, character, new Map(), 0, placement.ratio)
            : await createNodeForCharacter(movie, character, new Map(), 0, placement.ratio);
        applyPlacement(node, placement, character);
        if (placement.clipDepth != null) {
            const group = new Sprite();
            group.mask = node as Sprite;
            currentMaskContainer(root, maskStack).addChild(group);
            maskStack.push({ clipDepth: placement.clipDepth, group });
            continue;
        }
        currentMaskContainer(root, maskStack).addChild(node);
        renderedShapeCount += renderedShapeCountFor(node);
    }
    (root as any).__rawSwfButtonState = state;
    (root as any).__rawSwfButtonCharacterId = button.characterId;
    (root as any).__rawSwfRenderedShapeCount = renderedShapeCount;
    (root as any).__rawSwfBitmapFillCount = childrenDebugCount(root, "__rawSwfBitmapFillCount");
    return root;
}

function createButtonStateShellNode(movie: SwfMovie, button: SwfDefineButton, state: SwfButtonStateName): Sprite {
    const placeholder = new Sprite();
    void createButtonStateNode(movie, button, state, true).then(stateRoot => {
        placeholder.removeChildren();
        while (Number(stateRoot.numChildren ?? 0) > 0) {
            const child = stateRoot.getChildAt(0);
            if (!child) {
                break;
            }
            placeholder.addChild(child);
        }
        (placeholder as any).__rawSwfRenderedShapeCount = (stateRoot as any).__rawSwfRenderedShapeCount ?? 0;
        (placeholder as any).__rawSwfBitmapFillCount = (stateRoot as any).__rawSwfBitmapFillCount ?? 0;
        (placeholder as any).__rawSwfButtonStateShellReady = true;
    });
    (placeholder as any).__rawSwfButtonState = state;
    (placeholder as any).__rawSwfButtonStateShell = true;
    return placeholder;
}

function installButtonBridge(root: Sprite, movie: SwfMovie, button: SwfDefineButton, stateRoots: Map<SwfButtonStateName, Sprite>): void {
    const raw = root as any;
    raw.__rawSwfButtonCharacterId = button.characterId;
    raw.__rawSwfButtonRecords = button.records;
    raw.__rawSwfButtonActions = button.actions;
    raw._flashButtonActions = button.actions;
    raw._flashButtonActionRecords = button.actions;
    raw._flashButtonActionDispatches = [];
    raw.trackAsMenu = button.trackAsMenu;
    raw.enabled = true;
    raw.mouseEnabled = true;
    raw.buttonMode = true;
    raw.useHandCursor = true;
    raw.tabEnabled = false;
    raw.doubleClickEnabled = false;
    raw.upState = stateRoots.get("up") ?? null;
    raw.overState = stateRoots.get("over") ?? null;
    raw.downState = stateRoots.get("down") ?? null;
    raw.hitTestState = stateRoots.get("hit") ?? null;
    raw._flashHitTestLocalPoint = (x: number, y: number): boolean => buttonHitTestLocal(movie, button, x, y);
    raw._flashHitTestPoint = (x: number, y: number): boolean => {
        const point = typeof raw.globalToLocal === "function"
            ? raw.globalToLocal({ x, y })
            : { x: x - Number(raw.x ?? 0), y: y - Number(raw.y ?? 0) };
        return raw._flashHitTestLocalPoint(point.x, point.y);
    };
    raw.hitTestPrior = true;
    raw.hitArea = {
        contains: (x: number, y: number): boolean => raw._flashHitTestLocalPoint(x, y)
    };
    raw._flashDispatchButtonActions = (trigger: string) => dispatchButtonActions(raw, button, trigger);
    raw.gotoAndStop = (target: number | string): void => {
        setButtonState(root, button, stateRoots, resolveButtonState(target));
    };
    raw.gotoAndPlay = raw.gotoAndStop;
    raw.stop = (): void => {};
    raw.play = (): void => {};
    const addHandler = (eventName: string, handler: () => void): void => {
        if (typeof raw.on === "function") {
            raw.on(eventName, root, handler);
        }
    };
    addHandler("mouseover", () => {
        if (raw.enabled !== false && raw.mouseEnabled !== false) {
            dispatchButtonActions(raw, button, "idleToOverUp");
            setButtonState(root, button, stateRoots, "over");
        }
    });
    addHandler("mousedown", () => {
        if (raw.enabled !== false && raw.mouseEnabled !== false) {
            dispatchButtonActions(raw, button, raw.currentFrame === 2 ? "overUpToOverDown" : "idleToOverDown");
            setButtonState(root, button, stateRoots, "down");
        }
    });
    addHandler("mouseup", () => {
        if (raw.enabled !== false && raw.mouseEnabled !== false) {
            dispatchButtonActions(raw, button, "overDownToOverUp");
            setButtonState(root, button, stateRoots, "over");
        }
    });
    addHandler("mouseout", () => {
        if (raw.enabled !== false && raw.mouseEnabled !== false) {
            dispatchButtonActions(raw, button, raw.currentFrame === 3 ? "overDownToIdle" : "overUpToIdle");
            setButtonState(root, button, stateRoots, "up");
        }
    });
}

function setButtonState(root: Sprite, button: SwfDefineButton, stateRoots: Map<SwfButtonStateName, Sprite>, state: SwfButtonStateName): void {
    const raw = root as any;
    const stateRoot = stateRoots.get(state) ?? stateRoots.get("up") ?? new Sprite();
    raw.__rawSwfButtonState = state;
    raw.currentFrame = buttonStateFrameNumber(state);
    raw.currentLabel = state;
    raw.currentLabels = [state, `_${state}`];
    raw.totalFrames = 4;
    root.removeChildren();
    root.addChild(stateRoot);
    (root as any).__rawSwfRenderedShapeCount = renderedShapeCountFor(stateRoot);
    (root as any).__rawSwfBitmapFillCount = childrenDebugCount(stateRoot, "__rawSwfBitmapFillCount");
}

function dispatchButtonActions(raw: any, button: SwfDefineButton, trigger: string): any[] {
    const matched = button.actions.filter(action => buttonActionMatchesTrigger(action, trigger));
    for (const action of matched) {
        const execution = executeAvm1Actions(raw, action.decodedActions, {
            trigger,
            source: "button",
            rawBytes: action.actions
        });
        raw._flashButtonActionDispatches.push({ trigger, action, execution });
    }
    return matched;
}

function buttonActionMatchesTrigger(action: any, trigger: string): boolean {
    const conditions = action.conditions ?? {};
    if (trigger === "keyPress") {
        return Number(action.keyPress ?? 0) !== 0;
    }
    return !!conditions[trigger];
}

interface Avm1ExecutionContext {
    source: "button" | "frame" | "init";
    trigger?: string;
    frameIndex?: number;
    rawBytes?: Uint8Array;
}

function executeInitAvm1Actions(root: Sprite, sprite: SwfDefineSprite): void {
    const raw = root as any;
    raw.__rawSwfInitActions = sprite.initActions ?? [];
    for (const action of sprite.initActions ?? []) {
        executeAvm1Actions(raw, action.decodedActions, {
            source: "init",
            rawBytes: action.actions
        });
    }
}

function executeFrameAvm1Actions(root: Sprite, frame: { index?: number; actions?: SwfDoAction[] } | undefined, timeline?: SwfTimelineInstance): void {
    const raw = root as any;
    const actions = frame?.actions ?? [];
    raw.__rawSwfFrameActions = actions;
    if (!actions.length) {
        return;
    }
    for (const action of actions) {
        executeAvm1Actions(raw, action.decodedActions, {
            source: "frame",
            frameIndex: frameIndexFromFrame(frame),
            rawBytes: action.actions
        }, timeline);
    }
}

function frameIndexFromFrame(frame: { index?: number } | undefined): number | undefined {
    return typeof frame?.index === "number" ? frame.index : undefined;
}

function executeAvm1Actions(target: any, actions: SwfAvm1ActionRecord[] | undefined, context: Avm1ExecutionContext, timeline?: SwfTimelineInstance): any {
    const records = actions ?? [];
    const execution = {
        source: context.source,
        trigger: context.trigger,
        frameIndex: context.frameIndex,
        executed: [] as string[],
        stack: [] as SwfAvm1ActionValue[],
        variables: {} as Record<string, SwfAvm1ActionValue>,
        stopped: false,
        played: false,
        jumpedToFrame: null as number | string | null,
        traces: [] as SwfAvm1ActionValue[]
    };
    const raw = target as any;
    raw.__rawSwfAvm1Executions ??= [];
    const stack = execution.stack;
    const offsetToIndex = new Map<number, number>();
    records.forEach((record, index) => offsetToIndex.set(record.offset, index));
    let constantPool: string[] = [];
    for (let pc = 0; pc >= 0 && pc < records.length; pc++) {
        const record = records[pc];
        execution.executed.push(record.name);
        switch (record.opcode) {
            case 0x04:
                gotoAvm1Frame(raw, timeline, Number(raw.currentFrame ?? 1) + 1);
                execution.jumpedToFrame = Number(raw.currentFrame ?? 1) + 1;
                break;
            case 0x05:
                gotoAvm1Frame(raw, timeline, Number(raw.currentFrame ?? 1) - 1);
                execution.jumpedToFrame = Number(raw.currentFrame ?? 1) - 1;
                break;
            case 0x06:
                execution.played = true;
                void raw.play?.();
                break;
            case 0x07:
                execution.stopped = true;
                raw.stop?.();
                break;
            case 0x0a:
                stack.push(Number(stack.pop() ?? 0) + Number(stack.pop() ?? 0));
                break;
            case 0x0b: {
                const right = Number(stack.pop() ?? 0);
                const left = Number(stack.pop() ?? 0);
                stack.push(left - right);
                break;
            }
            case 0x0c:
                stack.push(Number(stack.pop() ?? 0) * Number(stack.pop() ?? 0));
                break;
            case 0x0d: {
                const right = Number(stack.pop() ?? 0);
                const left = Number(stack.pop() ?? 0);
                stack.push(right === 0 ? Number.NaN : left / right);
                break;
            }
            case 0x12:
                stack.push(!avm1Truthy(stack.pop()));
                break;
            case 0x17:
                stack.pop();
                break;
            case 0x1c:
                stack.push(getAvm1Variable(raw, String(stack.pop() ?? "")));
                break;
            case 0x1d: {
                const value = stack.pop();
                const name = String(stack.pop() ?? "");
                setAvm1Variable(raw, name, value);
                execution.variables[name] = value;
                break;
            }
            case 0x26: {
                const value = stack.pop();
                execution.traces.push(value);
                avm1Trace(value);
                break;
            }
            case 0x81:
                if (typeof record.frame === "number") {
                    const frame = record.frame + 1;
                    execution.jumpedToFrame = frame;
                    gotoAvm1Frame(raw, timeline, frame);
                }
                break;
            case 0x83:
                raw.__rawSwfAvm1GetUrls ??= [];
                raw.__rawSwfAvm1GetUrls.push({ url: record.url ?? "", target: record.target ?? "" });
                break;
            case 0x88:
                constantPool = record.constantPool ?? [];
                break;
            case 0x8c:
                if (record.label) {
                    execution.jumpedToFrame = record.label;
                    gotoAvm1Frame(raw, timeline, record.label);
                }
                break;
            case 0x96:
                for (const value of record.values ?? []) {
                    stack.push(typeof value === "number" && Number.isInteger(value) && constantPool[value] != null
                        ? constantPool[value]
                        : value);
                }
                break;
            case 0x99:
                pc = avm1JumpIndex(records, offsetToIndex, record, pc);
                break;
            case 0x9d:
                if (avm1Truthy(stack.pop())) {
                    pc = avm1JumpIndex(records, offsetToIndex, record, pc);
                }
                break;
            default:
                raw.__rawSwfAvm1UnsupportedActions ??= [];
                raw.__rawSwfAvm1UnsupportedActions.push(record);
                break;
        }
    }
    raw.__rawSwfAvm1Executions.push(execution);
    return execution;
}

function gotoAvm1Frame(raw: any, timeline: SwfTimelineInstance | undefined, frame: number | string): void {
    if (timeline) {
        void timeline.gotoAndStop(frame);
        return;
    }
    void raw.gotoAndStop?.(frame);
}

function avm1JumpIndex(records: SwfAvm1ActionRecord[], offsetToIndex: Map<number, number>, record: SwfAvm1ActionRecord, pc: number): number {
    const targetOffset = record.offset + record.size + Number(record.branchOffset ?? 0);
    const exact = offsetToIndex.get(targetOffset);
    if (exact != null) {
        return exact - 1;
    }
    const next = records.findIndex(candidate => candidate.offset >= targetOffset);
    return next >= 0 ? next - 1 : pc;
}

function avm1Truthy(value: SwfAvm1ActionValue): boolean {
    return !(value == null || value === false || value === 0 || value === "");
}

function getAvm1Variable(raw: any, name: string): SwfAvm1ActionValue {
    if (!name) {
        return undefined;
    }
    if (name.startsWith("_root.")) {
        return getPathValue(raw, name.slice("_root.".length));
    }
    return getPathValue(raw, name);
}

function setAvm1Variable(raw: any, name: string, value: SwfAvm1ActionValue): void {
    if (!name) {
        return;
    }
    const normalized = name.startsWith("_root.") ? name.slice("_root.".length) : name;
    setPathValue(raw, normalized, value);
}

function getPathValue(root: any, path: string): SwfAvm1ActionValue {
    const parts = path.split(".").filter(Boolean);
    let current = root;
    for (const part of parts) {
        current = current?.[part];
    }
    return current;
}

function setPathValue(root: any, path: string, value: SwfAvm1ActionValue): void {
    const parts = path.split(".").filter(Boolean);
    if (!parts.length) {
        return;
    }
    let current = root;
    for (const part of parts.slice(0, -1)) {
        current[part] ??= {};
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

function avm1Trace(value: SwfAvm1ActionValue): void {
    const global = globalThis as any;
    global.__rawSwfAvm1Trace ??= [];
    global.__rawSwfAvm1Trace.push(value);
}

function buttonHitTestLocal(movie: SwfMovie, button: SwfDefineButton, x: number, y: number): boolean {
    const placements = button.statePlacements.hit.length > 0
        ? button.statePlacements.hit
        : button.statePlacements.up;
    return placements.some(placement => placementHitTestLocal(movie, placement, x, y));
}

function placementHitTestLocal(movie: SwfMovie, placement: SwfPlaceObject, x: number, y: number): boolean {
    if (placement.characterId == null) {
        return false;
    }
    const point = inversePlacementPoint(placement, x, y);
    const character = movie.getCharacter(placement.characterId);
    return characterHitTestLocal(movie, character, point.x, point.y);
}

function characterHitTestLocal(movie: SwfMovie, character: any, x: number, y: number): boolean {
    if (isSpriteCharacter(character)) {
        const placements = framePlacements(character, 0);
        return placements.some(placement => placementHitTestLocal(movie, placement, x, y));
    }
    if (isButtonCharacter(character)) {
        return buttonHitTestLocal(movie, character, x, y);
    }
    if (isMorphShapeCharacter(character)) {
        return pointInShape(morphShapeAtRatio(character, 0), x, y);
    }
    if (character?.shapeBounds) {
        return pointInShape(character, x, y);
    }
    const bounds = character?.bounds ?? (
        character?.width != null && character?.height != null
            ? { xMin: 0, yMin: 0, xMax: character.width, yMax: character.height }
            : null
    );
    return !!bounds && x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax;
}

function inversePlacementPoint(placement: SwfPlaceObject, x: number, y: number): { x: number; y: number } {
    const matrix = placement.matrix;
    if (!matrix) {
        return { x, y };
    }
    const a = matrix.scaleX;
    const b = matrix.rotateSkew1;
    const c = matrix.rotateSkew0;
    const d = matrix.scaleY;
    const tx = matrix.translateX;
    const ty = matrix.translateY;
    const det = a * d - b * c;
    if (Math.abs(det) < 0.000001) {
        return { x, y };
    }
    const dx = x - tx;
    const dy = y - ty;
    return {
        x: (d * dx - c * dy) / det,
        y: (-b * dx + a * dy) / det
    };
}

function pointInShape(shape: SwfDefineShape, x: number, y: number): boolean {
    for (const fill of shape.fillStyles ?? []) {
        const paths = orientedFillPathsForStyle(shape.paths ?? [], fill.index);
        if (paths.length > 0 && windingForPaths(paths, x, y) !== 0) {
            return true;
        }
    }
    const bounds = shape.shapeBounds;
    return !!bounds && x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax;
}

function windingForPaths(paths: OrientedShapePath[], x: number, y: number): number {
    let winding = 0;
    for (const orientedPath of paths) {
        const points = orientedPath.reverse ? reversedFlatPoints(orientedPath.path) : flattenPathForLaya(orientedPath.path);
        for (let index = 0; index + 3 < points.length; index += 2) {
            winding += edgeWinding(points[index], points[index + 1], points[index + 2], points[index + 3], x, y);
        }
        if (points.length >= 4) {
            winding += edgeWinding(points[points.length - 2], points[points.length - 1], points[0], points[1], x, y);
        }
    }
    return winding;
}

function edgeWinding(x0: number, y0: number, x1: number, y1: number, x: number, y: number): number {
    if (y0 <= y) {
        return y1 > y && isLeftOfEdge(x0, y0, x1, y1, x, y) > 0 ? 1 : 0;
    }
    return y1 <= y && isLeftOfEdge(x0, y0, x1, y1, x, y) < 0 ? -1 : 0;
}

function isLeftOfEdge(x0: number, y0: number, x1: number, y1: number, x: number, y: number): number {
    return (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
}

function resolveButtonState(target: number | string): SwfButtonStateName {
    if (typeof target === "number") {
        switch (Math.max(1, Math.min(4, Math.trunc(target)))) {
            case 2: return "over";
            case 3: return "down";
            case 4: return "hit";
            case 1:
            default: return "up";
        }
    }
    switch (target) {
        case "over":
        case "_over":
            return "over";
        case "down":
        case "_down":
            return "down";
        case "hit":
        case "_hit":
            return "hit";
        case "up":
        case "_up":
        default:
            return "up";
    }
}

function buttonStateFrameNumber(state: SwfButtonStateName): number {
    switch (state) {
        case "over": return 2;
        case "down": return 3;
        case "hit": return 4;
        case "up":
        default: return 1;
    }
}

function buttonStateNames(): SwfButtonStateName[] {
    return ["up", "over", "down", "hit"];
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
        await loadCanvasOntoSprite(root, await cachedStaticTextOutlineCanvas(character, canvas));
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
    const text = character.flags.readOnly ? new Text() : new Input();
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
        (text as any).type = "password";
    }
    if (text instanceof Input) {
        text.editable = true;
        text.selectable = !character.flags.noSelect;
        text.multiline = !!character.flags.multiline;
        text.maxChars = character.maxLength ?? 0;
    }
    if (character.flags.border) {
        text.borderColor = rgbaToCss(character.textColor) ?? "#000000";
    }
    (text as any).__rawSwfVariableName = character.variableName;
    (text as any).__rawSwfReadOnly = character.flags.readOnly;
    (text as any).__rawSwfSelectable = !character.flags.noSelect;
    (text as any).__rawSwfTextNodeKind = text instanceof Input ? "Input" : "Text";
    (text as any).__rawSwfMaxLength = character.maxLength ?? 0;
    (text as any).__rawSwfMultiline = !!character.flags.multiline;
    (text as any).__rawSwfWordWrap = !!character.flags.wordWrap;
    if (character.csmTextSettings) {
        (text as any).__rawSwfCsmTextSettings = character.csmTextSettings;
    }
    return text;
}

async function renderMorphShapeNode(movie: SwfMovie, morph: SwfDefineMorphShape, ratio: number): Promise<Sprite> {
    const shape = morphShapeAtRatio(morph, ratio);
    const node = await renderShapeNode(movie, shape);
    (node as any).__rawSwfMorphShape = true;
    (node as any).__rawSwfMorphCharacterId = morph.characterId;
    (node as any).__rawSwfMorphRatio = ratio;
    (node as any).__rawSwfMorphStartPathCount = morph.startPaths.length;
    (node as any).__rawSwfMorphEndPathCount = morph.endPaths.length;
    return node;
}

function morphShapeAtRatio(morph: SwfDefineMorphShape, ratio: number): SwfDefineShape {
    const normalized = morphRatioToUnit(ratio);
    return {
        characterId: morph.characterId,
        shapeBounds: interpolatedMorphBounds(morph, ratio),
        edgeBounds: morph.startEdgeBounds && morph.endEdgeBounds
            ? interpolateRect(morph.startEdgeBounds, morph.endEdgeBounds, normalized)
            : undefined,
        usesNonScalingStrokes: morph.usesNonScalingStrokes,
        usesScalingStrokes: morph.usesScalingStrokes,
        fillStyles: morph.fillStyles.map(style => ({
            index: style.index,
            type: style.type,
            color: style.startColor || style.endColor ? interpolateRgba(style.startColor, style.endColor, normalized) : undefined,
            bitmapId: style.bitmapId,
            bitmapMatrix: interpolateMatrix(style.startBitmapMatrix, style.endBitmapMatrix, normalized),
            gradientMatrix: interpolateMatrix(style.startGradientMatrix, style.endGradientMatrix, normalized),
            focalPoint: style.focalPoint,
            gradientRecords: style.gradientRecords?.map(record => ({
                ratio: Math.round(interpolateNumber(record.startRatio, record.endRatio, normalized)),
                color: interpolateRgba(record.startColor, record.endColor, normalized)
            }))
        })),
        lineStyles: morph.lineStyles.map(style => ({
            index: style.index,
            widthTwips: Math.round(interpolateNumber(style.startWidthTwips, style.endWidthTwips, normalized)),
            width: interpolateNumber(style.startWidth, style.endWidth, normalized),
            color: style.startColor || style.endColor ? interpolateRgba(style.startColor, style.endColor, normalized) : undefined,
            fillStyle: style.fillStyle ? {
                index: style.fillStyle.index,
                type: style.fillStyle.type,
                color: style.fillStyle.startColor || style.fillStyle.endColor
                    ? interpolateRgba(style.fillStyle.startColor, style.fillStyle.endColor, normalized)
                    : undefined,
                bitmapId: style.fillStyle.bitmapId,
                bitmapMatrix: interpolateMatrix(style.fillStyle.startBitmapMatrix, style.fillStyle.endBitmapMatrix, normalized),
                gradientMatrix: interpolateMatrix(style.fillStyle.startGradientMatrix, style.fillStyle.endGradientMatrix, normalized),
                gradientRecords: style.fillStyle.gradientRecords?.map(record => ({
                    ratio: Math.round(interpolateNumber(record.startRatio, record.endRatio, normalized)),
                    color: interpolateRgba(record.startColor, record.endColor, normalized)
                }))
            } : undefined,
            startCapStyle: style.startCapStyle,
            joinStyle: style.joinStyle,
            hasFill: style.hasFill,
            noHScale: style.noHScale,
            noVScale: style.noVScale,
            pixelHinting: style.pixelHinting,
            noClose: style.noClose,
            endCapStyle: style.endCapStyle,
            miterLimitFactor: style.miterLimitFactor
        })),
        paths: interpolateShapePaths(morph.startPaths, morph.endPaths, normalized)
    };
}

function interpolatedMorphBounds(morph: SwfDefineMorphShape, ratio: number): SwfRect {
    return interpolateRect(morph.startBounds, morph.endBounds, morphRatioToUnit(ratio));
}

function interpolateShapePaths(startPaths: SwfShapePath[], endPaths: SwfShapePath[], ratio: number): SwfShapePath[] {
    if (startPaths.length !== endPaths.length) {
        return ratio < 0.5 ? startPaths : endPaths;
    }
    return startPaths.map((startPath, index) => interpolateShapePath(startPath, endPaths[index], ratio));
}

function interpolateShapePath(startPath: SwfShapePath, endPath: SwfShapePath, ratio: number): SwfShapePath {
    if (startPath.segments.length !== endPath.segments.length) {
        return ratio < 0.5 ? startPath : endPath;
    }
    const segments = startPath.segments.map((startSegment, index) => {
        const endSegment = endPath.segments[index];
        if (startSegment.type !== endSegment.type) {
            return ratio < 0.5 ? startSegment : endSegment;
        }
        if (startSegment.type === "line" && endSegment.type === "line") {
            return {
                type: "line" as const,
                start: interpolateShapePoint(startSegment.start, endSegment.start, ratio),
                end: interpolateShapePoint(startSegment.end, endSegment.end, ratio)
            };
        }
        if (startSegment.type === "curve" && endSegment.type === "curve") {
            return {
                type: "curve" as const,
                start: interpolateShapePoint(startSegment.start, endSegment.start, ratio),
                control: interpolateShapePoint(startSegment.control, endSegment.control, ratio),
                end: interpolateShapePoint(startSegment.end, endSegment.end, ratio)
            };
        }
        return ratio < 0.5 ? startSegment : endSegment;
    });
    return {
        fillStyleIndex: startPath.fillStyleIndex || endPath.fillStyleIndex,
        fillStyle0Index: startPath.fillStyle0Index || endPath.fillStyle0Index,
        fillStyle1Index: startPath.fillStyle1Index || endPath.fillStyle1Index,
        lineStyleIndex: startPath.lineStyleIndex || endPath.lineStyleIndex,
        points: segments.length > 0 ? [segments[0].start, ...segments.map(segment => segment.end)] : startPath.points,
        segments
    };
}

function interpolateShapePoint(start: any, end: any, ratio: number): any {
    const xTwips = Math.round(interpolateNumber(start.xTwips, end.xTwips, ratio));
    const yTwips = Math.round(interpolateNumber(start.yTwips, end.yTwips, ratio));
    return {
        xTwips,
        yTwips,
        x: xTwips / 20,
        y: yTwips / 20
    };
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
        const rasterCanvas = await cachedFillRasterCanvas(paths, pathBounds, fill, image);
        if (rasterCanvas) {
            const child = new Sprite();
            child.pos(pathBounds.xMin, pathBounds.yMin);
            child.size(Math.max(1, Math.ceil(pathBounds.width)), Math.max(1, Math.ceil(pathBounds.height)));
            await loadCanvasOntoSprite(child, rasterCanvas);
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
            const child = new Sprite();
            child.pos(pathBounds.xMin, pathBounds.yMin);
            child.size(Math.max(1, pathBounds.width), Math.max(1, pathBounds.height));
            await loadImageCharacterOntoSprite(child, image);
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

function cachedFillRasterCanvas(paths: OrientedShapePath[], bounds: SwfRect, fill: SwfFillStyle, image: any): Promise<HTMLCanvasElement | null> {
    const cacheKey = fill as object;
    let cached = fillRasterCanvasCache.get(cacheKey);
    if (!cached) {
        cached = rasterizeCompoundFill(paths, bounds, fill, image);
        fillRasterCanvasCache.set(cacheKey, cached);
    }
    return cached;
}

function cachedStaticTextOutlineCanvas(character: SwfDefineText, canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const cacheKey = character as object;
    let cached = staticTextOutlineCanvasCache.get(cacheKey);
    if (!cached) {
        cached = Promise.resolve(canvas);
        staticTextOutlineCanvasCache.set(cacheKey, cached);
    }
    return cached;
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
        applyScalingGridPlacementMetadata(node, character, a, d);
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
    applyScalingGridPlacementMetadata(node, character, a, d);
    applyPlacementDisplayState(node, placement);
}

function applyScalingGridPlacementMetadata(node: Sprite | Text, character: any, scaleX: number, scaleY: number): void {
    const scalingGrid = character?.scalingGrid;
    if (!scalingGrid?.splitter) {
        return;
    }
    const bounds = characterNominalBounds(character, scalingGrid.splitter);
    const splitter = scalingGrid.splitter;
    const left = Math.max(0, splitter.xMin - bounds.xMin);
    const right = Math.max(0, bounds.xMax - splitter.xMax);
    const top = Math.max(0, splitter.yMin - bounds.yMin);
    const bottom = Math.max(0, bounds.yMax - splitter.yMax);
    const targetWidth = Math.max(1, bounds.width * Math.abs(scaleX || 1));
    const targetHeight = Math.max(1, bounds.height * Math.abs(scaleY || 1));
    (node as any).__rawSwfScalingGrid = scalingGrid;
    (node as any).__rawSwfScale9OriginalBounds = bounds;
    (node as any).__rawSwfScale9Margins = { left, right, top, bottom };
    (node as any).__rawSwfScale9TargetWidth = targetWidth;
    (node as any).__rawSwfScale9TargetHeight = targetHeight;
    (node as any).__rawSwfScale9PlacementScale = { x: scaleX, y: scaleY };
    (node as any).__rawSwfScale9NeedsNativeDraw9Grid = true;
    (node as any).__rawSwfScale9NativeReady = false;
    (node as any).__rawSwfScale9NativePromise = installNativeScale9Draw(node, character, bounds, scaleX, scaleY);
}

function characterNominalBounds(character: any, splitter: SwfRect): SwfRect {
    const bounds = character?.shapeBounds ?? character?.bounds;
    if (bounds) {
        return bounds;
    }
    const xMin = 0;
    const yMin = 0;
    const xMax = Math.max(1, splitter.xMin + splitter.xMax);
    const yMax = Math.max(1, splitter.yMin + splitter.yMax);
    return {
        xMinTwips: xMin * 20,
        xMaxTwips: xMax * 20,
        yMinTwips: yMin * 20,
        yMaxTwips: yMax * 20,
        xMin,
        xMax,
        yMin,
        yMax,
        width: xMax - xMin,
        height: yMax - yMin
    };
}

async function installNativeScale9Draw(
    node: Sprite | Text,
    character: any,
    bounds: SwfRect,
    scaleX: number,
    scaleY: number
): Promise<boolean> {
    const graphics = (node as any).graphics;
    if (!graphics?.draw9Grid || !graphics?.clear) {
        (node as any).__rawSwfScale9NativeError = "Laya Graphics.draw9Grid is unavailable.";
        return false;
    }
    if (scaleX === 0 || scaleY === 0) {
        (node as any).__rawSwfScale9NativeError = "Zero scale cannot be converted to a native scale-9 surface.";
        return false;
    }
    const texture = await scale9TextureForCharacter(character);
    if (!texture) {
        (node as any).__rawSwfScale9NativeError = "Scale-9 source character could not be rasterized.";
        return false;
    }
    const margins = (node as any).__rawSwfScale9Margins;
    const sizeGrid = [
        Math.max(0, Number(margins?.top ?? 0)),
        Math.max(0, Number(margins?.right ?? 0)),
        Math.max(0, Number(margins?.bottom ?? 0)),
        Math.max(0, Number(margins?.left ?? 0)),
        0
    ];
    const targetWidth = Math.max(1, Math.abs(bounds.width * scaleX));
    const targetHeight = Math.max(1, Math.abs(bounds.height * scaleY));
    const drawX = scaleX < 0 ? bounds.xMax * scaleX : bounds.xMin * scaleX;
    const drawY = scaleY < 0 ? bounds.yMax * scaleY : bounds.yMin * scaleY;
    (node as any).texture = null;
    if (typeof (node as any).removeChildren === "function") {
        (node as any).removeChildren();
    }
    graphics.clear();
    (node as any).scale(1, 1);
    (node as any).size(Math.max(1, Math.abs(drawX) + targetWidth), Math.max(1, Math.abs(drawY) + targetHeight));
    graphics.draw9Grid(texture, drawX, drawY, targetWidth, targetHeight, sizeGrid);
    (node as any).__rawSwfScale9SizeGrid = sizeGrid;
    (node as any).__rawSwfScale9NativeDraw9Grid = true;
    (node as any).__rawSwfScale9NativeReady = true;
    (node as any).__rawSwfScale9NeedsNativeDraw9Grid = false;
    rawSwfRendererAssetMetrics().scale9Draw9GridInstalls += 1;
    return true;
}

function scale9TextureForCharacter(character: any): Promise<any | null> {
    const cacheKey = character as object;
    let cached = scale9TextureCache.get(cacheKey);
    if (!cached) {
        cached = scale9TextureForCharacterUncached(character);
        scale9TextureCache.set(cacheKey, cached);
    }
    return cached;
}

async function scale9TextureForCharacterUncached(character: any): Promise<any | null> {
    if (typeof document === "undefined") {
        return null;
    }
    const splitter = character?.scalingGrid?.splitter ?? character?.shapeBounds ?? character?.bounds;
    const bounds = characterNominalBounds(character, splitter);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(bounds.width));
    canvas.height = Math.max(1, Math.ceil(bounds.height));
    const context = canvas.getContext("2d");
    if (!context) {
        return null;
    }
    context.save();
    context.translate(-bounds.xMin, -bounds.yMin);
    await drawCharacterToCanvas(context, character);
    context.restore();
    const texture = createTextureFromSource(canvas, canvas.width, canvas.height);
    if (texture) {
        (texture as any)._sizeGrid = scale9SizeGridForCharacter(character, bounds);
        rawSwfRendererAssetMetrics().scale9SourceUploads += 1;
    }
    return texture;
}

function scale9SizeGridForCharacter(character: any, bounds: SwfRect): number[] {
    const splitter = character?.scalingGrid?.splitter;
    if (!splitter) {
        return [0, 0, 0, 0, 0];
    }
    return [
        Math.max(0, splitter.yMin - bounds.yMin),
        Math.max(0, bounds.xMax - splitter.xMax),
        Math.max(0, bounds.yMax - splitter.yMax),
        Math.max(0, splitter.xMin - bounds.xMin),
        0
    ];
}

async function drawCharacterToCanvas(context: CanvasRenderingContext2D, character: any): Promise<void> {
    if (isSpriteCharacter(character)) {
        for (const placement of framePlacements(character, 0)) {
            if (placement.characterId == null) {
                continue;
            }
            const child = (character as any).__rawSwfMovie?.getCharacter?.(placement.characterId);
            if (!child) {
                continue;
            }
            context.save();
            applyPlacementMatrixToCanvas(context, placement.matrix);
            await drawCharacterToCanvas(context, child);
            context.restore();
        }
        return;
    }
    if (isMorphShapeCharacter(character)) {
        await drawShapeToCanvas(context, morphShapeAtRatio(character, 0));
        return;
    }
    if (character?.shapeBounds) {
        await drawShapeToCanvas(context, character);
        return;
    }
    if (character?.zlibBitmapData || character?.imageData) {
        const surface = await imageCharacterToSurface(character);
        context.drawImage(surface.source, 0, 0);
        return;
    }
    if (character?.records) {
        await drawStaticTextToCanvas(context, character);
    }
}

function applyPlacementMatrixToCanvas(context: CanvasRenderingContext2D, matrix: SwfMatrix | undefined): void {
    if (!matrix) {
        return;
    }
    context.transform(
        matrix.scaleX,
        matrix.rotateSkew1,
        matrix.rotateSkew0,
        matrix.scaleY,
        matrix.translateX,
        matrix.translateY
    );
}

async function drawShapeToCanvas(context: CanvasRenderingContext2D, shape: SwfDefineShape): Promise<void> {
    const paths = shape.paths?.filter(path => (path.fillStyleIndex > 0 || path.lineStyleIndex > 0) && path.points.length >= 2) ?? [];
    for (const fill of shape.fillStyles ?? []) {
        const fillPaths = orientedFillPathsForStyle(paths, fill.index);
        if (fillPaths.length === 0) {
            continue;
        }
        const pathBounds = boundsForPaths(fillPaths);
        const image = fill.bitmapId == null ? null : (shape as any).__rawSwfMovie?.getCharacter?.(fill.bitmapId);
        const raster = await rasterizeCompoundFill(fillPaths, pathBounds, fill, image);
        if (raster) {
            context.drawImage(raster, pathBounds.xMin, pathBounds.yMin);
            continue;
        }
        if (fill.color) {
            buildCanvasCompoundPath(context, fillPaths, 0, 0);
            context.fillStyle = rgbaToCss(fill.color) ?? "#000000";
            context.fill("nonzero");
        }
    }
    for (const path of paths) {
        const line = shape.lineStyles?.find(candidate => candidate.index === path.lineStyleIndex);
        const lineColor = colorForLineStyle(line);
        if (!lineColor) {
            continue;
        }
        const commands = drawPathCommands(path, false);
        context.beginPath();
        for (const command of commands) {
            if (command[0] === "moveTo") {
                context.moveTo(command[1], command[2]);
            }
            else if (command[0] === "lineTo") {
                context.lineTo(command[1], command[2]);
            }
            else if (command[0] === "quadraticCurveTo") {
                context.quadraticCurveTo(command[1], command[2], command[3], command[4]);
            }
        }
        context.strokeStyle = lineColor;
        context.lineWidth = Math.max(1, line?.width ?? 1);
        context.stroke();
    }
}

async function drawStaticTextToCanvas(context: CanvasRenderingContext2D, character: SwfDefineText): Promise<void> {
    for (const record of character.records) {
        if (record.fontId == null) {
            continue;
        }
        const font = (character as any).__rawSwfMovie?.getCharacter?.(record.fontId) as SwfDefineFont | undefined;
        if (!font?.glyphs) {
            continue;
        }
        const textHeightTwips = record.textHeightTwips ?? 1024;
        const glyphScale = textHeightTwips / fontGlyphCoordinateDivisor(font);
        let xCursor = (record.xOffsetTwips ?? 0) / 20;
        const yOffset = (record.yOffsetTwips ?? 0) / 20;
        context.fillStyle = rgbaToCss(record.textColor) ?? "#ffffff";
        for (const entry of record.glyphs) {
            const glyph = font.glyphs[entry.glyphIndex];
            const paths = glyph ? orientedFillPathsForStyle(glyph.paths, 1) : [];
            if (paths.length) {
                buildCanvasTextGlyphPath(context, paths, character, xCursor, yOffset, glyphScale);
                context.fill("nonzero");
            }
            xCursor += entry.advanceTwips * glyphScale / 20;
        }
    }
}

function applyPlacementDisplayState(node: Sprite | Text, placement: SwfPlaceObject): void {
    if (placement.visible === false) {
        node.visible = false;
    }
    const displayFilters: any[] = [];
    const colorFilter = applyColorTransform(node, placement.colorTransform);
    const renderSurfaceReasons = placementRenderSurfaceReasons(placement);
    if (colorFilter) {
        displayFilters.push(colorFilter);
        (node as any).__rawSwfColorTransformMatrix = colorTransformMatrix(placement.colorTransform);
    }
    const flashFilters = createFlashFilters(placement.filters);
    displayFilters.push(...flashFilters);
    (node as any).filters = displayFilters.length > 0 ? displayFilters : null;
    (node as any).__rawSwfFilterOrder = displayFilters.map(filter => filter?.constructor?.name ?? "UnknownFilter");
    (node as any).__rawSwfFlashFilterOrder = flashFilters.map(filter => filter?.constructor?.name ?? "UnknownFilter");
    const blendMode = flashBlendModeToLaya(placement.blendMode);
    if (blendMode) {
        (node as any).blendMode = blendMode;
    }
    if (placement.cacheAsBitmap || renderSurfaceReasons.length > 0) {
        (node as any).cacheAs = "bitmap";
        (node as any).__rawSwfRenderSurfaceReasons = renderSurfaceReasons;
    }
}

function placementRenderSurfaceReasons(placement: SwfPlaceObject): string[] {
    const reasons: string[] = [];
    const blendMode = flashBlendModeToLaya(placement.blendMode);
    if (blendMode && blendMode !== "normal") {
        reasons.push("blend");
    }
    if (placement.filters?.length) {
        reasons.push("filter");
    }
    if (needsColorFilter(placement.colorTransform)) {
        reasons.push("colorTransform");
    }
    return reasons;
}

function applyColorTransform(node: Sprite | Text, transform: SwfPlaceObject["colorTransform"]): any | null {
    if (!transform) {
        return null;
    }
    if (needsColorFilter(transform)) {
        return new ColorFilter(colorTransformMatrix(transform));
    }
    const alpha = alphaFromColorTransform(transform);
    if (alpha != null) {
        node.alpha = alpha;
    }
    return null;
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
    const layaFilters = createFlashFilters(filters);
    if (layaFilters.length === 0) {
        return;
    }
    (node as any).filters = layaFilters;
}

function createFlashFilters(filters: SwfFilter[] | undefined): any[] {
    if (!filters?.length) {
        return [];
    }
    const layaFilters = filters.map(flashFilterToLaya).filter((filter): filter is any => !!filter);
    if (layaFilters.length === 0) {
        return [];
    }
    return layaFilters;
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
): Promise<HTMLCanvasElement | null> {
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
        const bitmap = await imageCharacterToSurface(image);
        drawBitmapFill(context, bitmap.source, bounds, fill);
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
    return canvas;
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
    bitmap: CanvasImageSource,
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
        const bitmapWidth = sourceWidth(bitmap);
        const bitmapHeight = sourceHeight(bitmap);
        const minX = Math.floor(Math.min(...corners.map(point => point.x)) / bitmapWidth) - 1;
        const maxX = Math.ceil(Math.max(...corners.map(point => point.x)) / bitmapWidth) + 1;
        const minY = Math.floor(Math.min(...corners.map(point => point.y)) / bitmapHeight) - 1;
        const maxY = Math.ceil(Math.max(...corners.map(point => point.y)) / bitmapHeight) + 1;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                context.drawImage(bitmap, x * bitmapWidth, y * bitmapHeight);
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
    const center = transformGradientPoint(matrix, bounds, 0, 0);
    const axisX = transformGradientPoint(matrix, bounds, 16384, 0);
    const axisY = transformGradientPoint(matrix, bounds, 0, 16384);
    const gradient = fill.type === 0x12 || fill.type === 0x13
        ? context.createRadialGradient(
            center.x,
            center.y,
            0,
            center.x,
            center.y,
            Math.max(distanceBetween(center, axisX), distanceBetween(center, axisY), 0.0001)
        )
        : context.createLinearGradient(
            transformGradientPoint(matrix, bounds, -16384, 0).x,
            transformGradientPoint(matrix, bounds, -16384, 0).y,
            axisX.x,
            axisX.y
        );
    for (const record of records) {
        gradient.addColorStop(Math.max(0, Math.min(1, record.ratio / 255)), rgbaToCss(record.color) ?? "#000000");
    }
    return gradient;
}

function transformGradientPoint(
    matrix: SwfFillStyle["gradientMatrix"],
    bounds: SwfRect,
    x: number,
    y: number
): { x: number; y: number } {
    if (!matrix) {
        return {
            x: bounds.width / 2 + x / 32768 * bounds.width,
            y: bounds.height / 2 + y / 32768 * bounds.height
        };
    }
    return {
        x: (matrix.scaleX * x + matrix.rotateSkew0 * y) / 20 + matrix.translateX - bounds.xMin,
        y: (matrix.rotateSkew1 * x + matrix.scaleY * y) / 20 + matrix.translateY - bounds.yMin
    };
}

function distanceBetween(left: { x: number; y: number }, right: { x: number; y: number }): number {
    return Math.hypot(right.x - left.x, right.y - left.y);
}

async function loadCanvasOntoSprite(sprite: Sprite, canvas: HTMLCanvasElement): Promise<void> {
    const texture = createTextureFromSource(canvas, canvas.width, canvas.height);
    if (texture) {
        (sprite as any).texture = texture;
        rawSwfRendererAssetMetrics().directCanvasUploads += 1;
        return;
    }
    (sprite as any).__rawSwfCanvasSource = canvas;
}

async function loadImageCharacterOntoSprite(sprite: Sprite, image: any): Promise<void> {
    const surface = await imageCharacterToSurface(image);
    const texture = createTextureFromSource(surface.source, surface.width, surface.height, surface.pixels);
    if (texture) {
        (sprite as any).texture = texture;
        if (surface.pixels) {
            rawSwfRendererAssetMetrics().directPixelUploads += 1;
        }
        else {
            rawSwfRendererAssetMetrics().directImageUploads += 1;
        }
        return;
    }
    (sprite as any).__rawSwfImageSource = surface.source;
}

function createTextureFromSource(sourceImage: CanvasImageSource, width: number, height: number, pixels?: ImageData): any | null {
    const Laya = (globalThis as any).Laya;
    if (!Laya?.Texture || !Laya?.Texture2D || !Laya?.TextureFormat) {
        return null;
    }
    try {
        const source = new Laya.Texture2D(width, height, Laya.TextureFormat.R8G8B8A8, false, false, true, false);
        rawSwfRendererAssetMetrics().directSrgbTextureUploads += 1;
        if (pixels && typeof source.setPixelsData === "function") {
            source.setPixelsData(pixels.data, false, false);
        }
        else {
            source.setImageData(sourceImage as HTMLCanvasElement | HTMLImageElement | ImageBitmap, false, false);
        }
        return new Laya.Texture(source);
    }
    catch (_error) {
        return null;
    }
}

function rawSwfRendererAssetMetrics(): {
    directCanvasUploads: number;
    directImageUploads: number;
    directPixelUploads: number;
    canvasBlobFallbacks: number;
    imageDecoderDecodes: number;
    losslessDecodes: number;
    deflateInflates: number;
    unsupportedImageDecodes: number;
    scale9SourceUploads: number;
    scale9Draw9GridInstalls: number;
    directSrgbTextureUploads: number;
    premultipliedTextureUploads: number;
} {
    const global = globalThis as any;
    global.__rawSwfRendererAssetMetrics ??= {
        directCanvasUploads: 0,
        directImageUploads: 0,
        directPixelUploads: 0,
        canvasBlobFallbacks: 0,
        imageDecoderDecodes: 0,
        losslessDecodes: 0,
        deflateInflates: 0,
        unsupportedImageDecodes: 0,
        scale9SourceUploads: 0,
        scale9Draw9GridInstalls: 0,
        directSrgbTextureUploads: 0,
        premultipliedTextureUploads: 0
    };
    return global.__rawSwfRendererAssetMetrics;
}

function imageCharacterToSurface(image: any): Promise<DecodedSwfImage> {
    const cached = imageSurfaceCache.get(image);
    if (cached) {
        return cached;
    }
    const pending = image.zlibBitmapData
        ? losslessBitmapToSurface(image)
        : image.alphaData
        ? composeJpeg3AlphaSurface(jpegBytesForImage(image), image.alphaData)
        : compressedImageToSurface(jpegBytesForImage(image), "image/jpeg");
    imageSurfaceCache.set(image, pending);
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

async function losslessBitmapToSurface(image: SwfDefineBitsLossless): Promise<DecodedSwfImage> {
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
    rawSwfRendererAssetMetrics().losslessDecodes += 1;
    return {
        source: canvas,
        width: canvas.width,
        height: canvas.height,
        pixels
    };
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

async function composeJpeg3AlphaSurface(imageData: Uint8Array, alphaData: Uint8Array): Promise<DecodedSwfImage> {
    const image = await compressedImageToSurface(imageData, "image/jpeg");
    const alpha = await inflateDeflate(alphaData);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
        throw new Error("Invalid SWF JPEG alpha bitmap dimensions.");
    }
    context.drawImage(image.source, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixelCount = Math.min(alpha.byteLength, canvas.width * canvas.height);
    for (let index = 0; index < pixelCount; index++) {
        pixels.data[index * 4 + 3] = alpha[index];
    }
    context.putImageData(pixels, 0, 0);
    return {
        source: canvas,
        width: canvas.width,
        height: canvas.height,
        pixels
    };
}

async function inflateDeflate(bytes: Uint8Array): Promise<Uint8Array> {
    const DecompressionStreamCtor = (globalThis as any).DecompressionStream;
    if (typeof DecompressionStreamCtor !== "function") {
        return bytes;
    }
    const body = new Response(bytes).body;
    if (body == null) {
        throw new Error("SWF deflate decode could not create a byte stream.");
    }
    rawSwfRendererAssetMetrics().deflateInflates += 1;
    const stream = body.pipeThrough(new DecompressionStreamCtor("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compressedImageToSurface(bytes: Uint8Array, type: string): Promise<DecodedSwfImage> {
    const ImageDecoderCtor = (globalThis as any).ImageDecoder;
    if (typeof ImageDecoderCtor !== "function") {
        rawSwfRendererAssetMetrics().unsupportedImageDecodes += 1;
        throw new Error(`SWF direct image decode requires ImageDecoder support for ${type}.`);
    }
    const decoder = new ImageDecoderCtor({ data: bytes, type });
    try {
        const result = await decoder.decode();
        const image = result.image as CanvasImageSource;
        rawSwfRendererAssetMetrics().imageDecoderDecodes += 1;
        return {
            source: image,
            width: sourceWidth(image),
            height: sourceHeight(image)
        };
    }
    finally {
        decoder.close?.();
    }
}

function sourceWidth(source: CanvasImageSource): number {
    return Number(
        (source as any).naturalWidth
        ?? (source as any).videoWidth
        ?? (source as any).displayWidth
        ?? (source as any).codedWidth
        ?? (source as any).width
        ?? 1
    ) || 1;
}

function sourceHeight(source: CanvasImageSource): number {
    return Number(
        (source as any).naturalHeight
        ?? (source as any).videoHeight
        ?? (source as any).displayHeight
        ?? (source as any).codedHeight
        ?? (source as any).height
        ?? 1
    ) || 1;
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

export class SwfTimelineInstance {
    readonly root: Sprite;
    readonly namedInstances = new Map<string, Sprite | Text>();
    readonly totalFrames: number;
    readonly frameRate: number;
    readonly ready: Promise<void>;

    private currentFrameIndex: number;
    private readonly runtimeByDepth = new Map<number, SwfRuntimePlacementNode>();
    private timerHandle: number | ReturnType<typeof globalThis.setInterval> | null = null;
    private playing = false;
    private destroyed = false;
    private initActionsExecuted = false;
    private renderPromise: Promise<void> = Promise.resolve();

    constructor(
        private readonly movie: SwfMovie,
        readonly sprite: SwfDefineSprite,
        options: SwfTimelineInstanceOptions = {}
    ) {
        this.root = new Sprite();
        this.totalFrames = Math.max(1, sprite.frames.length || sprite.frameCount || 1);
        this.frameRate = Math.max(1, Math.round(movie.header.frameRate || 1));
        this.currentFrameIndex = normalizeTimelineFrameIndex(options.frameIndex ?? 0, this.totalFrames);
        this.installFlashApiBridge();
        this.ready = this.renderFrame(this.currentFrameIndex).then(() => {
            if (options.autoPlay !== false) {
                this.play();
            }
        });
    }

    get currentFrame(): number {
        return this.currentFrameIndex + 1;
    }

    async play(): Promise<void> {
        if (this.destroyed || this.playing || this.totalFrames <= 1) {
            return;
        }
        await this.ready;
        if (this.destroyed || this.playing) {
            return;
        }
        this.playing = true;
        const delay = Math.max(1, Math.round(1000 / this.frameRate));
        const timer = (globalThis as any).Laya?.timer;
        if (timer?.loop) {
            timer.loop(delay, this, this.advanceFrameBridge);
            this.timerHandle = -1;
            return;
        }
        this.timerHandle = globalThis.setInterval(this.advanceFrameBridge, delay);
    }

    stop(): void {
        this.playing = false;
        const timer = (globalThis as any).Laya?.timer;
        if (this.timerHandle === -1 && timer?.clear) {
            timer.clear(this, this.advanceFrameBridge);
        } else if (this.timerHandle != null) {
            globalThis.clearInterval(this.timerHandle);
        }
        this.timerHandle = null;
    }

    async gotoAndPlay(frame: number | string): Promise<void> {
        await this.gotoAndStop(frame);
        await this.play();
    }

    async gotoAndStop(frame: number | string): Promise<void> {
        const targetIndex = resolveTimelineFrameInput(frame, this.totalFrames, this.sprite);
        this.stop();
        await this.renderFrame(targetIndex);
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.stop();
        this.destroyed = true;
        for (const runtime of this.runtimeByDepth.values()) {
            runtime.timeline?.destroy();
        }
        this.runtimeByDepth.clear();
        this.namedInstances.clear();
        this.root.removeChildren();
    }

    private readonly advanceFrameBridge = (): void => {
        if (!this.playing || this.destroyed) {
            return;
        }
        void this.renderFrame(this.currentFrameIndex + 1);
    };

    private installFlashApiBridge(): void {
        const raw = this.root as any;
        raw.__rawSwfTimelineInstance = this;
        raw.play = (): Promise<void> => this.play();
        raw.stop = (): void => this.stop();
        raw.gotoAndStop = (frame: number | string): Promise<void> => this.gotoAndStop(frame);
        raw.gotoAndPlay = (frame: number | string): Promise<void> => this.gotoAndPlay(frame);
        raw.destroy = (): void => this.destroy();
        Object.defineProperty(raw, "currentFrame", {
            configurable: true,
            enumerable: false,
            get: () => this.currentFrame
        });
        Object.defineProperty(raw, "currentLabel", {
            configurable: true,
            enumerable: false,
            get: () => frameLabelNameAt(this.sprite, this.currentFrameIndex)
        });
        Object.defineProperty(raw, "currentLabels", {
            configurable: true,
            enumerable: false,
            get: () => frameLabelNamesAt(this.sprite, this.currentFrameIndex)
        });
        Object.defineProperty(raw, "totalFrames", {
            configurable: true,
            enumerable: false,
            get: () => this.totalFrames
        });
    }

    private async renderFrame(frameIndex: number): Promise<void> {
        const targetIndex = normalizeTimelineFrameIndex(frameIndex, this.totalFrames);
        this.renderPromise = this.renderPromise.then(async () => {
            if (this.destroyed) {
                return;
            }
            await this.renderFrameNow(targetIndex);
            this.currentFrameIndex = targetIndex;
        });
        return this.renderPromise;
    }

    private async renderFrameNow(frameIndex: number): Promise<void> {
        const placements = framePlacements(this.sprite, frameIndex);
        const nextRuntimes = new Map<number, SwfRuntimePlacementNode>();
        const frameNodes: { placement: SwfPlaceObject; runtime: SwfRuntimePlacementNode; character: any }[] = [];
        let renderedShapeCount = 0;
        for (const placement of placements) {
            if (placement.characterId == null) {
                continue;
            }
            const runtime = await this.resolveFrameRuntime(placement);
            const character = this.movie.getCharacter(placement.characterId);
            runtime.node.name = placement.name ?? "";
            applyPlacement(runtime.node, placement, character);
            nextRuntimes.set(placement.depth, runtime);
            frameNodes.push({ placement, runtime, character });
            renderedShapeCount += renderedShapeCountFor(runtime.node);
        }

        if (this.destroyed) {
            for (const [depth, runtime] of nextRuntimes) {
                if (this.runtimeByDepth.get(depth) !== runtime) {
                    runtime.timeline?.destroy();
                }
            }
            return;
        }

        const staleRuntimes = new Set<SwfRuntimePlacementNode>();
        for (const [depth, runtime] of this.runtimeByDepth) {
            if (nextRuntimes.get(depth) !== runtime) {
                staleRuntimes.add(runtime);
            }
        }

        this.namedInstances.clear();
        this.root.removeChildren();
        const maskStack: { clipDepth: number; group: Sprite }[] = [];
        for (const { placement, runtime } of frameNodes) {
            while (maskStack.length && placement.depth > maskStack[maskStack.length - 1].clipDepth) {
                maskStack.pop();
            }
            if (placement.name) {
                this.namedInstances.set(placement.name, runtime.node);
            }
            if (placement.clipDepth != null) {
                const group = new Sprite();
                group.mask = runtime.node as Sprite;
                currentMaskContainer(this.root, maskStack).addChild(group);
                maskStack.push({ clipDepth: placement.clipDepth, group });
                continue;
            }
            currentMaskContainer(this.root, maskStack).addChild(runtime.node);
        }

        this.runtimeByDepth.clear();
        for (const [depth, runtime] of nextRuntimes) {
            this.runtimeByDepth.set(depth, runtime);
        }
        for (const runtime of staleRuntimes) {
            runtime.timeline?.destroy();
        }
        (this.root as any).__rawSwfRenderedShapeCount = renderedShapeCount;
        (this.root as any).__rawSwfBitmapFillCount = childrenDebugCount(this.root, "__rawSwfBitmapFillCount");
        this.currentFrameIndex = frameIndex;
        if (!this.initActionsExecuted) {
            this.initActionsExecuted = true;
            executeInitAvm1Actions(this.root, this.sprite);
        }
        executeFrameAvm1Actions(this.root, this.sprite.frames[frameIndex], this);
    }

    private async resolveFrameRuntime(placement: SwfPlaceObject): Promise<SwfRuntimePlacementNode> {
        const existing = this.runtimeByDepth.get(placement.depth);
        const character = this.movie.getCharacter(placement.characterId!);
        const ratio = isMorphShapeCharacter(character) ? placement.ratio ?? 0 : undefined;
        if (existing?.characterId === placement.characterId && existing.ratio === ratio) {
            return existing;
        }
        const runtime = await createTimelineRuntimeNode(this.movie, character, ratio);
        return {
            characterId: placement.characterId!,
            ratio,
            ...runtime
        };
    }
}

function normalizeTimelineFrameIndex(frameIndex: number, totalFrames: number): number {
    if (!Number.isFinite(frameIndex)) {
        return 0;
    }
    if (totalFrames <= 0) {
        return 0;
    }
    const normalized = Math.trunc(frameIndex);
    return ((normalized % totalFrames) + totalFrames) % totalFrames;
}

function resolveTimelineFrameInput(frame: number | string, totalFrames: number, sprite?: SwfDefineSprite): number {
    if (typeof frame === "number") {
        return normalizeTimelineFrameIndex(frame - 1, totalFrames);
    }
    const parsed = Number(frame);
    if (Number.isFinite(parsed)) {
        return normalizeTimelineFrameIndex(parsed - 1, totalFrames);
    }
    const label = sprite?.frameLabelsByName?.get(frame) ?? sprite?.frameLabels?.find(candidate => candidate.name === frame);
    if (label) {
        return normalizeTimelineFrameIndex(label.frameIndex, totalFrames);
    }
    throw new Error(`Frame label '${frame}' was not found on the raw-SWF timeline.`);
}

function frameLabelNamesAt(sprite: SwfDefineSprite, frameIndex: number): string[] {
    const normalized = normalizeTimelineFrameIndex(frameIndex, Math.max(1, sprite.frames.length || sprite.frameCount || 1));
    return (sprite.frames[normalized]?.labels ?? []).map(label => label.name);
}

function frameLabelNameAt(sprite: SwfDefineSprite, frameIndex: number): string | null {
    return frameLabelNamesAt(sprite, frameIndex)[0] ?? null;
}

async function createTimelineRuntimeNode(
    movie: SwfMovie,
    character: any,
    ratio: number = 0
): Promise<{ node: Sprite | Text; timeline?: SwfTimelineInstance }> {
    if (isSpriteCharacter(character)) {
        const timeline = new SwfTimelineInstance(movie, character, {
            frameIndex: 0,
            autoPlay: true
        });
        await timeline.ready;
        return {
            node: timeline.root,
            timeline
        };
    }
    if (isButtonCharacter(character)) {
        return { node: await createButtonNode(movie, character, new Map()) };
    }
    if (isMorphShapeCharacter(character)) {
        return { node: await renderMorphShapeNode(movie, character, ratio) };
    }
    if (character?.variableName !== undefined || character?.initialText !== undefined) {
        return { node: createTextNode(movie, character) };
    }
    if (character?.records) {
        return { node: await createStaticTextNode(movie, character) };
    }
    if (character?.zlibBitmapData) {
        return { node: await createBitmapNode(character) };
    }
    if (character?.shapeBounds) {
        return { node: await renderShapeNode(movie, character) };
    }
    const sprite = new Sprite();
    if (character?.bounds) {
        sprite.size(character.bounds.width, character.bounds.height);
    }
    return { node: sprite };
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

function interpolateRect(start: SwfRect, end: SwfRect, ratio: number): SwfRect {
    const xMinTwips = Math.round(interpolateNumber(start.xMinTwips, end.xMinTwips, ratio));
    const xMaxTwips = Math.round(interpolateNumber(start.xMaxTwips, end.xMaxTwips, ratio));
    const yMinTwips = Math.round(interpolateNumber(start.yMinTwips, end.yMinTwips, ratio));
    const yMaxTwips = Math.round(interpolateNumber(start.yMaxTwips, end.yMaxTwips, ratio));
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
