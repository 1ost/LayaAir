import { Browser } from "../../laya/utils/Browser";
import { EventDispatcher } from "../events/EventDispatcher";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

const LOCAL_CONNECTION_VALUES = new WeakSet<object>();
const CONNECTIONS = new Map<string, LocalConnection>();

function browserScope(): { origin: string; domain: string } {
    const location = (Browser.window as (Window & typeof globalThis) | null)?.location;
    const origin = typeof location?.origin === "string" && location.origin.length > 0
        ? location.origin : "opaque-browser-origin";
    const domain = typeof location?.hostname === "string" ? location.hostname : "";
    return { origin, domain };
}

function validateConnectionName(name: string): void {
    if (typeof name !== "string" || name.length === 0 || name.length > 256
        || name.trim() !== name || /[\u0000-\u001f\u007f]/.test(name))
        throw new TypeError("LocalConnection name must be a validated non-empty string");
}

/** @internal */
export function isFlashLocalConnection(value: unknown): value is LocalConnection {
    return typeof value === "object" && value !== null && LOCAL_CONNECTION_VALUES.has(value);
}

/**
 * Origin-scoped connection ownership used by the maintained double-connect
 * collision flow. Cross-context messaging requires an explicit application
 * host and is intentionally not simulated in memory.
 */
export class LocalConnection extends EventDispatcher {
    private _connectionKey: string | null = null;
    private _client: object = this;

    constructor() {
        super();
        LOCAL_CONNECTION_VALUES.add(this);
    }

    get client(): object { return this._client; }
    set client(value: object) {
        if ((typeof value !== "object" && typeof value !== "function") || value === null)
            throw new TypeError("LocalConnection.client must be an object");
        this._client = value;
    }

    get domain(): string { return browserScope().domain; }

    connect(connectionName: string): void {
        validateConnectionName(connectionName);
        if (this._connectionKey !== null) throw new Error("LocalConnection is already connected");
        const key = `${browserScope().origin}\u0000${connectionName}`;
        if (CONNECTIONS.has(key)) throw new Error(`LocalConnection name is already in use: ${connectionName}`);
        CONNECTIONS.set(key, this);
        this._connectionKey = key;
    }

    close(): void {
        if (this._connectionKey === null) throw new Error("LocalConnection is not connected");
        if (CONNECTIONS.get(this._connectionKey) === this) CONNECTIONS.delete(this._connectionKey);
        this._connectionKey = null;
    }

    send(_connectionName: string, _methodName: string, ..._arguments: unknown[]): void {
        throw new UnsupportedFlashFeatureError(
            "flash.net.LocalConnection.send",
            "cross-context messaging requires an explicit origin-scoped browser or native host"
        );
    }

    allowDomain(..._domains: string[]): void {
        throw new UnsupportedFlashFeatureError(
            "flash.net.LocalConnection.allowDomain",
            "cross-origin LocalConnection messaging is not admitted"
        );
    }

    allowInsecureDomain(..._domains: string[]): void {
        throw new UnsupportedFlashFeatureError(
            "flash.net.LocalConnection.allowInsecureDomain",
            "insecure cross-origin LocalConnection messaging is not admitted"
        );
    }
}
