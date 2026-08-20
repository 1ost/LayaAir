import { Browser } from "../../laya/utils/Browser";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { ByteArray } from "../utils/ByteArray";
import { FlashURLRequestSnapshot } from "./URLRequest";
import { isFlashURLVariables, URLVariables } from "./URLVariables";

export interface FlashHTTPRequest {
    readonly url: string;
    readonly method: string;
    readonly headers: readonly Readonly<{ name: string; value: string }>[];
    readonly body: string | ArrayBuffer | null;
    readonly keepalive: boolean;
}

export interface FlashHTTPResponse {
    readonly url: string;
    readonly status: number;
    readonly statusText: string;
    readonly redirected: boolean;
    readonly contentLength: number | null;
    readonly body: ArrayBuffer;
}

export type FlashHTTPProgressObserver = (bytesLoaded: number, bytesTotal: number) => void;
export type FlashHTTPStatusObserver = (status: number, redirected: boolean) => void;

const HTTP_HOST_VALUES = new WeakSet<object>();
let installedHTTPHost: FlashHTTPHost | null = null;

/** Injected HTTP capability for browsers or an application host. */
export abstract class FlashHTTPHost {
    protected constructor() { HTTP_HOST_VALUES.add(this); }

    abstract request(
        request: FlashHTTPRequest,
        signal: AbortSignal,
        status: FlashHTTPStatusObserver,
        progress: FlashHTTPProgressObserver
    ): Promise<FlashHTTPResponse>;
}

/** Installs one process-wide host before any URLLoader or sendToURL use. */
export function installFlashHTTPHost(host: FlashHTTPHost): void {
    if (!isFlashHTTPHost(host)) throw new TypeError("Flash HTTP host must be a nominal Laya capability");
    if (installedHTTPHost !== null) throw new Error("Flash HTTP host is already installed");
    installedHTTPHost = host;
}

/** @internal */
export function isFlashHTTPHost(value: unknown): value is FlashHTTPHost {
    return typeof value === "object" && value !== null && HTTP_HOST_VALUES.has(value);
}

class BrowserFetchHTTPHost extends FlashHTTPHost {
    constructor() { super(); }

    override async request(request: FlashHTTPRequest, signal: AbortSignal,
        status: FlashHTTPStatusObserver, progress: FlashHTTPProgressObserver): Promise<FlashHTTPResponse> {
        const browser = Browser.window as (Window & typeof globalThis & { fetch?: typeof fetch }) | null;
        if (!browser || typeof browser.fetch !== "function")
            throw new UnsupportedFlashFeatureError("flash.net HTTP", "the host does not provide Fetch");

        const headers = new Headers();
        for (const header of request.headers) headers.append(header.name, header.value);
        const response = await Reflect.apply(browser.fetch, browser, [request.url, {
            method: request.method,
            headers,
            body: request.body,
            signal,
            keepalive: request.keepalive,
            redirect: "follow",
            credentials: "same-origin",
        } satisfies RequestInit]) as Response;
        status(response.status, response.redirected);

        const rawLength = response.headers.get("content-length");
        const parsedLength = rawLength === null ? NaN : Number(rawLength);
        const contentLength = Number.isSafeInteger(parsedLength) && parsedLength >= 0 ? parsedLength : null;
        const reader = response.body?.getReader();
        let body: ArrayBuffer;
        if (!reader) {
            body = await response.arrayBuffer();
            progress(body.byteLength, contentLength ?? body.byteLength);
        } else {
            const chunks: Uint8Array[] = [];
            let loaded = 0;
            for (;;) {
                const result = await reader.read();
                if (result.done) break;
                const chunk = result.value.slice();
                chunks.push(chunk);
                loaded += chunk.byteLength;
                progress(loaded, contentLength ?? 0);
            }
            const joined = new Uint8Array(loaded);
            let offset = 0;
            for (const chunk of chunks) {
                joined.set(chunk, offset);
                offset += chunk.byteLength;
            }
            body = joined.buffer;
            if (loaded === 0) progress(0, contentLength ?? 0);
        }
        return Object.freeze({
            url: response.url || request.url,
            status: response.status,
            statusText: response.statusText,
            redirected: response.redirected,
            contentLength,
            body,
        });
    }
}

let browserHTTPHost: BrowserFetchHTTPHost | null = null;

/** @internal */
export function requireFlashHTTPHost(): FlashHTTPHost {
    if (installedHTTPHost !== null) return installedHTTPHost;
    const browser = Browser.window as (Window & typeof globalThis & { fetch?: typeof fetch }) | null;
    if (!browser || typeof browser.fetch !== "function")
        throw new UnsupportedFlashFeatureError("flash.net HTTP", "the host does not provide Fetch");
    return browserHTTPHost ??= new BrowserFetchHTTPHost();
}

function copyArrayBuffer(value: ArrayBufferLike | ArrayBufferView): ArrayBuffer {
    const bytes = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);
    return bytes.slice().buffer;
}

function appendQuery(url: string, query: string): string {
    if (query.length === 0) return url;
    const hashIndex = url.indexOf("#");
    const head = hashIndex < 0 ? url : url.slice(0, hashIndex);
    const tail = hashIndex < 0 ? "" : url.slice(hashIndex);
    return `${head}${head.includes("?") ? "&" : "?"}${query}${tail}`;
}

/** @internal Converts one canonical URLRequest snapshot without generic coercion. */
export function prepareFlashHTTPRequest(snapshot: FlashURLRequestSnapshot, keepalive = false): FlashHTTPRequest {
    let url = snapshot.url;
    let body: string | ArrayBuffer | null = null;
    let inferredContentType: string | null = null;
    const data = snapshot.data;
    if (data !== null && data !== undefined) {
        if (isFlashURLVariables(data)) {
            body = URLVariables.prototype.toString.call(data);
            inferredContentType = "application/x-www-form-urlencoded";
        } else if (typeof data === "string") {
            body = data;
            inferredContentType = "application/x-www-form-urlencoded";
        } else if (data instanceof ByteArray) {
            body = data.buffer;
            inferredContentType = "application/octet-stream";
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            body = copyArrayBuffer(data);
            inferredContentType = "application/octet-stream";
        } else {
            throw new UnsupportedFlashFeatureError(
                "flash.net.URLRequest.data",
                "only URLVariables, strings, ByteArray and binary views are admitted"
            );
        }
    }

    if (snapshot.method === "GET") {
        if (body !== null) {
            if (typeof body !== "string")
                throw new UnsupportedFlashFeatureError("flash.net URLRequest GET", "binary GET payloads are not admitted");
            url = appendQuery(url, body);
            body = null;
        }
    } else if (snapshot.method === "HEAD" && body !== null) {
        throw new UnsupportedFlashFeatureError("flash.net URLRequest HEAD", "HEAD payloads are not admitted");
    }

    const headers = snapshot.requestHeaders.map(header => ({ name: header.name, value: header.value }));
    if (body !== null && !headers.some(header => header.name.toLowerCase() === "content-type")) {
        headers.push({ name: "Content-Type", value: snapshot.contentType ?? inferredContentType ?? "application/octet-stream" });
    } else if (snapshot.contentType !== null && !headers.some(header => header.name.toLowerCase() === "content-type")) {
        headers.push({ name: "Content-Type", value: snapshot.contentType });
    }
    const ownedHeaders: Readonly<{ name: string; value: string }>[] = headers.map(header => Object.freeze(header));
    return Object.freeze({
        url,
        method: snapshot.method,
        headers: Object.freeze(ownedHeaders),
        body,
        keepalive,
    });
}
