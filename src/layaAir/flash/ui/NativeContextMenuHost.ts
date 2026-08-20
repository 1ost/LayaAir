import { isFlashInteractiveObject, resolveFlashFocusOwner, type InteractiveObject } from "../display/InteractiveObject";
import { ContextMenuEvent } from "../events/ContextMenuEvent";
import { ContextMenuItem, isFlashContextMenu, isFlashContextMenuItem } from "./ContextMenu";

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

interface HostAuthority {
    readonly token: object;
    readonly retire: () => void;
}

const CANVAS_AUTHORITIES = new WeakMap<HTMLElement, HostAuthority>();
const CANVAS_INSTALLATIONS = new WeakMap<HTMLElement, object>();

function findOwner(value: unknown): InteractiveObject | null {
    let current = resolveFlashFocusOwner(value);
    const seen = new Set<InteractiveObject>();
    while (current) {
        if (seen.has(current)) throw new Error("Context-menu owner ancestry is cyclic");
        seen.add(current);
        if (!current.destroyed && isFlashContextMenu(current.contextMenu)) return current;
        const parent = current.parent;
        current = isFlashInteractiveObject(parent) ? parent : null;
    }
    return null;
}

/**
 * Installs the single accessible context-menu authority for a Laya canvas.
 * Only trusted browser ingress is admitted, so selection stays inside the
 * browser user-activation stack required by clipboard and navigation APIs.
 */
export function installNativeContextMenuHost(options: NativeContextMenuHostOptions): NativeContextMenuHostLease {
    if (!options || typeof options !== "object") throw new TypeError("Native context-menu options are required");
    const canvas = options.canvas;
    const document = options.document ?? globalThis.document;
    if (!canvas || typeof canvas.addEventListener !== "function" || !document?.body)
        throw new TypeError("Native context-menu host requires a live canvas and document body");
    const resolveTarget = options.resolveTarget;
    if (typeof resolveTarget !== "function")
        throw new TypeError("Native context-menu host requires a target resolver");

    const predecessor = CANVAS_AUTHORITIES.get(canvas);
    const installationToken = Object.freeze({});
    CANVAS_INSTALLATIONS.set(canvas, installationToken);
    let view: Window;
    try {
        const candidate = document.defaultView;
        if (!candidate || typeof candidate.addEventListener !== "function"
            || typeof candidate.removeEventListener !== "function")
            throw new TypeError("Native context-menu host requires one live document window");
        view = candidate;
    } catch (error) {
        if (CANVAS_INSTALLATIONS.get(canvas) === installationToken)
            CANVAS_INSTALLATIONS.delete(canvas);
        throw error;
    }
    if (CANVAS_INSTALLATIONS.get(canvas) !== installationToken
        || CANVAS_AUTHORITIES.get(canvas) !== predecessor) {
        if (CANVAS_INSTALLATIONS.get(canvas) === installationToken)
            CANVAS_INSTALLATIONS.delete(canvas);
        throw new Error("Native context-menu host installation was superseded reentrantly");
    }
    const token = Object.freeze({});
    let popup: HTMLDivElement | null = null;
    let previousFocus: HTMLElement | null = null;
    let disposed = false;
    let generation = 0;

    const ownsCanvas = (): boolean => CANVAS_AUTHORITIES.get(canvas)?.token === token;
    const dismiss = (): void => {
        generation++;
        const current = popup;
        popup = null;
        current?.remove();
        const restore = previousFocus;
        previousFocus = null;
        if (restore?.isConnected) {
            try { restore.focus({ preventScroll: true }); }
            catch { /* Authority is already cleared even if a host focus method throws. */ }
        }
    };

    const activate = (event: MouseEvent | KeyboardEvent, item: ContextMenuItem,
        owner: InteractiveObject, expectedGeneration: number): void => {
        if (!event.isTrusted || disposed || !ownsCanvas() || generation !== expectedGeneration
            || !isFlashContextMenuItem(item) || !item.visible || !item.enabled) return;
        dismiss();
        if (disposed || !ownsCanvas() || generation !== expectedGeneration + 1) return;
        item.dispatchEvent(new ContextMenuEvent(ContextMenuEvent.MENU_ITEM_SELECT, false, false, owner, owner));
    };

    const onDocumentPointerDown = (event: Event): void => {
        if (event.isTrusted && popup && !popup.contains(event.target as Node)) dismiss();
    };
    const onWindowBlur = (): void => dismiss();

    const openFromEvent = (event: MouseEvent | KeyboardEvent, x: number, y: number): void => {
        if (!event.isTrusted || disposed || !ownsCanvas()) return;
        const resolvedTarget = Reflect.apply(resolveTarget, options, []) as unknown;
        if (disposed || !ownsCanvas()) return;
        const owner = findOwner(resolvedTarget);
        if (disposed || !ownsCanvas()) return;
        if (!owner) return;
        const menu = owner.contextMenu;
        if (disposed || !ownsCanvas()) return;
        if (!isFlashContextMenu(menu)) return;
        const rawItems = menu.customItems ?? [];
        if (disposed || !ownsCanvas()) return;
        const snapshot = Array.prototype.slice.call(rawItems) as unknown[];
        if (disposed || !ownsCanvas()) return;
        const canonicalItems = snapshot.every(isFlashContextMenuItem);
        if (disposed || !ownsCanvas() || !canonicalItems) return;

        event.preventDefault();
        dismiss();
        const callbackGeneration = generation;
        if (disposed || !ownsCanvas()) return;
        const activeElement = document.activeElement;
        if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
        previousFocus = activeElement instanceof HTMLElement ? activeElement : null;
        try { (owner as unknown as { _applyNativeFocus(value: boolean): void })._applyNativeFocus(true); }
        catch (error) {
            dismiss();
            throw error;
        }
        if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
        try { menu.dispatchEvent(new ContextMenuEvent(ContextMenuEvent.MENU_SELECT, false, false, owner, owner)); }
        catch (error) {
            dismiss();
            throw error;
        }
        if (disposed || !ownsCanvas() || generation !== callbackGeneration
            || owner.destroyed || owner.contextMenu !== menu) {
            previousFocus = null;
            return;
        }

        const items: ContextMenuItem[] = [];
        for (const item of snapshot as ContextMenuItem[]) {
            const visible = item.visible;
            if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
            if (visible) items.push(item);
        }
        if (items.length === 0) {
            previousFocus = null;
            return;
        }
        const container = document.createElement("div");
        container.dataset.flashContextMenu = "true";
        container.setAttribute("role", "menu");
        Object.assign(container.style, {
            position: "fixed", left: `${x}px`, top: `${y}px`, zIndex: "2147483647",
            minWidth: "12rem", padding: "4px", color: "CanvasText", background: "Canvas",
            border: "1px solid GrayText", borderRadius: "3px", boxShadow: "0 2px 8px #0006",
            font: "menu", display: "grid",
        });
        const buttons: HTMLButtonElement[] = [];
        const buttonItems = new Map<HTMLButtonElement, ContextMenuItem>();
        for (const item of items) {
            const separatorBefore = item.separatorBefore;
            if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
            if (separatorBefore) {
                const separator = document.createElement("div");
                separator.setAttribute("role", "separator");
                separator.style.borderTop = "1px solid GrayText";
                separator.style.margin = "3px 0";
                container.appendChild(separator);
            }
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "menuitem");
            const caption = item.caption;
            if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
            const enabled = item.enabled;
            if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
            button.textContent = caption ?? "";
            button.disabled = !enabled;
            button.style.cssText = "display:block;width:100%;text-align:left;border:0;padding:4px 8px;background:transparent;color:inherit;font:inherit";
            button.addEventListener("click", clickEvent => activate(clickEvent, item, owner, callbackGeneration));
            container.appendChild(button);
            if (enabled) {
                buttons.push(button);
                buttonItems.set(button, item);
            }
        }
        container.addEventListener("keydown", keyboardEvent => {
            if (!keyboardEvent.isTrusted || disposed || !ownsCanvas() || generation !== callbackGeneration) return;
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
            } else if ((keyboardEvent.key === "Enter" || keyboardEvent.key === " ") && index >= 0) {
                keyboardEvent.preventDefault();
                activate(keyboardEvent, buttonItems.get(buttons[index])!, owner, callbackGeneration);
            }
        });
        if (disposed || !ownsCanvas() || generation !== callbackGeneration) return;
        document.body.appendChild(container);
        popup = container;
        buttons[0]?.focus({ preventScroll: true });
    };
    const onContextMenu = (nativeEvent: Event): void => {
        const event = nativeEvent as MouseEvent;
        openFromEvent(event, event.clientX, event.clientY);
    };
    const onCanvasKeyDown = (nativeEvent: Event): void => {
        const event = nativeEvent as KeyboardEvent;
        if (!((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) return;
        const bounds = canvas.getBoundingClientRect();
        openFromEvent(event, bounds.left, bounds.bottom);
    };

    const retire = (): void => {
        if (disposed) return;
        disposed = true;
        generation++;
        if (ownsCanvas()) CANVAS_AUTHORITIES.delete(canvas);
        let caught = false;
        let firstError: unknown;
        const capture = (operation: () => void): void => {
            try { operation(); }
            catch (error) {
                if (!caught) {
                    caught = true;
                    firstError = error;
                }
            }
        };
        capture(() => canvas.removeEventListener("contextmenu", onContextMenu));
        capture(() => canvas.removeEventListener("keydown", onCanvasKeyDown));
        capture(() => document.removeEventListener("pointerdown", onDocumentPointerDown, true));
        capture(() => view.removeEventListener("blur", onWindowBlur));
        capture(dismiss);
        if (caught) throw firstError;
    };
    const rollback = (): void => {
        disposed = true;
        generation++;
        for (const operation of [
            () => canvas.removeEventListener("contextmenu", onContextMenu),
            () => canvas.removeEventListener("keydown", onCanvasKeyDown),
            () => document.removeEventListener("pointerdown", onDocumentPointerDown, true),
            () => view.removeEventListener("blur", onWindowBlur),
            dismiss,
        ]) {
            try { operation(); }
            catch { /* Installation rollback preserves its primary failure. */ }
        }
    };

    try {
        canvas.addEventListener("contextmenu", onContextMenu);
        canvas.addEventListener("keydown", onCanvasKeyDown);
        document.addEventListener("pointerdown", onDocumentPointerDown, true);
        view.addEventListener("blur", onWindowBlur);
    } catch (error) {
        if (CANVAS_INSTALLATIONS.get(canvas) === installationToken)
            CANVAS_INSTALLATIONS.delete(canvas);
        rollback();
        throw error;
    }

    let currentView: Window | null;
    try { currentView = document.defaultView; }
    catch (error) {
        if (CANVAS_INSTALLATIONS.get(canvas) === installationToken)
            CANVAS_INSTALLATIONS.delete(canvas);
        rollback();
        throw error;
    }
    if (CANVAS_INSTALLATIONS.get(canvas) !== installationToken
        || CANVAS_AUTHORITIES.get(canvas) !== predecessor) {
        rollback();
        throw new Error("Native context-menu host installation was superseded reentrantly");
    }
    if (currentView !== view) {
        CANVAS_INSTALLATIONS.delete(canvas);
        rollback();
        throw new Error("Native context-menu host document window changed during installation");
    }
    try { predecessor?.retire(); }
    catch (error) {
        if (CANVAS_INSTALLATIONS.get(canvas) === installationToken)
            CANVAS_INSTALLATIONS.delete(canvas);
        rollback();
        throw error;
    }
    if (CANVAS_INSTALLATIONS.get(canvas) !== installationToken || CANVAS_AUTHORITIES.has(canvas)) {
        rollback();
        throw new Error("Native context-menu host installation was superseded during predecessor teardown");
    }
    CANVAS_AUTHORITIES.set(canvas, { token, retire });
    CANVAS_INSTALLATIONS.delete(canvas);

    return Object.freeze({
        get open(): boolean { return !disposed && ownsCanvas() && popup !== null; },
        dismiss(): void { if (!disposed && ownsCanvas()) dismiss(); },
        dispose: retire,
    });
}
