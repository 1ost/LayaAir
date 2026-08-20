import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

const UINT_MAX = 0xffffffff;
declare const NATIVE_SYSTEM_HOST_LEASE: unique symbol;

let systemHost: SystemHostRecord | null = null;
let installingSystemHost = false;

/** Structural application host accepted only through the explicit installer. */
export interface NativeSystemHost {
    setClipboard(text: string): void;
}

/** Opaque engine-issued ownership of the currently installed System host. */
export interface NativeSystemHostLease {
    readonly [NATIVE_SYSTEM_HOST_LEASE]: true;
    readonly active: boolean;
    readonly disposed: boolean;
    dispose(): void;
}

interface SystemHostRecord {
    owner: NativeSystemHost | null;
    setClipboard: Function | null;
    active: boolean;
}

interface BrowserHeapMemory {
    readonly usedJSHeapSize?: number;
}

const SYSTEM_LEASE_RECORDS = new WeakMap<object, SystemHostRecord>();

class EngineNativeSystemHostLease implements NativeSystemHostLease {
    declare readonly [NATIVE_SYSTEM_HOST_LEASE]: true;

    constructor(record: SystemHostRecord) {
        SYSTEM_LEASE_RECORDS.set(this, record);
        Object.defineProperties(this, {
            active: { get: () => requireLeaseRecord(this).active, enumerable: true },
            disposed: { get: () => !requireLeaseRecord(this).active, enumerable: true },
            dispose: {
                value: EngineNativeSystemHostLease.prototype.dispose.bind(this),
                writable: false,
                enumerable: false,
                configurable: false,
            },
        });
        Object.freeze(this);
    }

    get active(): boolean { return requireLeaseRecord(this).active; }
    get disposed(): boolean { return !requireLeaseRecord(this).active; }

    dispose(): void {
        retireSystemHost(requireLeaseRecord(this));
    }
}

function usedHeapSize(): number {
    const memory = typeof globalThis.performance === "undefined"
        ? undefined
        : (globalThis.performance as Performance & { readonly memory?: BrowserHeapMemory }).memory;
    const value = Number(memory?.usedJSHeapSize);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

/**
 * Installs or replaces the application bootstrap host and returns its opaque
 * ownership lease. A stale lease can never dispose its successor.
 */
export function installNativeSystemHost(host: NativeSystemHost): NativeSystemHostLease {
    if ((typeof host !== "object" && typeof host !== "function") || host === null)
        throw new TypeError("Native System host must be an explicit structural capability");
    if (installingSystemHost)
        throw new Error("Native System host installation is already in progress");

    installingSystemHost = true;
    try {
        const setClipboard = requireDataMethod(host, "setClipboard", "Native System host");
        const record: SystemHostRecord = { owner: host, setClipboard, active: true };
        const lease = new EngineNativeSystemHostLease(record);
        if (systemHost) retireSystemHost(systemHost);
        systemHost = record;
        return lease;
    } finally {
        installingSystemHost = false;
    }
}

/**
 * Source-shaped subset backed only by native browser/host capabilities used by
 * Bleach. VM collection, process control and XML disposal are intentionally
 * absent.
 */
export class System {
    private constructor() {}

    static get totalMemory(): number {
        const bytes = usedHeapSize();
        return bytes <= UINT_MAX ? bytes : 0;
    }
    static get totalMemoryNumber(): number { return usedHeapSize(); }

    static setClipboard(value: string): void {
        const record = systemHost;
        if (!record?.active || record.owner === null || record.setClipboard === null)
            throw new UnsupportedFlashFeatureError("flash.system.System.setClipboard",
                "the application bootstrap has not installed a native clipboard host");
        const text = value == null ? "" : String(value);
        if (systemHost !== record || !record.active || record.owner === null || record.setClipboard === null)
            throw new Error("Native System host changed during clipboard value coercion");
        Reflect.apply(record.setClipboard, record.owner, [text]);
    }
}

function retireSystemHost(record: SystemHostRecord): void {
    if (!record.active) return;
    record.active = false;
    record.owner = null;
    record.setClipboard = null;
    if (systemHost === record) systemHost = null;
}

function requireLeaseRecord(value: unknown): SystemHostRecord {
    if ((typeof value !== "object" && typeof value !== "function") || value === null)
        throw new TypeError("Native System host lifecycle requires an engine-issued lease");
    const record = SYSTEM_LEASE_RECORDS.get(value as object);
    if (!record)
        throw new TypeError("Native System host lifecycle requires an engine-issued lease");
    return record;
}

function requireDataMethod(owner: object, name: string, label: string): Function {
    let cursor: object | null = owner;
    const visited = new Set<object>();
    while (cursor !== null && !visited.has(cursor)) {
        visited.add(cursor);
        const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
        if (descriptor) {
            if (typeof descriptor.value !== "function")
                throw new TypeError(`${label} ${name} must be a data method`);
            return descriptor.value;
        }
        cursor = Object.getPrototypeOf(cursor);
    }
    throw new TypeError(`${label} ${name} must be a data method`);
}
