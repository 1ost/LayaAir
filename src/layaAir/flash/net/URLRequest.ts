export interface URLRequestHeader {
    name: string;
    value: string;
}

const URL_REQUEST_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash URL request descriptors. */
export function isFlashURLRequest(value: unknown): value is URLRequest {
    return typeof value === "object" && value !== null && URL_REQUEST_VALUES.has(value);
}

/**
 * Source-shaped request descriptor. Transport, navigation and payload encoding
 * belong to their later browser adapters; this object never opens a socket.
 */
export class URLRequest {
    private _url: string | null;

    method = "GET";
    data: unknown = null;
    contentType: string | null = null;
    requestHeaders: URLRequestHeader[] = [];

    constructor(url: string | null = null) {
        this._url = URLRequest.validateUrl(url);
        URL_REQUEST_VALUES.add(this);
    }

    get url(): string | null { return this._url; }
    set url(value: string | null) { this._url = URLRequest.validateUrl(value); }

    private static validateUrl(value: string | null): string | null {
        if (value !== null && typeof value !== "string")
            throw new TypeError("URLRequest.url must be a string or null");
        return value;
    }
}
