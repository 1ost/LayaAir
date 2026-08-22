import { ILaya } from "../../ILaya";
import { Node as LayaNode } from "../../laya/display/Node";
import {
    beginNodeMutationTransaction, endNodeMutationTransaction, NodeMutationOperation,
    NodeMutationPermit, NodeMutationTransaction, runPermittedNodeMutation,
} from "../../laya/display/NodeMutationTransaction";
import { Loader as LayaLoader } from "../../laya/net/Loader";
import { Prefab } from "../../laya/resource/HierarchyResource";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { Event, EventPhase } from "../events/Event";
import { EventDispatcher } from "../events/EventDispatcher";
import { FlashEventListener } from "../events/FlashEventRouter";
import { IOErrorEvent } from "../events/IOErrorEvent";
import { ProgressEvent } from "../events/ProgressEvent";
import { SecurityErrorEvent } from "../events/SecurityErrorEvent";
import { URLRequest, snapshotNativeLoaderRequest } from "../net/URLRequest";
import { LoaderContext, snapshotNativeLoaderContext } from "../system/LoaderContext";
import {
    bindDisplayObjectLoaderInfo, DisplayObject, isFlashDisplayObject, unbindDisplayObjectLoaderInfo
} from "./DisplayObject";
import { DisplayObjectContainer } from "./DisplayObjectContainer";

const LOADER_VALUES = new WeakSet<object>();
const CONTENT_OWNERS = new WeakMap<DisplayObject, Loader>();
const CONTENT_NODE_TRANSACTIONS = new WeakMap<DisplayObject, NodeMutationTransaction>();
const addCanonicalLoaderChild = DisplayObjectContainer.prototype.addChildAt;
const removeCanonicalLoaderChild = DisplayObjectContainer.prototype.removeChild;
const destroyCanonicalLoader = DisplayObjectContainer.prototype.destroy;
const LOADER_INFO_TOKEN = Symbol("LayaAir.flash.LoaderInfo");
const LOADER_INFO_VALUES = new WeakSet<object>();
const LOADER_INFO_STATE = new WeakMap<LoaderInfo, LoaderInfoState>();
const LOADER_INFO_ROUTERS = new WeakMap<LoaderInfo, LoaderInfoRouterState>();
const EMPTY_PARAMETERS = Object.freeze(Object.create(null)) as Readonly<Record<string, string>>;
const HOST_VALUES = new WeakSet<object>();
const SOURCE_VALUES = new WeakMap<object, NativeLoaderContentSourceState>();
const HIERARCHY_CONTENT_TYPE = "application/x-laya-hierarchy";
const SAFE_CONTENT_URL = /^(?![\u0000-\u001f\u007f])[^\u0000-\u001f\u007f]{1,4096}$/;
const LOADER_NODE_GUARDED_OPERATIONS: readonly NodeMutationOperation[] = Object.freeze([
    "addChildAt", "setChildIndex", "removeChild", "removeChildAt",
    "addInternalChild", "removeInternalChild", "setContainer",
    "destroy", "destroyDerived", "destroyFlashDisplayObject", "destroyChildren",
]);
const CONTENT_NODE_GUARDED_OPERATIONS: readonly NodeMutationOperation[] = Object.freeze([
    "setParent", "setParentDerived", "setContainer",
    "destroy", "destroyDerived", "destroyFlashDisplayObject",
]);
const LOADER_INFO_LIFECYCLE_EVENTS = new Set<string>([
    Event.OPEN,
    ProgressEvent.PROGRESS,
    Event.INIT,
    Event.COMPLETE,
    Event.UNLOAD,
    IOErrorEvent.IO_ERROR,
    SecurityErrorEvent.SECURITY_ERROR,
]);
let defaultHost: NativeLoaderContentHost | null = null;

interface LoaderInfoState {
    readonly loader: Loader;
    bytesLoaded: number;
    bytesTotal: number;
    content: DisplayObject | null;
    contentType: string;
    height: number;
    url: string;
    width: number;
}

interface LoaderInfoListenerEntry {
    readonly listener: FlashEventListener;
    readonly priority: number;
    readonly ordinal: number;
}

interface LoaderInfoListenerLists {
    readonly capture: LoaderInfoListenerEntry[];
    readonly bubble: LoaderInfoListenerEntry[];
}

interface LoaderInfoRouterState {
    readonly types: Map<string, LoaderInfoListenerLists>;
    ordinal: number;
}

interface NativeLoaderContentSourceState {
    readonly owner: NativeLoaderContentHost;
    readonly logicalURL: string;
    readonly nativeHierarchyURL: string;
    readonly bytesTotal: number;
}

/** @internal Read-only nominal proof for canonical Flash LoaderInfo values. */
export function isFlashLoaderInfo(value: unknown): value is LoaderInfo {
    return typeof value === "object" && value !== null && LOADER_INFO_VALUES.has(value);
}

/** Stable, externally read-only event and state surface for one Loader. */
export class LoaderInfo extends EventDispatcher {
    constructor(token: typeof LOADER_INFO_TOKEN, loader: Loader) {
        if (token !== LOADER_INFO_TOKEN || !LOADER_VALUES.has(loader))
            throw new TypeError("LoaderInfo is created only by a canonical Loader");
        super();
        // LoaderInfo owns a module-private event ledger. Retire the ordinary
        // EventDispatcher router created by super() so callers cannot bypass
        // the reserved lifecycle surface with EventDispatcher.prototype.call.
        Object.defineProperty(this, "_flashEvents", {
            configurable: false,
            enumerable: false,
            value: null,
            writable: false,
        });
        LOADER_INFO_VALUES.add(this);
        LOADER_INFO_ROUTERS.set(this, { types: new Map(), ordinal: 0 });
        LOADER_INFO_STATE.set(this, {
            loader,
            bytesLoaded: 0,
            bytesTotal: 0,
            content: null,
            contentType: "",
            height: 0,
            url: "",
            width: 0,
        });
        const state = () => readLoaderInfo(this);
        Object.defineProperties(this, {
            bytesLoaded: { configurable: false, enumerable: false, get: () => state().bytesLoaded },
            bytesTotal: { configurable: false, enumerable: false, get: () => state().bytesTotal },
            content: { configurable: false, enumerable: false, get: () => state().content },
            contentType: { configurable: false, enumerable: false, get: () => state().contentType },
            height: { configurable: false, enumerable: false, get: () => state().height },
            loader: { configurable: false, enumerable: false, get: () => state().loader },
            parameters: { configurable: false, enumerable: false, get: () => EMPTY_PARAMETERS },
            url: { configurable: false, enumerable: false, get: () => state().url },
            width: { configurable: false, enumerable: false, get: () => state().width },
        });
    }

    get bytesLoaded(): number { return readLoaderInfo(this).bytesLoaded; }
    get bytesTotal(): number { return readLoaderInfo(this).bytesTotal; }
    get content(): DisplayObject | null { return readLoaderInfo(this).content; }
    get contentType(): string { return readLoaderInfo(this).contentType; }
    get height(): number { return readLoaderInfo(this).height; }
    get loader(): Loader { return readLoaderInfo(this).loader; }
    get parameters(): Readonly<Record<string, string>> { return EMPTY_PARAMETERS; }
    get url(): string { return readLoaderInfo(this).url; }
    get width(): number { return readLoaderInfo(this).width; }

    override addEventListener(type: string, listener: FlashEventListener, useCapture = false,
        priority = 0, useWeakReference = false): void {
        addLoaderInfoListener(this, type, listener, useCapture, priority, useWeakReference);
    }
    override removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        removeLoaderInfoListener(this, type, listener, useCapture);
    }

    override dispatchEvent(event: Event): boolean {
        if (LOADER_INFO_LIFECYCLE_EVENTS.has(event.type))
            throw new UnsupportedFlashFeatureError(
                "flash.display.LoaderInfo lifecycle dispatch",
                "LoaderInfo lifecycle events are published only by its owning Loader"
            );
        return dispatchLoaderInfo(this, event);
    }
    override hasEventListener(type: string): boolean { return hasLoaderInfoListener(this, type); }
    override willTrigger(type: string): boolean { return this.hasEventListener(type); }
}

/** Opaque, host-bound proof for one already-published native hierarchy. */
export class NativeLoaderContentSource {
    private constructor() {}

    toString(): string { return "[object NativeLoaderContentSource]"; }
}

/**
 * Narrow bootstrap capability mapping logical resource identities to native
 * Laya hierarchy assets. It cannot supply display instances or byte decoders.
 */
export abstract class NativeLoaderContentHost {
    protected constructor() { HOST_VALUES.add(this); }

    abstract resolve(logicalURL: string): NativeLoaderContentSource | null;

    /** Mints a host-bound source after validating all immutable asset facts. */
    protected hierarchy(logicalURL: string, nativeHierarchyURL: string, bytesTotal: number): NativeLoaderContentSource {
        validateLogicalURL(logicalURL);
        validateHierarchyURL(nativeHierarchyURL);
        if (!Number.isSafeInteger(bytesTotal) || bytesTotal < 0)
            throw new TypeError("Native hierarchy bytesTotal must be a nonnegative safe integer");
        const source = Object.freeze(Object.create(NativeLoaderContentSource.prototype)) as NativeLoaderContentSource;
        SOURCE_VALUES.set(source, Object.freeze({ owner: this, logicalURL, nativeHierarchyURL, bytesTotal }));
        return source;
    }
}

/** Installs the single application bootstrap host. It cannot be replaced. */
export function installNativeLoaderContentHost(host: NativeLoaderContentHost): void {
    if (!isNativeLoaderContentHost(host))
        throw new TypeError("Native Loader content host must be a nominal Laya capability");
    if (defaultHost !== null) throw new Error("Native Loader content host is already installed");
    defaultHost = host;
}

/** @internal Read-only nominal proof for canonical native-content hosts. */
export function isNativeLoaderContentHost(value: unknown): value is NativeLoaderContentHost {
    return typeof value === "object" && value !== null && HOST_VALUES.has(value);
}

interface NativeSourceSnapshot {
    readonly logicalURL: string;
    readonly nativeHierarchyURL: string;
    readonly bytesTotal: number;
    readonly contentType: string;
}

interface LoadTransaction {
    readonly generation: number;
    readonly source: NativeSourceSnapshot;
    bytesLoaded: number;
    firstError?: unknown;
    terminal: boolean;
}

/** @internal Read-only nominal proof for canonical Flash Loader values. */
export function isFlashLoader(value: unknown): value is Loader {
    return typeof value === "object" && value !== null && LOADER_VALUES.has(value);
}

function readLoaderInfo(value: LoaderInfo): LoaderInfoState {
    const state = LOADER_INFO_STATE.get(value);
    if (!state) throw new TypeError("LoaderInfo receiver is not canonical");
    return state;
}

function readLoaderInfoRouter(value: LoaderInfo): LoaderInfoRouterState {
    const router = LOADER_INFO_ROUTERS.get(value);
    if (!router) throw new TypeError("LoaderInfo event receiver is not canonical");
    return router;
}

function addLoaderInfoListener(value: LoaderInfo, type: string, listener: FlashEventListener,
    useCapture: boolean, priority: number, useWeakReference: boolean): void {
    if (useWeakReference)
        throw new UnsupportedFlashFeatureError(
            "flash.events.IEventDispatcher.useWeakReference",
            "weak listener retention is nondeterministic"
        );
    if (typeof listener !== "function") throw new TypeError(`Listener for '${type}' must be a function`);
    if (!Number.isFinite(priority)) throw new TypeError("Listener priority must be finite");
    new Event(type);
    const router = readLoaderInfoRouter(value);
    let lists = router.types.get(type);
    if (!lists) {
        lists = { capture: [], bubble: [] };
        router.types.set(type, lists);
    }
    const entries = useCapture ? lists.capture : lists.bubble;
    if (entries.some(entry => entry.listener === listener)) return;
    entries.push({ listener, priority, ordinal: router.ordinal++ });
    entries.sort((left, right) => right.priority - left.priority || left.ordinal - right.ordinal);
}

function removeLoaderInfoListener(value: LoaderInfo, type: string, listener: FlashEventListener,
    useCapture: boolean): void {
    const router = readLoaderInfoRouter(value);
    const lists = router.types.get(type);
    if (!lists) return;
    const entries = useCapture ? lists.capture : lists.bubble;
    const index = entries.findIndex(entry => entry.listener === listener);
    if (index >= 0) entries.splice(index, 1);
    if (lists.capture.length === 0 && lists.bubble.length === 0) router.types.delete(type);
}

function hasLoaderInfoListener(value: LoaderInfo, type: string): boolean {
    const lists = readLoaderInfoRouter(value).types.get(type);
    return !!lists && (lists.capture.length > 0 || lists.bubble.length > 0);
}

function dispatchLoaderInfo(value: LoaderInfo, event: Event): boolean {
    if (!(event instanceof Event)) throw new TypeError("dispatchEvent requires a flash.events.Event instance");
    event._prepareForDispatch(value);
    event._setCurrentTarget(value, EventPhase.AT_TARGET);
    const lists = readLoaderInfoRouter(value).types.get(event.type);
    if (lists) {
        for (const entries of [lists.capture, lists.bubble]) {
            for (const entry of entries.slice()) {
                entry.listener(event);
                if (event._isImmediatePropagationStopped) break;
            }
            if (event._isImmediatePropagationStopped) break;
        }
    }
    return !event.isDefaultPrevented();
}

function beginLoaderInfo(value: LoaderInfo, logicalURL: string, contentType: string, bytesTotal: number): void {
    const state = readLoaderInfo(value);
    state.bytesLoaded = 0;
    state.bytesTotal = bytesTotal;
    state.content = null;
    state.contentType = contentType;
    state.height = 0;
    state.url = logicalURL;
    state.width = 0;
}

function progressLoaderInfo(value: LoaderInfo, bytesLoaded: number): void {
    const state = readLoaderInfo(value);
    state.bytesLoaded = bytesLoaded;
    dispatchLoaderInfo(value, new ProgressEvent(ProgressEvent.PROGRESS, false, false,
        state.bytesLoaded, state.bytesTotal));
}

function publishLoaderInfo(value: LoaderInfo, content: DisplayObject): void {
    const state = readLoaderInfo(value);
    bindDisplayObjectLoaderInfo(content, value);
    state.content = content;
    state.width = Number.isFinite(content.width) ? content.width : 0;
    state.height = Number.isFinite(content.height) ? content.height : 0;
}

function clearLoaderInfo(value: LoaderInfo): void {
    const state = readLoaderInfo(value);
    if (state.content !== null) unbindDisplayObjectLoaderInfo(state.content, value);
    state.bytesLoaded = 0;
    state.bytesTotal = 0;
    state.content = null;
    state.contentType = "";
    state.height = 0;
    state.url = "";
    state.width = 0;
}

function dispatchLoaderInfoEvent(value: LoaderInfo, type: string): void {
    dispatchLoaderInfo(value, new Event(type));
}

function dispatchLoaderInfoIOError(value: LoaderInfo, text: string): void {
    dispatchLoaderInfo(value, new IOErrorEvent(IOErrorEvent.IO_ERROR, false, false, text));
}

function dispatchLoaderInfoSecurityError(value: LoaderInfo, text: string): void {
    dispatchLoaderInfo(value, new SecurityErrorEvent(SecurityErrorEvent.SECURITY_ERROR, false, false, text));
}

function readNativeLoaderContentSource(
    host: NativeLoaderContentHost,
    source: NativeLoaderContentSource,
    logicalURL: string
): NativeSourceSnapshot {
    if (!isNativeLoaderContentHost(host))
        throw new TypeError("Native Loader content host is not canonical");
    const state = typeof source === "object" && source !== null ? SOURCE_VALUES.get(source) : undefined;
    if (!state || state.owner !== host || state.logicalURL !== logicalURL)
        throw new TypeError("Native Loader content source is not authentic for this host and URL");
    return Object.freeze({
        logicalURL: state.logicalURL,
        nativeHierarchyURL: state.nativeHierarchyURL,
        bytesTotal: state.bytesTotal,
        contentType: HIERARCHY_CONTENT_TYPE,
    });
}

function validateLogicalURL(value: string): void {
    if (typeof value !== "string" || value.trim() !== value || !SAFE_CONTENT_URL.test(value))
        throw new TypeError("Native Loader logical URL must be a canonical non-empty string");
    if (/^(?:data|javascript|blob):/i.test(value))
        throw new TypeError("Native Loader logical URL uses a forbidden executable or inline scheme");
}

function validateHierarchyURL(value: string): void {
    if (typeof value !== "string" || value.trim() !== value || !SAFE_CONTENT_URL.test(value))
        throw new TypeError("Native hierarchy URL must be a canonical non-empty string");
    if (/^(?:data|javascript|blob|file):/i.test(value))
        throw new TypeError("Native hierarchy URL uses a forbidden scheme");
    const path = value.split(/[?#]/, 1)[0];
    if (!/\.lh$/i.test(path))
        throw new TypeError("Native Loader content host may resolve only .lh hierarchy assets");
    if (/\.(?:swf|swc|abc)$/i.test(path))
        throw new TypeError("Native Loader content host cannot resolve non-hierarchy executables");
}

function hasNativeParent(node: LayaNode, parent: LayaNode): boolean {
    return node.parent === parent;
}

/**
 * Source-shaped Flash Loader whose production path is deliberately limited to
 * authenticated native Laya hierarchy assets. It never fetches or executes
 * legacy bytecode, ApplicationDomain content or arbitrary byte input.
 */
export class Loader extends DisplayObjectContainer {
    readonly #contentLoaderInfo: LoaderInfo;
    readonly #explicitHost: NativeLoaderContentHost | null;
    #active: LoadTransaction | null = null;
    #content: DisplayObject | null = null;
    #generation = 0;
    #internalChildMutation = false;
    readonly #nodeTransaction: NodeMutationTransaction;

    constructor(nativeContentHost: NativeLoaderContentHost | null = null) {
        super();
        LOADER_VALUES.add(this);
        if (nativeContentHost !== null && !isNativeLoaderContentHost(nativeContentHost))
            throw new TypeError("Loader nativeContentHost must be a nominal Laya capability");
        this.#explicitHost = nativeContentHost;
        this.#contentLoaderInfo = new LoaderInfo(LOADER_INFO_TOKEN, this);
        this.#nodeTransaction = beginNodeMutationTransaction([this],
            operation => this.#rejectNodeMutation(operation), LOADER_NODE_GUARDED_OPERATIONS);
        Object.defineProperties(this, {
            content: { configurable: false, enumerable: false, get: () => this.#content },
            contentLoaderInfo: { configurable: false, enumerable: false, get: () => this.#contentLoaderInfo },
        });
    }

    get content(): DisplayObject | null { return this.#content; }
    get contentLoaderInfo(): LoaderInfo { return this.#contentLoaderInfo; }

    load(request: URLRequest, context: LoaderContext | null = null): void {
        if (context !== null) snapshotNativeLoaderContext(context);

        // Snapshot and resolve the complete authority before invalidating any
        // existing generation or display ownership.
        const logicalURL = snapshotNativeLoaderRequest(request);
        const entryGeneration = this.#generation;
        const host = this.#explicitHost ?? defaultHost;
        if (host === null) {
            this.#publishSourceFailure(logicalURL, "No authenticated native-content host is installed");
            return;
        }

        let source: NativeSourceSnapshot;
        try {
            const proof = host.resolve(logicalURL);
            if (this.#generation !== entryGeneration) return;
            if (proof === null) {
                this.#publishSourceFailure(logicalURL, "Native-content host rejected the logical URL");
                return;
            }
            source = readNativeLoaderContentSource(host, proof, logicalURL);
        } catch {
            if (this.#generation === entryGeneration)
                this.#publishSourceFailure(logicalURL, "Native-content source authentication failed");
            return;
        }
        if (this.#generation !== entryGeneration) return;
        this.#begin(source);
    }

    loadBytes(_bytes: ArrayBuffer | Uint8Array, _context: LoaderContext | null = null): never {
        throw new UnsupportedFlashFeatureError(
            "flash.display.Loader.loadBytes",
            "runtime executable and arbitrary byte decoding is forbidden"
        );
    }

    close(): void {
        if (this.#active === null) return;
        this.#generation++;
        this.#active = null;
    }

    unload(): void {
        ++this.#generation;
        this.#active = null;
        const error = this.#detachPublished(false, true);
        if (error !== undefined) throw error;
    }

    unloadAndStop(gc = true): void {
        if (typeof gc !== "boolean") throw new TypeError("Loader.unloadAndStop gc must be boolean");
        ++this.#generation;
        this.#active = null;
        const error = this.#detachPublished(true, true);
        if (error !== undefined) throw error;
    }

    override destroy(destroyChild = true): void {
        if (this.destroyed) return;
        this.#generation++;
        this.#active = null;
        const content = this.#content;
        const first = this.#detachPublished(destroyChild, false);
        if (content && hasNativeParent(content, this)) {
            if (first !== undefined) throw first;
            throw new Error("Loader content could not be detached before destroy");
        }
        let destroyError: unknown | undefined;
        try {
            runPermittedNodeMutation(this.#nodeTransaction, [
                { node: this, operation: "destroyFlashDisplayObject" },
                { node: this, operation: "destroyDerived" },
                { node: this, operation: "destroy" },
            ], () => destroyCanonicalLoader.call(this, false));
        } catch (error) { destroyError = error; }
        if (this.destroyed) endNodeMutationTransaction(this.#nodeTransaction);
        if (first !== undefined) throw first;
        if (destroyError !== undefined) throw destroyError;
    }

    override addChild<T extends LayaNode>(_node: T): T { return this.#rejectChildMutation(); }
    override addChildren(..._args: LayaNode[]): void { this.#rejectChildMutation(); }
    override addChildAt<T extends LayaNode>(_node: T, _index: number): T {
        if (!this.#internalChildMutation) return this.#rejectChildMutation();
        return super.addChildAt(_node, _index);
    }
    override removeChild<T extends LayaNode>(_node: T, _destroy?: boolean): T {
        if (!this.#internalChildMutation) return this.#rejectChildMutation();
        return super.removeChild(_node, _destroy);
    }
    override removeChildAt(_index: number, _destroy?: boolean): DisplayObject {
        if (!this.#internalChildMutation) return this.#rejectChildMutation();
        return super.removeChildAt(_index, _destroy) as DisplayObject;
    }
    override removeChildByName(_name: string, _destroy?: boolean): DisplayObject {
        if (!this.#internalChildMutation) return this.#rejectChildMutation();
        return super.removeChildByName(_name, _destroy) as DisplayObject;
    }
    override removeChildren(_beginIndex?: number, _endIndex?: number, _destroy?: boolean): void {
        if (!this.#internalChildMutation) this.#rejectChildMutation();
        else super.removeChildren(_beginIndex, _endIndex, _destroy);
    }
    override destroyChildren(): void {
        if (!this.#internalChildMutation) this.#rejectChildMutation();
        else super.destroyChildren();
    }
    override replaceChild(_newNode: LayaNode, _oldNode: LayaNode): LayaNode {
        return this.#rejectChildMutation();
    }
    override setChildIndex<T extends LayaNode>(_node: T, _index: number): T {
        return this.#rejectChildMutation();
    }
    override setChildIndexBefore(_node: LayaNode, _index: number): number {
        return this.#rejectChildMutation();
    }
    override _addChild(_node: LayaNode, _index?: number): LayaNode {
        if (!this.#internalChildMutation) return this.#rejectChildMutation();
        return super._addChild(_node, _index);
    }
    override _removeChild(_node: LayaNode): LayaNode {
        if (!this.#internalChildMutation) return this.#rejectChildMutation();
        return super._removeChild(_node);
    }

    #begin(source: NativeSourceSnapshot): void {
        const generation = ++this.#generation;
        this.#active = null;
        const unloadError = this.#detachPublished(false, true);
        if (unloadError !== undefined) throw unloadError;
        if (this.#generation !== generation) return;

        const transaction: LoadTransaction = {
            generation,
            source,
            bytesLoaded: 0,
            terminal: false,
        };
        this.#active = transaction;
        beginLoaderInfo(this.#contentLoaderInfo, source.logicalURL, source.contentType, source.bytesTotal);
        try {
            dispatchLoaderInfoEvent(this.#contentLoaderInfo, Event.OPEN);
        } catch (error) {
            this.#abortForListener(transaction, error);
            throw error;
        }
        if (!this.#isCurrent(transaction)) return;

        const nativeLoader = ILaya.loader;
        if (!nativeLoader || typeof nativeLoader.load !== "function") {
            this.#failIO(transaction, "Native Laya hierarchy loader is unavailable");
            return;
        }

        let completion: Promise<unknown>;
        try {
            completion = nativeLoader.load(
                source.nativeHierarchyURL,
                { type: LayaLoader.HIERARCHY, silent: true },
                ratio => this.#reportProgress(transaction, ratio)
            );
        } catch (error) {
            if (transaction.firstError !== undefined) throw transaction.firstError;
            this.#failIO(transaction, "Native Laya hierarchy load could not start");
            return;
        }
        if (!completion || typeof completion.then !== "function") {
            this.#failSecurity(transaction, "Native hierarchy loader returned a malformed transaction");
            return;
        }

        completion.then(
            prefab => this.#acceptPrefab(transaction, prefab),
            () => this.#failIO(transaction, "Native Laya hierarchy load failed")
        ).catch(error => {
            // Event listeners execute inside an asynchronous Laya completion.
            // Retain the exact primary object while preventing a second failure
            // event or a global unhandled rejection.
            if (transaction.firstError === undefined) transaction.firstError = error;
        });
    }

    #publishSourceFailure(logicalURL: string, text: string): void {
        const generation = ++this.#generation;
        this.#active = null;
        const unloadError = this.#detachPublished(false, true);
        if (unloadError !== undefined) throw unloadError;
        if (this.#generation !== generation) return;
        beginLoaderInfo(this.#contentLoaderInfo, logicalURL, "", 0);
        dispatchLoaderInfoSecurityError(this.#contentLoaderInfo, text);
    }

    #reportProgress(transaction: LoadTransaction, ratio: number): void {
        if (!this.#isCurrent(transaction)) return;
        if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
            this.#failSecurity(transaction, "Native hierarchy loader reported invalid progress");
            return;
        }
        const bytes = Math.min(transaction.source.bytesTotal,
            Math.floor(transaction.source.bytesTotal * ratio));
        if (bytes <= transaction.bytesLoaded) return;
        transaction.bytesLoaded = bytes;
        try {
            progressLoaderInfo(this.#contentLoaderInfo, bytes);
        } catch (error) {
            this.#abortForListener(transaction, error);
            throw error;
        }
        if (!this.#isCurrent(transaction)) return;
    }

    #acceptPrefab(transaction: LoadTransaction, value: unknown): void {
        if (!this.#isCurrent(transaction)) return;
        if (value === null) {
            this.#failIO(transaction, "Native Laya hierarchy load returned no content");
            return;
        }
        if (!(value instanceof Prefab)) {
            this.#failSecurity(transaction, "Native hierarchy loader returned a non-Prefab resource");
            return;
        }

        if (transaction.bytesLoaded < transaction.source.bytesTotal) {
            this.#reportProgress(transaction, 1);
            if (!this.#isCurrent(transaction)) return;
        }

        const errors: unknown[] = [];
        let candidate: LayaNode;
        try {
            candidate = value.create({}, errors);
        } catch {
            this.#failIO(transaction, "Native hierarchy instantiation failed");
            return;
        }
        if (!this.#isCurrent(transaction)) {
            this.#destroyUnpublished(candidate, transaction);
            return;
        }
        if (errors.length !== 0) {
            this.#destroyUnpublished(candidate, transaction);
            this.#failSecurity(transaction, "Native hierarchy instantiation reported validation errors");
            return;
        }
        if (!isFlashDisplayObject(candidate)) {
            this.#destroyUnpublished(candidate, transaction);
            this.#failSecurity(transaction, "Native hierarchy root is not a canonical Flash DisplayObject");
            return;
        }
        if (candidate === this) {
            this.#failSecurity(transaction, "Native hierarchy root cannot be its Loader");
            return;
        }
        if (candidate.destroyed) {
            this.#failSecurity(transaction, "Native hierarchy root is already destroyed");
            return;
        }
        if (candidate.parent != null) {
            this.#failSecurity(transaction, "Native hierarchy root is already parented");
            return;
        }
        if (candidate.contains(this)) {
            this.#failSecurity(transaction, "Native hierarchy root cannot contain its Loader");
            return;
        }
        if (CONTENT_OWNERS.has(candidate)) {
            this.#failSecurity(transaction, "Native hierarchy root is already owned by another Loader");
            return;
        }

        let candidateNodeTransaction: NodeMutationTransaction;
        try {
            candidateNodeTransaction = beginNodeMutationTransaction([candidate],
                operation => this.#rejectOwnedContentMutation(candidate as DisplayObject, operation),
                CONTENT_NODE_GUARDED_OPERATIONS);
        } catch {
            if (this.#isCurrent(transaction))
                this.#failSecurity(transaction, "Native hierarchy root has conflicting mutation authority");
            return;
        }
        CONTENT_NODE_TRANSACTIONS.set(candidate, candidateNodeTransaction);

        CONTENT_OWNERS.set(candidate, this);
        this.#content = candidate;
        publishLoaderInfo(this.#contentLoaderInfo, candidate);
        let attachError: unknown;
        try {
            this.#withInternalMutation(candidate,
                [{ node: this, operation: "addChildAt" }],
                [
                    { node: candidate, operation: "setParentDerived" },
                    { node: candidate, operation: "setParent" },
                ],
                () => addCanonicalLoaderChild.call(this, candidate, 0));
        } catch (error) {
            attachError = error;
        }
        if (attachError !== undefined || !this.#isCurrent(transaction)
            || !hasNativeParent(candidate, this) || this.numChildren !== 1 || this.#content !== candidate) {
            if (this.#content === candidate || CONTENT_OWNERS.get(candidate) === this)
                this.#abortPublished(transaction, candidate, attachError);
            return;
        }

        try {
            dispatchLoaderInfoEvent(this.#contentLoaderInfo, Event.INIT);
        } catch (error) {
            this.#abortPublished(transaction, candidate, error);
            throw error;
        }
        if (!this.#isCurrent(transaction) || !hasNativeParent(candidate, this) || this.#content !== candidate) {
            if (this.#content === candidate || CONTENT_OWNERS.get(candidate) === this)
                this.#abortPublished(transaction, candidate);
            return;
        }

        transaction.terminal = true;
        this.#active = null;
        try {
            dispatchLoaderInfoEvent(this.#contentLoaderInfo, Event.COMPLETE);
        } catch (error) {
            transaction.firstError = error;
            throw error;
        }
    }

    #failIO(transaction: LoadTransaction, text: string): void {
        this.#fail(transaction, false, text);
    }

    #failSecurity(transaction: LoadTransaction, text: string): void {
        this.#fail(transaction, true, text);
    }

    #fail(transaction: LoadTransaction, security: boolean, text: string): void {
        if (!this.#isCurrent(transaction)) return;
        transaction.terminal = true;
        this.#active = null;
        try {
            if (security) dispatchLoaderInfoSecurityError(this.#contentLoaderInfo, text);
            else dispatchLoaderInfoIOError(this.#contentLoaderInfo, text);
        } catch (error) {
            transaction.firstError = error;
            throw error;
        }
    }

    #abortForListener(transaction: LoadTransaction, error: unknown): void {
        if (transaction.firstError === undefined) transaction.firstError = error;
        transaction.terminal = true;
        if (this.#active === transaction && this.#generation === transaction.generation) {
            this.#active = null;
            this.#generation++;
        }
    }

    #abortPublished(transaction: LoadTransaction, candidate: DisplayObject, primary?: unknown): void {
        if (primary !== undefined && transaction.firstError === undefined) transaction.firstError = primary;
        transaction.terminal = true;
        if (this.#active === transaction && this.#generation === transaction.generation) {
            this.#active = null;
            this.#generation++;
        }
        const stillOwned = this.#content === candidate || CONTENT_OWNERS.get(candidate) === this;
        if (!stillOwned) return;
        if (this.#content === candidate) this.#content = null;
        clearLoaderInfo(this.#contentLoaderInfo);
        let first = transaction.firstError;
        if (hasNativeParent(candidate, this)) {
            try { this.#removeOwnedContent(candidate); }
            catch (error) { if (first === undefined) first = error; }
        }
        if (!hasNativeParent(candidate, this) && !candidate.destroyed) {
            try { this.#destroyOwnedContent(candidate); }
            catch (error) { if (first === undefined) first = error; }
        }
        if (!hasNativeParent(candidate, this) && !this.children.includes(candidate)) this.#releaseOwnedContent(candidate);
        transaction.firstError = first;
    }

    #destroyUnpublished(candidate: unknown, transaction: LoadTransaction): void {
        if (!(candidate instanceof LayaNode) || candidate === this || candidate.destroyed || candidate.parent != null)
            return;
        try { candidate.destroy(true); }
        catch (error) { if (transaction.firstError === undefined) transaction.firstError = error; }
    }

    #detachPublished(destroy: boolean, dispatchUnload: boolean): unknown | undefined {
        const content = this.#content;
        if (content === null) return undefined;
        this.#content = null;
        clearLoaderInfo(this.#contentLoaderInfo);

        let first: unknown | undefined;
        if (hasNativeParent(content, this)) {
            try { this.#removeOwnedContent(content); }
            catch (error) { first = error; }
        }
        if (destroy && !hasNativeParent(content, this) && !content.destroyed) {
            try { this.#destroyOwnedContent(content); }
            catch (error) { if (first === undefined) first = error; }
        }
        if (!hasNativeParent(content, this) && !this.children.includes(content)) this.#releaseOwnedContent(content);
        if (dispatchUnload) {
            try { dispatchLoaderInfoEvent(this.#contentLoaderInfo, Event.UNLOAD); }
            catch (error) { if (first === undefined) first = error; }
        }
        return first;
    }

    #isCurrent(transaction: LoadTransaction): boolean {
        return !this.destroyed && !transaction.terminal && this.#active === transaction
            && this.#generation === transaction.generation;
    }

    #withInternalMutation<T>(content: DisplayObject,
        loaderSteps: readonly NodeMutationPermit[], contentSteps: readonly NodeMutationPermit[], action: () => T): T {
        if (this.#internalChildMutation)
            throw new Error("Loader child ownership mutation is not reentrant");
        const contentTransaction = CONTENT_NODE_TRANSACTIONS.get(content);
        if (!contentTransaction) throw new Error("Loader content mutation authority is unavailable");
        this.#internalChildMutation = true;
        try {
            return runPermittedNodeMutation(this.#nodeTransaction, loaderSteps,
                () => runPermittedNodeMutation(contentTransaction, contentSteps, action));
        }
        finally { this.#internalChildMutation = false; }
    }

    #removeOwnedContent(content: DisplayObject): void {
        this.#withInternalMutation(content,
            [{ node: this, operation: "removeChild" }],
            [
                { node: content, operation: "setParentDerived" },
                { node: content, operation: "setParent" },
            ],
            () => { removeCanonicalLoaderChild.call(this, content); });
    }

    #destroyOwnedContent(content: DisplayObject): void {
        const transaction = CONTENT_NODE_TRANSACTIONS.get(content);
        if (!transaction) throw new Error("Loader content destroy authority is unavailable");
        runPermittedNodeMutation(transaction, [
            { node: content, operation: "destroyFlashDisplayObject" },
            { node: content, operation: "destroyDerived" },
            { node: content, operation: "destroy" },
        ], () => content.destroy(true));
    }

    #releaseOwnedContent(content: DisplayObject): void {
        if (hasNativeParent(content, this) || this.children.includes(content))
            throw new Error("Loader content mutation authority cannot be released while attached");
        const transaction = CONTENT_NODE_TRANSACTIONS.get(content);
        if (!transaction) return;
        endNodeMutationTransaction(transaction);
        if (CONTENT_NODE_TRANSACTIONS.get(content) !== transaction)
            throw new Error("Loader content mutation authority changed during release");
        CONTENT_NODE_TRANSACTIONS.delete(content);
        if (CONTENT_OWNERS.get(content) === this) CONTENT_OWNERS.delete(content);
    }

    #rejectNodeMutation(operation: NodeMutationOperation): never {
        throw new UnsupportedFlashFeatureError(
            "flash.display.Loader node mutation",
            `Loader lifecycle mutation '${operation}' requires module-private authority`
        );
    }

    #rejectOwnedContentMutation(_content: DisplayObject, operation: NodeMutationOperation): never {
        throw new UnsupportedFlashFeatureError(
            "flash.display.Loader content mutation",
            `Loaded content mutation '${operation}' requires its owning Loader`
        );
    }

    #rejectChildMutation(): never {
        throw new UnsupportedFlashFeatureError(
            "flash.display.Loader child mutation",
            "Loader owns exactly one authenticated native content root"
        );
    }
}
