import { Browser } from "../../laya/utils/Browser";
import { EventDispatcher } from "../events/EventDispatcher";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

const SHARED_OBJECT_SCHEMA = "laya-flash-shared-object-json@1";
const SHARED_OBJECT_TOKEN = Symbol("LayaAir.flash.SharedObject");
const SHARED_OBJECT_VALUES = new WeakSet<object>();
const STORAGE_HOST_VALUES = new WeakSet<object>();
const LIVE_OBJECTS = new Map<string, SharedObject>();
let installedStorageHost: FlashSharedObjectStorageHost | null = null;

/** Explicit string storage boundary; JSON is current-format data, not AMF migration. */
export abstract class FlashSharedObjectStorageHost {
    protected constructor() { STORAGE_HOST_VALUES.add(this); }
    abstract read(key: string): string | null;
    abstract write(key: string, value: string): void;
    abstract remove(key: string): void;
}

export function installFlashSharedObjectStorageHost(host: FlashSharedObjectStorageHost): void {
    if (typeof host !== "object" || host === null || !STORAGE_HOST_VALUES.has(host))
        throw new TypeError("SharedObject storage host must be a nominal Laya capability");
    if (installedStorageHost !== null || LIVE_OBJECTS.size !== 0)
        throw new Error("SharedObject storage host must be installed once before use");
    installedStorageHost = host;
}

class BrowserSharedObjectStorageHost extends FlashSharedObjectStorageHost {
    constructor(private readonly storage: Storage) { super(); }
    override read(key: string): string | null { return this.storage.getItem(key); }
    override write(key: string, value: string): void { this.storage.setItem(key, value); }
    override remove(key: string): void { this.storage.removeItem(key); }
}

let browserStorageHost: BrowserSharedObjectStorageHost | null = null;

function requireStorageHost(): FlashSharedObjectStorageHost {
    if (installedStorageHost !== null) return installedStorageHost;
    let storage: Storage | null = null;
    try { storage = (Browser.window as (Window & typeof globalThis) | null)?.localStorage ?? null; }
    catch { storage = null; }
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function")
        throw new UnsupportedFlashFeatureError("flash.net.SharedObject", "persistent local storage is unavailable");
    return browserStorageHost ??= new BrowserSharedObjectStorageHost(storage);
}

function checkedIdentity(name: string, localPath: string | null, secure: boolean): { key: string; path: string } {
    if (typeof name !== "string" || name.length === 0 || name.trim() !== name
        || /[\u0000-\u001f\u007f]/.test(name))
        throw new TypeError("SharedObject name must be a validated non-empty string");
    const path = localPath ?? "/";
    if (typeof path !== "string" || !path.startsWith("/") || /[\u0000-\u001f\u007f]/.test(path))
        throw new TypeError("SharedObject localPath must be an absolute path");
    const location = (Browser.window as (Window & typeof globalThis) | null)?.location;
    if (secure && location?.protocol !== "https:")
        throw new Error("Secure SharedObject storage requires an HTTPS origin");
    const origin = typeof location?.origin === "string" && location.origin.length > 0
        ? location.origin : "opaque-browser-origin";
    return { path, key: `laya.flash.shared-object:${secure ? "secure" : "local"}:${origin}:${path}:${name}` };
}

type JsonValue = null | string | boolean | number | JsonValue[] | { [name: string]: JsonValue };

function snapshotJsonValue(value: unknown, seen = new Set<object>(), path = "data"): JsonValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
        return value;
    }
    if (typeof value !== "object") throw new TypeError(`${path} is not JSON-persistable`);
    if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
    seen.add(value);
    if (Object.getOwnPropertySymbols(value).length !== 0)
        throw new TypeError(`${path} contains symbol properties`);
    let snapshot: JsonValue;
    if (Array.isArray(value)) {
        const array: JsonValue[] = [];
        const ownKeys = Object.keys(value);
        if (ownKeys.length !== value.length
            || ownKeys.some((key, index) => key !== String(index)))
            throw new TypeError(`${path} contains sparse or named array properties`);
        for (let index = 0; index < value.length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !('value' in descriptor))
                throw new TypeError(`${path}[${index}] is an accessor and cannot be persisted safely`);
            array.push(snapshotJsonValue(descriptor.value, seen, `${path}[${index}]`));
        }
        snapshot = array;
    } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            throw new TypeError(`${path} contains a non-plain object`);
        const object: { [name: string]: JsonValue } = {};
        for (const key of Object.keys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor))
                throw new TypeError(`${path}.${key} is an accessor and cannot be persisted safely`);
            Object.defineProperty(object, key, {
                configurable: true, enumerable: true, writable: true,
                value: snapshotJsonValue(descriptor.value, seen, `${path}.${key}`),
            });
        }
        snapshot = object;
    }
    seen.delete(value);
    return snapshot;
}

function decodeStoredData(serialized: string | null): Record<string, unknown> {
    if (serialized === null) return {};
    if (typeof serialized !== "string")
        throw new TypeError("SharedObject storage host must return a string or null");
    const envelope = JSON.parse(serialized) as { schema?: unknown; data?: unknown };
    if (typeof envelope !== "object" || envelope === null || envelope.schema !== SHARED_OBJECT_SCHEMA
        || typeof envelope.data !== "object" || envelope.data === null || Array.isArray(envelope.data))
        throw new UnsupportedFlashFeatureError(
            "flash.net.SharedObject migration",
            "stored data is not the authenticated JSON format; legacy AMF migration requires fixtures"
        );
    return snapshotJsonValue(envelope.data) as Record<string, unknown>;
}

/** @internal */
export function isFlashSharedObject(value: unknown): value is SharedObject {
    return typeof value === "object" && value !== null && SHARED_OBJECT_VALUES.has(value);
}

/** Source-used local persistent object with stable live data identity. */
export class SharedObject extends EventDispatcher {
    private _closed = false;

    private constructor(
        token: typeof SHARED_OBJECT_TOKEN,
        private readonly _storage: FlashSharedObjectStorageHost,
        private readonly _key: string,
        private readonly _data: Record<string, unknown>
    ) {
        if (token !== SHARED_OBJECT_TOKEN) throw new TypeError("SharedObject instances are created by getLocal");
        super();
        SHARED_OBJECT_VALUES.add(this);
    }

    static getLocal(name: string, localPath: string | null = null, secure = false): SharedObject {
        const identity = checkedIdentity(name, localPath, !!secure);
        const existing = LIVE_OBJECTS.get(identity.key);
        if (existing) return existing;
        const storage = requireStorageHost();
        const instance = new SharedObject(SHARED_OBJECT_TOKEN, storage, identity.key,
            decodeStoredData(storage.read(identity.key)));
        LIVE_OBJECTS.set(identity.key, instance);
        return instance;
    }

    get data(): Record<string, unknown> {
        this.assertOpen();
        return this._data;
    }

    setProperty(propertyName: string, value: unknown): void {
        this.assertOpen();
        if (typeof propertyName !== "string" || propertyName.length === 0)
            throw new TypeError("SharedObject property name must be non-empty");
        Object.defineProperty(this._data, propertyName, {
            configurable: true, enumerable: true, writable: true, value,
        });
    }

    flush(minDiskSpace = 0): string {
        this.assertOpen();
        if (!Number.isFinite(minDiskSpace) || minDiskSpace < 0)
            throw new RangeError("SharedObject.flush minDiskSpace must be nonnegative");
        const snapshot = snapshotJsonValue(this._data);
        this._storage.write(this._key, JSON.stringify({ schema: SHARED_OBJECT_SCHEMA, data: snapshot }));
        return "flushed";
    }

    clear(): void {
        this.assertOpen();
        this._storage.remove(this._key);
        for (const key of Object.keys(this._data)) delete this._data[key];
    }

    close(): void {
        this.assertOpen();
        this._closed = true;
        if (LIVE_OBJECTS.get(this._key) === this) LIVE_OBJECTS.delete(this._key);
    }

    private assertOpen(): void {
        if (this._closed) throw new Error("SharedObject is closed");
    }
}
