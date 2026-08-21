import { getQualifiedClassName } from "./getQualifiedClassName";

/** Returns the stable native identifier for a value's immediate instance superclass. */
export function getQualifiedSuperclassName(value: unknown): string | null {
    if (value === null || value === undefined)
        return null;

    const constructor = typeof value === "function"
        ? value
        : (value as { constructor?: unknown }).constructor;
    if (typeof constructor !== "function" || !constructor.prototype)
        return null;

    const parentPrototype = Object.getPrototypeOf(constructor.prototype) as object | null;
    if (parentPrototype === null)
        return null;
    const parentConstructor = Object.getOwnPropertyDescriptor(parentPrototype, "constructor")?.value;
    return typeof parentConstructor === "function"
        ? getQualifiedClassName(parentConstructor)
        : null;
}
