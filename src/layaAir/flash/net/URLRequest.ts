import { Browser } from "../../laya/utils/Browser";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

export interface URLRequestHeader {
    name: string;
    value: string;
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
