import { Browser } from "../../laya/utils/Browser";
import { EventDispatcher } from "../events/EventDispatcher";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { ByteArray } from "../utils/ByteArray";

export interface FlashFileDownload {
    readonly suggestedName: string;
    readonly data: string | Uint8Array;
    readonly mimeType: string;
}

const FILE_HOST_VALUES = new WeakSet<object>();
const FILE_REFERENCE_VALUES = new WeakSet<object>();
let installedFileHost: FlashFileDownloadHost | null = null;

/** Browser/native host capability for an unobservable save handoff. */
export abstract class FlashFileDownloadHost {
    protected constructor() { FILE_HOST_VALUES.add(this); }
    abstract save(download: FlashFileDownload): void;
}

export function installFlashFileDownloadHost(host: FlashFileDownloadHost): void {
    if (typeof host !== "object" || host === null || !FILE_HOST_VALUES.has(host))
        throw new TypeError("Flash file host must be a nominal Laya capability");
    if (installedFileHost !== null) throw new Error("Flash file host is already installed");
    installedFileHost = host;
}

class BrowserFileDownloadHost extends FlashFileDownloadHost {
    constructor() { super(); }
    override save(download: FlashFileDownload): void {
        const browser = Browser.window as (Window & typeof globalThis) | null;
        const document = browser?.document;
        const URLClass = browser?.URL;
        if (!document || typeof document.createElement !== "function"
            || !URLClass || typeof URLClass.createObjectURL !== "function")
            throw new UnsupportedFlashFeatureError("flash.net.FileReference.save", "a browser document download host is unavailable");
        const blob = new Blob([download.data], { type: download.mimeType });
        const objectURL = URLClass.createObjectURL(blob);
        try {
            const anchor = document.createElement("a");
            anchor.href = objectURL;
            anchor.download = download.suggestedName;
            anchor.rel = "noopener";
            anchor.style.display = "none";
            document.body?.appendChild(anchor);
            anchor.click();
            anchor.remove();
        } finally {
            browser.setTimeout(() => URLClass.revokeObjectURL(objectURL), 0);
        }
    }
}

let browserFileHost: BrowserFileDownloadHost | null = null;

function requireFileHost(): FlashFileDownloadHost {
    if (installedFileHost !== null) return installedFileHost;
    const browser = Browser.window as (Window & typeof globalThis) | null;
    if (!browser?.document)
        throw new UnsupportedFlashFeatureError("flash.net.FileReference.save", "a browser document download host is unavailable");
    return browserFileHost ??= new BrowserFileDownloadHost();
}

/** @internal */
export function isFlashFileReference(value: unknown): value is FileReference {
    return typeof value === "object" && value !== null && FILE_REFERENCE_VALUES.has(value);
}

/** Source-used browser download boundary; file selection remains an explicit host HOLD. */
export class FileReference extends EventDispatcher {
    private _data: ByteArray | null = null;

    constructor() {
        super();
        FILE_REFERENCE_VALUES.add(this);
    }

    get data(): ByteArray {
        if (this._data === null)
            throw new Error("FileReference.data is unavailable until a selected file has completed load");
        return this._data;
    }

    save(data: string | ByteArray | ArrayBuffer | ArrayBufferView, defaultFileName = ""): void {
        if (typeof defaultFileName !== "string" || defaultFileName.length === 0
            || /[\u0000-\u001f\u007f\\/:*?\"<>|]/.test(defaultFileName))
            throw new TypeError("FileReference.save requires a safe non-empty file name");
        let owned: string | Uint8Array;
        let mimeType: string;
        if (typeof data === "string") {
            owned = data;
            mimeType = "text/plain;charset=UTF-8";
        } else if (data instanceof ByteArray) {
            owned = new Uint8Array(data.buffer);
            mimeType = "application/octet-stream";
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            const bytes = ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data);
            owned = bytes.slice();
            mimeType = "application/octet-stream";
        } else {
            throw new TypeError("FileReference.save data must be text or bytes");
        }
        requireFileHost().save(Object.freeze({ suggestedName: defaultFileName, data: owned, mimeType }));
    }

    browse(_typeFilter: readonly unknown[] | null = null): boolean {
        throw new UnsupportedFlashFeatureError(
            "flash.net.FileReference.browse",
            "trusted browser file selection requires an application-owned user-gesture host"
        );
    }

    load(): void {
        throw new UnsupportedFlashFeatureError(
            "flash.net.FileReference.load",
            "no authenticated selected-file host is installed"
        );
    }

    cancel(): void {
        throw new UnsupportedFlashFeatureError(
            "flash.net.FileReference.cancel",
            "browser download completion and cancellation are not observable"
        );
    }
}
