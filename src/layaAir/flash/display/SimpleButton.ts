import { Event as LayaEvent } from "../../laya/events/Event";
import { Point } from "../../laya/maths/Point";
import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { Node } from "../../laya/display/Node";
import {
    beginNodeMutationTransaction, endNodeMutationTransaction, runPermittedNodeMutation,
    NodeMutationOperation, NodeMutationTransaction,
} from "../../laya/display/NodeMutationTransaction";
import { IHitArea } from "../../laya/utils/IHitArea";
import { InputManager } from "../../laya/events/InputManager";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { DisplayObject } from "./DisplayObject";
import { InteractiveObject } from "./InteractiveObject";

type ButtonVisualState = "up" | "over" | "down";
type ButtonStateSlot = "_upState" | "_overState" | "_downState" | "_hitTestState";
type ButtonStateTransaction = { revision: number; poisoned: boolean; nodeTransaction?: NodeMutationTransaction };
type LayaNode = Node;
const BUTTON_STATE_SLOTS: readonly ButtonStateSlot[] = ["_upState", "_overState", "_downState", "_hitTestState"];
const buttonTransactions = new WeakMap<object, ButtonStateTransaction>();
const buttonRevisions = new WeakMap<object, number>();
const nextButtonRevision = (button: object): number => {
    const revision = (buttonRevisions.get(button) ?? 0) + 1;
    buttonRevisions.set(button, revision);
    return revision;
};
const poisonButtonTransaction = (button: object, operation: NodeMutationOperation): never => {
    const transaction = buttonTransactions.get(button);
    if (transaction) transaction.poisoned = true;
    nextButtonRevision(button);
    throw new Error(`SimpleButton ${operation} mutation is not allowed during state replacement`);
};

const visibleDescriptor = Object.getOwnPropertyDescriptor(LayaSprite.prototype, "visible");
const mouseDescriptor = Object.getOwnPropertyDescriptor(LayaSprite.prototype, "mouseEnabled");
if (!visibleDescriptor?.get || !visibleDescriptor.set || !mouseDescriptor?.get || !mouseDescriptor.set)
    throw new Error("Laya Sprite native state descriptors are unavailable");
const nativeVisible = (value: DisplayObject): boolean => visibleDescriptor.get!.call(value);
const setNativeVisible = (value: DisplayObject, visible: boolean): void => visibleDescriptor.set!.call(value, visible);
const nativeMouseEnabled = (value: DisplayObject): boolean => mouseDescriptor.get!.call(value);
const setNativeMouseEnabled = (value: DisplayObject, enabled: boolean): void => mouseDescriptor.set!.call(value, enabled);
type NodeInternals = {
    _children: LayaNode[];
    _$children: LayaNode[];
    _parent: LayaNode | null | undefined;
    _$parent: LayaNode | null | undefined;
    _$container: LayaNode;
    _destroyed: boolean;
    _setParent(value: LayaNode | null, index?: number): void;
};
const nodeInternals = (value: LayaNode): NodeInternals => value as unknown as NodeInternals;
const canonicalStateSetParent = nodeInternals(DisplayObject.prototype as unknown as LayaNode)._setParent;
if (typeof canonicalStateSetParent !== "function")
    throw new Error("Laya DisplayObject canonical _setParent implementation is unavailable");
const assertCanonicalStateLifecycle = (value: DisplayObject, name: string): void => {
    if (Object.prototype.hasOwnProperty.call(value, "_setParent"))
        throw new TypeError(`${name} state must use the canonical Laya DisplayObject _setParent implementation`);
    let prototype = Object.getPrototypeOf(value);
    while (prototype && prototype !== DisplayObject.prototype) {
        if (Object.prototype.hasOwnProperty.call(prototype, "_setParent"))
            throw new TypeError(`${name} state must use the canonical Laya DisplayObject _setParent implementation`);
        prototype = Object.getPrototypeOf(prototype);
    }
    if (prototype !== DisplayObject.prototype || nodeInternals(value)._setParent !== canonicalStateSetParent)
        throw new TypeError(`${name} state must use the canonical Laya DisplayObject _setParent implementation`);
};
const assertConsistentPlacement = (value: DisplayObject, name: string): void => {
    const state = nodeInternals(value);
    const logicalParent = state._$parent;
    const actualParent = state._parent;
    if (!logicalParent || !actualParent) {
        if (logicalParent != null || actualParent != null)
            throw new TypeError(`${name} state has inconsistent Laya parent fields`);
        return;
    }
    const logical = nodeInternals(logicalParent);
    if (logical._$container !== actualParent)
        throw new TypeError(`${name} state has inconsistent Laya logical and container parents`);
    const logicalCount = logical._$children.reduce((count, child) => count + Number(child === value), 0);
    const actualCount = nodeInternals(actualParent)._children.reduce((count, child) => count + Number(child === value), 0);
    if (logicalCount !== 1 || actualCount !== 1 || logical._$children.indexOf(value) !== nodeInternals(actualParent)._children.indexOf(value))
        throw new TypeError(`${name} state has inconsistent Laya child-array placement`);
};
const assertOwnedPlacement = (value: DisplayObject, owner: LayaNode, name: string): void => {
    assertConsistentPlacement(value, name);
    const state = nodeInternals(value);
    const ownerState = nodeInternals(owner);
    if (state._$parent !== owner || state._parent !== ownerState._$container
        || ownerState._$children.indexOf(value) < 0 || nodeInternals(ownerState._$container)._children.indexOf(value) < 0)
        throw new TypeError(`${name} state did not remain attached after Laya lifecycle dispatch`);
};
const assertDetachedFromOwner = (value: DisplayObject, owner: LayaNode, name: string): void => {
    assertConsistentPlacement(value, name);
    const ownerState = nodeInternals(owner);
    if (ownerState._$children.includes(value) || nodeInternals(ownerState._$container)._children.includes(value))
        throw new TypeError(`${name} prior state remained in Laya child arrays after lifecycle dispatch`);
};
const nativeRemove = (parent: LayaNode, value: DisplayObject): void => {
    if (value.parent === parent) Node.prototype.removeChild.call(parent, value);
};
const nativeAdd = (parent: LayaNode, value: DisplayObject, index: number): void => {
    Node.prototype.addChildAt.call(parent, value, Math.max(0, Math.min(index, parent.numChildren)));
};
const collectNodeGraph = (roots: Iterable<LayaNode | null | undefined>): Set<LayaNode> => {
    const nodes = new Set<LayaNode>();
    const pending = [...roots].filter((node): node is LayaNode => node != null);
    while (pending.length > 0) {
        const node = pending.pop()!;
        if (nodes.has(node)) continue;
        nodes.add(node);
        const internals = nodeInternals(node);
        for (const child of internals._children) pending.push(child);
        for (const child of internals._$children) pending.push(child);
        if (internals._$container && internals._$container !== node) pending.push(internals._$container);
        if (internals._parent) pending.push(internals._parent);
        if (internals._$parent) pending.push(internals._$parent);
    }
    return nodes;
};
const assertCanonicalGraphLifecycle = (node: LayaNode, name: string): void => {
    if (!(node instanceof DisplayObject)) return;
    const lifecycleNames = ["_setParent", "destroy", "destroyChildren"] as const;
    for (const lifecycleName of lifecycleNames) {
        if (Object.prototype.hasOwnProperty.call(node, lifecycleName))
            throw new TypeError(`${name} graph node must not replace canonical Laya ${lifecycleName}`);
    }
    let prototype = Object.getPrototypeOf(node);
    while (prototype && prototype !== DisplayObject.prototype) {
        for (const lifecycleName of lifecycleNames) {
            if (Object.prototype.hasOwnProperty.call(prototype, lifecycleName))
                throw new TypeError(`${name} graph node must not replace canonical Laya ${lifecycleName}`);
        }
        prototype = Object.getPrototypeOf(prototype);
    }
    if (prototype !== DisplayObject.prototype)
        throw new TypeError(`${name} graph node has an unrecognized DisplayObject lifecycle chain`);
};

class DisplayObjectHitArea implements IHitArea {
    private static readonly input = new InputManager();
    constructor(readonly state: DisplayObject) { }
    contains(x: number, y: number, _owner: LayaSprite): boolean {
        const local = this.state.fromParentPoint(new Point(x, y));
        return this.containsSprite(this.state, local.x, local.y);
    }
    private containsSprite(sprite: LayaSprite, x: number, y: number): boolean {
        for (let index = sprite.numChildren - 1; index >= 0; index--) {
            const child = sprite.getChildAt(index);
            if (!(child instanceof LayaSprite)) continue;
            const local = child.fromParentPoint(new Point(x, y));
            if (this.containsSprite(child, local.x, local.y)) return true;
        }
        return DisplayObjectHitArea.input.hitTest(sprite, x, y);
    }
}

/** Flash-shaped SimpleButton using native Laya children and InputManager hit testing. */
export class SimpleButton extends InteractiveObject {
    useHandCursor = true;
    private _upState: DisplayObject | null = null;
    private _overState: DisplayObject | null = null;
    private _downState: DisplayObject | null = null;
    private _hitTestState: DisplayObject | null = null;
    private _enabled = true;
    private _authoredMouseEnabled = true;
    private _updatingEnabled = false;
    private _trackAsMenu = false;
    private _visualState: ButtonVisualState = "up";

    constructor(upState: DisplayObject | null = null, overState: DisplayObject | null = null,
        downState: DisplayObject | null = null, hitTestState: DisplayObject | null = null) {
        super();
        this.mouseEnabled = true;
        this.mouseThrough = false;
        this.on(LayaEvent.MOUSE_OVER, this, this._showOverState);
        this.on(LayaEvent.MOUSE_OUT, this, this._showUpState);
        this.on(LayaEvent.MOUSE_DOWN, this, this._showDownState);
        this.on(LayaEvent.MOUSE_UP, this, this._showOverState);
        this.upState = upState;
        this.overState = overState;
        this.downState = downState;
        this.hitTestState = hitTestState;
    }

    get enabled(): boolean { return this._enabled; }
    set enabled(value: boolean) {
        this._enabled = !!value;
        this._updatingEnabled = true;
        try { super.mouseEnabled = this._enabled && this._authoredMouseEnabled; }
        finally { this._updatingEnabled = false; }
        if (!this._enabled) this._setVisualState("up");
    }

    override get mouseEnabled(): boolean { return super.mouseEnabled; }
    override set mouseEnabled(value: boolean) {
        if (!this._updatingEnabled) this._authoredMouseEnabled = !!value;
        super.mouseEnabled = this._enabled && this._authoredMouseEnabled;
    }

    get trackAsMenu(): boolean { return this._trackAsMenu; }
    set trackAsMenu(value: boolean) {
        if (value) throw new UnsupportedFlashFeatureError("flash.display.SimpleButton.trackAsMenu", "menu tracking is not admitted");
        this._trackAsMenu = false;
    }

    get upState(): DisplayObject | null { return this._upState; }
    set upState(value: DisplayObject | null) { this._replaceState("_upState", value, "upState"); }
    get overState(): DisplayObject | null { return this._overState; }
    set overState(value: DisplayObject | null) { this._replaceState("_overState", value, "overState"); }
    get downState(): DisplayObject | null { return this._downState; }
    set downState(value: DisplayObject | null) { this._replaceState("_downState", value, "downState"); }
    get hitTestState(): DisplayObject | null { return this._hitTestState; }
    set hitTestState(value: DisplayObject | null) {
        this._replaceState("_hitTestState", value, "hitTestState");
        this._refreshHitArea();
    }

    override onAfterDeserialize(): void {
        super.onAfterDeserialize();
        this._upState = this._childState("upState") ?? this._upState;
        this._overState = this._childState("overState") ?? this._overState;
        this._downState = this._childState("downState") ?? this._downState;
        this._hitTestState = this._childState("hitTestState") ?? this._hitTestState;
        this._applyStateVisibility();
        this._refreshHitArea();
    }

    private _childState(name: string): DisplayObject | null {
        const child = this.getChildByName(name);
        return child instanceof DisplayObject ? child : null;
    }

    private _replaceState(slot: ButtonStateSlot, value: DisplayObject | null, name: string): void {
        const active = buttonTransactions.get(this);
        if (active) {
            active.poisoned = true;
            nextButtonRevision(this);
            throw new Error(`${name} replacement is not reentrant`);
        }
        const transaction: ButtonStateTransaction = { revision: nextButtonRevision(this), poisoned: false };
        buttonTransactions.set(this, transaction);
        try {
            this._replaceStateTransaction(slot, value, name, transaction);
        } finally {
            if (buttonTransactions.get(this) === transaction) buttonTransactions.delete(this);
        }
    }

    private _replaceStateTransaction(slot: ButtonStateSlot, value: DisplayObject | null, name: string,
        transaction: ButtonStateTransaction): void {
        if (value !== null && !(value instanceof DisplayObject)) throw new TypeError(`${name} must be a DisplayObject or null`);
        if (value === this || value?.contains(this))
            throw new TypeError(`${name} must not be the button or one of its ancestors`);
        const old = this[slot];
        if (old === value) return;
        const stateSlots = new Map<ButtonStateSlot, DisplayObject | null>(
            BUTTON_STATE_SLOTS.map(stateSlot => [stateSlot, this[stateSlot]]),
        );
        if (value) {
            assertCanonicalStateLifecycle(value, name);
            assertConsistentPlacement(value, name);
        }
        if (old) {
            assertCanonicalStateLifecycle(old, name);
            assertConsistentPlacement(old, name);
        }
        const snapshots = [...new Set([old, value].filter((item): item is DisplayObject => item !== null))].map(item => ({
            item,
            parent: item.parent,
            actualParent: nodeInternals(item)._parent,
            name: item.name,
            mouseEnabled: nativeMouseEnabled(item),
            visible: nativeVisible(item),
        }));
        const initialButtonChildren = new Set<LayaNode>([
            ...nodeInternals(this)._children,
            ...nodeInternals(this)._$children,
        ]);
        const placementNodes = collectNodeGraph([
            this,
            ...initialButtonChildren,
            ...snapshots.map(snapshot => snapshot.item),
            ...BUTTON_STATE_SLOTS.map(stateSlot => stateSlots.get(stateSlot)).filter((item): item is DisplayObject => item != null),
        ]);
        for (const node of placementNodes) assertCanonicalGraphLifecycle(node, name);
        const placements = [...placementNodes].map(item => ({
            item,
            actualParent: nodeInternals(item)._parent,
            logicalParent: nodeInternals(item)._$parent,
            container: nodeInternals(item)._$container,
            children: nodeInternals(item)._children,
            logicalChildren: nodeInternals(item)._$children,
            destroyed: nodeInternals(item)._destroyed,
        }));
        const childArrays = new Map<LayaNode[], LayaNode[]>();
        const snapshotArrays = (node: LayaNode | null): void => {
            if (!node) return;
            const internals = nodeInternals(node);
            if (!childArrays.has(internals._children)) childArrays.set(internals._children, internals._children.slice());
            if (!childArrays.has(internals._$children)) childArrays.set(internals._$children, internals._$children.slice());
        };
        for (const placement of placements) {
            snapshotArrays(placement.item);
            snapshotArrays(placement.container);
        }
        const expectedArrays = new Map<LayaNode[], LayaNode[]>(
            [...childArrays].map(([children, saved]) => [children, saved.slice()]),
        );
        const expectedActualParents = new Map(placements.map(placement => [placement.item, placement.actualParent]));
        const expectedLogicalParents = new Map(placements.map(placement => [placement.item, placement.logicalParent]));
        const expectedSlots = new Map(stateSlots);
        expectedSlots.set(slot, value);
        const expectedChildren = (parent: LayaNode): LayaNode[] => {
            const children = nodeInternals(parent)._$children;
            const expected = expectedArrays.get(children);
            if (!expected) throw new Error(`${name} replacement is missing an expected Laya child-array snapshot`);
            return expected;
        };
        if (value && value.parent !== this) {
            if (value.parent) {
                const source = expectedChildren(value.parent);
                const sourceIndex = source.indexOf(value);
                if (sourceIndex < 0) throw new Error(`${name} state is absent from its snapshotted source parent`);
                source.splice(sourceIndex, 1);
            }
            expectedChildren(this).push(value);
            expectedActualParents.set(value, nodeInternals(this)._$container);
            expectedLogicalParents.set(value, this);
        }
        if (old && old.parent === this && ![...expectedSlots.values()].includes(old)) {
            const ownerChildren = expectedChildren(this);
            const oldIndex = ownerChildren.indexOf(old);
            if (oldIndex < 0) throw new Error(`${name} prior state is absent from its snapshotted owner`);
            ownerChildren.splice(oldIndex, 1);
            expectedActualParents.set(old, null);
            expectedLogicalParents.set(old, null);
        }
        const nodeTransaction = beginNodeMutationTransaction(placementNodes,
            operation => poisonButtonTransaction(this, operation));
        transaction.nodeTransaction = nodeTransaction;
        try {
          try {
            if (value) {
                if (!value.name) value.name = name;
                setNativeMouseEnabled(value, false);
                if (value.parent !== this) {
                    if (value.parent) {
                        const sourceParent = value.parent;
                        runPermittedNodeMutation(nodeTransaction, [
                            { node: sourceParent, operation: "removeChild" },
                            { node: value, operation: "setParentDerived" },
                            { node: value, operation: "setParent" },
                        ], () => nativeRemove(sourceParent, value));
                    }
                    runPermittedNodeMutation(nodeTransaction, [
                        { node: this, operation: "addChildAt" },
                        { node: value, operation: "setParentDerived" },
                        { node: value, operation: "setParent" },
                    ], () => nativeAdd(this, value, this.numChildren));
                }
            }
            this[slot] = value;
            if (old && old.parent === this && !this._stateStillOwned(old)) {
                runPermittedNodeMutation(nodeTransaction, [
                    { node: this, operation: "removeChild" },
                    { node: old, operation: "setParentDerived" },
                    { node: old, operation: "setParent" },
                ], () => nativeRemove(this, old));
            }
            this._applyStateVisibility();
            if (value) assertOwnedPlacement(value, this, name);
            if (old) {
                if (this._stateStillOwned(old)) assertOwnedPlacement(old, this, name);
                else assertDetachedFromOwner(old, this, name);
            }
            for (const stateSlot of BUTTON_STATE_SLOTS) {
                const expected = stateSlot === slot ? value : stateSlots.get(stateSlot)!;
                if (this[stateSlot] !== expected)
                    throw new Error(`${name} replacement observed a reentrant state-slot mutation`);
            }
            for (const placement of placements) {
                const internals = nodeInternals(placement.item);
                if (internals._$container !== placement.container || internals._children !== placement.children
                    || internals._$children !== placement.logicalChildren || internals._destroyed !== placement.destroyed)
                    throw new Error(`${name} replacement observed a direct Laya lifecycle or container mutation`);
                if (internals._parent !== expectedActualParents.get(placement.item)
                    || internals._$parent !== expectedLogicalParents.get(placement.item))
                    throw new Error(`${name} replacement observed a direct Laya parent-field mutation`);
            }
            for (const [children, expected] of expectedArrays) {
                if (children.length !== expected.length || children.some((child, index) => child !== expected[index]))
                    throw new Error(`${name} replacement observed a direct Laya child-array content mutation`);
            }
            for (const placement of placements) {
                const logicalParent = expectedLogicalParents.get(placement.item);
                const actualParent = expectedActualParents.get(placement.item);
                if (!logicalParent || !actualParent) {
                    if (logicalParent != null || actualParent != null)
                        throw new Error(`${name} replacement produced split Laya parent fields`);
                    continue;
                }
                const logicalChildren = expectedArrays.get(nodeInternals(logicalParent)._$children);
                const actualChildren = expectedArrays.get(nodeInternals(actualParent)._children);
                if (nodeInternals(logicalParent)._$container !== actualParent
                    || logicalChildren?.filter(child => child === placement.item).length !== 1
                    || actualChildren?.filter(child => child === placement.item).length !== 1)
                    throw new Error(`${name} replacement produced an inconsistent recursive Laya graph`);
            }
            if (transaction.poisoned || buttonRevisions.get(this) !== transaction.revision)
                throw new Error(`${name} replacement was poisoned by reentrant state or child mutation`);
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            for (const stateSlot of BUTTON_STATE_SLOTS) this[stateSlot] = stateSlots.get(stateSlot)!;
            try {
                const currentGraph = collectNodeGraph([
                    ...placementNodes,
                    this, old, value,
                    ...BUTTON_STATE_SLOTS.map(stateSlot => this[stateSlot]),
                ]);
                const introducedChildren = [...currentGraph].filter(child => !placementNodes.has(child));
                for (const [children, saved] of childArrays)
                    children.splice(0, children.length, ...saved);
                for (const placement of placements) {
                    const internals = nodeInternals(placement.item);
                    internals._parent = placement.actualParent;
                    internals._$parent = placement.logicalParent;
                    internals._$container = placement.container;
                    internals._children = placement.children;
                    internals._$children = placement.logicalChildren;
                    internals._destroyed = placement.destroyed;
                }
                const owner = nodeInternals(this);
                const guardedContainers = new Set(placements.map(placement => placement.container));
                for (const child of introducedChildren) {
                    const internals = nodeInternals(child);
                    if ((internals._parent && guardedContainers.has(internals._parent))
                        || (internals._$parent && placementNodes.has(internals._$parent))) {
                        internals._parent = null;
                        internals._$parent = null;
                    }
                }
                for (const [children, saved] of childArrays) {
                    if (children.length !== saved.length || children.some((child, index) => child !== saved[index]))
                        throw new Error("Laya child-array rollback did not restore the exact snapshot");
                }
                for (const placement of placements) {
                    const internals = nodeInternals(placement.item);
                    if (internals._parent !== placement.actualParent || internals._$parent !== placement.logicalParent)
                        throw new Error("Laya parent-field rollback did not restore the exact snapshot");
                    if (internals._$container !== placement.container || internals._children !== placement.children
                        || internals._$children !== placement.logicalChildren || internals._destroyed !== placement.destroyed)
                        throw new Error("Laya lifecycle/container rollback did not restore the exact snapshot");
                    if (!placement.logicalParent || !placement.actualParent) {
                        if (placement.logicalParent != null || placement.actualParent != null)
                            throw new Error("Laya rollback restored split parent fields");
                    } else {
                        const logicalSaved = childArrays.get(nodeInternals(placement.logicalParent)._$children);
                        const actualSaved = childArrays.get(nodeInternals(placement.actualParent)._children);
                        if (nodeInternals(placement.logicalParent)._$container !== placement.actualParent
                            || logicalSaved?.filter(child => child === placement.item).length !== 1
                            || actualSaved?.filter(child => child === placement.item).length !== 1)
                            throw new Error("Laya rollback did not restore recursive graph closure");
                    }
                }
                for (const child of owner._$children) {
                    const internals = nodeInternals(child);
                    if (internals._$parent !== this || internals._parent !== owner._$container)
                        throw new Error("Laya button rollback did not restore bidirectional child closure");
                }
                for (const child of introducedChildren) {
                    const internals = nodeInternals(child);
                    if ([...childArrays.keys()].some(children => children.includes(child))
                        || (internals._$parent && placementNodes.has(internals._$parent))
                        || (internals._parent && guardedContainers.has(internals._parent)))
                        throw new Error("Laya button rollback retained an introduced child");
                }
            } catch (rollback) { rollbackErrors.push(rollback); }
            for (const snapshot of snapshots) {
                try { snapshot.item.name = snapshot.name; } catch (rollback) { rollbackErrors.push(rollback); }
                try { setNativeMouseEnabled(snapshot.item, snapshot.mouseEnabled); } catch (rollback) { rollbackErrors.push(rollback); }
                try { setNativeVisible(snapshot.item, snapshot.visible); } catch (rollback) { rollbackErrors.push(rollback); }
            }
            if (rollbackErrors.length > 0) {
                const failure = new Error(`${name} replacement rollback failed`);
                (failure as Error & { causes?: readonly unknown[] }).causes = [error, ...rollbackErrors];
                throw failure;
            }
            throw error;
          }
        } finally {
            endNodeMutationTransaction(nodeTransaction);
            transaction.nodeTransaction = undefined;
        }
    }

    private _stateStillOwned(value: DisplayObject): boolean {
        return this._upState === value || this._overState === value || this._downState === value || this._hitTestState === value;
    }

    private _refreshHitArea(): void {
        if (this._hitTestState) {
            this.hitArea = new DisplayObjectHitArea(this._hitTestState);
        } else {
            this.hitArea = null as any;
        }
    }

    private _showUpState(): void { this._setVisualState("up"); }
    private _showOverState(): void { if (this._enabled) this._setVisualState("over"); }
    private _showDownState(): void { if (this._enabled) this._setVisualState("down"); }
    private _setVisualState(value: ButtonVisualState): void { this._visualState = value; this._applyStateVisibility(); }
    private _applyStateVisibility(): void {
        const visible = new Map<DisplayObject, boolean>();
        const include = (state: DisplayObject | null, active: boolean): void => {
            if (state) visible.set(state, (visible.get(state) ?? false) || active);
        };
        include(this._hitTestState, false);
        include(this._upState, this._visualState === "up");
        include(this._overState, this._visualState === "over");
        include(this._downState, this._visualState === "down");
        for (const [state, active] of visible) setNativeVisible(state, active);
    }
}
