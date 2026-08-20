export type NativeClassConstructor = new (...arguments_: any[]) => object;

const CONSTRUCTOR_BY_ALIAS = new Map<string, NativeClassConstructor>();
const ALIAS_BY_CONSTRUCTOR = new Map<NativeClassConstructor, string>();

function validateAlias(aliasName: string): void {
    if (typeof aliasName !== "string" || aliasName.length === 0 || aliasName.trim() !== aliasName
        || /[\u0000-\u001f\u007f]/.test(aliasName))
        throw new TypeError("Class alias must be a validated non-empty string");
}

/** Registers a native constructor identity for maintained serialization/linkage consumers. */
export function registerClassAlias(aliasName: string, classObject: NativeClassConstructor): void {
    validateAlias(aliasName);
    if (typeof classObject !== "function" || typeof classObject.prototype !== "object")
        throw new TypeError("registerClassAlias requires a constructible class");
    const previousConstructor = CONSTRUCTOR_BY_ALIAS.get(aliasName);
    if (previousConstructor && previousConstructor !== classObject)
        ALIAS_BY_CONSTRUCTOR.delete(previousConstructor);
    const previousAlias = ALIAS_BY_CONSTRUCTOR.get(classObject);
    if (previousAlias && previousAlias !== aliasName)
        CONSTRUCTOR_BY_ALIAS.delete(previousAlias);
    CONSTRUCTOR_BY_ALIAS.set(aliasName, classObject);
    ALIAS_BY_CONSTRUCTOR.set(classObject, aliasName);
}

/** @internal Read-only lookup for an authenticated object codec. */
export function resolveClassAlias(aliasName: string): NativeClassConstructor | null {
    validateAlias(aliasName);
    return CONSTRUCTOR_BY_ALIAS.get(aliasName) ?? null;
}

/** @internal Read-only reverse lookup for an authenticated object codec. */
export function resolveAliasForClass(classObject: NativeClassConstructor): string | null {
    if (typeof classObject !== "function") throw new TypeError("Class alias lookup requires a constructor");
    return ALIAS_BY_CONSTRUCTOR.get(classObject) ?? null;
}
