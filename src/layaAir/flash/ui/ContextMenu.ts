import { EventDispatcher } from "../events/EventDispatcher";

const CONTEXT_MENU_VALUES = new WeakSet<object>();
const CONTEXT_MENU_ITEM_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash context menus. */
export function isFlashContextMenu(value: unknown): value is ContextMenu {
    return typeof value === "object" && value !== null && CONTEXT_MENU_VALUES.has(value);
}

/** @internal Read-only nominal proof for canonical Flash context-menu items. */
export function isFlashContextMenuItem(value: unknown): value is ContextMenuItem {
    return typeof value === "object" && value !== null && CONTEXT_MENU_ITEM_VALUES.has(value);
}

export interface ContextMenuBuiltInItems {
    forwardAndBack: boolean;
    loop: boolean;
    play: boolean;
    print: boolean;
    quality: boolean;
    rewind: boolean;
    save: boolean;
    zoom: boolean;
}

function builtInItems(value = true): ContextMenuBuiltInItems {
    return { forwardAndBack: value, loop: value, play: value, print: value,
        quality: value, rewind: value, save: value, zoom: value };
}

export class ContextMenu extends EventDispatcher {
    readonly builtInItems: ContextMenuBuiltInItems = builtInItems();
    private _customItems: ContextMenuItem[] | null = [];

    constructor() {
        super();
        if (arguments.length !== 0) throw new TypeError("ContextMenu does not accept constructor arguments");
        CONTEXT_MENU_VALUES.add(this);
    }

    get customItems(): ContextMenuItem[] | null { return this._customItems; }
    set customItems(value: ContextMenuItem[] | null) {
        if (value !== null && (!Array.isArray(value) || !value.every(isFlashContextMenuItem)))
            throw new TypeError("ContextMenu.customItems requires ContextMenuItem[] or null");
        this._customItems = value;
    }

    hideBuiltInItems(): void {
        for (const name of Object.keys(this.builtInItems) as Array<keyof ContextMenuBuiltInItems>)
            this.builtInItems[name] = false;
    }
}

export class ContextMenuItem extends EventDispatcher {
    private _caption: string | null;
    private _separatorBefore: boolean;
    private _enabled: boolean;
    private _visible: boolean;

    constructor(caption: string | null, separatorBefore = false, enabled = true, visible = true) {
        super();
        if (arguments.length === 0) throw new TypeError("ContextMenuItem requires a caption");
        CONTEXT_MENU_ITEM_VALUES.add(this);
        this._caption = caption === null ? null : String(caption);
        this._separatorBefore = !!separatorBefore;
        this._enabled = !!enabled;
        this._visible = !!visible;
    }

    get caption(): string | null { return this._caption; }
    set caption(value: string | null) { this._caption = value === null ? null : String(value); }
    get separatorBefore(): boolean { return this._separatorBefore; }
    set separatorBefore(value: boolean) { this._separatorBefore = !!value; }
    get enabled(): boolean { return this._enabled; }
    set enabled(value: boolean) { this._enabled = !!value; }
    get visible(): boolean { return this._visible; }
    set visible(value: boolean) { this._visible = !!value; }

    clone(): ContextMenuItem {
        return new ContextMenuItem(this.caption, this.separatorBefore, this.enabled, this.visible);
    }
}
