import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

const FUNCTION_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
let externalHost: ExternalHostRecord | null = null;
let installingExternalHost = false;

export type ExternalInterfaceValue = string | number | boolean | null;

/** Structural application host accepted only through the explicit installer. */
export interface NativeExternalInterfaceHost {
    call(functionName: string, arguments_: readonly ExternalInterfaceValue[]): unknown;
}

/** Opaque engine-issued ownership of the currently installed external host. */
export declare class NativeExternalInterfaceHostLease {
    #private;
    private constructor();
    readonly active: boolean;
    readonly disposed: boolean;
    dispose(): void;
}

interface ExternalHostRecord {
    owner: NativeExternalInterfaceHost | null;
    call: Function | null;
    active: boolean;
}

const EXTERNAL_LEASE_RECORDS = new WeakMap<object, ExternalHostRecord>();

class EngineNativeExternalInterfaceHostLease {
    constructor(record: ExternalHostRecord) {
        EXTERNAL_LEASE_RECORDS.set(this, record);
        Object.defineProperties(this, {
            active: { get: () => requireLeaseRecord(this).active, enumerable: true },
            disposed: { get: () => !requireLeaseRecord(this).active, enumerable: true },
            dispose: {
                value: EngineNativeExternalInterfaceHostLease.prototype.dispose.bind(this),
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
        retireExternalHost(requireLeaseRecord(this));
    }
}

/**
 * Installs or replaces the application bootstrap host and returns its opaque
 * ownership lease. A stale lease can never dispose its successor.
 */
export function installNativeExternalInterfaceHost(
    host: NativeExternalInterfaceHost,
): NativeExternalInterfaceHostLease {
    if ((typeof host !== "object" && typeof host !== "function") || host === null)
        throw new TypeError("Native ExternalInterface host must be an explicit structural capability");
    if (installingExternalHost)
        throw new Error("Native ExternalInterface host installation is already in progress");

    installingExternalHost = true;
    try {
        const call = requireDataMethod(host, "call", "Native ExternalInterface host");
        const record: ExternalHostRecord = { owner: host, call, active: true };
        const lease = new EngineNativeExternalInterfaceHostLease(record);
        if (externalHost) retireExternalHost(externalHost);
        externalHost = record;
        return lease as unknown as NativeExternalInterfaceHostLease;
    } finally {
        installingExternalHost = false;
    }
}

/**
 * Closed call-only bridge for Bleach's retained host protocol. It never walks
 * global object paths or publishes callbacks onto globalThis.
 */
export class ExternalInterface {
    private constructor() {}

    static get available(): boolean { return externalHost?.active === true; }

    static call(functionName: string, ...arguments_: ExternalInterfaceValue[]): unknown {
        if (typeof functionName !== "string" || !FUNCTION_NAME.test(functionName))
            throw new TypeError("ExternalInterface.call requires a canonical non-empty function name");
        const record = externalHost;
        if (!record?.active || record.owner === null || record.call === null)
            throw new UnsupportedFlashFeatureError("flash.external.ExternalInterface.call",
                "the application bootstrap has not installed a native external host");
        const snapshot = Object.freeze(arguments_.map((value, index) => snapshotValue(value, index)));
        return Reflect.apply(record.call, record.owner, [functionName, snapshot]);
    }
}

function retireExternalHost(record: ExternalHostRecord): void {
    if (!record.active) return;
    record.active = false;
    record.owner = null;
    record.call = null;
    if (externalHost === record) externalHost = null;
}

function requireLeaseRecord(value: unknown): ExternalHostRecord {
    if ((typeof value !== "object" && typeof value !== "function") || value === null)
        throw new TypeError("Native ExternalInterface host lifecycle requires an engine-issued lease");
    const record = EXTERNAL_LEASE_RECORDS.get(value as object);
    if (!record)
        throw new TypeError("Native ExternalInterface host lifecycle requires an engine-issued lease");
    return record;
}

function snapshotValue(value: unknown, index: number): ExternalInterfaceValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    throw new TypeError(`ExternalInterface.call argument ${index} must be a finite primitive host value`);
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
