import { Browser } from "../../laya/utils/Browser";
import { IWebSocket } from "../../laya/net/IWebSocket";
import { PAL } from "../../laya/platform/PlatformAdapters";
import { Event } from "../events/Event";
import { EventDispatcher } from "../events/EventDispatcher";
import { IOErrorEvent } from "../events/IOErrorEvent";
import { ProgressEvent } from "../events/ProgressEvent";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { ByteArray } from "../utils/ByteArray";
import { Endian } from "../utils/Endian";

export interface FlashSocketCallbacks {
    readonly open: () => void;
    readonly message: (data: ArrayBuffer | ArrayBufferView | string) => void;
    readonly error: (error: unknown) => void;
    readonly close: () => void;
}

export interface FlashSocketConnection {
    send(data: ArrayBuffer): void | Promise<void>;
    close(): void;
}

export interface FlashSocketConnectOptions {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly timeout: number;
}

const SOCKET_HOST_VALUES = new WeakSet<object>();
const SOCKET_VALUES = new WeakSet<object>();
let installedSocketHost: FlashSocketHost | null = null;

/** Browser/native binary WebSocket capability used by the Flash Socket projection. */
export abstract class FlashSocketHost {
    protected constructor() { SOCKET_HOST_VALUES.add(this); }
    abstract connect(options: FlashSocketConnectOptions, callbacks: FlashSocketCallbacks): FlashSocketConnection;
}

export function installFlashSocketHost(host: FlashSocketHost): void {
    if (typeof host !== "object" || host === null || !SOCKET_HOST_VALUES.has(host))
        throw new TypeError("Flash Socket host must be a nominal Laya capability");
    if (installedSocketHost !== null) throw new Error("Flash Socket host is already installed");
    installedSocketHost = host;
}

class LayaWebSocketHost extends FlashSocketHost {
    constructor() { super(); }

    override connect(options: FlashSocketConnectOptions, callbacks: FlashSocketCallbacks): FlashSocketConnection {
        const socket = PAL.browser?.createWebSocket();
        if (!socket)
            throw new UnsupportedFlashFeatureError("flash.net.Socket", "binary WebSocket is unavailable");
        socket.onOpen = callbacks.open;
        socket.onMessage = callbacks.message;
        socket.onError = callbacks.error;
        socket.onClose = callbacks.close;
        socket.open(`${options.secure ? "wss" : "ws"}://${options.host}:${options.port}`, {
            timeout: options.timeout,
        });
        return new LayaWebSocketConnection(socket);
    }
}

class LayaWebSocketConnection implements FlashSocketConnection {
    constructor(private readonly socket: IWebSocket) {}
    send(data: ArrayBuffer): Promise<void> { return this.socket.send(data); }
    close(): void { this.socket.close(); }
}

let layaSocketHost: LayaWebSocketHost | null = null;

function requireSocketHost(): FlashSocketHost {
    if (installedSocketHost !== null) return installedSocketHost;
    if (!PAL.browser || typeof PAL.browser.createWebSocket !== "function")
        throw new UnsupportedFlashFeatureError("flash.net.Socket", "the Laya browser socket host is unavailable");
    return layaSocketHost ??= new LayaWebSocketHost();
}

function checkedPort(port: number): number {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new RangeError("Socket port must be an integer between 1 and 65535");
    return port;
}

function checkedLength(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
        throw new RangeError(`${label} must be a uint`);
    return value;
}

function authenticateConnection(value: unknown): FlashSocketConnection {
    if (typeof value !== "object" || value === null)
        throw new TypeError("Flash Socket host returned a malformed connection");
    const readMethod = (name: "send" | "close"): ((...arguments_: any[]) => unknown) => {
        let owner: object | null = value;
        while (owner !== null) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, name);
            if (descriptor) {
                if (!("value" in descriptor) || typeof descriptor.value !== "function")
                    throw new TypeError(`Flash Socket connection ${name} must be a data method`);
                return descriptor.value;
            }
            owner = Object.getPrototypeOf(owner) as object | null;
        }
        throw new TypeError(`Flash Socket connection is missing ${name}`);
    };
    const send = readMethod("send");
    const close = readMethod("close");
    return Object.freeze({
        send: (data: ArrayBuffer) => Reflect.apply(send, value, [data]) as void | Promise<void>,
        close: () => { Reflect.apply(close, value, []); },
    });
}

/** @internal */
export function isFlashSocket(value: unknown): value is Socket {
    return typeof value === "object" && value !== null && SOCKET_VALUES.has(value);
}

/** Source-used binary Socket semantics projected onto one WebSocket frame per flush. */
export class Socket extends EventDispatcher {
    private _connection: FlashSocketConnection | null = null;
    private _connecting = false;
    private _connected = false;
    private _generation = 0;
    private _incoming = new Uint8Array(0);
    private _incomingOffset = 0;
    private _outgoing: number[] = [];
    private _endian = Endian.BIG_ENDIAN;
    private _timeout = 20000;

    constructor(host: string | null = null, port = 0) {
        super();
        SOCKET_VALUES.add(this);
        if (host !== null) this.connect(host, port);
    }

    get connected(): boolean { return this._connected; }
    get bytesAvailable(): number { return this._incoming.length - this._incomingOffset; }
    get endian(): string { return this._endian; }
    set endian(value: string) {
        if (value !== Endian.BIG_ENDIAN && value !== Endian.LITTLE_ENDIAN)
            throw new RangeError(`Unsupported Socket endian: ${String(value)}`);
        this._endian = value;
    }
    get timeout(): number { return this._timeout; }
    set timeout(value: number) {
        if (!Number.isFinite(value)) throw new RangeError("Socket.timeout must be finite");
        this._timeout = Math.min(0x7fffffff, Math.max(0, Math.floor(value)));
    }

    connect(host: string, port: number): void {
        if (this._connection !== null || this._connecting || this._connected)
            throw new Error("Socket is already connecting or connected");
        if (typeof host !== "string" || host.length === 0 || host.trim() !== host
            || /[\u0000-\u0020\u007f/:]/.test(host))
            throw new TypeError("Socket host must be a bare validated host name");
        const exactPort = checkedPort(port);
        const generation = ++this._generation;
        this._connecting = true;
        this._incoming = new Uint8Array(0);
        this._incomingOffset = 0;
        this._outgoing = [];
        const secure = (Browser.window as (Window & typeof globalThis) | null)?.location?.protocol === "https:";
        const pendingCallbacks: Array<() => void> = [];
        let connectionReady = false;
        let createdConnection: FlashSocketConnection | null = null;
        const deliver = (callback: () => void): void => {
            if (connectionReady) callback();
            else pendingCallbacks.push(callback);
        };
        try {
            const rawConnection = requireSocketHost().connect(Object.freeze({
                host,
                port: exactPort,
                secure,
                timeout: this._timeout,
            }), Object.freeze({
                open: () => deliver(() => this.onOpen(generation)),
                message: (data: ArrayBuffer | ArrayBufferView | string) => deliver(() => this.onMessage(generation, data)),
                error: (error: unknown) => deliver(() => this.onError(generation, error)),
                close: () => deliver(() => this.onServerClose(generation)),
            }));
            const connection = authenticateConnection(rawConnection);
            createdConnection = connection;
            this._connection = connection;
            connectionReady = true;
            for (const callback of pendingCallbacks) callback();
        } catch (error) {
            if (createdConnection !== null) {
                try { createdConnection.close(); }
                catch { /* preserve the original producer/listener failure */ }
            }
            ++this._generation;
            this._connecting = false;
            this._connection = null;
            throw error;
        }
    }

    close(): void {
        if (this._connection === null || (!this._connecting && !this._connected))
            throw new Error("Socket.close requires a connecting or connected socket");
        const connection = this._connection!;
        ++this._generation;
        this._connection = null;
        this._connecting = false;
        this._connected = false;
        this._outgoing = [];
        connection.close();
    }

    readInt(): number {
        return this.readUnsignedInt() | 0;
    }

    readUnsignedInt(): number {
        this.requireConnected("readUnsignedInt");
        this.requireAvailable(4);
        const view = new DataView(this._incoming.buffer, this._incoming.byteOffset + this._incomingOffset, 4);
        const value = view.getUint32(0, this._endian === Endian.LITTLE_ENDIAN);
        this.consume(4);
        return value;
    }

    readBytes(bytes: ByteArray, offset = 0, length = 0): void {
        this.requireConnected("readBytes");
        if (!(bytes instanceof ByteArray)) throw new TypeError("Socket.readBytes requires a ByteArray");
        const exactOffset = checkedLength(offset, "Socket.readBytes offset");
        const exactLength = length === 0 ? this.bytesAvailable : checkedLength(length, "Socket.readBytes length");
        this.requireAvailable(exactLength);
        const originalPosition = bytes.position;
        bytes.position = exactOffset;
        for (let index = 0; index < exactLength; index++)
            bytes.writeByte(this._incoming[this._incomingOffset + index]);
        bytes.position = originalPosition;
        this.consume(exactLength);
    }

    writeUnsignedInt(value: number): void {
        this.requireConnected("writeUnsignedInt");
        const buffer = new ArrayBuffer(4);
        new DataView(buffer).setUint32(0, Number(value) >>> 0, this._endian === Endian.LITTLE_ENDIAN);
        this.appendOutgoing(new Uint8Array(buffer));
    }

    writeBytes(bytes: ByteArray, offset = 0, length = 0): void {
        this.requireConnected("writeBytes");
        if (!(bytes instanceof ByteArray)) throw new TypeError("Socket.writeBytes requires a ByteArray");
        const exactOffset = checkedLength(offset, "Socket.writeBytes offset");
        if (exactOffset > bytes.length) throw new RangeError("Socket.writeBytes offset exceeds source length");
        const exactLength = length === 0 ? bytes.length - exactOffset : checkedLength(length, "Socket.writeBytes length");
        if (exactOffset + exactLength > bytes.length)
            throw new RangeError("Socket.writeBytes range exceeds source length");
        this.appendOutgoing(new Uint8Array(bytes.buffer, exactOffset, exactLength));
    }

    flush(): void {
        this.requireConnected("flush");
        if (this._outgoing.length === 0) return;
        const frame = Uint8Array.from(this._outgoing).buffer;
        const generation = this._generation;
        const result = this._connection!.send(frame);
        this._outgoing = [];
        if (result && typeof result.then === "function") {
            void result.catch(error => {
                if (generation === this._generation && this._connected)
                    this.onError(generation, error);
            });
        }
    }

    private onOpen(generation: number): void {
        if (generation !== this._generation || !this._connecting || this._connection === null) return;
        this._connecting = false;
        this._connected = true;
        this.dispatchEvent(new Event(Event.CONNECT));
    }

    private onMessage(generation: number, data: ArrayBuffer | ArrayBufferView | string): void {
        if (generation !== this._generation || !this._connected) return;
        if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
            this.dispatchEvent(new IOErrorEvent(IOErrorEvent.IO_ERROR, false, false,
                "Flash Socket admits binary WebSocket frames only"));
            return;
        }
        const chunk = ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
            : new Uint8Array(data).slice();
        const unread = this._incoming.subarray(this._incomingOffset);
        const joined = new Uint8Array(unread.length + chunk.length);
        joined.set(unread, 0);
        joined.set(chunk, unread.length);
        this._incoming = joined;
        this._incomingOffset = 0;
        this.dispatchEvent(new ProgressEvent(ProgressEvent.SOCKET_DATA, false, false,
            chunk.byteLength, this.bytesAvailable));
    }

    private onError(generation: number, error: unknown): void {
        if (generation !== this._generation || this._connection === null) return;
        const text = error instanceof Error ? error.message : typeof error === "string" ? error : "Socket I/O error";
        this.dispatchEvent(new IOErrorEvent(IOErrorEvent.IO_ERROR, false, false, text));
    }

    private onServerClose(generation: number): void {
        if (generation !== this._generation || this._connection === null) return;
        this._connection = null;
        this._connecting = false;
        this._connected = false;
        this._outgoing = [];
        this.dispatchEvent(new Event(Event.CLOSE));
    }

    private requireConnected(operation: string): void {
        if (!this._connected || this._connection === null)
            throw new Error(`Socket.${operation} requires a connected socket`);
    }

    private requireAvailable(length: number): void {
        if (length > this.bytesAvailable) throw new RangeError("Socket read exceeds bytesAvailable");
    }

    private consume(length: number): void {
        this._incomingOffset += length;
        if (this._incomingOffset === this._incoming.length) {
            this._incoming = new Uint8Array(0);
            this._incomingOffset = 0;
        }
    }

    private appendOutgoing(bytes: Uint8Array): void {
        for (const byte of bytes) this._outgoing.push(byte);
    }
}
