const FLASH_CLASS_IDENTIFIER = Symbol.for("laya.flash.classIdentifier");

type NamedConstructor = Function & {
    readonly __className?: unknown;
    readonly [FLASH_CLASS_IDENTIFIER]?: unknown;
};

function normalizeClassIdentifier(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0)
        return null;

    const lastDot = value.lastIndexOf(".");
    return lastDot < 0 || value.includes("::")
        ? value
        : `${value.slice(0, lastDot)}::${value.slice(lastDot + 1)}`;
}

/**
 * Returns the Flash-style qualified class name for a native JavaScript value.
 * Classes may expose a stable package name through the shared
 * `laya.flash.classIdentifier` symbol or Laya's existing `__className` field.
 */
export function getQualifiedClassName(value: unknown): string {
    if (value === null)
        return "null";
    if (value === undefined)
        return "void";

    switch (typeof value) {
        case "string": return "String";
        case "boolean": return "Boolean";
        case "number": return "Number";
        case "bigint": return "Number";
        case "symbol": return "Symbol";
    }

    const constructor = (typeof value === "function"
        ? value
        : (value as { constructor?: unknown }).constructor) as NamedConstructor | undefined;
    if (typeof constructor !== "function")
        return "Object";

    return normalizeClassIdentifier(constructor[FLASH_CLASS_IDENTIFIER])
        ?? normalizeClassIdentifier(constructor.__className)
        ?? constructor.name
        ?? "Object";
}
