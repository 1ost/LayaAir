export type NodeMutationOperation =
    | "addChildAt" | "setChildIndex" | "removeChild" | "removeChildAt"
    | "addInternalChild" | "removeInternalChild" | "setParent" | "setContainer" | "destroy"
    | "beginTransaction";

declare const transactionBrand: unique symbol;
export type NodeMutationTransaction = { readonly [transactionBrand]: true };
export type NodeMutationPermit = { readonly node: object; readonly operation: NodeMutationOperation };

type Guard = { readonly token: object; readonly reject: (operation: NodeMutationOperation) => never };
type Permit = { readonly token: object; readonly operations: NodeMutationOperation[] };
type TransactionState = { readonly guards: object[]; readonly reject: Guard["reject"]; active: boolean };

const guards = new WeakMap<object, Guard>();
const permits = new WeakMap<object, Permit>();
const transactions = new WeakMap<object, TransactionState>();

/** @internal Starts an opaque, module-owned mutation transaction over an exact node set. */
export function beginNodeMutationTransaction(nodes: Iterable<object>, reject: Guard["reject"]): NodeMutationTransaction {
    const guarded = [...new Set(nodes)];
    for (const node of guarded) {
        const existing = guards.get(node);
        if (existing) existing.reject("beginTransaction");
    }
    const token = Object.freeze({}) as NodeMutationTransaction;
    const state: TransactionState = { guards: guarded, reject, active: true };
    transactions.set(token, state);
    for (const node of guarded) guards.set(node, { token, reject });
    return token;
}

/** @internal Ends a transaction. Only its opaque token can release its guards. */
export function endNodeMutationTransaction(token: NodeMutationTransaction): void {
    const state = transactions.get(token);
    if (!state?.active) throw new Error("Laya node mutation transaction is not active");
    for (const node of state.guards) {
        if (permits.has(node)) throw new Error("Laya node mutation transaction ended with an active permit");
        if (guards.get(node)?.token !== token) throw new Error("Laya node mutation guard ownership changed");
    }
    state.active = false;
    for (const node of state.guards) guards.delete(node);
    transactions.delete(token);
}

/** @internal Runs one exact primitive sequence; permits are consumed before lifecycle callbacks. */
export function runPermittedNodeMutation<T>(token: NodeMutationTransaction, steps: readonly NodeMutationPermit[], mutation: () => T): T {
    const state = transactions.get(token);
    if (!state?.active) throw new Error("Laya node mutation transaction is not active");
    const byNode = new Map<object, NodeMutationOperation[]>();
    for (const step of steps) {
        if (guards.get(step.node)?.token !== token)
            throw new Error("Laya node mutation permit targets a node outside its transaction");
        if (permits.has(step.node) || byNode.has(step.node)) {
            if (permits.has(step.node)) throw new Error("Nested Laya node mutation permit acquisition is forbidden");
        }
        const operations = byNode.get(step.node) ?? [];
        operations.push(step.operation);
        byNode.set(step.node, operations);
    }
    for (const [node, operations] of byNode) {
        if (permits.has(node)) throw new Error("Nested Laya node mutation permit acquisition is forbidden");
        permits.set(node, { token, operations });
    }
    try {
        const result = mutation();
        for (const node of byNode.keys()) {
            if (permits.has(node)) throw new Error("Laya node mutation primitive did not consume its exact permit");
        }
        return result;
    } finally {
        for (const node of byNode.keys()) permits.delete(node);
    }
}

/** @internal Called directly by canonical Node primitives; no virtual surface can bypass it. */
export function admitNodeMutation(node: object, operation: NodeMutationOperation): void {
    const permit = permits.get(node);
    if (permit) {
        if (permit.operations[0] === operation) {
            permit.operations.shift();
            if (permit.operations.length === 0) permits.delete(node);
            return;
        }
    }
    const guard = guards.get(node);
    if (guard) guard.reject(operation);
}
