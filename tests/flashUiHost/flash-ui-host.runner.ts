import assert from "node:assert/strict";
import test from "node:test";
import {
    AccessibilityProperties, Clipboard, ClipboardFormats, ContextMenu, ContextMenuItem,
    Keyboard, installNativeClipboardHost, installNativeContextMenuHost, installNativeKeyboardStateHost,
} from "../../src/layaAir/flash";
import { isFlashAccessibilityProperties } from "../../src/layaAir/flash/accessibility/AccessibilityProperties";
import { isFlashContextMenu, isFlashContextMenuItem } from "../../src/layaAir/flash/ui/ContextMenu";
import { ContextMenuEvent } from "../../src/layaAir/flash/events/ContextMenuEvent";
import { UnsupportedFlashFeatureError } from "../../src/layaAir/flash/events/UnsupportedFlashFeatureError";

test("source-used Keyboard constants and native lock-state lease are deterministic", () => {
    assert.deepEqual([
        Keyboard.BACKSPACE, Keyboard.TAB, Keyboard.ENTER, Keyboard.SHIFT, Keyboard.CONTROL,
        Keyboard.CAPS_LOCK, Keyboard.ESCAPE, Keyboard.SPACE, Keyboard.PAGE_UP, Keyboard.PAGE_DOWN,
        Keyboard.END, Keyboard.HOME, Keyboard.LEFT, Keyboard.UP, Keyboard.RIGHT, Keyboard.DOWN,
        Keyboard.INSERT, Keyboard.DELETE, Keyboard.SEMICOLON, Keyboard.QUOTE, Keyboard.A, Keyboard.Z,
        Keyboard.F1, Keyboard.F12, Keyboard.NUMPAD_0, Keyboard.NUMPAD_9, Keyboard.NUMPAD_ADD,
        Keyboard.NUMPAD_DECIMAL, Keyboard.NUMPAD_DIVIDE, Keyboard.NUMPAD_ENTER,
        Keyboard.NUMPAD_MULTIPLY, Keyboard.NUMPAD_SUBTRACT,
    ], [8, 9, 13, 16, 17, 20, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 45, 46,
        186, 222, 65, 90, 112, 123, 96, 105, 107, 110, 111, 108, 106, 109]);
    assert.equal(Object.isFrozen(Keyboard), true);

    const target = new EventTarget();
    const lease = installNativeKeyboardStateHost(target);
    const event = new Event("keydown") as Event & { getModifierState(name: string): boolean };
    Object.defineProperty(event, "getModifierState", {
        value: (name: string) => name === "CapsLock",
    });
    target.dispatchEvent(event);
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock, Keyboard.isAccessible()], [false, false, true],
        "synthetic keyboard events cannot publish native lock state");
    lease.dispose();
    target.dispatchEvent(event);
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock], [false, false]);
});

test("Keyboard host publishes only after both listeners install and tears down transactionally", () => {
    type KeyboardListener = (event: Event) => void;
    const trusted = (capsLock: boolean, numLock: boolean): Event => ({
        isTrusted: true,
        getModifierState(name: string): boolean {
            return name === "CapsLock" ? capsLock : name === "NumLock" ? numLock : false;
        },
    } as unknown as Event);
    const predecessorListeners = new Map<string, KeyboardListener>();
    const predecessor = {
        addEventListener(type: string, listener: EventListener): void {
            predecessorListeners.set(type, listener as KeyboardListener);
        },
        removeEventListener(type: string): void { predecessorListeners.delete(type); },
    } as unknown as EventTarget;
    const predecessorLease = installNativeKeyboardStateHost(predecessor);
    predecessorListeners.get("keydown")!(trusted(true, false));
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock], [true, false]);

    const installCalls: string[] = [];
    const installPrimary = new Error("keyup installation failed");
    const failedTarget = {
        addEventListener(type: string): void {
            installCalls.push(`add:${type}`);
            if (type === "keyup") throw installPrimary;
        },
        removeEventListener(type: string): void {
            installCalls.push(`remove:${type}`);
            if (type === "keydown") throw new Error("rollback removal failed");
        },
    } as unknown as EventTarget;
    assert.throws(() => installNativeKeyboardStateHost(failedTarget), error => error === installPrimary);
    assert.deepEqual(installCalls, ["add:keydown", "add:keyup", "remove:keydown", "remove:keyup"]);
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock], [true, false],
        "failed successor installation cannot replace published keyboard state");
    predecessorLease.dispose();

    const disposeCalls: string[] = [];
    const disposePrimary = new Error("keydown removal failed");
    const disposeListeners = new Map<string, KeyboardListener>();
    const disposalTarget = {
        addEventListener(type: string, listener: EventListener): void {
            disposeListeners.set(type, listener as KeyboardListener);
        },
        removeEventListener(type: string): void {
            disposeCalls.push(type);
            if (type === "keydown") throw disposePrimary;
            disposeListeners.delete(type);
        },
    } as unknown as EventTarget;
    const disposalLease = installNativeKeyboardStateHost(disposalTarget);
    disposeListeners.get("keydown")!(trusted(false, true));
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock], [false, true]);
    assert.throws(() => disposalLease.dispose(), error => error === disposePrimary);
    assert.deepEqual(disposeCalls, ["keydown", "keyup"]);
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock], [false, false]);
    disposeListeners.get("keydown")!(trusted(true, true));
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock], [false, false],
        "a leaked listener is inert after ownership clears");
});

test("ContextMenu retains source-shaped item identity, mutation and dispatch", () => {
    const menu = new ContextMenu();
    const item = new ContextMenuItem("Copy", true, false, true);
    assert.equal(isFlashContextMenu(menu), true);
    assert.equal(isFlashContextMenuItem(item), true);
    assert.deepEqual(Object.values(menu.builtInItems), new Array(8).fill(true));
    menu.hideBuiltInItems();
    assert.deepEqual(Object.values(menu.builtInItems), new Array(8).fill(false));
    menu.customItems.push(item);
    assert.equal(menu.customItems[0], item);
    menu.customItems = null;
    assert.equal(menu.customItems, null);
    menu.customItems = [item];
    assert.throws(() => { (menu as any).customItems = [Object.freeze({})]; }, TypeError);

    item.caption = null;
    item.separatorBefore = false;
    item.enabled = true;
    item.visible = false;
    const clone = item.clone();
    assert.deepEqual([clone !== item, clone.caption, clone.separatorBefore, clone.enabled, clone.visible],
        [true, null, false, true, false]);
    let observed = 0;
    item.addEventListener(ContextMenuEvent.MENU_ITEM_SELECT, () => observed++);
    item.dispatchEvent(new ContextMenuEvent(ContextMenuEvent.MENU_ITEM_SELECT));
    assert.equal(observed, 1);
});

test("ContextMenu host installation rollback attempts every removal and preserves the primary failure", () => {
    const calls: string[] = [];
    const primary = new Error("pointer listener installation failed");
    const canvas = {
        addEventListener(type: string): void { calls.push(`canvas:add:${type}`); },
        removeEventListener(type: string): void {
            calls.push(`canvas:remove:${type}`);
            if (type === "contextmenu") throw new Error("cleanup failed");
        },
    } as unknown as HTMLElement;
    const view = {
        addEventListener(type: string): void { calls.push(`window:add:${type}`); },
        removeEventListener(type: string): void { calls.push(`window:remove:${type}`); },
    };
    const document = {
        body: {}, defaultView: view,
        addEventListener(type: string): void {
            calls.push(`document:add:${type}`);
            throw primary;
        },
        removeEventListener(type: string): void { calls.push(`document:remove:${type}`); },
    } as unknown as Document;

    assert.throws(() => installNativeContextMenuHost({ canvas, document, resolveTarget: () => null }),
        error => error === primary);
    assert.deepEqual(calls, [
        "canvas:add:contextmenu", "canvas:add:keydown", "document:add:pointerdown",
        "canvas:remove:contextmenu", "canvas:remove:keydown", "document:remove:pointerdown",
        "window:remove:blur",
    ]);
});

test("Clipboard synchronously publishes only source-used text and leases cannot clobber successors", () => {
    const first: string[] = [];
    const firstLease = installNativeClipboardHost({ writeText(value) { first.push(value); return true; } });
    assert.equal(Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, "debug"), true);
    assert.deepEqual(first, ["debug"]);
    assert.throws(() => Clipboard.generalClipboard.setData(ClipboardFormats.HTML_FORMAT, "<b>x</b>"),
        (error: unknown) => error instanceof UnsupportedFlashFeatureError);

    const second: string[] = [];
    const secondLease = installNativeClipboardHost({ writeText(value) { second.push(value); return true; } });
    firstLease.dispose();
    assert.equal(Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, 42), true);
    assert.deepEqual(second, ["42"]);
    secondLease.dispose();
    assert.throws(() => Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, "orphan"),
        (error: unknown) => error instanceof UnsupportedFlashFeatureError);
});

test("AccessibilityProperties preserves Flash metadata and nominal identity", () => {
    const properties = new AccessibilityProperties();
    properties.name = "Owner";
    properties.description = null;
    properties.shortcut = "Control+C";
    properties.forceSimple = 1;
    properties.noAutoLabeling = "";
    properties.silent = true;
    assert.equal(isFlashAccessibilityProperties(properties), true);
    assert.deepEqual([properties.name, properties.description, properties.shortcut,
        properties.forceSimple, properties.noAutoLabeling, properties.silent],
        ["Owner", null, "Control+C", true, false, true]);
});
