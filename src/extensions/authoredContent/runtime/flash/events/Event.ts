/** Flash-compatible event phases projected onto a native Laya display path. */
export const enum EventPhase {
    CAPTURING_PHASE = 1,
    AT_TARGET = 2,
    BUBBLING_PHASE = 3
}

const EVENT_TYPE = /^[^\u0000-\u001f\u007f]{1,128}$/;

/** Source-shaped `flash.events.Event`; transport and display ownership remain native Laya. */
export class Event {
    static readonly ACTIVATE = "activate";
    static readonly ADDED = "added";
    static readonly ADDED_TO_STAGE = "addedToStage";
    static readonly CANCEL = "cancel";
    static readonly CHANGE = "change";
    static readonly CLOSE = "close";
    static readonly COMPLETE = "complete";
    static readonly CONNECT = "connect";
    static readonly DEACTIVATE = "deactivate";
    static readonly ENTER_FRAME = "enterFrame";
    static readonly EXIT_FRAME = "exitFrame";
    static readonly FRAME_CONSTRUCTED = "frameConstructed";
    static readonly INIT = "init";
    static readonly MOUSE_LEAVE = "mouseLeave";
    static readonly OPEN = "open";
    static readonly REMOVED = "removed";
    static readonly REMOVED_FROM_STAGE = "removedFromStage";
    static readonly RENDER = "render";
    static readonly RESIZE = "resize";
    static readonly SCROLL = "scroll";
    static readonly SELECT = "select";
    static readonly SOUND_COMPLETE = "soundComplete";
    static readonly UNLOAD = "unload";

    readonly type: string;
    readonly bubbles: boolean;
    readonly cancelable: boolean;

    private _eventPhase: EventPhase = EventPhase.AT_TARGET;
    private _target: unknown = null;
    private _currentTarget: unknown = null;
    private _immediatePropagationStopped = false;
    private _propagationStopped = false;
    private _defaultWasPrevented = false;
    private _nativeControl: { stopPropagation(): void; preventDefault(): void } | null = null;

    constructor(type: string, bubbles: boolean = false, cancelable: boolean = false) {
        if (typeof type !== "string" || !EVENT_TYPE.test(type) || type.trim() !== type)
            throw new TypeError("Event.type must be a nonempty validated string");
        this.type = type;
        this.bubbles = bubbles;
        this.cancelable = cancelable;
    }

    get eventPhase(): EventPhase { return this._eventPhase; }
    get target(): unknown { return this._target; }
    get currentTarget(): unknown { return this._currentTarget; }

    clone(): Event { return new Event(this.type, this.bubbles, this.cancelable); }
    isDefaultPrevented(): boolean { return this._defaultWasPrevented; }

    preventDefault(): void {
        if (this.cancelable) {
            this._defaultWasPrevented = true;
            this._nativeControl?.preventDefault();
        }
    }

    stopPropagation(): void {
        this._propagationStopped = true;
        this._nativeControl?.stopPropagation();
    }

    stopImmediatePropagation(): void {
        this._immediatePropagationStopped = true;
        this.stopPropagation();
    }

    toString(): string {
        return `[Event type="${this.type}" bubbles=${this.bubbles} cancelable=${this.cancelable}]`;
    }

    /** @internal */
    _prepareForDispatch(target: unknown): void {
        this._target = target;
        this._currentTarget = null;
        this._eventPhase = EventPhase.AT_TARGET;
        this._propagationStopped = false;
        this._defaultWasPrevented = false;
        this._immediatePropagationStopped = false;
        this._nativeControl = null;
    }

    /** @internal */
    _setCurrentTarget(currentTarget: unknown, phase: EventPhase): void {
        this._currentTarget = currentTarget;
        this._eventPhase = phase;
    }

    /** @internal */
    get _isImmediatePropagationStopped(): boolean { return this._immediatePropagationStopped; }
    /** @internal */
    get _isPropagationStopped(): boolean { return this._propagationStopped; }

    /** @internal */
    _bindNativeControl(control: { stopPropagation(): void; preventDefault(): void }): void {
        this._nativeControl = control;
    }
}
