import { Node } from "../../../layaAir/laya/display/Node";
import { ClassUtils } from "../../../layaAir/laya/utils/ClassUtils";

export interface AuthoredRuntimeLinkage {
    readonly id: string;
    readonly ctor: new (...args: any[]) => Node;
}

const LINKAGE_ID = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/;
const installed = new Map<string, Function>();

/**
 * Explicit application bootstrap. Only game/runtime linkage IDs are registered;
 * canonical serialized `_$type` IDs continue to come from Laya ModuleDef.
 */
export function registerAuthoredContentRuntime(linkages: readonly AuthoredRuntimeLinkage[]): void {
    if (!Array.isArray(linkages)) throw new TypeError("Authored runtime linkages must be an array");
    const batch = new Map<string, Function>();
    for (const [index, linkage] of linkages.entries()) {
        if (!linkage || typeof linkage !== "object" || Object.getPrototypeOf(linkage) !== Object.prototype)
            throw new TypeError(`linkages[${index}] must be a plain object`);
        const keys = Reflect.ownKeys(linkage);
        if (keys.length !== 2 || !keys.includes("id") || !keys.includes("ctor"))
            throw new TypeError(`linkages[${index}] must contain exactly id and ctor`);
        if (typeof linkage.id !== "string" || !LINKAGE_ID.test(linkage.id)
            || linkage.id.startsWith("flash.") || linkage.id.startsWith("laya."))
            throw new TypeError(`linkages[${index}].id must be an application-owned linkage ID`);
        if (typeof linkage.ctor !== "function" || !(linkage.ctor.prototype instanceof Node))
            throw new TypeError(`linkages[${index}].ctor must extend Laya Node`);
        if (batch.has(linkage.id)) throw new Error(`Duplicate authored runtime linkage: ${linkage.id}`);
        const existing = installed.get(linkage.id) ?? ClassUtils.getClass(linkage.id);
        if (existing && existing !== linkage.ctor)
            throw new Error(`Authored runtime linkage collision: ${linkage.id}`);
        batch.set(linkage.id, linkage.ctor);
    }
    for (const [id, ctor] of batch) {
        ClassUtils.regClass(id, ctor);
        installed.set(id, ctor);
    }
}
