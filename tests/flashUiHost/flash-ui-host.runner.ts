import assert from "node:assert/strict";
import test from "node:test";
import {
    AccessibilityProperties, Clipboard, ClipboardFormats, ContextMenu, ContextMenuItem,
    Keyboard, createBrowserClipboardHost, installNativeClipboardHost, installNativeContextMenuHost,
    installNativeKeyboardStateHost, type NativeClipboardHost,
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

    const nestedListeners = new Map<string, KeyboardListener>();
    const outerListeners = new Map<string, KeyboardListener>();
    const outerRemovals: string[] = [];
    let nestedLease: ReturnType<typeof installNativeKeyboardStateHost> | null = null;
    let nested = false;
    const nestedTarget = {
        addEventListener(type: string, listener: EventListener): void {
            nestedListeners.set(type, listener as KeyboardListener);
        },
        removeEventListener(type: string): void { nestedListeners.delete(type); },
    } as unknown as EventTarget;
    const outerTarget = {
        addEventListener(type: string, listener: EventListener): void {
            outerListeners.set(type, listener as KeyboardListener);
            if (!nested) {
                nested = true;
                nestedLease = installNativeKeyboardStateHost(nestedTarget);
            }
        },
        removeEventListener(type: string): void {
            outerRemovals.push(type);
            outerListeners.delete(type);
        },
    } as unknown as EventTarget;
    assert.throws(() => installNativeKeyboardStateHost(outerTarget), /superseded reentrantly/);
    assert.deepEqual(outerRemovals, ["keydown", "keyup"]);
    nestedListeners.get("keydown")!(trusted(true, true));
    assert.deepEqual([Keyboard.capsLock, Keyboard.numLock], [true, true],
        "the nested successful installation remains authoritative");
    nestedLease!.dispose();

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
    class EvilItems extends Array<ContextMenuItem> {}
    const evilItems = new EvilItems();
    evilItems.push(item);
    Object.defineProperty(evilItems, "every", { value(): never { throw new Error("overridden every must not run"); } });
    Object.defineProperty(evilItems, Symbol.iterator, {
        value: function* (): IterableIterator<ContextMenuItem> {
            yield Object.freeze({ caption: "forged" }) as unknown as ContextMenuItem;
        },
    });
    menu.customItems = evilItems;
    assert.equal(menu.customItems[0], item,
        "validation uses indexed canonical entries rather than an overridable iterator/every");

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

test("ContextMenu nested installation wins and failed replacement preserves its predecessor", () => {
    type Listener = EventListenerOrEventListenerObject;
    let label = "outer";
    let nestedTriggered = false;
    let failKeydown = false;
    const addLabels = new Map<Listener, string>();
    const removals: string[] = [];
    let nestedLease: ReturnType<typeof installNativeContextMenuHost> | null = null;
    const recordAdd = (scope: string, type: string, listener: Listener): void => {
        addLabels.set(listener, label);
        if (scope === "canvas" && type === "contextmenu" && label === "outer" && !nestedTriggered) {
            nestedTriggered = true;
            label = "nested";
            try { nestedLease = installNativeContextMenuHost({ canvas, document, resolveTarget: () => null }); }
            finally { label = "outer"; }
        }
        if (scope === "canvas" && type === "keydown" && failKeydown)
            throw new Error("replacement keydown failed");
    };
    const recordRemove = (scope: string, type: string, listener: Listener): void => {
        const owner = addLabels.get(listener);
        if (owner) removals.push(`${owner}:${scope}:${type}`);
        addLabels.delete(listener);
    };
    const canvas = {
        addEventListener(type: string, listener: Listener): void { recordAdd("canvas", type, listener); },
        removeEventListener(type: string, listener: Listener): void { recordRemove("canvas", type, listener); },
    } as unknown as HTMLElement;
    const view = {
        addEventListener(type: string, listener: Listener): void { recordAdd("window", type, listener); },
        removeEventListener(type: string, listener: Listener): void { recordRemove("window", type, listener); },
    };
    const document = {
        body: {}, defaultView: view,
        addEventListener(type: string, listener: Listener): void { recordAdd("document", type, listener); },
        removeEventListener(type: string, listener: Listener): void { recordRemove("document", type, listener); },
    } as unknown as Document;

    assert.throws(() => installNativeContextMenuHost({ canvas, document, resolveTarget: () => null }),
        /superseded reentrantly/);
    assert.equal(removals.filter(value => value.startsWith("outer:")).length, 4);

    label = "successor";
    const successorLease = installNativeContextMenuHost({ canvas, document, resolveTarget: () => null });
    assert.equal(removals.filter(value => value.startsWith("nested:")).length, 4,
        "the nested host was the predecessor retired by the next successful installation");

    label = "failed";
    failKeydown = true;
    assert.throws(() => installNativeContextMenuHost({ canvas, document, resolveTarget: () => null }),
        /replacement keydown failed/);
    failKeydown = false;
    assert.equal(removals.filter(value => value.startsWith("successor:")).length, 0,
        "failed replacement listener installation preserves the predecessor");

    label = "final";
    const finalLease = installNativeContextMenuHost({ canvas, document, resolveTarget: () => null });
    assert.equal(removals.filter(value => value.startsWith("successor:")).length, 4,
        "the preserved predecessor is retired by the next successful replacement");
    nestedLease!.dispose();
    successorLease.dispose();
    finalLease.dispose();
});

test("ContextMenu authenticates one exact document window and failed window capture preserves its predecessor", () => {
    type Listener = EventListenerOrEventListenerObject;
    let label = "predecessor";
    const owners = new Map<Listener, string>();
    const calls: string[] = [];
    const recordAdd = (scope: string, type: string, listener: Listener): void => {
        owners.set(listener, label);
        calls.push(`${label}:${scope}:add:${type}`);
    };
    const recordRemove = (scope: string, type: string, listener: Listener): void => {
        calls.push(`${owners.get(listener) ?? label}:${scope}:remove:${type}`);
        owners.delete(listener);
    };
    const canvas = {
        addEventListener(type: string, listener: Listener): void { recordAdd("canvas", type, listener); },
        removeEventListener(type: string, listener: Listener): void { recordRemove("canvas", type, listener); },
    } as unknown as HTMLElement;
    const makeView = (name: string): Window => ({
        addEventListener(type: string, listener: Listener): void { recordAdd(name, type, listener); },
        removeEventListener(type: string, listener: Listener): void { recordRemove(name, type, listener); },
    } as unknown as Window);
    const makeDocument = (view: Window | null): Document => ({
        body: {}, defaultView: view,
        addEventListener(type: string, listener: Listener): void { recordAdd("document", type, listener); },
        removeEventListener(type: string, listener: Listener): void { recordRemove("document", type, listener); },
    } as unknown as Document);

    const predecessorView = makeView("predecessor-window");
    const predecessor = installNativeContextMenuHost({
        canvas, document: makeDocument(predecessorView), resolveTarget: () => null,
    });

    label = "changing";
    const firstView = makeView("first-window");
    const secondView = makeView("second-window");
    let reads = 0;
    const changingDocument = {
        body: {},
        get defaultView(): Window { return ++reads === 1 ? firstView : secondView; },
        addEventListener(type: string, listener: Listener): void { recordAdd("document", type, listener); },
        removeEventListener(type: string, listener: Listener): void { recordRemove("document", type, listener); },
    } as unknown as Document;
    assert.throws(() => installNativeContextMenuHost({
        canvas, document: changingDocument, resolveTarget: () => null,
    }), /document window changed/);
    const firstWindowAdd = calls.find(value => value === "changing:first-window:add:blur");
    const firstWindowRemove = calls.find(value => value === "changing:first-window:remove:blur");
    assert.ok(firstWindowAdd && firstWindowRemove,
        "rollback removes the exact blur listener from the captured first window");
    assert.equal(calls.some(value => value.includes("second-window") && value.includes(":remove:")), false);

    label = "missing";
    assert.throws(() => installNativeContextMenuHost({
        canvas, document: makeDocument(null), resolveTarget: () => null,
    }), /requires one live document window/);

    label = "final";
    const finalLease = installNativeContextMenuHost({
        canvas, document: makeDocument(makeView("final-window")), resolveTarget: () => null,
    });
    assert.equal(calls.filter(value => value.startsWith("predecessor:") && value.includes(":remove:")).length, 4,
        "both failed replacements preserve the predecessor until a successful successor retires it");
    predecessor.dispose();
    finalLease.dispose();
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

test("Clipboard installation captures one callable and a hostile getter cannot overwrite its nested successor", () => {
    const nestedWrites: string[] = [];
    const outerWrites: string[] = [];
    let nestedLease: ReturnType<typeof installNativeClipboardHost> | null = null;
    const hostile = Object.create(null) as NativeClipboardHost;
    Object.defineProperty(hostile, "writeText", {
        get(): NativeClipboardHost["writeText"] {
            nestedLease = installNativeClipboardHost({
                writeText(value: string): boolean { nestedWrites.push(value); return true; },
            });
            return (value: string): boolean => { outerWrites.push(value); return true; };
        },
    });
    assert.throws(() => installNativeClipboardHost(hostile), /superseded reentrantly/);
    assert.equal(Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, "nested"), true);
    assert.deepEqual(nestedWrites, ["nested"]);
    assert.deepEqual(outerWrites, []);
    nestedLease!.dispose();

    const capturedWrites: string[] = [];
    const replacedWrites: string[] = [];
    const mutableHost: NativeClipboardHost = {
        writeText(value: string): boolean { capturedWrites.push(value); return true; },
    };
    const capturedLease = installNativeClipboardHost(mutableHost);
    mutableHost.writeText = (value: string): boolean => { replacedWrites.push(value); return true; };
    assert.equal(Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, "captured"), true);
    assert.deepEqual(capturedWrites, ["captured"]);
    assert.deepEqual(replacedWrites, []);
    capturedLease.dispose();

    const oldWrites: string[] = [];
    const newWrites: string[] = [];
    const oldLease = installNativeClipboardHost({
        writeText(value: string): boolean { oldWrites.push(value); return true; },
    });
    let coercionSuccessor: ReturnType<typeof installNativeClipboardHost> | null = null;
    const hostileData = {
        [Symbol.toPrimitive](): string {
            coercionSuccessor = installNativeClipboardHost({
                writeText(value: string): boolean { newWrites.push(value); return true; },
            });
            return "coerced";
        },
    };
    assert.equal(Clipboard.generalClipboard.setData(ClipboardFormats.TEXT_FORMAT, hostileData), true);
    assert.deepEqual(oldWrites, []);
    assert.deepEqual(newWrites, ["coerced"]);
    oldLease.dispose();
    coercionSuccessor!.dispose();
});

test("browser Clipboard ignores nested synthetic copy and requires the genuine event to publish", () => {
    type CopyListener = (event: Event) => void;
    const listeners: CopyListener[] = [];
    let addOptions: unknown = "unset";
    let nested = false;
    let syntheticWrites = 0;
    const realWrites: Array<[string, string]> = [];
    const syntheticEvent = {
        isTrusted: false,
        clipboardData: { setData(): void { syntheticWrites++; } },
        preventDefault(): void {},
    } as unknown as Event;
    listeners.push(event => {
        if (!event.isTrusted || nested) return;
        nested = true;
        for (const listener of [...listeners]) listener(syntheticEvent);
    });
    const document = {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: unknown): void {
            assert.equal(type, "copy");
            addOptions = options;
            listeners.push(listener as CopyListener);
        },
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
            assert.equal(type, "copy");
            const index = listeners.indexOf(listener as CopyListener);
            if (index >= 0) listeners.splice(index, 1);
        },
        execCommand(command: string): boolean {
            assert.equal(command, "copy");
            const realEvent = {
                isTrusted: true,
                clipboardData: { setData(type: string, value: string): void { realWrites.push([type, value]); } },
                preventDefault(): void {},
            } as unknown as Event;
            for (const listener of [...listeners]) listener(realEvent);
            return true;
        },
    } as unknown as Document;
    const host = createBrowserClipboardHost(document, {
        userActivation: { isActive: true },
    } as unknown as Navigator);
    assert.equal(host.writeText("trusted"), true);
    assert.equal(addOptions, undefined, "the real publisher is not a synthetic-consumable one-shot listener");
    assert.equal(syntheticWrites, 0);
    assert.deepEqual(realWrites, [["text/plain", "trusted"]]);
    assert.equal(listeners.length, 1, "the exact publisher listener is removed after execCommand");

    const syntheticOnlyListeners: CopyListener[] = [];
    const syntheticOnlyDocument = {
        addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
            syntheticOnlyListeners.push(listener as CopyListener);
        },
        removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
            const index = syntheticOnlyListeners.indexOf(listener as CopyListener);
            if (index >= 0) syntheticOnlyListeners.splice(index, 1);
        },
        execCommand(): boolean {
            for (const listener of [...syntheticOnlyListeners]) listener(syntheticEvent);
            return true;
        },
    } as unknown as Document;
    assert.equal(createBrowserClipboardHost(syntheticOnlyDocument, {
        userActivation: { isActive: true },
    } as unknown as Navigator).writeText("not-published"), false);
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
