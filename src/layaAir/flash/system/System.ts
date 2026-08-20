const SYSTEM_HOSTS = new WeakSet<object>();
let systemHost: NativeSystemHost | null = null;

interface BrowserHeapMemory {
    readonly usedJSHeapSize?: number;
}

function usedHeapSize(): number {
    const memory = typeof globalThis.performance === "undefined"
        ? undefined
        : (globalThis.performance as Performance & { readonly memory?: BrowserHeapMemory }).memory;
    const value = Number(memory?.usedJSHeapSize);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Nominal application bootstrap capability for synchronous clipboard handoff. */
export abstract class NativeSystemHost {
    protected constructor() { SYSTEM_HOSTS.add(this); }

    /** Accepts text into the embedding host's clipboard workflow. */
    abstract setClipboard(text: string): void;
}

/** Installs the single application-owned native System host. */
export function installNativeSystemHost(host: NativeSystemHost): void {
    if (typeof host !== "object" || host === null || !SYSTEM_HOSTS.has(host))
        throw new TypeError("Native System host must be a nominal Laya capability");
    if (systemHost !== null) throw new Error("Native System host is already installed");
    systemHost = host;
}

/**
 * Source-shaped subset backed only by native browser/host capabilities used by
 * Bleach. VM collection, process control and XML disposal are intentionally
 * absent.
 */
export class System {
    private constructor() {}

    static get totalMemory(): number { return usedHeapSize(); }
    static get totalMemoryNumber(): number { return usedHeapSize(); }

    static setClipboard(value: string): void {
        if (systemHost === null)
            throw missingHost("flash.system.System.setClipboard",
                "the application bootstrap has not installed a native clipboard host");
        systemHost.setClipboard(value == null ? "" : String(value));
    }
}

function missingHost(feature: string, detail: string): Error {
    const error = new Error(`${feature}: ${detail}`);
    error.name = "UnsupportedFlashFeatureError";
    Object.defineProperty(error, "feature", { value: feature, enumerable: true });
    return error;
}
