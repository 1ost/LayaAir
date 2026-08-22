const QNAME_VALUES = new WeakSet<object>();

/** @internal Nominal guard shared by canonical Flash XML/reflection adapters. */
export function isFlashQName(value: unknown): value is QName {
    return typeof value === "object" && value !== null && QNAME_VALUES.has(value);
}

/**
 * Source-shaped ActionScript `QName` value.
 *
 * This models the public URI/local-name value contract used by native ports.
 * It does not provide AVM trait lookup or E4X property interception.
 */
export class QName {
    private readonly _uri: string | null;
    private readonly _localName: string;

    constructor();
    constructor(qname: unknown);
    constructor(uri: unknown, localName: unknown);
    constructor(uriOrQName: unknown = undefined, localName?: unknown) {
        QNAME_VALUES.add(this);

        if (arguments.length < 2) {
            if (isFlashQName(uriOrQName)) {
                this._uri = uriOrQName.uri;
                this._localName = uriOrQName.localName;
            } else {
                this._uri = "";
                this._localName = uriOrQName === undefined ? "" : String(uriOrQName);
            }
            return;
        }

        this._uri = uriOrQName === null ? null : String(uriOrQName);
        this._localName = isFlashQName(localName) ? localName.localName : String(localName);
    }

    get localName(): string { return this._localName; }
    get uri(): string | null { return this._uri; }

    toString(): string {
        if (this._uri === "") return this._localName;
        if (this._uri === null) return `*::${this._localName}`;
        return `${this._uri}::${this._localName}`;
    }

    valueOf(): QName { return this; }
}

Object.freeze(QName.prototype);
