import { Event as LayaEvent } from "../../laya/events/Event";
import { Point } from "../../laya/maths/Point";
import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { Node as LayaNode } from "../../laya/display/Node";
import { IHitArea } from "../../laya/utils/IHitArea";
import { InputManager } from "../../laya/events/InputManager";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { DisplayObject } from "./DisplayObject";
import { InteractiveObject } from "./InteractiveObject";

type ButtonVisualState = "up" | "over" | "down";
type ButtonStateSlot = "_upState" | "_overState" | "_downState" | "_hitTestState";

const visibleDescriptor = Object.getOwnPropertyDescriptor(LayaSprite.prototype, "visible");
const mouseDescriptor = Object.getOwnPropertyDescriptor(LayaSprite.prototype, "mouseEnabled");
if (!visibleDescriptor?.get || !visibleDescriptor.set || !mouseDescriptor?.get || !mouseDescriptor.set)
    throw new Error("Laya Sprite native state descriptors are unavailable");
const nativeVisible = (value: DisplayObject): boolean => visibleDescriptor.get!.call(value);
const setNativeVisible = (value: DisplayObject, visible: boolean): void => visibleDescriptor.set!.call(value, visible);
const nativeMouseEnabled = (value: DisplayObject): boolean => mouseDescriptor.get!.call(value);
const setNativeMouseEnabled = (value: DisplayObject, enabled: boolean): void => mouseDescriptor.set!.call(value, enabled);
const nativeRemove = (parent: LayaNode, value: DisplayObject): void => {
    if (value.parent === parent) LayaNode.prototype.removeChild.call(parent, value);
};
const nativeAdd = (parent: LayaNode, value: DisplayObject, index: number): void => {
    LayaNode.prototype.addChildAt.call(parent, value, Math.max(0, Math.min(index, parent.numChildren)));
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
        if (value !== null && !(value instanceof DisplayObject)) throw new TypeError(`${name} must be a DisplayObject or null`);
        if (value === this || value?.contains(this))
            throw new TypeError(`${name} must not be the button or one of its ancestors`);
        const old = this[slot];
        if (old === value) return;
        const snapshots = [...new Set([old, value].filter((item): item is DisplayObject => item !== null))].map(item => ({
            item,
            parent: item.parent,
            index: item.parent ? item.parent.getChildIndex(item) : -1,
            name: item.name,
            mouseEnabled: nativeMouseEnabled(item),
            visible: nativeVisible(item),
        }));
        try {
            if (value) {
                if (!value.name) value.name = name;
                setNativeMouseEnabled(value, false);
                if (value.parent !== this) {
                    if (value.parent) nativeRemove(value.parent, value);
                    nativeAdd(this, value, this.numChildren);
                }
            }
            this[slot] = value;
            if (old && old.parent === this && !this._stateStillOwned(old)) nativeRemove(this, old);
            this._applyStateVisibility();
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            this[slot] = old;
            try {
                for (const snapshot of snapshots) {
                    if (snapshot.item.parent && snapshot.item.parent !== snapshot.parent)
                        nativeRemove(snapshot.item.parent, snapshot.item);
                }
                for (const snapshot of snapshots.slice().sort((left, right) => left.index - right.index)) {
                    if (snapshot.parent && snapshot.item.parent !== snapshot.parent)
                        nativeAdd(snapshot.parent, snapshot.item, snapshot.index);
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
