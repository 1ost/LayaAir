import { ContextMenuEvent } from "../events/ContextMenuEvent";
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

interface ContextMenuOwner {
    readonly parent?: ContextMenuOwner | null;
    readonly destroyed?: boolean;
    readonly contextMenu?: ContextMenu | null;
    _applyNativeFocus?(value: boolean): void;
}

export interface NativeContextMenuHostOptions {
    readonly canvas: HTMLElement;
    readonly resolveTarget: () => unknown;
    readonly document?: Document;
}

export interface NativeContextMenuHostLease {
    readonly open: boolean;
    dismiss(): void;
    dispose(): void;
}

function findOwner(value: unknown): ContextMenuOwner | null {
    const seen = new Set<object>();
    let current = value as ContextMenuOwner | null;
    while (typeof current === "object" && current !== null) {
        if (seen.has(current)) throw new Error("Context-menu owner ancestry is cyclic");
        seen.add(current);
        if (!current.destroyed && isFlashContextMenu(current.contextMenu)) return current;
        current = current.parent ?? null;
    }
    return null;
}

/**
 * Installs an accessible DOM context menu over a Laya canvas. Selection is
 * dispatched directly from the trusted click/keyboard event, preserving the
 * browser user-activation window required by clipboard and navigation APIs.
 */
export function installNativeContextMenuHost(options: NativeContextMenuHostOptions): NativeContextMenuHostLease {
    if (!options || typeof options !== "object") throw new TypeError("Native context-menu options are required");
    const canvas = options.canvas;
    const document = options.document ?? globalThis.document;
    if (!canvas || typeof canvas.addEventListener !== "function" || !document?.body)
        throw new TypeError("Native context-menu host requires a live canvas and document body");
    if (typeof options.resolveTarget !== "function")
        throw new TypeError("Native context-menu host requires a target resolver");

    let popup: HTMLDivElement | null = null;
    let previousFocus: HTMLElement | null = null;
    let disposed = false;

    const dismiss = (): void => {
        if (!popup) return;
        popup.remove();
        popup = null;
        const restore = previousFocus;
        previousFocus = null;
        if (restore?.isConnected) {
            try { restore.focus({ preventScroll: true }); }
            catch { /* The menu is already closed; a hostile focus override cannot retain host authority. */ }
        }
    };

    const activate = (item: ContextMenuItem, owner: ContextMenuOwner): void => {
        if (!item.visible || !item.enabled) return;
        dismiss();
        item.dispatchEvent(new ContextMenuEvent(ContextMenuEvent.MENU_ITEM_SELECT, false, false, owner, owner));
    };

    const onDocumentPointerDown = (event: Event): void => {
        if (popup && !popup.contains(event.target as Node)) dismiss();
    };
    const onWindowBlur = (): void => dismiss();

    const onContextMenu = (nativeEvent: Event): void => {
        if (disposed) return;
        const event = nativeEvent as MouseEvent;
        const owner = findOwner(options.resolveTarget());
        if (!owner) return;
        const menu = owner.contextMenu!;
        event.preventDefault();
        dismiss();
        owner._applyNativeFocus?.(true);
        menu.dispatchEvent(new ContextMenuEvent(ContextMenuEvent.MENU_SELECT, false, false, owner, owner));

        const items = (menu.customItems ?? []).filter(item => item.visible);
        if (items.length === 0) return;
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const container = document.createElement("div");
        container.dataset.flashContextMenu = "true";
        container.setAttribute("role", "menu");
        Object.assign(container.style, {
            position: "fixed", left: `${event.clientX}px`, top: `${event.clientY}px`, zIndex: "2147483647",
            minWidth: "12rem", padding: "4px", color: "CanvasText", background: "Canvas",
            border: "1px solid GrayText", borderRadius: "3px", boxShadow: "0 2px 8px #0006",
            font: "menu", display: "grid",
        });
        const buttons: HTMLButtonElement[] = [];
        for (const item of items) {
            if (item.separatorBefore) {
                const separator = document.createElement("div");
                separator.setAttribute("role", "separator");
                separator.style.borderTop = "1px solid GrayText";
                separator.style.margin = "3px 0";
                container.appendChild(separator);
            }
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "menuitem");
            button.textContent = item.caption ?? "";
            button.disabled = !item.enabled;
            button.style.cssText = "display:block;width:100%;text-align:left;border:0;padding:4px 8px;background:transparent;color:inherit;font:inherit";
            button.addEventListener("click", () => activate(item, owner));
            container.appendChild(button);
            if (item.enabled) buttons.push(button);
        }
        container.addEventListener("keydown", keyboardEvent => {
            if (keyboardEvent.key === "Escape") {
                keyboardEvent.preventDefault();
                dismiss();
                return;
            }
            if (buttons.length === 0) return;
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const delta = keyboardEvent.key === "ArrowDown" ? 1 : keyboardEvent.key === "ArrowUp" ? -1 : 0;
            if (delta !== 0) {
                keyboardEvent.preventDefault();
                buttons[(index + delta + buttons.length) % buttons.length].focus();
            }
        });
        document.body.appendChild(container);
        popup = container;
        buttons[0]?.focus({ preventScroll: true });
    };

    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.defaultView?.addEventListener("blur", onWindowBlur);

    return Object.freeze({
        get open(): boolean { return popup !== null; },
        dismiss,
        dispose(): void {
            if (disposed) return;
            disposed = true;
            canvas.removeEventListener("contextmenu", onContextMenu);
            document.removeEventListener("pointerdown", onDocumentPointerDown, true);
            document.defaultView?.removeEventListener("blur", onWindowBlur);
            dismiss();
        },
    });
}
