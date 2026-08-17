import assert from "node:assert/strict";
import test from "node:test";
import { Event } from "../../src/layaAir/laya/events/Event";
import { IWebSocket, IWebSocketCloseInfo, IWebSocketConnectOptions } from "../../src/layaAir/laya/net/IWebSocket";
import { Socket } from "../../src/layaAir/laya/net/Socket";
import { _WebSocket } from "../../src/layaAir/laya/net/WebSocket";
import { PAL } from "../../src/layaAir/laya/platform/PlatformAdapters";
import { Browser } from "../../src/layaAir/laya/utils/Browser";
import { MgWebSocket } from "../../src/layaAir/platforms/minigame/MgWebSocket";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

class DeferredBlob {
    private _resolve: (value: ArrayBuffer) => void;
    private readonly _promise = new Promise<ArrayBuffer>(resolve => this._resolve = resolve);

    arrayBuffer(): Promise<ArrayBuffer> {
        return this._promise;
    }

    resolve(value: ArrayBuffer): void {
        this._resolve(value);
    }
}

class BrowserSocketDouble {
    static instances: BrowserSocketDouble[] = [];

    binaryType: BinaryType;
    onopen: (event: Event) => void;
    onclose: (event: CloseEvent) => void;
    onerror: (event: Event) => void;
    onmessage: (event: MessageEvent) => void;
    readonly closeCalls: any[][] = [];
    readonly sent: Array<string | ArrayBuffer> = [];

    constructor(readonly url: string, readonly protocols?: string[]) {
        BrowserSocketDouble.instances.push(this);
    }

    close(...args: any[]): void {
        this.closeCalls.push(args);
    }

    send(data: string | ArrayBuffer): void {
        this.sent.push(data);
    }

    emitOpen(): void {
        this.onopen?.(<Event><unknown>{});
    }

    emitClose(code: number, reason: string, wasClean: boolean): void {
        this.onclose?.(<CloseEvent><unknown>{ code, reason, wasClean });
    }

    emitMessage(data: any): void {
        this.onmessage?.(<MessageEvent><unknown>{ data });
    }
}

test("browser adapter preserves order, close details, empty messages, timeouts, and socket generations", async () => {
    BrowserSocketDouble.instances.length = 0;
    const timers = new Map<number, () => void>();
    const cleared: number[] = [];
    let nextTimer = 1;
    (<any>Browser).window = {
        WebSocket: BrowserSocketDouble,
        Blob: DeferredBlob,
        setTimeout(callback: () => void): number {
            const id = nextTimer++;
            timers.set(id, callback);
            return id;
        },
        clearTimeout(id: number): void {
            cleared.push(id);
            timers.delete(id);
        }
    };

    const adapter = new _WebSocket();
    const messages: Array<string | ArrayBuffer> = [];
    const closes: IWebSocketCloseInfo[] = [];
    const errors: any[] = [];
    adapter.onOpen = () => { };
    adapter.onClose = info => closes.push(info);
    adapter.onError = error => errors.push(error);
    adapter.onMessage = data => messages.push(data);

    adapter.open("ws://first", { protocols: ["binary"], timeout: 25 });
    const first = BrowserSocketDouble.instances[0];
    assert.equal(first.binaryType, "arraybuffer");
    assert.deepEqual(first.protocols, ["binary"]);
    first.emitOpen();
    assert.deepEqual(cleared, [1]);

    first.emitMessage("");
    const blob = new DeferredBlob();
    first.emitMessage(blob);
    first.emitMessage("after-blob");
    first.emitClose(1000, "normal", true);
    await turn();
    assert.deepEqual(messages, [""]);
    assert.deepEqual(closes, []);

    const blobBytes = new Uint8Array([3, 1, 4]).buffer;
    blob.resolve(blobBytes);
    await turn();
    await turn();
    assert.deepEqual(messages, ["", blobBytes, "after-blob"]);
    assert.deepEqual(closes, [{ code: 1000, reason: "normal", wasClean: true }]);

    adapter.open("ws://second", { timeout: 50 });
    const second = BrowserSocketDouble.instances[1];
    adapter.close(1001, "leaving");
    assert.deepEqual(second.closeCalls, [[1001, "leaving"]]);
    second.emitOpen();
    assert.deepEqual(cleared, [1, 2]);

    const staleBlob = new DeferredBlob();
    second.emitMessage(staleBlob);
    adapter.open("ws://third", { timeout: 75 });
    const third = BrowserSocketDouble.instances[2];
    assert.deepEqual(second.closeCalls, [[1001, "leaving"], []]);
    staleBlob.resolve(new Uint8Array([9]).buffer);
    await turn();
    assert.equal(messages.length, 3);

    const timeoutCallback = timers.get(3);
    assert.ok(timeoutCallback);
    timeoutCallback();
    assert.match(errors[0].message, /timed out after 75 ms/);
    assert.deepEqual(third.closeCalls, [[]]);
});

class MiniSocketDouble {
    onOpenCallback: (result: any) => void;
    onCloseCallback: (result: any) => void;
    onErrorCallback: (error: any) => void;
    onMessageCallback: (result: any) => void;
    closeOptions: any;

    onOpen(callback: (result: any) => void): void { this.onOpenCallback = callback; }
    onClose(callback: (result: any) => void): void { this.onCloseCallback = callback; }
    onError(callback: (error: any) => void): void { this.onErrorCallback = callback; }
    onMessage(callback: (result: any) => void): void { this.onMessageCallback = callback; }
    close(options: any): void { this.closeOptions = options; }
    send(options: any): void { options.success(); }
}

test("minigame adapter maps supported close fields and accepts empty payloads", async () => {
    const tasks: MiniSocketDouble[] = [];
    const connectOptions: any[] = [];
    (<any>PAL).g = {
        connectSocket(options: any): MiniSocketDouble {
            connectOptions.push(options);
            const task = new MiniSocketDouble();
            tasks.push(task);
            return task;
        }
    };

    const adapter = new MgWebSocket();
    const messages: Array<string | ArrayBuffer> = [];
    const closes: IWebSocketCloseInfo[] = [];
    adapter.onOpen = () => { };
    adapter.onClose = info => closes.push(info);
    adapter.onError = error => assert.fail(error);
    adapter.onMessage = data => messages.push(data);

    adapter.open("wss://platform", { timeout: 2000 });
    assert.equal(connectOptions[0].timeout, 2000);
    tasks[0].onMessageCallback({ data: "" });
    assert.deepEqual(messages, [""]);
    adapter.close(1001, "away");
    assert.deepEqual(tasks[0].closeOptions, { code: 1001, reason: "away" });
    tasks[0].onCloseCallback({ code: 1001, reason: "away", wasClean: true });
    assert.deepEqual(closes, [{ code: 1001, reason: "away", wasClean: true }]);

    adapter.open("wss://replacement");
    tasks[0].onMessageCallback({ data: "stale" });
    tasks[0].onCloseCallback({ code: 1006, reason: "stale" });
    assert.deepEqual(messages, [""]);
    assert.equal(closes.length, 1);
    await adapter.send(new Uint8Array([7]).buffer);
});

class EngineSocketDouble implements IWebSocket {
    onOpen: (result: any) => void;
    onClose: (info: IWebSocketCloseInfo) => void;
    onError: (e: any) => void;
    onMessage: (data: string | ArrayBuffer) => void;
    readonly closeCalls: Array<[number?, string?]> = [];
    readonly sent: Array<string | ArrayBuffer> = [];
    url: string;
    options: IWebSocketConnectOptions;

    open(url: string, options?: IWebSocketConnectOptions): void {
        this.url = url;
        this.options = options;
    }

    close(code?: number, reason?: string): void {
        this.closeCalls.push([code, reason]);
    }

    send(data: string | ArrayBuffer): Promise<void> {
        this.sent.push(data);
        return Promise.resolve();
    }
}

test("Socket isolates reconnect epochs while retaining buffering, flush, and close behavior", () => {
    const rawSockets: EngineSocketDouble[] = [];
    (<any>PAL).browser = {
        createWebSocket(): EngineSocketDouble {
            const socket = new EngineSocketDouble();
            rawSockets.push(socket);
            return socket;
        }
    };

    const socket = new Socket();
    const opened: number[] = [];
    const messages: Array<string | ArrayBuffer> = [];
    const closes: IWebSocketCloseInfo[] = [];
    const errors: any[] = [];
    socket.on(Event.OPEN, () => opened.push(rawSockets.length));
    socket.on(Event.MESSAGE, (data: string | ArrayBuffer) => messages.push(data));
    socket.on(Event.CLOSE, (info: IWebSocketCloseInfo) => closes.push(info));
    socket.on(Event.ERROR, (error: any) => errors.push(error));

    socket.connectByUrl("ws://one");
    const first = rawSockets[0];
    const stale = {
        open: first.onOpen,
        close: first.onClose,
        error: first.onError,
        message: first.onMessage
    };
    first.onOpen({});
    assert.equal(socket.connected, true);
    const firstMessage = new Uint8Array([1, 2]).buffer;
    first.onMessage(firstMessage);
    assert.equal(socket.input.length, 2);
    socket.output.writeUint8(8);
    socket.output.writeUint8(9);
    socket.flush();
    assert.deepEqual(Array.from(new Uint8Array(<ArrayBuffer>first.sent[0])), [8, 9]);
    assert.equal(socket.output.length, 0);

    socket.connectByUrl("ws://two");
    const second = rawSockets[1];
    stale.open({});
    stale.message("stale");
    stale.error(new Error("stale"));
    stale.close({ code: 1006, reason: "stale", wasClean: false });
    assert.deepEqual(opened, [1]);
    assert.deepEqual(messages, [firstMessage]);
    assert.deepEqual(errors, []);
    assert.deepEqual(closes, []);

    socket.disableInput = true;
    second.onOpen({});
    second.onMessage("");
    assert.equal(socket.connected, true);
    assert.deepEqual(messages, [firstMessage, ""]);
    second.onClose({ code: 1000, reason: "remote", wasClean: true });
    assert.equal(socket.connected, false);
    assert.deepEqual(closes, [{ code: 1000, reason: "remote", wasClean: true }]);

    socket.connectByUrl("ws://three");
    const third = rawSockets[2];
    const localClose = third.onClose;
    socket.close(1001, "local");
    assert.deepEqual(third.closeCalls, [[1001, "local"]]);
    localClose({ code: 1001, reason: "local", wasClean: true });
    assert.deepEqual(closes[1], { code: 1001, reason: "local", wasClean: true });
});
