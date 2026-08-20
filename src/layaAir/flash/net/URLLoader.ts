import { Event } from "../events/Event";
import { EventDispatcher } from "../events/EventDispatcher";
import { HTTPStatusEvent } from "../events/HTTPStatusEvent";
import { IOErrorEvent } from "../events/IOErrorEvent";
import { ProgressEvent } from "../events/ProgressEvent";
import { ByteArray } from "../utils/ByteArray";
import { prepareFlashHTTPRequest, requireFlashHTTPHost } from "./FlashHTTPTransport";
import { URLLoaderDataFormat } from "./URLLoaderDataFormat";
import { snapshotFlashURLRequest, URLRequest } from "./URLRequest";
import { URLVariables } from "./URLVariables";

const URL_LOADER_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical URLLoader values. */
export function isFlashURLLoader(value: unknown): value is URLLoader {
    return typeof value === "object" && value !== null && URL_LOADER_VALUES.has(value);
}

function errorText(value: unknown): string {
    if (value instanceof Error) return value.message;
    return typeof value === "string" ? value : "Network request failed";
}

function snapshotHTTPResponse(value: unknown): Readonly<{
    url: string;
    status: number;
    statusText: string;
    redirected: boolean;
    contentLength: number | null;
    body: ArrayBuffer;
}> {
    if (typeof value !== "object" || value === null)
        throw new TypeError("HTTP host returned a malformed response");
    const read = (name: string): unknown => {
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor || !("value" in descriptor))
            throw new TypeError(`HTTP host response ${name} must be an own data property`);
        return descriptor.value;
    };
    const url = read("url");
    const status = read("status");
    const statusText = read("statusText");
    const redirected = read("redirected");
    const contentLength = read("contentLength");
    const body = read("body");
    if (typeof url !== "string" || !Number.isInteger(status) || (status as number) < 0
        || (status as number) > 999 || typeof statusText !== "string" || typeof redirected !== "boolean"
        || (contentLength !== null && (!Number.isSafeInteger(contentLength) || (contentLength as number) < 0))
        || !(body instanceof ArrayBuffer))
        throw new TypeError("HTTP host returned a malformed response");
    return Object.freeze({
        url, status: status as number, statusText, redirected,
        contentLength: contentLength as number | null, body,
    });
}

/** Source-used asynchronous HTTP loader backed by the installed browser/host capability. */
export class URLLoader extends EventDispatcher {
    private _data: unknown = null;
    private _dataFormat = URLLoaderDataFormat.TEXT;
    private _bytesLoaded = 0;
    private _bytesTotal = 0;
    private _active = false;
    private _generation = 0;
    private _abortController: AbortController | null = null;

    constructor(request: URLRequest | null = null) {
        super();
        URL_LOADER_VALUES.add(this);
        if (request !== null) this.load(request);
    }

    get data(): unknown { return this._data; }
    get dataFormat(): string { return this._dataFormat; }
    set dataFormat(value: string) {
        if (value !== URLLoaderDataFormat.BINARY && value !== URLLoaderDataFormat.TEXT
            && value !== URLLoaderDataFormat.VARIABLES)
            throw new RangeError(`Unsupported URLLoader.dataFormat: ${String(value)}`);
        this._dataFormat = value;
    }
    get bytesLoaded(): number { return this._bytesLoaded; }
    get bytesTotal(): number { return this._bytesTotal; }

    load(request: URLRequest): void {
        if (this._active) throw new Error("URLLoader already has an active request");
        const prepared = prepareFlashHTTPRequest(snapshotFlashURLRequest(request));
        const host = requireFlashHTTPHost();
        const generation = ++this._generation;
        const abortController = new AbortController();
        this._abortController = abortController;
        this._active = true;
        this._data = null;
        this._bytesLoaded = 0;
        this._bytesTotal = 0;

        // Transport start is deferred so listeners added immediately after
        // load() observe every producer-owned lifecycle event.
        queueMicrotask(() => {
            if (!this.isCurrent(generation, abortController)) return;
            let statusPublished = false;
            let publishedStatus = 0;
            let publishedRedirected = false;
            const publishStatus = (status: number, redirected: boolean): void => {
                if (!this.isCurrent(generation, abortController)) return;
                if (statusPublished)
                    this.rejectProducerViolation(generation, abortController,
                        "HTTP host published status more than once");
                if (!Number.isInteger(status) || status < 0 || status > 999 || typeof redirected !== "boolean")
                    this.rejectProducerViolation(generation, abortController, "HTTP host status is invalid");
                statusPublished = true;
                publishedStatus = status;
                publishedRedirected = redirected;
                this.dispatchProducerEvent(generation, abortController,
                    new HTTPStatusEvent(HTTPStatusEvent.HTTP_STATUS, false, false, status, redirected));
            };
            const publishProgress = (loaded: number, total: number): void => {
                if (!this.isCurrent(generation, abortController)) return;
                if (!statusPublished)
                    this.rejectProducerViolation(generation, abortController,
                        "HTTP host published progress before status");
                if (!Number.isSafeInteger(loaded) || loaded < this._bytesLoaded
                    || !Number.isSafeInteger(total) || total < 0)
                    this.rejectProducerViolation(generation, abortController,
                        "HTTP host progress must be monotonic nonnegative safe integers");
                this._bytesLoaded = loaded;
                this._bytesTotal = total;
                this.dispatchProducerEvent(generation, abortController,
                    new ProgressEvent(ProgressEvent.PROGRESS, false, false, loaded, total));
            };
            let requestPromise: Promise<unknown>;
            try {
                requestPromise = host.request(prepared, abortController.signal, publishStatus, publishProgress);
            } catch (error) {
                if (!this.isCurrent(generation, abortController)) throw error;
                this.finishError(generation, abortController, errorText(error));
                return;
            }
            Promise.resolve(requestPromise).then(responseValue => {
                if (!this.isCurrent(generation, abortController)) return;
                const response = snapshotHTTPResponse(responseValue);
                if (!statusPublished) {
                    statusPublished = true;
                    publishedStatus = response.status;
                    publishedRedirected = response.redirected;
                    this.dispatchProducerEvent(generation, abortController,
                        new HTTPStatusEvent(HTTPStatusEvent.HTTP_STATUS, false, false,
                            response.status, response.redirected));
                    if (!this.isCurrent(generation, abortController)) return;
                } else if (publishedStatus !== response.status || publishedRedirected !== response.redirected) {
                    this.finishError(generation, abortController, "HTTP host response does not match its published status");
                    return;
                }
                if (response.status < 200 || response.status >= 400) {
                    this.finishError(generation, abortController,
                        `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
                    return;
                }
                this._bytesLoaded = response.body.byteLength;
                this._bytesTotal = response.contentLength ?? response.body.byteLength;
                try {
                    if (this._dataFormat === URLLoaderDataFormat.BINARY)
                        this._data = new ByteArray(response.body);
                    else {
                        const text = new TextDecoder("utf-8", { fatal: false }).decode(response.body);
                        this._data = this._dataFormat === URLLoaderDataFormat.VARIABLES
                            ? new URLVariables(text) : text;
                    }
                } catch (error) {
                    this.finishError(generation, abortController, errorText(error));
                    return;
                }
                this._active = false;
                this._abortController = null;
                this.dispatchEvent(new Event(Event.COMPLETE));
            }).catch(error => {
                if (!this.isCurrent(generation, abortController) || abortController.signal.aborted) return;
                this.finishError(generation, abortController, errorText(error));
            });
        });
    }

    close(): void {
        if (!this._active || this._abortController === null)
            throw new Error("URLLoader has no active request");
        const controller = this._abortController;
        this._active = false;
        this._abortController = null;
        ++this._generation;
        controller.abort();
    }

    private isCurrent(generation: number, controller: AbortController): boolean {
        return this._active && this._generation === generation && this._abortController === controller;
    }

    private finishError(generation: number, controller: AbortController, text: string): void {
        if (!this.isCurrent(generation, controller)) return;
        this._active = false;
        this._abortController = null;
        this.dispatchEvent(new IOErrorEvent(IOErrorEvent.IO_ERROR, false, false, text));
    }

    private dispatchProducerEvent(generation: number, controller: AbortController, event: Event): void {
        try {
            this.dispatchEvent(event);
        } catch (error) {
            if (this.isCurrent(generation, controller)) {
                this._active = false;
                this._abortController = null;
                ++this._generation;
                controller.abort();
            }
            throw error;
        }
    }

    private rejectProducerViolation(generation: number, controller: AbortController, message: string): never {
        if (this.isCurrent(generation, controller)) {
            this._active = false;
            this._abortController = null;
            ++this._generation;
            controller.abort();
        }
        throw new TypeError(message);
    }
}
