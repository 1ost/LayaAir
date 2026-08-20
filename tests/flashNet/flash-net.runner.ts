import assert from "node:assert/strict";
import test from "node:test";

import { Event } from "../../src/layaAir/flash/events/Event";
import { HTTPStatusEvent } from "../../src/layaAir/flash/events/HTTPStatusEvent";
import { IOErrorEvent } from "../../src/layaAir/flash/events/IOErrorEvent";
import { ProgressEvent } from "../../src/layaAir/flash/events/ProgressEvent";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";
import {
    registerClassAlias, resolveAliasForClass, resolveClassAlias,
} from "../../src/layaAir/flash/net/ClassAlias";
import {
    FileReference, FlashFileDownload, FlashFileDownloadHost, installFlashFileDownloadHost,
    isFlashFileReference,
} from "../../src/layaAir/flash/net/FileReference";
import {
    FlashHTTPHost, FlashHTTPRequest, FlashHTTPResponse, installFlashHTTPHost,
} from "../../src/layaAir/flash/net/FlashHTTPTransport";
import { LocalConnection, isFlashLocalConnection } from "../../src/layaAir/flash/net/LocalConnection";
import {
    FlashSharedObjectStorageHost, installFlashSharedObjectStorageHost, isFlashSharedObject, SharedObject,
} from "../../src/layaAir/flash/net/SharedObject";
import {
    FlashSocketCallbacks, FlashSocketConnection, FlashSocketConnectOptions, FlashSocketHost,
    installFlashSocketHost, isFlashSocket, Socket,
} from "../../src/layaAir/flash/net/Socket";
import { URLLoader, isFlashURLLoader } from "../../src/layaAir/flash/net/URLLoader";
import { URLLoaderDataFormat } from "../../src/layaAir/flash/net/URLLoaderDataFormat";
import { URLRequest, snapshotFlashURLRequest } from "../../src/layaAir/flash/net/URLRequest";
import { URLVariables, isFlashURLVariables } from "../../src/layaAir/flash/net/URLVariables";
import { sendToURL } from "../../src/layaAir/flash/net/sendToURL";
import { ByteArray } from "../../src/layaAir/flash/utils/ByteArray";
import { Endian } from "../../src/layaAir/flash/utils/Endian";

interface HTTPCall {
    readonly request: FlashHTTPRequest;
    readonly signal: AbortSignal;
    readonly status: (status: number, redirected: boolean) => void;
    readonly progress: (loaded: number, total: number) => void;
    resolve(response: FlashHTTPResponse): void;
    reject(error: unknown): void;
}

class ManualHTTPHost extends FlashHTTPHost {
    readonly calls: HTTPCall[] = [];
    synchronousFailure: Error | null = null;
    constructor() { super(); }
    override request(request: FlashHTTPRequest, signal: AbortSignal,
        status: (status: number, redirected: boolean) => void,
        progress: (loaded: number, total: number) => void): Promise<FlashHTTPResponse> {
        if (this.synchronousFailure !== null) {
            const failure = this.synchronousFailure;
            this.synchronousFailure = null;
            throw failure;
        }
        let resolve!: (response: FlashHTTPResponse) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<FlashHTTPResponse>((accepted, rejected) => {
            resolve = accepted;
            reject = rejected;
        });
        this.calls.push({ request, signal, status, progress, resolve, reject });
        return promise;
    }
}

class MemoryStorageHost extends FlashSharedObjectStorageHost {
    readonly values = new Map<string, string>();
    nextReadValue: unknown = undefined;
    constructor() { super(); }
    read(key: string): string | null {
        if (this.nextReadValue !== undefined) {
            const value = this.nextReadValue;
            this.nextReadValue = undefined;
            return value as string | null;
        }
        return this.values.get(key) ?? null;
    }
    write(key: string, value: string): void { this.values.set(key, value); }
    remove(key: string): void { this.values.delete(key); }
}

class DownloadHost extends FlashFileDownloadHost {
    readonly downloads: FlashFileDownload[] = [];
    constructor() { super(); }
    save(download: FlashFileDownload): void {
        this.downloads.push({ ...download, data: typeof download.data === "string" ? download.data : download.data.slice() });
    }
}

interface SocketCall {
    readonly options: FlashSocketConnectOptions;
    readonly callbacks: FlashSocketCallbacks;
    readonly frames: ArrayBuffer[];
    closeCalls: number;
    sendFailure: Error | null;
    readonly connection: FlashSocketConnection;
}

class ManualSocketHost extends FlashSocketHost {
    readonly calls: SocketCall[] = [];
    synchronousCallback: ((callbacks: FlashSocketCallbacks) => void) | null = null;
    constructor() { super(); }
    connect(options: FlashSocketConnectOptions, callbacks: FlashSocketCallbacks): FlashSocketConnection {
        const call = { options, callbacks, frames: [] as ArrayBuffer[], closeCalls: 0, sendFailure: null } as SocketCall;
        const connection: FlashSocketConnection = {
            send: data => {
                if (call.sendFailure !== null) return Promise.reject(call.sendFailure);
                call.frames.push(data.slice(0));
                return undefined;
            },
            close: () => { call.closeCalls++; },
        };
        Object.assign(call, { connection });
        this.calls.push(call);
        this.synchronousCallback?.(callbacks);
        this.synchronousCallback = null;
        return connection;
    }
}

const httpHost = new ManualHTTPHost();
const storageHost = new MemoryStorageHost();
const downloadHost = new DownloadHost();
const socketHost = new ManualSocketHost();
installFlashHTTPHost(httpHost);
installFlashSharedObjectStorageHost(storageHost);
installFlashFileDownloadHost(downloadHost);
installFlashSocketHost(socketHost);

function response(status: number, body: Uint8Array, redirected = false): FlashHTTPResponse {
    return Object.freeze({
        url: "https://game.invalid/final",
        status,
        statusText: status >= 400 ? "Failure" : "OK",
        redirected,
        contentLength: body.byteLength,
        body: body.slice().buffer,
    });
}

async function turn(): Promise<void> {
    await new Promise<void>(resolve => queueMicrotask(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
}

test("URLVariables preserves repeated pairs, plus encoding and dynamic producer fields", () => {
    const variables = new URLVariables("a=1&a=2&space=hello+world&empty&encoded=%E9%BB%91");
    assert(isFlashURLVariables(variables));
    assert.deepEqual(variables.a, ["1", "2"]);
    assert.equal(variables.space, "hello world");
    assert.equal(variables.empty, "");
    assert.equal(variables.encoded, "\u9ed1");
    variables.log = "line one";
    assert.equal(variables.toString(), "a=1&a=2&space=hello+world&empty=&encoded=%E9%BB%91&log=line+one");
    assert.throws(() => new URLVariables("bad=%ZZ"), URIError);

    const hostile = new URLVariables("__proto__=owned&constructor=safe");
    assert.equal(Object.getPrototypeOf(hostile), URLVariables.prototype);
    assert.equal(Object.prototype.hasOwnProperty.call(hostile, "__proto__"), true);
    assert.equal(URLVariables.prototype.toString.call(hostile), "__proto__=owned&constructor=safe");
    assert.equal(({} as { owned?: boolean }).owned, undefined);

    const punctuation = new URLVariables();
    punctuation.x = "!~'()*";
    assert.equal(punctuation.toString(), "x=%21%7E%27%28%29*");
});

test("URLRequest snapshots own headers and rejects accessor impostors", () => {
    const request = new URLRequest("https://game.invalid/data");
    request.method = "post";
    request.contentType = "application/custom";
    request.requestHeaders.push({ name: "X-Game", value: "Bleach" });
    const snapshot = snapshotFlashURLRequest(request);
    request.requestHeaders[0].value = "mutated";
    assert.deepEqual(snapshot, {
        url: "https://game.invalid/data", method: "POST", data: null,
        contentType: "application/custom", requestHeaders: [{ name: "X-Game", value: "Bleach" }],
    });
    assert.throws(() => snapshotFlashURLRequest({ url: "https://game.invalid" } as URLRequest), TypeError);
    let headerReads = 0;
    const hostileHeader = new URLRequest("https://game.invalid/data");
    hostileHeader.requestHeaders.push(Object.defineProperties({}, {
        name: { enumerable: true, get() { headerReads++; return "X-Hostile"; } },
        value: { enumerable: true, value: "value" },
    }) as URLRequest["requestHeaders"][number]);
    assert.throws(() => snapshotFlashURLRequest(hostileHeader), /own data properties/);
    assert.equal(headerReads, 0);

    assert.equal(snapshotFlashURLRequest(new URLRequest("/relative/path")).url, "/relative/path");
    assert.equal(snapshotFlashURLRequest(new URLRequest("HTTPS://game.invalid/data")).url,
        "HTTPS://game.invalid/data");
    for (const url of ["file:///private/save", "ftp://game.invalid/data", "ws://game.invalid/socket", "custom:data"])
        assert.throws(() => snapshotFlashURLRequest(new URLRequest(url)), UnsupportedFlashFeatureError);
});

test("URLLoader defers open and preserves status, progress, terminal and binary identity order", async () => {
    const request = new URLRequest("https://game.invalid/version.swf");
    request.requestHeaders.push({ name: "X-Request", value: "one" });
    const loader = new URLLoader();
    assert(isFlashURLLoader(loader));
    loader.dataFormat = URLLoaderDataFormat.BINARY;
    const sequence: string[] = [];
    loader.addEventListener(HTTPStatusEvent.HTTP_STATUS, event => sequence.push(`status:${(event as HTTPStatusEvent).status}`));
    loader.addEventListener(ProgressEvent.PROGRESS, event => sequence.push(`progress:${(event as ProgressEvent).bytesLoaded}`));
    loader.addEventListener(Event.COMPLETE, event => {
        assert.equal(event.target, loader);
        sequence.push("complete");
    });
    loader.addEventListener(IOErrorEvent.IO_ERROR, () => sequence.push("ioError"));
    const count = httpHost.calls.length;
    loader.load(request);
    assert.equal(httpHost.calls.length, count, "transport must not start in the load call stack");
    await turn();
    const call = httpHost.calls[count];
    assert.deepEqual(call.request.headers, [{ name: "X-Request", value: "one" }]);
    call.status(200, false);
    call.progress(2, 4);
    call.progress(4, 4);
    call.resolve(response(200, new Uint8Array([0x12, 0x34, 0x56, 0x78])));
    await turn();
    assert.deepEqual(sequence, ["status:200", "progress:2", "progress:4", "complete"]);
    assert.deepEqual([loader.bytesLoaded, loader.bytesTotal], [4, 4]);
    assert(loader.data instanceof ByteArray);
    assert.equal((loader.data as ByteArray).readUnsignedInt(), 0x12345678);
});

test("URLLoader close aborts silently and HTTP failures have one terminal event", async () => {
    const closed = new URLLoader(new URLRequest("https://game.invalid/slow"));
    const terminal: string[] = [];
    closed.addEventListener(Event.COMPLETE, () => terminal.push("complete"));
    closed.addEventListener(IOErrorEvent.IO_ERROR, () => terminal.push("error"));
    await turn();
    const closedCall = httpHost.calls.at(-1)!;
    closed.close();
    assert.equal(closedCall.signal.aborted, true);
    closedCall.reject(new Error("aborted"));
    await turn();
    assert.deepEqual(terminal, []);
    assert.throws(() => closed.close(), /no active request/);

    const failed = new URLLoader(new URLRequest("https://game.invalid/missing"));
    const failedEvents: string[] = [];
    failed.addEventListener(HTTPStatusEvent.HTTP_STATUS, () => failedEvents.push("status"));
    failed.addEventListener(IOErrorEvent.IO_ERROR, event => failedEvents.push((event as IOErrorEvent).text));
    failed.addEventListener(Event.COMPLETE, () => failedEvents.push("complete"));
    await turn();
    const failedCall = httpHost.calls.at(-1)!;
    failedCall.status(404, false);
    failedCall.resolve(response(404, new Uint8Array()));
    await turn();
    assert.deepEqual(failedEvents, ["status", "HTTP 404 Failure"]);

    httpHost.synchronousFailure = new Error("native start failure");
    const startFailed = new URLLoader(new URLRequest("https://game.invalid/start-failure"));
    const startEvents: string[] = [];
    startFailed.addEventListener(IOErrorEvent.IO_ERROR, event => startEvents.push((event as IOErrorEvent).text));
    await turn();
    assert.deepEqual(startEvents, ["native start failure"]);
});

test("URLLoader fences hostile producer ordering and listener failures without a false terminal", async () => {
    const malformed = new URLLoader(new URLRequest("https://game.invalid/hostile"));
    const malformedEvents: string[] = [];
    malformed.addEventListener(IOErrorEvent.IO_ERROR, event => malformedEvents.push((event as IOErrorEvent).text));
    await turn();
    const malformedCall = httpHost.calls.at(-1)!;
    assert.throws(() => malformedCall.progress(1, 1), /before status/);
    assert.equal(malformedCall.signal.aborted, true);
    malformedCall.resolve(response(200, new Uint8Array()));
    await turn();
    assert.deepEqual(malformedEvents, []);

    const listenerError = new Error("consumer progress failure");
    const fenced = new URLLoader(new URLRequest("https://game.invalid/listener"));
    const terminals: string[] = [];
    fenced.addEventListener(ProgressEvent.PROGRESS, () => { throw listenerError; });
    fenced.addEventListener(Event.COMPLETE, () => terminals.push("complete"));
    fenced.addEventListener(IOErrorEvent.IO_ERROR, () => terminals.push("ioError"));
    await turn();
    const fencedCall = httpHost.calls.at(-1)!;
    fencedCall.status(200, false);
    assert.throws(() => fencedCall.progress(1, 1), error => error === listenerError);
    assert.equal(fencedCall.signal.aborted, true);
    fencedCall.resolve(response(200, new Uint8Array([1])));
    await turn();
    assert.deepEqual(terminals, []);

    let responseReads = 0;
    const accessorResponse = new URLLoader(new URLRequest("https://game.invalid/accessor-response"));
    const accessorEvents: string[] = [];
    accessorResponse.addEventListener(IOErrorEvent.IO_ERROR, event => accessorEvents.push((event as IOErrorEvent).text));
    await turn();
    const accessorCall = httpHost.calls.at(-1)!;
    accessorCall.status(200, false);
    accessorCall.resolve(Object.defineProperties({}, {
        url: { enumerable: true, value: "https://game.invalid/final" },
        status: { enumerable: true, get() { responseReads++; return 200; } },
        statusText: { enumerable: true, value: "OK" },
        redirected: { enumerable: true, value: false },
        contentLength: { enumerable: true, value: 0 },
        body: { enumerable: true, value: new ArrayBuffer(0) },
    }) as FlashHTTPResponse);
    await turn();
    assert.deepEqual(accessorEvents, ["HTTP host response status must be an own data property"]);
    assert.equal(responseReads, 0);
});

test("URLLoader variables and sendToURL use explicit repeated form serialization", async () => {
    const variablesLoader = new URLLoader();
    variablesLoader.dataFormat = URLLoaderDataFormat.VARIABLES;
    variablesLoader.load(new URLRequest("https://game.invalid/form"));
    await turn();
    httpHost.calls.at(-1)!.status(200, false);
    httpHost.calls.at(-1)!.resolve(response(200, new TextEncoder().encode("id=1&id=2")));
    await turn();
    assert.deepEqual((variablesLoader.data as URLVariables).id, ["1", "2"]);

    const payload = new URLVariables();
    payload.log = "failure detail";
    const request = new URLRequest("https://game.invalid/log?build=1#fragment");
    request.data = payload;
    const index = httpHost.calls.length;
    sendToURL(request);
    const call = httpHost.calls[index];
    assert.equal(call.request.url, "https://game.invalid/log?build=1&log=failure+detail#fragment");
    assert.equal(call.request.body, null);
    assert.equal(call.request.keepalive, true);
    call.resolve(response(204, new Uint8Array()));

    const callsBeforeRejectedURLs = httpHost.calls.length;
    assert.throws(() => new URLLoader().load(new URLRequest("file:///private/save")), UnsupportedFlashFeatureError);
    assert.throws(() => sendToURL(new URLRequest("custom:payload")), UnsupportedFlashFeatureError);
    assert.equal(httpHost.calls.length, callsBeforeRejectedURLs,
        "rejected absolute schemes must never reach the HTTP host");
});

test("SharedObject has live identity, explicit flush, null values and no implicit close write", () => {
    const shared = SharedObject.getLocal("BleachGame-node");
    assert(isFlashSharedObject(shared));
    assert.equal(SharedObject.getLocal("BleachGame-node"), shared);
    const live = shared.data;
    shared.setProperty("volume", 7);
    shared.setProperty("nullable", null);
    assert.equal(shared.flush(1024), "flushed");
    const stored = [...storageHost.values.values()].find(value => value.includes('"volume":7'));
    assert.ok(stored?.includes('"nullable":null'));
    shared.setProperty("unflushed", true);
    shared.close();
    assert.throws(() => shared.data, /closed/);
    const reopened = SharedObject.getLocal("BleachGame-node");
    assert.notEqual(reopened, shared);
    assert.equal(reopened.data, reopened.data);
    assert.equal(reopened.data.volume, 7);
    assert.equal(reopened.data.unflushed, undefined);
    assert.notEqual(reopened.data, live);
    reopened.clear();
    assert.deepEqual(reopened.data, {});
    reopened.close();
});

test("SharedObject persists a defensive plain-data snapshot and rejects accessor TOCTOU", () => {
    const shared = SharedObject.getLocal("BleachGame-hostile-node");
    shared.clear();
    shared.setProperty("__proto__", "owned safely");
    assert.equal(Object.getPrototypeOf(shared.data), Object.prototype);
    assert.equal(Object.prototype.hasOwnProperty.call(shared.data, "__proto__"), true);
    const accessor = { reads: 0 };
    Object.defineProperty(accessor, "secret", {
        enumerable: true,
        get() { accessor.reads++; return "leaked"; },
    });
    shared.setProperty("accessor", accessor);
    assert.throws(() => shared.flush(), /accessor/);
    assert.equal(accessor.reads, 0, "flush must inspect descriptors without invoking hostile getters");
    shared.clear();
    shared.close();

    let coercions = 0;
    storageHost.nextReadValue = { toString() { coercions++; return '{"schema":"laya-flash-shared-object-json@1","data":{}}'; } };
    assert.throws(() => SharedObject.getLocal("BleachGame-malformed-storage"), /string or null/);
    assert.equal(coercions, 0, "storage authentication must not invoke generic string coercion");
});

test("LocalConnection preserves the maintained GC double-connect collision lifetime", () => {
    const first = new LocalConnection();
    const second = new LocalConnection();
    assert(isFlashLocalConnection(first));
    first.connect("GC-node-test");
    assert.throws(() => second.connect("GC-node-test"), /already in use/);
    assert.throws(() => first.send("other", "method"), UnsupportedFlashFeatureError);
    first.close();
    second.connect("GC-node-test");
    second.close();
});

test("FileReference save defensively copies producer bytes and fails closed for selection", () => {
    const bytes = new ByteArray(new Uint8Array([1, 2, 3]));
    const file = new FileReference();
    assert(isFlashFileReference(file));
    file.save(bytes, "beef.plib");
    bytes.position = 0;
    bytes.writeByte(99);
    const download = downloadHost.downloads.at(-1)!;
    assert.equal(download.suggestedName, "beef.plib");
    assert.deepEqual([...download.data as Uint8Array], [1, 2, 3]);
    assert.throws(() => file.data, /unavailable/);
    assert.throws(() => file.browse(), UnsupportedFlashFeatureError);
    assert.throws(() => file.save(bytes, "../unsafe.plib"), TypeError);
});

test("class aliases retain a closed native constructor mapping without AVM metadata", () => {
    class PlayerState {}
    class Replacement {}
    registerClassAlias("game.PlayerState", PlayerState);
    assert.equal(resolveClassAlias("game.PlayerState"), PlayerState);
    assert.equal(resolveAliasForClass(PlayerState), "game.PlayerState");
    registerClassAlias("game.PlayerState", Replacement);
    assert.equal(resolveClassAlias("game.PlayerState"), Replacement);
    assert.equal(resolveAliasForClass(PlayerState), null);
    assert.throws(() => registerClassAlias("", PlayerState), TypeError);
});

test("Socket buffers ordered frames, keeps EOF atomic and flushes one binary frame", () => {
    const socket = new Socket();
    assert(isFlashSocket(socket));
    assert.throws(() => socket.readInt(), /connected/);
    socket.timeout = Number.MAX_SAFE_INTEGER;
    socket.connect("game.invalid", 443);
    const call = socketHost.calls.at(-1)!;
    assert.equal(call.options.timeout, 0x7fffffff);
    const events: string[] = [];
    socket.addEventListener(Event.CONNECT, () => events.push("connect"));
    socket.addEventListener(ProgressEvent.SOCKET_DATA, () => events.push("data"));
    socket.addEventListener(Event.CLOSE, () => events.push("close"));
    socket.addEventListener(IOErrorEvent.IO_ERROR, event => events.push(`error:${(event as IOErrorEvent).text}`));
    call.callbacks.open();
    assert.equal(socket.connected, true);
    call.callbacks.message(new Uint8Array([0, 0]).buffer);
    assert.throws(() => socket.readInt(), RangeError);
    assert.equal(socket.bytesAvailable, 2, "failed read must not consume a prefix");
    call.callbacks.message(new Uint8Array([0, 5, 8, 9, 10]).buffer);
    assert.equal(socket.readInt(), 5);
    const target = new ByteArray(new Uint8Array([77]));
    target.position = 1;
    socket.readBytes(target, 2, 3);
    assert.equal(target.position, 1);
    assert.deepEqual([...new Uint8Array(target.buffer)], [77, 0, 8, 9, 10]);

    socket.endian = Endian.LITTLE_ENDIAN;
    socket.writeUnsignedInt(0x12345678);
    const payload = new ByteArray(new Uint8Array([4, 5, 6]));
    payload.position = 2;
    socket.writeBytes(payload);
    assert.equal(payload.position, 2);
    socket.flush();
    socket.flush();
    assert.equal(call.frames.length, 1);
    assert.deepEqual([...new Uint8Array(call.frames[0])], [0x78, 0x56, 0x34, 0x12, 4, 5, 6]);
    call.callbacks.message("text is not protocol data");
    assert.equal(events.at(-1), "error:Flash Socket admits binary WebSocket frames only");
    const bytesBeforeMalformed = socket.bytesAvailable;
    call.callbacks.message({ 0: 65, length: 1 } as unknown as ArrayBuffer);
    assert.equal(socket.bytesAvailable, bytesBeforeMalformed);
    assert.equal(events.at(-1), "error:Flash Socket admits binary WebSocket frames only");
    call.callbacks.close();
    assert.equal(socket.connected, false);
    assert.equal(events.filter(value => value === "close").length, 1);
    assert.throws(() => socket.flush(), /connected/);
});

test("Socket manual close suppresses the native close callback and supports connecting cancellation", () => {
    const connecting = new Socket();
    connecting.connect("game.invalid", 80);
    const connectingCall = socketHost.calls.at(-1)!;
    connecting.close();
    connectingCall.callbacks.close();
    assert.equal(connectingCall.closeCalls, 1);

    const socket = new Socket();
    const events: string[] = [];
    socket.addEventListener(Event.CLOSE, () => events.push("close"));
    socket.connect("game.invalid", 80);
    const call = socketHost.calls.at(-1)!;
    call.callbacks.open();
    socket.close();
    call.callbacks.close();
    assert.deepEqual(events, []);
    assert.equal(call.closeCalls, 1);
    assert.throws(() => socket.close(), /connecting or connected/);
});

test("Socket authenticates synchronous host callbacks and observes asynchronous send rejection", async () => {
    const socket = new Socket();
    const events: string[] = [];
    socket.addEventListener(Event.CONNECT, () => events.push("connect"));
    socket.addEventListener(ProgressEvent.SOCKET_DATA, () => events.push("data"));
    socket.addEventListener(IOErrorEvent.IO_ERROR, event => events.push(`error:${(event as IOErrorEvent).text}`));
    socketHost.synchronousCallback = callbacks => {
        callbacks.open();
        callbacks.message(new Uint8Array([0, 0, 0, 2]));
    };
    socket.connect("game.invalid", 443);
    const call = socketHost.calls.at(-1)!;
    assert.deepEqual(events, ["connect", "data"]);
    assert.equal(socket.readUnsignedInt(), 2);
    call.sendFailure = new Error("native send rejected");
    socket.writeUnsignedInt(7);
    socket.flush();
    await turn();
    assert.equal(events.at(-1), "error:native send rejected");
    socket.close();
});

test("Socket rejects malformed host input without bytes and stale generations stay silent", () => {
    const socket = new Socket();
    const listenerFailure = new Error("socket listener failure");
    socket.addEventListener(IOErrorEvent.IO_ERROR, () => { throw listenerFailure; });
    socket.connect("game.invalid", 443);
    const call = socketHost.calls.at(-1)!;
    call.callbacks.open();
    const malformed = { 0: 65, length: 1 } as unknown as ArrayBuffer;
    assert.throws(() => call.callbacks.message(malformed), error => error === listenerFailure);
    assert.equal(socket.bytesAvailable, 0);
    socket.close();
    assert.doesNotThrow(() => call.callbacks.message(malformed));
    assert.equal(socket.bytesAvailable, 0);
});
