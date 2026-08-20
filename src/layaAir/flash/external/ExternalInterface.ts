const EXTERNAL_HOSTS = new WeakSet<object>();
let externalHost: NativeExternalInterfaceHost | null = null;

/** Nominal embedding boundary for the legacy string-named host protocol. */
export abstract class NativeExternalInterfaceHost {
    protected constructor() { EXTERNAL_HOSTS.add(this); }

    abstract call(functionName: string, arguments_: readonly unknown[]): unknown;
}

/** Installs the single application bootstrap host. It cannot be replaced. */
export function installNativeExternalInterfaceHost(host: NativeExternalInterfaceHost): void {
    if (typeof host !== "object" || host === null || !EXTERNAL_HOSTS.has(host))
        throw new TypeError("Native ExternalInterface host must be a nominal Laya capability");
    if (externalHost !== null) throw new Error("Native ExternalInterface host is already installed");
    externalHost = host;
}

/**
 * Closed call-only bridge for Bleach's retained host protocol. It never walks
 * global object paths or publishes callbacks onto globalThis.
 */
export class ExternalInterface {
    private constructor() {}

    static get available(): boolean { return externalHost !== null; }

    static call(functionName: string, ...arguments_: unknown[]): unknown {
        if (typeof functionName !== "string" || functionName.trim() !== functionName || functionName.length === 0)
            throw new TypeError("ExternalInterface.call requires a canonical non-empty function name");
        if (/[^A-Za-z0-9_.:$-]/.test(functionName))
            throw new TypeError("ExternalInterface.call function name contains unsupported characters");
        if (externalHost === null)
            throw missingHost("flash.external.ExternalInterface.call",
                "the application bootstrap has not installed a native external host");
        return externalHost.call(functionName, Object.freeze([...arguments_]));
    }
}

function missingHost(feature: string, detail: string): Error {
    const error = new Error(`${feature}: ${detail}`);
    error.name = "UnsupportedFlashFeatureError";
    Object.defineProperty(error, "feature", { value: feature, enumerable: true });
    return error;
}
