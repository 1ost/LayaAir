export type NodeMutationOperation =
    | "addChildAt" | "setChildIndex" | "removeChild" | "removeChildAt"
    | "addInternalChild" | "removeInternalChild" | "setParent" | "setContainer" | "destroy"
    | "setParentDerived" | "destroyDerived" | "destroyFlashDisplayObject"
    | "destroyChildren" | "beginTransaction";

declare const transactionBrand: unique symbol;
export type NodeMutationTransaction = { readonly [transactionBrand]: true };
export type NodeMutationPermit = { readonly node: object; readonly operation: NodeMutationOperation };

type Guard = {
    readonly token: object;
    readonly reject: (operation: NodeMutationOperation) => never;
    readonly operations: ReadonlySet<NodeMutationOperation> | null;
};
type Permit = { readonly token: object; readonly operations: NodeMutationOperation[] };
type GuardEntry = { readonly node: object; readonly guard: Guard };
type TransactionState = { readonly guards: GuardEntry[]; active: boolean };

const guards = new WeakMap<object, Guard[]>();
const permits = new WeakMap<object, Permit[]>();
const transactions = new WeakMap<object, TransactionState>();
const admittedScopes = new WeakMap<object, NodeMutationOperation>();

function protects(guard: Guard, operation: NodeMutationOperation): boolean {
    return guard.operations === null || guard.operations.has(operation);
}

/** @internal Starts an opaque, module-owned mutation transaction over an exact node set. */
export function beginNodeMutationTransaction(nodes: Iterable<object>, reject: Guard["reject"],
    operations: Iterable<NodeMutationOperation> | null = null): NodeMutationTransaction {
    const guarded = [...new Set(nodes)];
    for (const node of guarded) {
        const existing = guards.get(node);
        if (existing) {
            for (let index = existing.length - 1; index >= 0; index--) {
                if (protects(existing[index], "beginTransaction")) existing[index].reject("beginTransaction");
            }
        }
    }
    const token = Object.freeze({}) as NodeMutationTransaction;
    const operationSet = operations === null ? null : new Set(operations);
    const entries = guarded.map(node => ({ node, guard: { token, reject, operations: operationSet } }));
    const state: TransactionState = { guards: entries, active: true };
    transactions.set(token, state);
    for (const { node, guard } of entries) {
        const stack = guards.get(node);
        if (stack) stack.push(guard);
        else guards.set(node, [guard]);
    }
    return token;
}

/** @internal Ends a transaction. Only its opaque token can release its guards. */
export function endNodeMutationTransaction(token: NodeMutationTransaction): void {
    const state = transactions.get(token);
    if (!state?.active) throw new Error("Laya node mutation transaction is not active");
    for (const { node, guard } of state.guards) {
        if (permits.get(node)?.some(permit => permit.token === token))
            throw new Error("Laya node mutation transaction ended with an active permit");
        const stack = guards.get(node);
        if (!stack || stack[stack.length - 1] !== guard)
            throw new Error("Laya node mutation guard ownership changed");
    }
    state.active = false;
    for (const { node } of state.guards) {
        const stack = guards.get(node)!;
        stack.pop();
        if (stack.length === 0) guards.delete(node);
    }
    transactions.delete(token);
}

/** @internal Runs one exact primitive sequence; permits are consumed before lifecycle callbacks. */
export function runPermittedNodeMutation<T>(token: NodeMutationTransaction, steps: readonly NodeMutationPermit[], mutation: () => T): T {
    const state = transactions.get(token);
    if (!state?.active) throw new Error("Laya node mutation transaction is not active");
    const byNode = new Map<object, NodeMutationOperation[]>();
    for (const step of steps) {
        if (!state.guards.some(entry => entry.node === step.node))
            throw new Error("Laya node mutation permit targets a node outside its transaction");
        if (permits.get(step.node)?.some(permit => permit.token === token))
            throw new Error("Nested Laya node mutation permit acquisition is forbidden");
        const operations = byNode.get(step.node) ?? [];
        operations.push(step.operation);
        byNode.set(step.node, operations);
    }
    for (const [node, operations] of byNode) {
        const active = permits.get(node);
        const permit = { token, operations };
        if (active) active.push(permit);
        else permits.set(node, [permit]);
    }
    try {
        const result = mutation();
        for (const node of byNode.keys()) {
            if (permits.get(node)?.some(permit => permit.token === token))
                throw new Error("Laya node mutation primitive did not consume its exact permit");
        }
        return result;
    } finally {
        for (const node of byNode.keys()) {
            const active = permits.get(node);
            if (!active) continue;
            const index = active.findIndex(permit => permit.token === token);
            if (index >= 0) active.splice(index, 1);
            if (active.length === 0) permits.delete(node);
        }
    }
}

/** @internal Called directly by canonical Node primitives; no virtual surface can bypass it. */
export function admitNodeMutation(node: object, operation: NodeMutationOperation): void {
    const stack = guards.get(node);
    if (!stack) return;
    for (let index = stack.length - 1; index >= 0; index--) {
        const guard = stack[index];
        if (!protects(guard, operation)) continue;
        const active = permits.get(node);
        const permitIndex = active?.findIndex(permit => permit.token === guard.token) ?? -1;
        const permit = permitIndex >= 0 ? active![permitIndex] : undefined;
        if (permit?.operations[0] === operation) {
            permit.operations.shift();
            if (permit.operations.length === 0) {
                active!.splice(permitIndex, 1);
                if (active!.length === 0) permits.delete(node);
            }
            continue;
        }
        guard.reject(operation);
    }
}

/** @internal Admits one operation before derived side effects and shares it with its base implementation. */
export function runAdmittedNodeMutation<T>(node: object, operation: NodeMutationOperation, action: () => T): T {
    if (admittedScopes.get(node) === operation) return action();
    admitNodeMutation(node, operation);
    admittedScopes.set(node, operation);
    try { return action(); }
    finally { admittedScopes.delete(node); }
}
