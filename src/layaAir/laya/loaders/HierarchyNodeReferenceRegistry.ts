type HierarchyNodeReferenceReceiver = (key: string, value: unknown) => boolean;

const receivers = new WeakMap<object, HierarchyNodeReferenceReceiver>();

/**
 * Registers an internal handler for a source-shaped property whose serialized
 * node reference has a distinct native hierarchy representation.
 */
export function registerHierarchyNodeReferenceReceiver(
    value: object,
    receiver: HierarchyNodeReferenceReceiver,
): void {
    if (receivers.has(value))
        throw new Error("Hierarchy node-reference receiver is already registered");
    receivers.set(value, receiver);
}

/** @internal Consumes only references authenticated by the active hierarchy node map. */
export function assignHierarchyNodeReference(target: object, key: string, value: unknown): boolean {
    return receivers.get(target)?.(key, value) === true;
}
