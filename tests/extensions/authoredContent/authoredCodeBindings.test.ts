import { strict as assert } from "node:assert";
import {
    attachAuthoredCodeBindings,
    type AuthoredBindingHost,
    type AuthoredBindingHostLease,
    type AuthoredHostListener
} from "../../../src/extensions/authoredContent/runtime/AuthoredCodeBindings";

type Root = { readonly root: true };
type Node = { readonly name: string };

const contract = {
    schema: "neutral-authored-code-bindings@1",
    documentId: "sample-view",
    sourceBase: "Sprite",
    bindings: [{
        bindingId: "sample.button",
        memberName: "submitButton",
        nodeId: "sample.button",
        nodeKind: "button",
        required: true,
        events: [{ eventId: "sample.button.click", type: "click", required: true }]
    }]
} as const;

class Host implements AuthoredBindingHost<Root, Node> {
    readonly node = { name: "sample.button" };
    listener: AuthoredHostListener<Node> | null = null;
    failDetach = false;
    findNodes(): readonly Node[] { return [this.node]; }
    attach(listeners: readonly AuthoredHostListener<Node>[]): AuthoredBindingHostLease {
        assert.equal(listeners.length, 1);
        this.listener = listeners[0];
        return { detach: () => {
            if (this.failDetach) throw new Error("atomic failure");
            this.listener = null;
        } };
    }
}

const pointer = Object.freeze({
    x: 1, y: 2, button: 0, pointerId: 3,
    altKey: false, ctrlKey: false, shiftKey: false, metaKey: false
});

export function run(): void {
    const root: Root = { root: true };
    const host = new Host();
    const duplicateOwnership = {
        ...contract,
        bindings: [contract.bindings[0], {
            ...contract.bindings[0], bindingId: "sample.other", memberName: "other",
            events: [{ eventId: "sample.other.click", type: "click", required: true }]
        }]
    };
    assert.throws(() => attachAuthoredCodeBindings(root, host, duplicateOwnership, {
        "sample.button.click": () => undefined,
        "sample.other.click": () => undefined
    }), /duplicate node\/event ownership/);
    const hiddenHandlers = { "sample.button.click": () => undefined };
    Object.defineProperty(hiddenHandlers, "hidden", { value: () => undefined, enumerable: false });
    assert.throws(() => attachAuthoredCodeBindings(root, host, contract, hiddenHandlers), /enumerable data property/);
    assert.throws(() => attachAuthoredCodeBindings(root, host, contract, {
        "sample.button.click": () => undefined,
        "sample.undeclared": () => undefined
    }), /unknown authored handler/);
    const hiddenBindings = [...contract.bindings];
    Object.defineProperty(hiddenBindings, "hidden", { value: true, enumerable: false });
    assert.throws(() => attachAuthoredCodeBindings(root, host, { ...contract, bindings: hiddenBindings }, {
        "sample.button.click": () => undefined
    }), /dense array/);
    let payload: unknown;
    const lease = attachAuthoredCodeBindings(root, host, contract, {
        "sample.button.click": (value: unknown) => { payload = value; }
    });
    host.listener!.receive(pointer);
    assert.equal(Object.isFrozen(payload), true);
    assert.throws(() => host.listener!.receive({ ...pointer, hidden: true }), /exactly/);
    host.failDetach = true;
    assert.throws(() => lease.detach(), /atomic failure/);
    assert.equal(lease.attached, true);
    assert.throws(() => attachAuthoredCodeBindings(root, host, contract, {
        "sample.button.click": () => undefined
    }), /already attached/);
    host.failDetach = false;
    lease.detach();

}
