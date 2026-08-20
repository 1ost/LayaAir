import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

const SYSTEM_HOSTS = new WeakSet<object>();
const UINT_MAX = 0xffffffff;
let systemHost: SystemHostRecord | null = null;
let installingSystemHost = false;

interface SystemHostRecord {
    readonly owner: NativeSystemHost;
    readonly setClipboard: (text: string) => void;
}

interface BrowserHeapMemory {
    readonly usedJSHeapSize?: number;
}

function usedHeapSize(): number {
    const memory = typeof globalThis.performance === "undefined"
        ? undefined
        : (globalThis.performance as Performance & { readonly memory?: BrowserHeapMemory }).memory;
    const value = Number(memory?.usedJSHeapSize);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

/** Nominal application bootstrap capability for synchronous clipboard handoff. */
export abstract class NativeSystemHost {
    protected constructor() {
        const prototype = new.target?.prototype;
        const method = prototype && Object.getOwnPropertyDescriptor(prototype, "setClipboard");
        if (new.target === NativeSystemHost
            || Object.getPrototypeOf(prototype) !== NativeSystemHost.prototype
            || typeof method?.value !== "function")
            throw new TypeError("NativeSystemHost requires a direct concrete data-method subclass");
        SYSTEM_HOSTS.add(this);
    }

    /** Accepts text into the embedding host's clipboard workflow. */
    abstract setClipboard(text: string): void;
}

/** Installs the single application-owned native System host. */
export function installNativeSystemHost(host: NativeSystemHost): void {
    if (typeof host !== "object" || host === null || !SYSTEM_HOSTS.has(host))
        throw new TypeError("Native System host must be a nominal Laya capability");
    if (systemHost !== null || installingSystemHost)
        throw new Error("Native System host is already installed or installing");
    installingSystemHost = true;
    try {
        const setClipboard = requireDataMethod(host, "setClipboard", "Native System host");
        systemHost = Object.freeze({
            owner: host,
            setClipboard: (text: string) => Reflect.apply(setClipboard, host, [text]),
        });
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
        if (systemHost === null)
            throw new UnsupportedFlashFeatureError("flash.system.System.setClipboard",
                "the application bootstrap has not installed a native clipboard host");
        systemHost.setClipboard(value == null ? "" : String(value));
    }
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
