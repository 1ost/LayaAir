import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

const EXTERNAL_HOSTS = new WeakSet<object>();
const FUNCTION_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
let externalHost: ExternalHostRecord | null = null;
let installingExternalHost = false;

export type ExternalInterfaceValue = string | number | boolean | null;

interface ExternalHostRecord {
    readonly owner: NativeExternalInterfaceHost;
    readonly call: (functionName: string, arguments_: readonly ExternalInterfaceValue[]) => unknown;
}

/** Nominal embedding boundary for the legacy string-named host protocol. */
export abstract class NativeExternalInterfaceHost {
    protected constructor() {
        const prototype = new.target?.prototype;
        const method = prototype && Object.getOwnPropertyDescriptor(prototype, "call");
        if (new.target === NativeExternalInterfaceHost
            || Object.getPrototypeOf(prototype) !== NativeExternalInterfaceHost.prototype
            || typeof method?.value !== "function")
            throw new TypeError("NativeExternalInterfaceHost requires a direct concrete data-method subclass");
        EXTERNAL_HOSTS.add(this);
    }

    abstract call(functionName: string, arguments_: readonly ExternalInterfaceValue[]): unknown;
}

/** Installs the single application bootstrap host. It cannot be replaced. */
export function installNativeExternalInterfaceHost(host: NativeExternalInterfaceHost): void {
    if (typeof host !== "object" || host === null || !EXTERNAL_HOSTS.has(host))
        throw new TypeError("Native ExternalInterface host must be a nominal Laya capability");
    if (externalHost !== null || installingExternalHost)
        throw new Error("Native ExternalInterface host is already installed or installing");
    installingExternalHost = true;
    try {
        const call = requireDataMethod(host, "call", "Native ExternalInterface host");
        externalHost = Object.freeze({
            owner: host,
            call: (functionName: string, arguments_: readonly ExternalInterfaceValue[]) =>
                Reflect.apply(call, host, [functionName, arguments_]),
        });
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

    static get available(): boolean { return externalHost !== null; }

    static call(functionName: string, ...arguments_: ExternalInterfaceValue[]): unknown {
        if (typeof functionName !== "string" || !FUNCTION_NAME.test(functionName))
            throw new TypeError("ExternalInterface.call requires a canonical non-empty function name");
        if (externalHost === null)
            throw new UnsupportedFlashFeatureError("flash.external.ExternalInterface.call",
                "the application bootstrap has not installed a native external host");
        const snapshot = Object.freeze(arguments_.map((value, index) => snapshotValue(value, index)));
        return externalHost.call(functionName, snapshot);
    }
}

function snapshotValue(value: unknown, index: number): ExternalInterfaceValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    throw new TypeError(`ExternalInterface.call argument ${index} must be a finite primitive host value`);
}

function requireDataMethod(owner: object, name: string, label: string): Function {
    let cursor: object | null = owner;
    while (cursor !== null) {
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
