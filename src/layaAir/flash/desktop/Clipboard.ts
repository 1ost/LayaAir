import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { ClipboardFormats } from "./ClipboardFormats";

export interface NativeClipboardHost {
    /** Synchronous publication executed within the caller's user gesture. */
    writeText(value: string): boolean;
}

export interface NativeClipboardHostLease {
    dispose(): void;
}

let installedHost: NativeClipboardHost | null = null;
let installedOwner: object | null = null;
let clipboardInstallGeneration = 0;

export function installNativeClipboardHost(host: NativeClipboardHost): NativeClipboardHostLease {
    if (!host) throw new TypeError("Native clipboard host requires writeText");
    const installGeneration = ++clipboardInstallGeneration;
    const writeText = host.writeText;
    if (clipboardInstallGeneration !== installGeneration)
        throw new Error("Native clipboard host installation was superseded reentrantly");
    if (typeof writeText !== "function")
        throw new TypeError("Native clipboard host requires writeText");
    const owner = Object.freeze({});
    installedHost = Object.freeze({
        writeText(value: string): boolean {
            return Reflect.apply(writeText, host, [value]) as boolean;
        },
    });
    installedOwner = owner;
    let disposed = false;
    return Object.freeze({
        dispose(): void {
            if (disposed) return;
            disposed = true;
            if (installedOwner === owner) {
                installedOwner = null;
                installedHost = null;
            }
        },
    });
}

/**
 * Browser clipboard host for Flash's synchronous setData contract. The
 * asynchronous Clipboard API cannot truthfully satisfy that contract, so this
 * adapter uses the synchronous copy-event path and fails outside a user
 * activation instead of reporting speculative success.
 */
export function createBrowserClipboardHost(document: Document = globalThis.document,
    navigator: Navigator = globalThis.navigator): NativeClipboardHost {
    if (!document || typeof document.execCommand !== "function")
        throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.setData", "synchronous browser copy is unavailable");
    return Object.freeze({
        writeText(value: string): boolean {
            const userActivation = (navigator as Navigator & {
                readonly userActivation?: { readonly isActive: boolean };
            }).userActivation;
            if (userActivation && !userActivation.isActive)
                throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.setData", "browser copy requires a user gesture");
            let produced = false;
            const publish = (event: Event): void => {
                const clipboardEvent = event as ClipboardEvent;
                if (!clipboardEvent.isTrusted || !clipboardEvent.clipboardData) return;
                clipboardEvent.clipboardData.setData("text/plain", value);
                clipboardEvent.preventDefault();
                produced = true;
            };
            document.addEventListener("copy", publish);
            let accepted = false;
            try { accepted = document.execCommand("copy"); }
            finally { document.removeEventListener("copy", publish); }
            return accepted && produced;
        },
    });
}

function resolveHost(): NativeClipboardHost {
    if (installedHost) return installedHost;
    if (typeof document !== "undefined" && typeof navigator !== "undefined")
        return createBrowserClipboardHost(document, navigator);
    throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.setData", "no native clipboard host is installed");
}

/** Narrow source-used clipboard surface. Reads and non-text formats remain explicit HOLDs. */
export class Clipboard {
    static readonly generalClipboard = new Clipboard();

    setData(format: string, data: unknown, _serializable = true): boolean {
        if (format !== ClipboardFormats.TEXT_FORMAT)
            throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.setData", `format '${String(format)}' is not admitted`);
        return resolveHost().writeText(data === null || data === undefined ? "" : String(data));
    }

    clear(): never {
        throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.clear", "synchronous browser clipboard clearing is not admitted");
    }

    clearData(_format: string): never {
        throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.clearData", "synchronous browser clipboard mutation is not admitted");
    }

    getData(_format: string, _transferMode = "originalPreferred"): never {
        throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.getData", "synchronous browser clipboard reads are not admitted");
    }

    hasFormat(_format: string): never {
        throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.hasFormat", "synchronous browser clipboard reads are not admitted");
    }

    get formats(): never {
        throw new UnsupportedFlashFeatureError("flash.desktop.Clipboard.formats", "synchronous browser clipboard reads are not admitted");
    }
}

Object.freeze(Clipboard);
