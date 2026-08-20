import { Browser } from "../../laya/utils/Browser";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

export interface URLRequestHeader {
    name: string;
    value: string;
}

/** Immutable transport descriptor captured without invoking caller accessors. */
export interface FlashURLRequestSnapshot {
    readonly url: string;
    readonly method: string;
    readonly data: unknown;
    readonly contentType: string | null;
    readonly requestHeaders: readonly Readonly<URLRequestHeader>[];
}

const URL_REQUEST_VALUES = new WeakSet<object>();

interface URLRequestState {
    url: string | null;
    method: string;
    data: unknown;
    contentType: string | null;
    requestHeaders: URLRequestHeader[];
    headersAssigned: boolean;
    headersMutated: boolean;
}

const URL_REQUEST_STATE = new WeakMap<object, URLRequestState>();

function createTrackedRequestHeaders(state: URLRequestState): URLRequestHeader[] {
    const owned: URLRequestHeader[] = [];
    const mutated = (): void => { state.headersMutated = true; };
    return new Proxy(owned, {
        set(target, property, value): boolean {
            mutated();
            return Reflect.set(target, property, value, target);
        },
        deleteProperty(target, property): boolean {
            mutated();
            return Reflect.deleteProperty(target, property);
        },
        defineProperty(target, property, descriptor): boolean {
            mutated();
            return Reflect.defineProperty(target, property, descriptor);
        },
        setPrototypeOf(target, prototype): boolean {
            mutated();
            return Reflect.setPrototypeOf(target, prototype);
        },
        preventExtensions(target): boolean {
            mutated();
            return Reflect.preventExtensions(target);
        },
    });
}

/** @internal Read-only nominal proof for canonical Flash URL request descriptors. */
export function isFlashURLRequest(value: unknown): value is URLRequest {
    return typeof value === "object" && value !== null
        && URL_REQUEST_VALUES.has(value) && URL_REQUEST_STATE.has(value);
}

/**
 * @internal Captures the only URLRequest shape admitted by the native-content
 * Loader bridge without invoking overridable accessors on the request object.
 */
export function snapshotNativeLoaderRequest(request: URLRequest): string {
    const state = typeof request === "object" && request !== null
        ? URL_REQUEST_STATE.get(request)
        : undefined;
    if (!state || !URL_REQUEST_VALUES.has(request))
        throw new TypeError("Loader.load requires a canonical URLRequest");
    if (state.method !== "GET" || state.data !== null || state.contentType !== null
        || state.headersAssigned || state.headersMutated || state.requestHeaders.length !== 0)
        throw new UnsupportedFlashFeatureError(
            "flash.display.Loader.load",
            "native content accepts only GET requests without data, content type or headers"
        );
    if (state.url === null || state.url.trim().length === 0 || state.url !== state.url.trim())
        throw new TypeError("Loader.load requires a non-empty canonical URL");
    if (/^[\u0000-\u001f\u007f]|[\u0000-\u001f\u007f]/.test(state.url))
        throw new TypeError("Loader.load URL contains control characters");
    if (/^(?:data|javascript|blob):/i.test(state.url))
        throw new UnsupportedFlashFeatureError(
            "flash.display.Loader.load",
            "data, javascript and blob sources are outside the native-content bridge"
        );
    return state.url;
}

/**
 * Captures a canonical request for the browser HTTP bridge. The returned
 * descriptor owns its header values, so later caller mutation cannot alter an
 * in-flight request.
 */
export function snapshotFlashURLRequest(request: URLRequest): FlashURLRequestSnapshot {
    const state = typeof request === "object" && request !== null
        ? URL_REQUEST_STATE.get(request)
        : undefined;
    if (!state || !URL_REQUEST_VALUES.has(request))
        throw new TypeError("Network operations require a canonical URLRequest");
    if (state.url === null || state.url.length === 0 || state.url.trim() !== state.url)
        throw new TypeError("URLRequest requires a non-empty canonical URL");
    if (/[\u0000-\u001f\u007f]/.test(state.url))
        throw new TypeError("URLRequest URL contains control characters");
    const explicitScheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(state.url);
    if (explicitScheme !== null && !/^https?$/i.test(explicitScheme[1]))
        throw new UnsupportedFlashFeatureError(
            "flash.net.URLRequest transport",
            "absolute request URLs must use HTTP or HTTPS"
        );
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(state.method))
        throw new TypeError("URLRequest.method must be an HTTP token");

    const requestHeaders = state.requestHeaders.map((header, index) => {
        if (typeof header !== "object" || header === null)
            throw new TypeError(`URLRequest.requestHeaders[${index}] must contain string name and value`);
        const nameDescriptor = Object.getOwnPropertyDescriptor(header, "name");
        const valueDescriptor = Object.getOwnPropertyDescriptor(header, "value");
        if (!nameDescriptor || !("value" in nameDescriptor) || typeof nameDescriptor.value !== "string"
            || !valueDescriptor || !("value" in valueDescriptor) || typeof valueDescriptor.value !== "string")
            throw new TypeError(`URLRequest.requestHeaders[${index}] must use own data properties`);
        const name = nameDescriptor.value;
        const value = valueDescriptor.value;
        if (name.length === 0 || /[\u0000-\u0020():<>@,;\\\[\]?={}\u007f]/.test(name))
            throw new TypeError(`URLRequest.requestHeaders[${index}].name is invalid`);
        if (/[\r\n]/.test(value))
            throw new TypeError(`URLRequest.requestHeaders[${index}].value contains a newline`);
        return Object.freeze({ name, value });
    });
    return Object.freeze({
        url: state.url,
        method: state.method.toUpperCase(),
        data: state.data,
        contentType: state.contentType,
        requestHeaders: Object.freeze(requestHeaders),
    });
}

/**
 * Source-shaped request descriptor. Transport, navigation and payload encoding
 * belong to their later browser adapters; this object never opens a socket.
 */
export class URLRequest {
    constructor(url: string | null = null) {
        const state: URLRequestState = {
            url: URLRequest.validateUrl(url),
            method: "GET",
            data: null,
            contentType: null,
            requestHeaders: [],
            headersAssigned: false,
            headersMutated: false,
        };
        state.requestHeaders = createTrackedRequestHeaders(state);
        URL_REQUEST_STATE.set(this, state);
        URL_REQUEST_VALUES.add(this);
    }

    get url(): string | null { return URLRequest.state(this).url; }
    set url(value: string | null) { URLRequest.state(this).url = URLRequest.validateUrl(value); }

    get method(): string { return URLRequest.state(this).method; }
    set method(value: string) {
        if (typeof value !== "string") throw new TypeError("URLRequest.method must be a string");
        URLRequest.state(this).method = value;
    }

    get data(): unknown { return URLRequest.state(this).data; }
    set data(value: unknown) { URLRequest.state(this).data = value; }

    get contentType(): string | null { return URLRequest.state(this).contentType; }
    set contentType(value: string | null) {
        if (value !== null && typeof value !== "string")
            throw new TypeError("URLRequest.contentType must be a string or null");
        URLRequest.state(this).contentType = value;
    }

    get requestHeaders(): URLRequestHeader[] { return URLRequest.state(this).requestHeaders; }
    set requestHeaders(value: URLRequestHeader[]) {
        if (!Array.isArray(value)) throw new TypeError("URLRequest.requestHeaders must be an array");
        const state = URLRequest.state(this);
        state.requestHeaders = value;
        state.headersAssigned = true;
    }

    private static validateUrl(value: string | null): string | null {
        if (value !== null && typeof value !== "string")
            throw new TypeError("URLRequest.url must be a string or null");
        return value;
    }

    private static state(request: URLRequest): URLRequestState {
        const state = URL_REQUEST_STATE.get(request);
        if (!state) throw new TypeError("URLRequest receiver is not canonical");
        return state;
    }
}

/**
 * Closed browser-navigation seam for the two retained Flash GET/_blank call
 * sites. Payloads, headers, other targets and non-web schemes are rejected;
 * this function is not a general URLLoader or transport implementation.
 */
export function navigateToURL(request: URLRequest, target: string): void {
    const state = typeof request === "object" && request !== null
        ? URL_REQUEST_STATE.get(request)
        : undefined;
    if (!state || !URL_REQUEST_VALUES.has(request))
        throw new TypeError("navigateToURL requires a canonical URLRequest");
    if (target !== "_blank")
        throw new UnsupportedFlashFeatureError("flash.net.navigateToURL", "only the retained _blank target is admitted");
    if (state.method !== "GET" || state.data !== null || state.contentType !== null
        || state.headersAssigned || state.headersMutated || state.requestHeaders.length !== 0)
        throw new UnsupportedFlashFeatureError("flash.net.navigateToURL", "only GET requests without data, content type or headers are admitted");
    if (state.url === null || state.url.trim().length === 0)
        throw new TypeError("navigateToURL requires a non-empty URL");

    let provisional: URL;
    try {
        provisional = new URL(state.url, "https://flash-navigation.invalid/");
    } catch {
        throw new TypeError("navigateToURL requires a valid absolute or browser-relative URL");
    }
    if (provisional.protocol !== "http:" && provisional.protocol !== "https:")
        throw new UnsupportedFlashFeatureError("flash.net.navigateToURL", "only HTTP(S) navigation is admitted");

    const browser = Browser.window;
    if (Browser.isDomSupported !== true || browser === null || typeof browser !== "object")
        throw new UnsupportedFlashFeatureError("flash.net.navigateToURL", "browser navigation is unavailable");

    let resolved: URL;
    try {
        const location = browser.location;
        const href = location?.href;
        const base = typeof href === "string" ? href : undefined;
        resolved = new URL(state.url, base);
    } catch {
        throw new TypeError("navigateToURL requires a valid absolute or browser-relative URL");
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
        throw new UnsupportedFlashFeatureError("flash.net.navigateToURL", "only HTTP(S) navigation is admitted");

    const open = browser.open;
    if (typeof open !== "function")
        throw new UnsupportedFlashFeatureError("flash.net.navigateToURL", "browser navigation is unavailable");

    // Flash did not expose the opened page as a scriptable child. `noopener`
    // preserves that isolation without suppressing the observable HTTP Referer.
    Reflect.apply(open, browser, [state.url, "_blank", "noopener"]);
}
