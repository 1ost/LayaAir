import { ILaya, type Mutable } from "../../ILaya";
import { getInputEventOwner } from "../../laya/display/Input";
import { Node as LayaNode } from "../../laya/display/Node";
import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { Event as LayaEvent } from "../../laya/events/Event";
import { ContextMenu, isFlashContextMenu } from "../ui/ContextMenu";
import { DisplayObject } from "./DisplayObject";

const FOCUS_MANAGERS = new WeakSet<object>();
const INTERACTIVE_OBJECT_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash interactive objects. */
export function isFlashInteractiveObject(value: unknown): value is InteractiveObject {
    return typeof value === "object" && value !== null && INTERACTIVE_OBJECT_VALUES.has(value);
}

/** @internal Resolves a native focus target to its canonical Flash owner. */
export function resolveFlashFocusOwner(value: unknown): InteractiveObject | null {
    const owner = getInputEventOwner(value) ?? value;
    return isFlashInteractiveObject(owner) ? owner : null;
}

function tabCandidates(stage: LayaNode): InteractiveObject[] {
    const ordered: Array<{ value: InteractiveObject, order: number }> = [];
    let order = 0;
    const visit = (node: LayaNode): void => {
        if (isFlashInteractiveObject(node) && node.tabEnabled && node.activeInHierarchy) {
            if (node.tabIndex < 0)
                throw new Error(`Tab-enabled InteractiveObject '${node.name}' requires an explicit nonnegative tabIndex`);
            ordered.push({ value: node, order: order++ });
        }
        for (const child of node._children) visit(child);
    };
    visit(stage);
    ordered.sort((left, right) => left.value.tabIndex - right.value.tabIndex || left.order - right.order);
    for (let index = 1; index < ordered.length; index++) {
        if (ordered[index - 1].value.tabIndex === ordered[index].value.tabIndex)
            throw new Error(`Tab-enabled InteractiveObjects require unique tabIndex ${ordered[index].value.tabIndex}`);
    }
    return ordered.map(item => item.value);
}

function installFocusTraversal(stage: LayaNode): void {
    if (FOCUS_MANAGERS.has(stage) || typeof (stage as { on?: unknown }).on !== "function") return;
    FOCUS_MANAGERS.add(stage);
    stage.on(LayaEvent.KEY_DOWN, stage, (event: unknown) => {
        if (!(event instanceof LayaEvent)) return;
        const native = event.nativeEvent as KeyboardEvent | null;
        if (!native || native.key !== "Tab") return;
        let candidates: InteractiveObject[];
        try { candidates = tabCandidates(stage); }
        catch (error) {
            event.preventDefault();
            throw error;
        }
        if (candidates.length === 0) return;
        const current = resolveFlashFocusOwner((stage as unknown as { focus?: LayaNode | null }).focus);
        const currentIndex = current ? candidates.indexOf(current) : -1;
        const direction = native.shiftKey ? -1 : 1;
        const nextIndex = currentIndex < 0
            ? (direction > 0 ? 0 : candidates.length - 1)
            : (currentIndex + direction + candidates.length) % candidates.length;
        const apply = (value: InteractiveObject, focused: boolean): void =>
            (value as unknown as { _applyNativeFocus(value: boolean): void })._applyNativeFocus(focused);
        if (current && current !== candidates[nextIndex]) apply(current, false);
        apply(candidates[nextIndex], true);
        event.preventDefault();
    });
}

/** Flash interactive base; Laya Sprite supplies mouseEnabled and hit testing. */
export class InteractiveObject extends DisplayObject {
    doubleClickEnabled: boolean = false;
    needsSoftKeyboard: boolean = false;
    private _tabEnabled = false;
    private _tabIndex = -1;
    private _focusRect: object | boolean | null = null;
    private _focusIndicator: LayaSprite | null = null;
    private _contextMenu: ContextMenu | null = null;

    get tabEnabled(): boolean { return this._tabEnabled; }
    set tabEnabled(value: boolean) { this._tabEnabled = !!value; }

    get tabIndex(): number { return this._tabIndex; }
    set tabIndex(value: number) {
        if (!Number.isInteger(value) || value < -1)
            throw new TypeError("InteractiveObject.tabIndex must be an integer greater than or equal to -1");
        this._tabIndex = value;
    }

    get focusRect(): object | boolean | null { return this._focusRect; }
    set focusRect(value: object | boolean | null) {
        if (value !== null && typeof value !== "object" && typeof value !== "boolean")
            throw new TypeError("InteractiveObject.focusRect must be an object, boolean or null");
        this._focusRect = value;
        if (this._focusIndicator) this._showFocusIndicator(value !== false && value !== null);
    }

    get contextMenu(): ContextMenu | null { return this._contextMenu; }
    set contextMenu(value: ContextMenu | null) {
        if (value !== null && !isFlashContextMenu(value))
            throw new TypeError("InteractiveObject.contextMenu requires ContextMenu or null");
        this._contextMenu = value;
    }

    constructor() {
        super();
        INTERACTIVE_OBJECT_VALUES.add(this);
        this.mouseEnabled = true;
        this.on(LayaEvent.DISPLAY, this, () => installFocusTraversal(ILaya.stage));
        if (ILaya.stage) installFocusTraversal(ILaya.stage);
    }

    /** Native focus-manager seam; TextField overrides it for its composed Input. @internal */
    protected _applyNativeFocus(value: boolean): void {
        const stage = ILaya.stage as unknown as Mutable<{ focus: LayaNode | null }>;
        if (value) {
            stage.focus = this;
            this.event(LayaEvent.FOCUS);
        } else if (stage.focus === this) {
            stage.focus = null;
            this.event(LayaEvent.BLUR);
        }
        this._showFocusIndicator(value && this._focusRect !== false && this._focusRect !== null);
    }

    /** Synchronizes pointer/native-adapter focus with the visible Flash focus ring. @internal */
    protected _syncNativeFocusIndicator(value: boolean): void {
        this._showFocusIndicator(value && this._focusRect !== false && this._focusRect !== null);
    }

    private _showFocusIndicator(value: boolean): void {
        if (!value) {
            if ((this._focusIndicator?.parent as unknown) === this) this.removeChild(this._focusIndicator);
            return;
        }
        if (!this._focusIndicator) {
            this._focusIndicator = new LayaSprite();
            this._focusIndicator.name = "__flashFocusIndicator";
            this._focusIndicator.mouseEnabled = false;
        }
        this._focusIndicator.graphics.clear();
        this._focusIndicator.graphics.drawRect(0, 0, Math.max(1, this.width), Math.max(1, this.height), null, "#4a90e2", 2);
        if ((this._focusIndicator.parent as unknown) !== this) this.addChild(this._focusIndicator);
    }
}
