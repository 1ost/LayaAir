import { getQualifiedClassName } from "./getQualifiedClassName";

export type FlashAccessorAccess = "readonly" | "writeonly" | "readwrite";

export interface FlashMethodDescription {
    readonly name: string;
    readonly declaredBy: string;
    readonly parameterCount: number;
}

export interface FlashAccessorDescription {
    readonly name: string;
    readonly declaredBy: string;
    readonly access: FlashAccessorAccess;
}

export interface FlashVariableDescription {
    readonly name: string;
    readonly declaredBy: string;
    readonly type: string;
}

export interface FlashTypeMembers {
    readonly methods: readonly FlashMethodDescription[];
    readonly accessors: readonly FlashAccessorDescription[];
    readonly variables: readonly FlashVariableDescription[];
}

export interface FlashTypeDescription extends FlashTypeMembers {
    readonly name: string;
    readonly base: string | null;
    readonly isDynamic: boolean;
    readonly isFinal: boolean;
    readonly isStatic: boolean;
    readonly factory: FlashTypeMembers | null;
}

function accessOf(descriptor: PropertyDescriptor): FlashAccessorAccess {
    if (descriptor.get && descriptor.set)
        return "readwrite";
    return descriptor.get ? "readonly" : "writeonly";
}

function describePrototype(prototype: object | null): Omit<FlashTypeMembers, "variables"> {
    const methods: FlashMethodDescription[] = [];
    const accessors: FlashAccessorDescription[] = [];
    const observed = new Set<PropertyKey>();

    for (let current = prototype;
        current !== null && current !== Object.prototype;
        current = Object.getPrototypeOf(current)) {
        const declaredBy = getQualifiedClassName(
            Object.getOwnPropertyDescriptor(current, "constructor")?.value,
        );
        for (const key of Reflect.ownKeys(current)) {
            if (key === "constructor" || observed.has(key))
                continue;
            observed.add(key);
            if (typeof key !== "string")
                continue;

            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (!descriptor)
                continue;
            if (typeof descriptor.value === "function") {
                methods.push({
                    name: key,
                    declaredBy,
                    parameterCount: descriptor.value.length,
                });
            }
            else if (descriptor.get || descriptor.set) {
                accessors.push({ name: key, declaredBy, access: accessOf(descriptor) });
            }
        }
    }

    return { methods, accessors };
}

function describeVariables(value: unknown, declaredBy: string): FlashVariableDescription[] {
    if ((typeof value !== "object" && typeof value !== "function") || value === null)
        return [];

    const variables: FlashVariableDescription[] = [];
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string")
            continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor))
            continue;
        variables.push({
            name: key,
            declaredBy,
            type: getQualifiedClassName(descriptor.value),
        });
    }
    return variables;
}

function members(value: unknown, prototype: object | null, declaredBy: string): FlashTypeMembers {
    const reflected = describePrototype(prototype);
    return {
        methods: reflected.methods,
        accessors: reflected.accessors,
        variables: describeVariables(value, declaredBy),
    };
}

/**
 * Describes native classes and instances using the public member information
 * exposed by Flash's `describeType` API, represented as an immutable native
 * descriptor instead of AVM/E4X state.
 */
export function describeType(value: unknown): FlashTypeDescription {
    const isStatic = typeof value === "function";
    const constructor = (isStatic
        ? value
        : value === null || value === undefined
            ? null
            : (value as { constructor?: unknown }).constructor) as Function | null | undefined;
    const name = getQualifiedClassName(value);
    const prototype = typeof constructor === "function" && constructor.prototype
        ? constructor.prototype as object
        : null;
    const parentPrototype = prototype === null ? null : Object.getPrototypeOf(prototype);
    const base = parentPrototype === null || parentPrototype === Object.prototype
        ? (prototype === Object.prototype ? null : "Object")
        : getQualifiedClassName(
            Object.getOwnPropertyDescriptor(parentPrototype, "constructor")?.value,
        );
    const instanceMembers = members(isStatic ? null : value, prototype, name);
    const staticMembers = isStatic
        ? members(value, Object.getPrototypeOf(value) as object | null, "Class")
        : instanceMembers;

    return Object.freeze({
        name,
        base: isStatic ? "Class" : base,
        isDynamic: isStatic || (value !== null
            && (typeof value === "object" || typeof value === "function")
            && Object.isExtensible(value)),
        isFinal: false,
        isStatic,
        methods: Object.freeze([...staticMembers.methods]),
        accessors: Object.freeze([...staticMembers.accessors]),
        variables: Object.freeze([...staticMembers.variables]),
        factory: isStatic ? Object.freeze(instanceMembers) : null,
    });
}
