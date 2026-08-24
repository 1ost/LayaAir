import { Node } from "../../../layaAir/laya/display/Node";
import { ClassUtils } from "../../../layaAir/laya/utils/ClassUtils";
import { DisplayObject, MovieClip, SimpleButton, Sprite, TextField } from "../../../layaAir/flash";
import { registerAuthoredContentPrimitives } from "./AuthoredRuntimePrimitives";

export type AuthoredSourceType = "DisplayObject" | "MovieClip" | "SimpleButton" | "Sprite" | "TextField";
export type AuthoredSerializedType = "Sprite" | "Input";

export interface AuthoredRuntimeLinkage {
    readonly id: string;
    readonly ctor: new (...args: any[]) => Node;
    readonly sourceType: AuthoredSourceType;
    readonly serializedType: AuthoredSerializedType;
}

export interface AuthoredPrefabFactory<T extends Node = Node> {
    create(options?: Record<string, unknown>, errors?: unknown[]): T | null;
}

export type AuthoredPrefabDefinition<T extends Node> = new () => T;

const LINKAGE_ID = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const installed = new Map<string, Function>();
const SOURCE_TYPES = { DisplayObject, MovieClip, SimpleButton, Sprite, TextField } as const;
const SERIALIZED_TYPES: Readonly<Record<AuthoredSourceType, AuthoredSerializedType>> = {
    DisplayObject: "Sprite", MovieClip: "Sprite", SimpleButton: "Sprite", Sprite: "Sprite", TextField: "Sprite"
};

function isApplicationLinkageId(value: unknown): value is string {
    return typeof value === "string"
        && LINKAGE_ID.test(value)
        && value !== "flash"
        && !value.startsWith("flash.")
        && value !== "laya"
        && !value.startsWith("laya.");
}

/**
 * Adapts one already-loaded canonical Laya hierarchy to a synchronous native
 * constructor token. This is intentionally narrower than a class registry:
 * the application remains responsible for registering the returned token in
 * its own definition domain after the prefab and all of its resources load.
 */
export function createAuthoredPrefabDefinition<T extends Node>(
    linkageId: string,
    prefab: AuthoredPrefabFactory,
    expectedRoot: new (...args: any[]) => T,
): AuthoredPrefabDefinition<T> {
    if (!isApplicationLinkageId(linkageId))
        throw new TypeError("Authored prefab definition requires an application-owned linkage ID");
    if (!prefab || typeof prefab !== "object" || typeof prefab.create !== "function")
        throw new TypeError(`Authored prefab definition '${linkageId}' requires a loaded canonical Laya prefab`);
    if (typeof expectedRoot !== "function" || !(expectedRoot.prototype instanceof Node))
        throw new TypeError(`Authored prefab definition '${linkageId}' expected root must extend Laya Node`);

    const definition = function AuthoredPrefabDefinition(): T {
        const errors: unknown[] = [];
        const node = prefab.create({}, errors);
        if (errors.length !== 0 || !(node instanceof expectedRoot)) {
            node?.destroy?.(true);
            const details = errors.length === 0
                ? `expected ${expectedRoot.name}; received ${node?.constructor?.name ?? "missing"}`
                : errors.map(String).join("; ");
            throw new Error(`Authored prefab definition '${linkageId}' instantiation failed: ${details}`);
        }
        return node;
    } as unknown as AuthoredPrefabDefinition<T>;
    definition.prototype = expectedRoot.prototype;
    return definition;
}

/**
 * Explicit application bootstrap. Only game/runtime linkage IDs are registered;
 * canonical serialized `_$type` IDs continue to come from Laya ModuleDef.
 */
export function registerAuthoredContentRuntime(linkages: readonly AuthoredRuntimeLinkage[]): void {
    registerAuthoredContentPrimitives();
    if (!Array.isArray(linkages)) throw new TypeError("Authored runtime linkages must be an array");
    const typedLinkages: readonly AuthoredRuntimeLinkage[] = linkages;
    const batch = new Map<string, Function>();
    const constructorClaims = new Map<Function, string>();
    for (const [index, linkage] of typedLinkages.entries()) {
        if (!linkage || typeof linkage !== "object" || Object.getPrototypeOf(linkage) !== Object.prototype)
            throw new TypeError(`linkages[${index}] must be a plain object`);
        const keys = Reflect.ownKeys(linkage);
        if (keys.length !== 4 || !keys.includes("id") || !keys.includes("ctor")
            || !keys.includes("sourceType") || !keys.includes("serializedType"))
            throw new TypeError(`linkages[${index}] must contain exactly id, ctor, sourceType and serializedType`);
        if (!isApplicationLinkageId(linkage.id))
            throw new TypeError(`linkages[${index}].id must be an application-owned linkage ID`);
        if (typeof linkage.ctor !== "function" || !(linkage.ctor.prototype instanceof Node))
            throw new TypeError(`linkages[${index}].ctor must extend Laya Node`);
        const sourceCtor = SOURCE_TYPES[linkage.sourceType];
        if (!sourceCtor || (linkage.ctor !== sourceCtor && !(linkage.ctor.prototype instanceof sourceCtor)))
            throw new TypeError(`linkages[${index}].ctor must extend declared sourceType ${linkage.sourceType}`);
        if (SERIALIZED_TYPES[linkage.sourceType] !== linkage.serializedType)
            throw new TypeError(`linkages[${index}].serializedType does not match ${linkage.sourceType}`);
        const registeredCtor = linkage.ctor as typeof linkage.ctor & {
            readonly _$authoredSerializedType?: AuthoredSerializedType;
            readonly _$authoredSourceType?: AuthoredSourceType;
        };
        const ownsSerializedType = Object.prototype.hasOwnProperty.call(
            registeredCtor,
            "_$authoredSerializedType",
        );
        const ownsSourceType = Object.prototype.hasOwnProperty.call(
            registeredCtor,
            "_$authoredSourceType",
        );
        if (ownsSerializedType
            && registeredCtor._$authoredSerializedType !== linkage.serializedType)
            throw new Error(`Authored runtime linkage constructor serialized type collision: ${linkage.id}`);
        if (ownsSourceType
            && registeredCtor._$authoredSourceType !== linkage.sourceType)
            throw new Error(`Authored runtime linkage constructor source type collision: ${linkage.id}`);
        const claim = `${linkage.sourceType}:${linkage.serializedType}`;
        const priorClaim = constructorClaims.get(linkage.ctor);
        if (priorClaim !== undefined && priorClaim !== claim)
            throw new Error(`Authored runtime linkage constructor has contradictory type declarations: ${linkage.id}`);
        constructorClaims.set(linkage.ctor, claim);
        if (batch.has(linkage.id)) throw new Error(`Duplicate authored runtime linkage: ${linkage.id}`);
        const existing = installed.get(linkage.id) ?? ClassUtils.getClass(linkage.id);
        if (existing && existing !== linkage.ctor)
            throw new Error(`Authored runtime linkage collision: ${linkage.id}`);
        batch.set(linkage.id, linkage.ctor);
    }
    for (const [id, ctor] of batch) {
        const linkage = typedLinkages.find(item => item.id === id)!;
        const registeredCtor = ctor as Function & {
            readonly _$authoredSerializedType?: AuthoredSerializedType;
            readonly _$authoredSourceType?: AuthoredSourceType;
        };
        if (!Object.prototype.hasOwnProperty.call(registeredCtor, "_$authoredSerializedType")) {
            Object.defineProperties(ctor, {
                _$authoredSerializedType: { value: linkage.serializedType, configurable: false },
                _$authoredSourceType: { value: linkage.sourceType, configurable: false }
            });
        }
        ClassUtils.regClass(id, ctor);
        installed.set(id, ctor);
    }
}
