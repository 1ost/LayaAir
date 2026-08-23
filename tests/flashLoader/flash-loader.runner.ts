import assert from "node:assert/strict";
import test from "node:test";

import { ILaya } from "../../src/layaAir/ILaya";
import { Node as LayaNode } from "../../src/layaAir/laya/display/Node";
import { Sprite as LayaSprite } from "../../src/layaAir/laya/display/Sprite";
import {
    beginNodeMutationTransaction, endNodeMutationTransaction, runPermittedNodeMutation,
} from "../../src/layaAir/laya/display/NodeMutationTransaction";
import { Loader as LayaLoader } from "../../src/layaAir/laya/net/Loader";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { Prefab } from "../../src/layaAir/laya/resource/HierarchyResource";
import "../../src/layaAir/laya/ModuleDef";
import { Event } from "../../src/layaAir/flash/events/Event";
import { EventDispatcher } from "../../src/layaAir/flash/events/EventDispatcher";
import { IOErrorEvent } from "../../src/layaAir/flash/events/IOErrorEvent";
import { ProgressEvent } from "../../src/layaAir/flash/events/ProgressEvent";
import { SecurityErrorEvent } from "../../src/layaAir/flash/events/SecurityErrorEvent";
import {
    Loader, LoaderInfo, isFlashLoader, isFlashLoaderInfo,
    NativeLoaderContentHost,
    NativeLoaderContentSource,
    NativeLoaderImageHost,
} from "../../src/layaAir/flash/display/Loader";
import * as LoaderModule from "../../src/layaAir/flash/display/Loader";
import { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject";
import { Bitmap } from "../../src/layaAir/flash/display/Bitmap";
import { BitmapData } from "../../src/layaAir/flash/display/BitmapData";
import { Sprite } from "../../src/layaAir/flash/display/Sprite";
import { SimpleButton } from "../../src/layaAir/flash/display/SimpleButton";
import { StaticText } from "../../src/layaAir/flash/text/StaticText";
import { TextField } from "../../src/layaAir/flash/text/TextField";
import { URLRequest } from "../../src/layaAir/flash/net/URLRequest";
import { ApplicationDomain } from "../../src/layaAir/flash/system/ApplicationDomain";
import { LoaderContext } from "../../src/layaAir/flash/system/LoaderContext";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;

type CompletionHandler = (value: unknown) => void;

class ManualCompletion {
    private accepted?: CompletionHandler;
    private rejected?: CompletionHandler;

    then(accepted: CompletionHandler, rejected: CompletionHandler): { catch(handler: CompletionHandler): void } {
        this.accepted = accepted;
        this.rejected = rejected;
        return { catch: () => undefined };
    }

    resolve(value: unknown): void { this.accepted?.(value); }
    reject(error: unknown): void { this.rejected?.(error); }
}

interface NativeCall {
    readonly url: string;
    readonly options: Readonly<{ type?: string; silent?: boolean }>;
    readonly progress: (ratio: number) => void;
    readonly completion: ManualCompletion;
}

class ControlledLoader {
    readonly calls: NativeCall[] = [];

    load(url: string, options: Readonly<{ type?: string; silent?: boolean }>, progress: (ratio: number) => void): Promise<unknown> {
        const completion = new ManualCompletion();
        this.calls.push({ url, options, progress, completion });
        return completion as unknown as Promise<unknown>;
    }
}

class Host extends NativeLoaderContentHost {
    readonly sources = new Map<string, NativeLoaderContentSource | null>();
    resolveCalls = 0;
    reenter?: () => void;

    constructor() { super(); }

    source(logicalURL: string, hierarchyURL = "native/content.lh", bytesTotal = 100): NativeLoaderContentSource {
        return this.hierarchy(logicalURL, hierarchyURL, bytesTotal);
    }

    override resolve(logicalURL: string): NativeLoaderContentSource | null {
        this.resolveCalls++;
        this.reenter?.();
        return this.sources.get(logicalURL) ?? null;
    }
}

interface ImageCall {
    readonly bytes: Uint8Array;
    readonly contentType: string;
    readonly completion: ManualCompletion;
}

class ImageHost extends NativeLoaderImageHost {
    readonly calls: ImageCall[] = [];

    constructor() { super(); }

    override decode(bytes: Uint8Array, contentType: string): Promise<BitmapData> {
        const completion = new ManualCompletion();
        this.calls.push({ bytes, contentType, completion });
        return completion as unknown as Promise<BitmapData>;
    }
}

class TestPrefab extends Prefab {
    createCalls = 0;
    constructor(private readonly factory: () => LayaNode, private readonly creationErrors: unknown[] = []) { super(); }
    override create(_options?: Record<string, unknown>, errors?: unknown[]): LayaNode {
        this.createCalls++;
        errors?.push(...this.creationErrors);
        return this.factory();
    }
}

function fixture(logicalURL = "ui/loading.swf") {
    const native = new ControlledLoader();
    (ILaya as unknown as { loader: ControlledLoader }).loader = native;
    const host = new Host();
    host.sources.set(logicalURL, host.source(logicalURL));
    const loader = new Loader(host);
    const request = new URLRequest(logicalURL);
    return { host, loader, native, request };
}

function events(loader: Loader): string[] {
    const values: string[] = [];
    for (const type of [Event.OPEN, ProgressEvent.PROGRESS, Event.INIT, Event.COMPLETE,
        IOErrorEvent.IO_ERROR, SecurityErrorEvent.SECURITY_ERROR, Event.UNLOAD]) {
        loader.contentLoaderInfo.addEventListener(type, event => {
            assert.equal(event.target, loader.contentLoaderInfo);
            assert.equal(event.currentTarget, loader.contentLoaderInfo);
            values.push(type === ProgressEvent.PROGRESS
                ? `${type}:${(event as ProgressEvent).bytesLoaded}` : type);
        }, false, 1000);
    }
    return values;
}

test("Loader publishes authenticated native content through stable LoaderInfo", () => {
    const { loader, native, request } = fixture();
    const info = loader.contentLoaderInfo;
    const sequence = events(loader);
    let candidate: Sprite;
    info.addEventListener(Event.INIT, () => {
        candidate = loader.content as Sprite;
        assert.equal(info.content, candidate);
        assert.equal(candidate.parent, loader);
        assert.equal(loader.numChildren, 1);
        assert.deepEqual([info.bytesLoaded, info.bytesTotal], [100, 100]);
    }, false, 100);

    loader.load(request);
    assert.equal(loader.contentLoaderInfo, info);
    assert(isFlashLoader(loader));
    assert(isFlashLoaderInfo(info));
    assert.deepEqual(sequence, [Event.OPEN]);
    assert.equal(native.calls.length, 1);
    assert.equal(native.calls[0].url, "native/content.lh");
    assert.deepEqual(native.calls[0].options, { type: LayaLoader.HIERARCHY, silent: true });
    native.calls[0].progress(0.25);
    native.calls[0].progress(0.25);
    native.calls[0].progress(0.20);
    native.calls[0].progress(0.80);
    const prefab = new TestPrefab(() => candidate = new Sprite());
    native.calls[0].completion.resolve(prefab);

    assert.deepEqual(sequence, [Event.OPEN, "progress:25", "progress:80", "progress:100", Event.INIT, Event.COMPLETE]);
    assert.equal(loader.content, candidate!);
    assert.equal(candidate!.loaderInfo, info,
        "published Loader content exposes the exact owning LoaderInfo");
    assert.equal(info.url, "ui/loading.swf");
    assert.equal(info.contentType, "application/x-laya-hierarchy");
    assert.equal(prefab.createCalls, 1);
});

test("LoaderContext admits native domains while rejecting executable and security domains", () => {
    const admitted = fixture("context.logical");
    const context = new LoaderContext(false, ApplicationDomain.currentDomain);
    admitted.loader.load(admitted.request, context);
    assert.equal(admitted.host.resolveCalls, 1);
    assert.equal(admitted.native.calls.length, 1);

    const forged = fixture("forged-context.logical");
    assert.throws(
        () => forged.loader.load(forged.request, {} as LoaderContext),
        /canonical LoaderContext/,
    );
    assert.equal(forged.host.resolveCalls, 0);

    const executable = fixture("executable-context.logical");
    const executableContext = new LoaderContext();
    executableContext.allowCodeImport = true;
    assert.throws(
        () => executable.loader.load(executable.request, executableContext),
        /runtime executable code import is forbidden/,
    );
    assert.equal(executable.host.resolveCalls, 0);

    const security = fixture("security-context.logical");
    const securityContext = new LoaderContext(false, null, {});
    assert.throws(
        () => security.loader.load(security.request, securityContext),
        /does not admit Flash security domains/,
    );
    assert.equal(security.host.resolveCalls, 0);
});

test("authentication and native failures are typed and side effects are ordered", () => {
    const denied = fixture("missing.logical");
    denied.host.sources.set("missing.logical", null);
    const deniedEvents = events(denied.loader);
    denied.loader.load(denied.request);
    assert.deepEqual(deniedEvents, [SecurityErrorEvent.SECURITY_ERROR]);
    assert.equal(denied.native.calls.length, 0);

    const forged = fixture("forged.logical");
    forged.host.sources.set("forged.logical", {} as NativeLoaderContentSource);
    const forgedEvents = events(forged.loader);
    forged.loader.load(forged.request);
    assert.deepEqual(forgedEvents, [SecurityErrorEvent.SECURITY_ERROR]);
    assert.equal(forged.native.calls.length, 0);

    const nullResult = fixture("null.logical");
    const nullEvents = events(nullResult.loader);
    nullResult.loader.load(nullResult.request);
    nullResult.native.calls[0].completion.resolve(null);
    assert.deepEqual(nullEvents, [Event.OPEN, IOErrorEvent.IO_ERROR]);

    const rejected = fixture("reject.logical");
    const rejectEvents = events(rejected.loader);
    rejected.loader.load(rejected.request);
    rejected.native.calls[0].completion.reject(new Error("network detail must not escape"));
    assert.deepEqual(rejectEvents, [Event.OPEN, IOErrorEvent.IO_ERROR]);

    const malformed = fixture("malformed.logical");
    const malformedEvents = events(malformed.loader);
    malformed.loader.load(malformed.request);
    malformed.native.calls[0].completion.resolve({ create: () => new Sprite() });
    assert.deepEqual(malformedEvents, [Event.OPEN, SecurityErrorEvent.SECURITY_ERROR]);
});

test("LoaderInfo, host and source authority cannot be publicly minted, inspected or mutated", () => {
    const { host, loader } = fixture("authority.logical");
    const info = loader.contentLoaderInfo;
    const source = host.source("sealed.logical", "native/sealed.lh", 7);

    assert.throws(() => new (LoaderInfo as any)(Symbol("forged"), loader), /canonical Loader/);
    assert.equal("_create" in LoaderInfo, false);
    for (const name of ["_begin", "_progress", "_publish", "_clear", "_dispatchOpen",
        "_dispatchInit", "_dispatchComplete", "_dispatchUnload", "_dispatchIOError",
        "_dispatchSecurityError"]) {
        assert.equal(name in info, false, `${name} must not be a public mutation surface`);
    }
    assert.throws(() => Object.defineProperty(info, "bytesLoaded", { value: 9001 }), TypeError);
    assert.equal(info.bytesLoaded, 0);
    assert.equal("getDefaultNativeLoaderContentHost" in LoaderModule, false);
    assert.equal("readNativeLoaderContentSource" in LoaderModule, false);

    for (const name of ["_begin", "_publishSourceFailure", "_reportProgress", "_acceptPrefab",
        "_fail", "_abortForListener", "_abortPublished", "_destroyUnpublished",
        "_detachPublished", "_isCurrent", "_withInternalMutation", "_rejectChildMutation"]) {
        assert.equal(name in loader, false, `${name} must not be a runtime-public Loader method`);
    }
    const attacker = loader as any;
    attacker._active = { terminal: false };
    attacker._content = new Sprite();
    attacker._generation = -1;
    attacker._internalChildMutation = true;
    assert.equal(loader.content, null);
    assert.throws(() => attacker._addChild(new Sprite()), /owns exactly one/);
    assert.throws(() => Object.defineProperty(loader, "content", { value: new Sprite() }), TypeError);

    const forgedHost = Object.create(NativeLoaderContentHost.prototype);
    assert.throws(() => new Loader(forgedHost), /nominal Laya capability/);
    assert(Object.isFrozen(source));
    assert.deepEqual(Reflect.ownKeys(source), []);
    assert.throws(() => Object.defineProperty(source, "nativeHierarchyURL", { value: "native/forged.lh" }), TypeError);

    const other = new Host();
    other.sources.set("sealed.logical", source);
    const rejected = new Loader(other);
    const rejectedEvents = events(rejected);
    rejected.load(new URLRequest("sealed.logical"));
    assert.deepEqual(rejectedEvents, [SecurityErrorEvent.SECURITY_ERROR]);
});

test("LoaderInfo lifecycle dispatch is reserved and public replacement cannot suppress authentic events", () => {
    const { loader, request } = fixture("dispatch.logical");
    const info = loader.contentLoaderInfo;
    for (const type of [Event.OPEN, ProgressEvent.PROGRESS, Event.INIT, Event.COMPLETE, Event.UNLOAD,
        IOErrorEvent.IO_ERROR, SecurityErrorEvent.SECURITY_ERROR]) {
        assert.throws(() => info.dispatchEvent(new Event(type)), /published only by its owning Loader/);
    }
    assert.throws(() => EventDispatcher.prototype.addEventListener.call(
        info, Event.OPEN, () => { throw new Error("forged base listener"); }
    ));
    assert.throws(() => EventDispatcher.prototype.dispatchEvent.call(info, new Event(Event.OPEN)));
    assert.equal((info as any)._flashEvents, null);
    assert.throws(() => { (info as any)._flashEvents = {}; }, TypeError);
    let opens = 0;
    info.addEventListener(Event.OPEN, () => opens++);
    (info as any).dispatchEvent = () => false;
    loader.load(request);
    assert.equal(opens, 1);
});

test("request and hierarchy authority reject unsupported transport before native load", () => {
    const { host, loader, native } = fixture("safe.logical");
    const post = new URLRequest("safe.logical");
    post.method = "POST";
    assert.throws(() => loader.load(post), /only GET requests/);
    assert.equal(native.calls.length, 0);

    assert.throws(() => host.source("bad.logical", "payload.swf"), /only \.lh/);
    assert.throws(() => host.source("bad.logical", "data:text/plain,x.lh"), /forbidden scheme/);
    assert.throws(() => loader.loadBytes(new Uint8Array([0x46, 0x57, 0x53])), /forbidden/);
});

test("loadBytes admits image signatures and publishes canonical BitmapData without executable decoding", () => {
    const imageHost = new ImageHost();
    const loader = new Loader(null, imageHost);
    const sequence = events(loader);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    loader.loadBytes(bytes);

    assert.deepEqual(sequence, [Event.OPEN]);
    assert.equal(imageHost.calls.length, 1);
    assert.equal(imageHost.calls[0].contentType, "image/jpeg");
    assert.deepEqual(imageHost.calls[0].bytes, bytes);
    bytes.fill(0);
    assert.equal(imageHost.calls[0].bytes[0], 0xff, "Loader snapshots caller-owned bytes");

    const bitmapData = new BitmapData(2, 1, true, 0);
    bitmapData.setPixel32(0, 0, 0xff123456);
    bitmapData.setPixel32(1, 0, 0x80102030);
    imageHost.calls[0].completion.resolve(bitmapData);

    assert.deepEqual(sequence, [Event.OPEN, "progress:6", Event.INIT, Event.COMPLETE]);
    assert(loader.content instanceof Bitmap);
    assert.equal(loader.content.bitmapData, bitmapData);
    assert.deepEqual([loader.contentLoaderInfo.bytesLoaded, loader.contentLoaderInfo.bytesTotal], [6, 6]);
    assert.equal(loader.contentLoaderInfo.contentType, "image/jpeg");
    assert.deepEqual([loader.contentLoaderInfo.width, loader.contentLoaderInfo.height], [2, 1]);
});

test("default loadBytes host rasterizes admitted browser image bytes into CPU-backed pixels", async () => {
    const createImageBitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    const offscreenCanvasDescriptor = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
    let closed = false;
    class TestCanvas {
        constructor(readonly width: number, readonly height: number) {}
        getContext(): NativeTestCanvasContext {
            return {
                drawImage: () => undefined,
                getImageData: () => ({
                    data: new Uint8ClampedArray([0x12, 0x34, 0x56, 0x80]),
                }),
            };
        }
    }
    interface NativeTestCanvasContext {
        drawImage(): void;
        getImageData(): { data: Uint8ClampedArray };
    }
    try {
        Object.defineProperty(globalThis, "createImageBitmap", {
            configurable: true,
            value: async () => ({ width: 1, height: 1, close: () => { closed = true; } }),
        });
        Object.defineProperty(globalThis, "OffscreenCanvas", {
            configurable: true,
            value: TestCanvas,
        });
        const loader = new Loader();
        const sequence = events(loader);
        loader.loadBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        assert.deepEqual(sequence, [Event.OPEN, "progress:8", Event.INIT, Event.COMPLETE]);
        assert(loader.content instanceof Bitmap);
        assert.equal(loader.contentLoaderInfo.contentType, "image/png");
        assert.equal(loader.content.bitmapData!.getPixel32(0, 0), 0x80123456);
        assert.equal(closed, true);
    } finally {
        if (createImageBitmapDescriptor) Object.defineProperty(globalThis, "createImageBitmap", createImageBitmapDescriptor);
        else delete (globalThis as any).createImageBitmap;
        if (offscreenCanvasDescriptor) Object.defineProperty(globalThis, "OffscreenCanvas", offscreenCanvasDescriptor);
        else delete (globalThis as any).OffscreenCanvas;
    }
});

test("image progress cancellation disposes transferred unpublished BitmapData", () => {
    const imageHost = new ImageHost();
    const loader = new Loader(null, imageHost);
    const sequence = events(loader);
    loader.contentLoaderInfo.addEventListener(ProgressEvent.PROGRESS, () => loader.close(), false, 100);
    loader.loadBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
    const bitmapData = new BitmapData(1, 1, true, 0xffabcdef);
    imageHost.calls[0].completion.resolve(bitmapData);

    assert.deepEqual(sequence, [Event.OPEN, "progress:6"]);
    assert.equal(loader.content, null);
    assert.throws(() => bitmapData.width, /disposed/);
});

test("close, unload, replacement and stale completions are generation fenced", () => {
    const closed = fixture("close.logical");
    const closeEvents = events(closed.loader);
    closed.loader.load(closed.request);
    const closedPrefab = new TestPrefab(() => new Sprite());
    closed.loader.close();
    closed.native.calls[0].progress(1);
    closed.native.calls[0].completion.resolve(closedPrefab);
    assert.deepEqual(closeEvents, [Event.OPEN]);
    assert.equal(closedPrefab.createCalls, 0);

    const current = fixture("a.logical");
    current.host.sources.set("b.logical", current.host.source("b.logical", "native/b.lh", 10));
    const replaceEvents = events(current.loader);
    current.loader.load(current.request);
    current.loader.load(new URLRequest("b.logical"));
    const stalePrefab = new TestPrefab(() => new Sprite());
    current.native.calls[0].completion.resolve(stalePrefab);
    let winner: Sprite;
    current.native.calls[1].completion.resolve(new TestPrefab(() => winner = new Sprite()));
    assert.equal(stalePrefab.createCalls, 0);
    assert.equal(current.loader.content, winner!);
    assert.deepEqual(replaceEvents, [Event.OPEN, Event.OPEN, "progress:10", Event.INIT, Event.COMPLETE]);

    current.loader.unload();
    assert.equal(winner!.destroyed, false);
    assert.equal(winner!.parent, null);
    assert.equal(current.loader.content, null);
    assert.equal(replaceEvents.at(-1), Event.UNLOAD);

    current.loader.load(new URLRequest("b.logical"));
    let stopped: Sprite;
    current.native.calls[2].completion.resolve(new TestPrefab(() => stopped = new Sprite()));
    current.loader.unloadAndStop();
    assert.equal(stopped!.destroyed, true);
});

test("event reentrancy is latest-wins and listener errors do not become typed failures", () => {
    const openCancel = fixture("open-cancel.logical");
    const openEvents = events(openCancel.loader);
    openCancel.loader.contentLoaderInfo.addEventListener(Event.OPEN, () => openCancel.loader.unload(), false, 100);
    openCancel.loader.load(openCancel.request);
    assert.deepEqual(openEvents, [Event.OPEN]);
    assert.equal(openCancel.native.calls.length, 0);

    const initUnload = fixture("init-unload.logical");
    const initEvents = events(initUnload.loader);
    let detached: Sprite;
    initUnload.loader.contentLoaderInfo.addEventListener(Event.INIT, () => initUnload.loader.unload(), false, 100);
    initUnload.loader.load(initUnload.request);
    initUnload.native.calls[0].completion.resolve(new TestPrefab(() => detached = new Sprite()));
    assert.deepEqual(initEvents, [Event.OPEN, "progress:100", Event.INIT, Event.UNLOAD]);
    assert.equal(detached!.destroyed, false);
    assert.equal(initUnload.loader.content, null);

    const openThrow = fixture("open-throw.logical");
    const primary = new Error("listener primary");
    openThrow.loader.contentLoaderInfo.addEventListener(Event.OPEN, () => { throw primary; });
    assert.throws(() => openThrow.loader.load(openThrow.request), error => error === primary);
    assert.equal(openThrow.native.calls.length, 0);

    const initThrow = fixture("init-throw.logical");
    const initSequence = events(initThrow.loader);
    let rejectedRoot: Sprite;
    initThrow.loader.contentLoaderInfo.addEventListener(Event.INIT, () => { throw primary; }, false, 100);
    initThrow.loader.load(initThrow.request);
    assert.throws(
        () => initThrow.native.calls[0].completion.resolve(new TestPrefab(() => rejectedRoot = new Sprite())),
        error => error === primary
    );
    assert.equal(rejectedRoot!.destroyed, true);
    assert.equal(initThrow.loader.content, null);
    assert(!initSequence.includes(IOErrorEvent.IO_ERROR));
    assert(!initSequence.includes(SecurityErrorEvent.SECURITY_ERROR));

    const completeThrow = fixture("complete-throw.logical");
    let readyRoot: Sprite;
    completeThrow.loader.contentLoaderInfo.addEventListener(Event.COMPLETE, () => { throw primary; }, false, 100);
    completeThrow.loader.load(completeThrow.request);
    assert.throws(
        () => completeThrow.native.calls[0].completion.resolve(new TestPrefab(() => readyRoot = new Sprite())),
        error => error === primary
    );
    assert.equal(completeThrow.loader.content, readyRoot!);
    assert.equal(readyRoot!.destroyed, false);
});

test("older OPEN, PROGRESS and INIT errors cannot invalidate a reentrant newer load", () => {
    const open = fixture("open-outer.logical");
    open.host.sources.set("open-inner.logical", open.host.source("open-inner.logical", "native/open-inner.lh", 3));
    const openPrimary = new Error("open reentry primary");
    let openReentered = false;
    open.loader.contentLoaderInfo.addEventListener(Event.OPEN, () => {
        if (openReentered) return;
        openReentered = true;
        open.loader.load(new URLRequest("open-inner.logical"));
        throw openPrimary;
    }, false, 100);
    assert.throws(() => open.loader.load(open.request), error => error === openPrimary);
    assert.equal(open.native.calls.length, 1);
    assert.equal(open.native.calls[0].url, "native/open-inner.lh");
    open.native.calls[0].completion.resolve(new TestPrefab(() => new Sprite()));
    assert.equal(open.loader.contentLoaderInfo.url, "open-inner.logical");
    assert(open.loader.content);

    const progress = fixture("progress-outer.logical");
    progress.host.sources.set("progress-inner.logical",
        progress.host.source("progress-inner.logical", "native/progress-inner.lh", 4));
    const progressPrimary = new Error("progress reentry primary");
    let progressReentered = false;
    progress.loader.contentLoaderInfo.addEventListener(ProgressEvent.PROGRESS, () => {
        if (progressReentered) return;
        progressReentered = true;
        progress.loader.load(new URLRequest("progress-inner.logical"));
        throw progressPrimary;
    }, false, 100);
    progress.loader.load(progress.request);
    assert.throws(() => progress.native.calls[0].progress(0.5), error => error === progressPrimary);
    assert.equal(progress.native.calls.length, 2);
    assert.equal(progress.native.calls[1].url, "native/progress-inner.lh");
    progress.native.calls[0].completion.resolve(new TestPrefab(() => new Sprite()));
    progress.native.calls[1].completion.resolve(new TestPrefab(() => new Sprite()));
    assert.equal(progress.loader.contentLoaderInfo.url, "progress-inner.logical");
    assert(progress.loader.content);

    const init = fixture("init-outer.logical");
    init.host.sources.set("init-inner.logical", init.host.source("init-inner.logical", "native/init-inner.lh", 6));
    const initPrimary = new Error("init reentry primary");
    let initReentered = false;
    init.loader.contentLoaderInfo.addEventListener(Event.INIT, () => {
        if (initReentered) return;
        initReentered = true;
        init.loader.load(new URLRequest("init-inner.logical"));
        throw initPrimary;
    }, false, 100);
    init.loader.load(init.request);
    let oldRoot: Sprite;
    assert.throws(
        () => init.native.calls[0].completion.resolve(new TestPrefab(() => oldRoot = new Sprite())),
        error => error === initPrimary
    );
    assert.equal(oldRoot!.destroyed, false);
    assert.equal(oldRoot!.parent, null);
    assert.equal(init.native.calls.length, 2);
    assert.equal(init.native.calls[1].url, "native/init-inner.lh");
    init.native.calls[1].completion.resolve(new TestPrefab(() => new Sprite()));
    assert.equal(init.loader.contentLoaderInfo.url, "init-inner.logical");
    assert(init.loader.content);
});

test("host resolution and teardown callbacks cannot revive stale outer generations", () => {
    const { host, loader, native, request } = fixture("outer.logical");
    host.sources.set("inner.logical", host.source("inner.logical", "native/inner.lh", 5));
    let reentered = false;
    host.reenter = () => {
        if (reentered) return;
        reentered = true;
        loader.load(new URLRequest("inner.logical"));
    };
    loader.load(request);
    assert.equal(native.calls.length, 1);
    assert.equal(native.calls[0].url, "native/inner.lh");
});

test("reentrant teardown preserves the exact listener error while fencing stale work", () => {
    const reentrantLoad = fixture("published.logical");
    reentrantLoad.host.sources.set("next.logical",
        reentrantLoad.host.source("next.logical", "native/next.lh", 5));
    reentrantLoad.loader.load(reentrantLoad.request);
    reentrantLoad.native.calls[0].completion.resolve(new TestPrefab(() => new Sprite()));
    const loadPrimary = new Error("reentrant load primary");
    reentrantLoad.loader.contentLoaderInfo.addEventListener(Event.UNLOAD, () => {
        reentrantLoad.loader.load(new URLRequest("next.logical"));
        throw loadPrimary;
    }, false, 100);
    assert.throws(() => reentrantLoad.loader.unload(), error => error === loadPrimary);
    assert.equal(reentrantLoad.native.calls.length, 2);
    assert.equal(reentrantLoad.native.calls[1].url, "native/next.lh");
    reentrantLoad.native.calls[1].completion.resolve(new TestPrefab(() => new Sprite()));
    assert.equal(reentrantLoad.loader.contentLoaderInfo.url, "next.logical");

    const reentrantUnload = fixture("old.logical");
    reentrantUnload.host.sources.set("replacement.logical",
        reentrantUnload.host.source("replacement.logical", "native/replacement.lh", 9));
    reentrantUnload.loader.load(reentrantUnload.request);
    reentrantUnload.native.calls[0].completion.resolve(new TestPrefab(() => new Sprite()));
    const unloadPrimary = new Error("reentrant unload primary");
    reentrantUnload.loader.contentLoaderInfo.addEventListener(Event.UNLOAD, () => {
        reentrantUnload.loader.unload();
        throw unloadPrimary;
    }, false, 100);
    assert.throws(
        () => reentrantUnload.loader.load(new URLRequest("replacement.logical")),
        error => error === unloadPrimary
    );
    assert.equal(reentrantUnload.native.calls.length, 1);
    assert.equal(reentrantUnload.loader.content, null);

    const reentrantStop = fixture("stop.logical");
    reentrantStop.host.sources.set("after-stop.logical",
        reentrantStop.host.source("after-stop.logical", "native/after-stop.lh", 4));
    reentrantStop.loader.load(reentrantStop.request);
    let stoppedRoot: Sprite;
    reentrantStop.native.calls[0].completion.resolve(new TestPrefab(() => stoppedRoot = new Sprite()));
    const stopPrimary = new Error("reentrant stop primary");
    reentrantStop.loader.contentLoaderInfo.addEventListener(Event.UNLOAD, () => {
        reentrantStop.loader.load(new URLRequest("after-stop.logical"));
        throw stopPrimary;
    }, false, 100);
    assert.throws(() => reentrantStop.loader.unloadAndStop(), error => error === stopPrimary);
    assert.equal(stoppedRoot!.destroyed, true);
    assert.equal(reentrantStop.native.calls.length, 2);
    assert.equal(reentrantStop.native.calls[1].url, "native/after-stop.lh");
});

test("Loader rejects public mutation of its authenticated content slot", () => {
    const { loader, native, request } = fixture("slot.logical");
    const injected = new Sprite();
    assert.throws(() => LayaNode.prototype.addChildAt.call(loader, injected, 0), /module-private authority/);
    assert.throws(() => LayaNode.prototype._addChild.call(loader, injected, 0), /module-private authority/);
    assert.throws(() => LayaNode.prototype._setContainer.call(loader, injected), /module-private authority/);
    assert.throws(() => LayaNode.prototype.destroy.call(loader, true), /module-private authority/);
    assert.throws(() => LayaSprite.prototype.destroy.call(loader, true), /module-private authority/);
    assert.throws(() => DisplayObject.prototype.destroy.call(loader, true), /module-private authority/);
    const foreignLoader = beginNodeMutationTransaction([loader], () => { throw new Error("foreign loader guard"); });
    try {
        assert.throws(() => runPermittedNodeMutation(foreignLoader,
            [{ node: loader, operation: "addChildAt" }],
            () => LayaNode.prototype.addChildAt.call(loader, injected, 0)), /module-private authority/);
    } finally { endNodeMutationTransaction(foreignLoader); }
    assert.equal(loader.destroyed, false);
    assert.equal(loader.numChildren, 0);
    assert(injected.parent == null);
    loader.load(request);
    let root: Sprite;
    native.calls[0].completion.resolve(new TestPrefab(() => root = new Sprite()));
    const authoredChild = new Sprite();
    root!.addChild(authoredChild);
    assert.equal(authoredChild.parent, root!);
    root!.removeChild(authoredChild);
    assert(authoredChild.parent == null);
    assert.throws(() => loader.addChild(new Sprite()), /owns exactly one/);
    assert.throws(() => loader.removeChild(root!), /owns exactly one/);
    assert.throws(() => root!.removeSelf(), /owns exactly one/);
    assert.throws(() => LayaNode.prototype.removeChild.call(loader, root!), /module-private authority/);
    assert.throws(() => LayaNode.prototype._removeChild.call(loader, root!), /module-private authority/);
    assert.throws(() => (LayaNode.prototype as any)._setParent.call(root!, null), /owning Loader/);
    assert.throws(() => (LayaSprite.prototype as any)._setParent.call(root!, null), /owning Loader/);
    assert.throws(() => LayaNode.prototype._setContainer.call(root!, injected), /owning Loader/);
    assert.throws(() => LayaNode.prototype.destroy.call(root!, true), /owning Loader/);
    assert.throws(() => LayaSprite.prototype.destroy.call(root!, true), /owning Loader/);
    assert.throws(() => DisplayObject.prototype.destroy.call(root!, true), /owning Loader/);
    assert.throws(() => Bitmap.prototype.destroy.call(root!, true), /owning Loader/);
    assert.throws(() => TextField.prototype.destroy.call(root!, true), /owning Loader/);
    assert.throws(() => StaticText.prototype.destroy.call(root!, true), /owning Loader/);
    const foreign = beginNodeMutationTransaction([root!], () => { throw new Error("foreign guard"); });
    try {
        assert.throws(() => runPermittedNodeMutation(foreign,
            [{ node: root!, operation: "destroyFlashDisplayObject" }],
            () => DisplayObject.prototype.destroy.call(root!, true)), /owning Loader/);
    } finally { endNodeMutationTransaction(foreign); }
    assert.equal(root!.destroyed, false);
    assert.equal(loader.content, root!);
    assert.equal(root!.parent, loader);

    loader.destroy(true);
    assert.equal(loader.destroyed, true);
    assert.equal(root!.destroyed, true);

    const buttonFixture = fixture("button.logical");
    buttonFixture.loader.load(buttonFixture.request);
    let button: SimpleButton;
    buttonFixture.native.calls[0].completion.resolve(new TestPrefab(
        () => button = new SimpleButton(new Sprite(), new Sprite())));
    const down = new Sprite();
    button!.downState = down;
    assert.equal(button!.downState, down);
    assert.equal(button!.parent, buttonFixture.loader);

    const cyclic = fixture("cyclic.logical");
    const ancestor = new Sprite();
    ancestor.addChild(cyclic.loader);
    const cyclicEvents = events(cyclic.loader);
    cyclic.loader.load(cyclic.request);
    cyclic.native.calls[0].completion.resolve(new TestPrefab(() => ancestor));
    assert.deepEqual(cyclicEvents, [Event.OPEN, "progress:100", SecurityErrorEvent.SECURITY_ERROR]);
    assert.equal(ancestor.destroyed, false);
    assert.equal(cyclic.loader.parent, ancestor);
});
