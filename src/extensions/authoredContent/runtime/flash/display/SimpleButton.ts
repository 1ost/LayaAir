import { Event as LayaEvent } from "../../../../../layaAir/laya/events/Event";
import { Point } from "../../../../../layaAir/laya/maths/Point";
import { Sprite as LayaSprite } from "../../../../../layaAir/laya/display/Sprite";
import { IHitArea } from "../../../../../layaAir/laya/utils/IHitArea";
import { UnsupportedFlashFeatureError } from "../../UnsupportedFlashFeatureError";
import { DisplayObject } from "./DisplayObject";
import { InteractiveObject } from "./InteractiveObject";

type ButtonVisualState = "up" | "over" | "down";
type ButtonStateSlot = "_upState" | "_overState" | "_downState" | "_hitTestState";

class DisplayObjectHitArea implements IHitArea {
    constructor(readonly state: DisplayObject) { }
    contains(x: number, y: number, _owner: LayaSprite): boolean {
        const local = this.state.fromParentPoint(new Point(x, y));
        if (this.state.width > 0 && this.state.height > 0)
            return local.x >= 0 && local.y >= 0 && local.x < this.state.width && local.y < this.state.height;
        return this.state.getBounds().contains(local.x, local.y);
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
        this.mouseEnabled = this._enabled;
        if (!this._enabled) this._setVisualState("up");
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
        const old = this[slot];
        if (old === value) return;
        this[slot] = value;
        if (value) {
            if (value.parent !== this) this.addChild(value);
            if (!value.name) value.name = name;
            value.mouseEnabled = false;
        }
        if (old && old.parent === this && !this._stateStillOwned(old)) this.removeChild(old);
        this._applyStateVisibility();
    }

    private _stateStillOwned(value: DisplayObject): boolean {
        return this._upState === value || this._overState === value || this._downState === value || this._hitTestState === value;
    }

    private _refreshHitArea(): void {
        if (this._hitTestState) {
            this._hitTestState.visible = false;
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
        if (this._upState) this._upState.visible = this._visualState === "up";
        if (this._overState) this._overState.visible = this._visualState === "over";
        if (this._downState) this._downState.visible = this._visualState === "down";
        if (this._hitTestState) this._hitTestState.visible = false;
    }
}
