/** Namespace identity used by ActionScript's flash_proxy methods. */
export const flash_proxy = "http://www.adobe.com/2006/actionscript/flash/proxy" as const;

export type FlashProxyName = string | number | symbol;

/**
 * Freezes the declared-slot list consumed by {@link Proxy}. Subclasses must
 * publish every instance field that is emitted as an assignment so those
 * writes retain sealed-class semantics instead of entering dynamic hooks.
 */
export function declareFlashProxyProperties(...names: readonly PropertyKey[]): readonly PropertyKey[] {
    return Object.freeze([...names]);
}

/**
 * Native bridge for ActionScript's flash.utils.Proxy.
 *
 * Ordinary declared members remain ordinary JavaScript properties. Missing
 * string/number properties are routed through the Flash proxy hooks. The
 * explicit call helper below preserves callProperty's receiver semantics,
 * which a JavaScript get trap cannot infer from a later invocation.
 */
export class Proxy {
    static readonly flashProxyDeclaredProperties: readonly PropertyKey[] = Object.freeze([]);

    constructor() {
        const declared = collectDeclaredProperties(new.target);
        const handler: ProxyHandler<this> = {
            get: (target, name, receiver) => {
                if (typeof name === "symbol" || Reflect.has(target, name))
                    return Reflect.get(target, name, receiver);
                return target.getProperty(name);
            },
            set: (target, name, value) => {
                if (typeof name === "symbol" || declared.has(name) || Reflect.has(target, name))
                    return Reflect.set(target, name, value, target);
                target.setProperty(name, value);
                return true;
            },
            deleteProperty: (target, name) => {
                if (typeof name === "symbol" || declared.has(name) || Reflect.has(target, name)) return false;
                return Boolean(target.deleteProperty(name));
            },
            has: (target, name) => Reflect.has(target, name) || Boolean(target.hasProperty(name)),
        };
        return new globalThis.Proxy(this, handler);
    }

    protected getProperty(_name: FlashProxyName): unknown { return undefined; }
    protected setProperty(_name: FlashProxyName, _value: unknown): void { }
    protected callProperty(name: FlashProxyName, ..._args: unknown[]): unknown {
        const value = this.getProperty(name);
        if (typeof value !== "function") throw new TypeError(`Flash proxy property ${String(name)} is not callable`);
        return Reflect.apply(value, this, _args);
    }
    protected deleteProperty(_name: FlashProxyName): boolean { return false; }
    protected hasProperty(name: FlashProxyName): boolean { return this.getProperty(name) !== undefined; }
    protected nextNameIndex(_index: number): number { return 0; }
    protected nextName(_index: number): string { return ""; }
    protected nextValue(index: number): unknown { return this.getProperty(this.nextName(index)); }

    /** @internal Compiler/runtime lowering entry for a dynamic call. */
    static call(receiver: Proxy, name: FlashProxyName, args: readonly unknown[]): unknown {
        if (!(receiver instanceof Proxy)) throw new TypeError("Flash proxy receiver must be canonical");
        return receiver.callProperty(name, ...args);
    }
}

/** Preserves ActionScript callProperty dispatch after native TypeScript lowering. */
export function callFlashProxyProperty(
    receiver: Proxy,
    name: FlashProxyName,
    ...args: readonly unknown[]
): unknown {
    return Proxy.call(receiver, name, args);
}

function collectDeclaredProperties(constructor: Function): Set<PropertyKey> {
    const result = new Set<PropertyKey>();
    for (let current: unknown = constructor;
        typeof current === "function" && current !== Function.prototype;
        current = Object.getPrototypeOf(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, "flashProxyDeclaredProperties");
        if (!descriptor || !("value" in descriptor)) continue;
        if (!Array.isArray(descriptor.value))
            throw new TypeError("flashProxyDeclaredProperties must be created by declareFlashProxyProperties");
        for (const name of descriptor.value) {
            if (typeof name !== "string" && typeof name !== "number" && typeof name !== "symbol")
                throw new TypeError("Flash proxy declared property names must be property keys");
            result.add(name);
        }
    }
    return result;
}
