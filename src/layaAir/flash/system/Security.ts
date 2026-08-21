function observeDomains(domains: readonly string[]): void {
    for (const domain of domains) String(domain);
}

function currentProtocol(): string {
    const location = (globalThis as unknown as {
        readonly location?: { readonly protocol?: unknown };
    }).location;
    return typeof location?.protocol === "string" ? location.protocol.toLowerCase() : "";
}

/**
 * Source-shaped Flash security classification over the native browser sandbox.
 *
 * Domain declarations remain callable for retained source behavior, but never
 * weaken browser CORS, CSP, mixed-content, or origin enforcement.
 */
export class Security {
    private constructor() {}

    static readonly APPLICATION = "application";
    static readonly LOCAL_TRUSTED = "localTrusted";
    static readonly LOCAL_WITH_FILE = "localWithFile";
    static readonly LOCAL_WITH_NETWORK = "localWithNetwork";
    static readonly REMOTE = "remote";

    static get sandboxType(): string {
        const protocol = currentProtocol();
        if (protocol === "file:") return Security.LOCAL_WITH_FILE;
        if (protocol === "app:" || protocol === "application:") return Security.APPLICATION;
        return Security.REMOTE;
    }

    static allowDomain(...domains: string[]): void {
        observeDomains(domains);
    }

    static allowInsecureDomain(...domains: string[]): void {
        observeDomains(domains);
    }
}

Object.freeze(Security);
