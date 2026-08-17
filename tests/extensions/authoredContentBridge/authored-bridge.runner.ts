import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ILaya } from "../../../src/layaAir/ILaya";
import { AnimationClip2D } from "../../../src/layaAir/laya/components/AnimationClip2D";
import { AnimatorClip2D } from "../../../src/layaAir/laya/components/AnimatorClip2D";
import { Input as LayaInput } from "../../../src/layaAir/laya/display/Input";
import { Node as LayaNode } from "../../../src/layaAir/laya/display/Node";
import { Sprite as LayaSprite } from "../../../src/layaAir/laya/display/Sprite";
import { Stage } from "../../../src/layaAir/laya/display/Stage";
import { Event as LayaEvent } from "../../../src/layaAir/laya/events/Event";
import { InputManager } from "../../../src/layaAir/laya/events/InputManager";
import { PAL } from "../../../src/layaAir/laya/platform/PlatformAdapters";
import { TextInputAdapter } from "../../../src/layaAir/laya/platform/TextInputAdapter";
import { HierarchyParser } from "../../../src/layaAir/laya/loaders/HierarchyParser";
import { LayaGL } from "../../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { PrefabImpl } from "../../../src/layaAir/laya/resource/PrefabImpl";
import "../../../src/layaAir/laya/ModuleDef";
import {
    AnimatorClip2DTimeline, DisplayObject, Event, EventDispatcher, EventPhase, InteractiveObject, MovieClip,
    FocusEvent, IMEEvent, MouseEvent, SimpleButton, TextEvent, TextField, TextFieldType,
    UnsupportedFlashFeatureError
} from "../../../src/layaAir/flash";
import {
    LayaAuthoredBindingHost, mapLayaAuthoredEventData, registerAuthoredContentRuntime
} from "../../../src/extensions/authoredContent/runtime";
import { ButtonStateLinkage, FlashPanel, SubmitButtonLinkage } from "./generated/FlashPanel";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;
ILaya.timer = { callLater: (): void => undefined } as any;
ILaya.systemTimer = {
    callLater: (): void => undefined, runCallLater: (): void => undefined,
    frameOnce: (_frame: number, caller: unknown, method: Function): void => { queueMicrotask(() => method.call(caller)); }
} as any;
(PAL as any).textInput = {
    target: null,
    begin(target: unknown): void { this.target = target; },
    end(): void { this.target = null; },
    setText: (): void => undefined,
    setSelection: (): void => undefined,
    syncSelection: (): void => undefined,
    syncText: (): void => undefined
};
(PAL as any).browser ??= { on: (): void => undefined };

test("A12 capability ledger owns exact Flash declarations, members, signatures and hashes", () => {
    const path = join(process.cwd(), "docTool/architecture/authored-content-capabilities.json");
    const ledger = JSON.parse(readFileSync(path, "utf8"));
    for (const namespace of ["display", "events", "text"]) {
        const capability = ledger.capabilities.find((item: any) => item.id === `api.flash.${namespace}`);
        assert.equal(capability.status, "typescript-obligation");
        assert.ok(capability.obligations.length > 0);
        for (const obligation of capability.obligations) {
            assert.ok(obligation.module.startsWith(`src/layaAir/flash/${namespace}/`));
            assert.match(obligation.sha256, /^[a-f0-9]{64}$/);
            assert.ok(obligation.signature.length > 0);
            if (obligation.kind === "class") {
                assert.ok(obligation.members.length > 0);
                assert.ok(Array.isArray(obligation.constructors));
                assert.ok(Array.isArray(obligation.indexSignatures));
            }
        }
        assert.deepEqual(capability.evidence[0].covers,
            [...new Set(capability.obligations.map((item: any) => item.sha256))].sort());
    }
});

test("Event validates immutable type and listener priority", () => {
    const event = new Event("change");
    assert.equal(event.type, "change");
    assert.throws(() => (event as { type: string }).type = "mutated", TypeError);
    assert.throws(() => (event as { bubbles: boolean }).bubbles = true, TypeError);
    assert.throws(() => (event as { cancelable: boolean }).cancelable = true, TypeError);
    assert.throws(() => new Event(""), /validated string/);
    assert.throws(() => new Event(" change"), /validated string/);
    const dispatcher = new EventDispatcher();
    assert.throws(() => dispatcher.addEventListener("change", () => undefined, false, Number.NaN), /finite/);
});

test("priority, duplicate identity, cancellation and removal preserve Flash behavior", () => {
    const dispatcher = new EventDispatcher();
    const calls: string[] = [];
    const low = (event: Event) => calls.push(`low:${event.type}`);
    const high = (event: Event) => { calls.push(`high:${event.type}`); event.preventDefault(); };
    dispatcher.addEventListener(Event.CHANGE, low, false, 0);
    dispatcher.addEventListener(Event.CHANGE, high, false, 10);
    dispatcher.addEventListener(Event.CHANGE, high, false, 10);
    assert.equal(dispatcher.dispatchEvent(new Event(Event.CHANGE, false, true)), false);
    assert.deepEqual(calls, ["high:change", "low:change"]);
    dispatcher.removeEventListener(Event.CHANGE, high);
    calls.length = 0;
    dispatcher.dispatchEvent(new Event(Event.CHANGE));
    assert.deepEqual(calls, ["low:change"]);
});

test("EventDispatcher aggregation retains dispatcher listener ownership", () => {
    const aggregate = new EventDispatcher();
    const dispatcher = new EventDispatcher(aggregate);
    let own = 0;
    let foreign = 0;
    dispatcher.addEventListener(Event.CHANGE, event => {
        own++;
        assert.equal(event.currentTarget, dispatcher);
        assert.equal(event.target, aggregate);
    });
    aggregate.addEventListener(Event.CHANGE, () => foreign++);
    dispatcher.dispatchEvent(new Event(Event.CHANGE));
    assert.equal(own, 1);
    assert.equal(foreign, 0);
});

test("one Event instance traverses capture, target and bubble in real Laya parent order", () => {
    const root = new DisplayObject();
    const middle = new DisplayObject();
    const target = new DisplayObject();
    root.addChild(middle); middle.addChild(target);
    const seen: Event[] = [];
    const calls: string[] = [];
    root.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`root-c:${event.eventPhase}`); seen.push(event); }, true);
    middle.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`middle-c:${event.eventPhase}`); seen.push(event); }, true);
    target.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`target:${event.eventPhase}`); seen.push(event); });
    middle.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`middle-b:${event.eventPhase}`); seen.push(event); });
    root.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push(`root-b:${event.eventPhase}`); seen.push(event); });
    const native = nativeMouse(LayaEvent.MOUSE_DOWN, target, 10, 12, 1);
    target.event(LayaEvent.MOUSE_DOWN, native);
    // Native InputManager would continue bubbling; the routed marker prevents duplicate delivery.
    native.setTo(LayaEvent.MOUSE_DOWN, middle, target); middle.event(LayaEvent.MOUSE_DOWN, native);
    native.setTo(LayaEvent.MOUSE_DOWN, root, target); root.event(LayaEvent.MOUSE_DOWN, native);
    assert.deepEqual(calls, [
        `root-c:${EventPhase.CAPTURING_PHASE}`, `middle-c:${EventPhase.CAPTURING_PHASE}`,
        `target:${EventPhase.AT_TARGET}`, `middle-b:${EventPhase.BUBBLING_PHASE}`,
        `root-b:${EventPhase.BUBBLING_PHASE}`
    ]);
    assert.ok(seen.every(event => event === seen[0]));
    assert.equal(seen[0].target, target);
    native.setTo(LayaEvent.MOUSE_DOWN, target, target);
    target.event(LayaEvent.MOUSE_DOWN, native);
    assert.equal(calls.length, 10, "a persistent TouchInfo Event starts a fresh dispatch at its target");
});

test("stopPropagation controls the native event and prevents ancestor bubble", () => {
    const parent = new DisplayObject();
    const child = new DisplayObject();
    parent.addChild(child);
    const calls: string[] = [];
    child.addEventListener(MouseEvent.MOUSE_DOWN, event => { calls.push("child"); event.stopPropagation(); });
    parent.addEventListener(MouseEvent.MOUSE_DOWN, _event => calls.push("parent"));
    const native = nativeMouse(LayaEvent.MOUSE_DOWN, child, 1, 2, 1);
    child.event(LayaEvent.MOUSE_DOWN, native);
    assert.equal(native._stopped, true);
    assert.deepEqual(calls, ["child"]);
});

test("mouse local coordinates, buttons and roll non-bubbling semantics are projected", () => {
    const parent = new DisplayObject();
    const child = new DisplayObject();
    child.pos(5, 7); parent.addChild(child);
    let mouse: MouseEvent | null = null;
    let parentRolls = 0;
    child.addEventListener(MouseEvent.MOUSE_DOWN, event => mouse = event as MouseEvent);
    child.addEventListener(MouseEvent.ROLL_OVER, event => { assert.equal(event.bubbles, false); });
    parent.addEventListener(MouseEvent.ROLL_OVER, _event => parentRolls++);
    child.event(LayaEvent.MOUSE_DOWN, nativeMouse(LayaEvent.MOUSE_DOWN, child, 15, 19, 1));
    assert.ok(mouse);
    assert.equal(mouse!.localX, 10); assert.equal(mouse!.localY, 12);
    assert.equal(mouse!.stageX, 15); assert.equal(mouse!.stageY, 19);
    assert.equal(mouse!.buttonDown, true);
    child.event(LayaEvent.MOUSE_OVER, nativeMouse(LayaEvent.MOUSE_OVER, child, 15, 19, 0));
    assert.equal(parentRolls, 0);
    const parentBoundary = nativeMouse(LayaEvent.MOUSE_OVER, parent, 15, 19, 0);
    parent.event(LayaEvent.MOUSE_OVER, parentBoundary);
    assert.equal(parentRolls, 1);
});

test("SimpleButton state replacement is clean and hitTestState drives InputManager", () => {
    const up = state(20, 10), over = state(20, 10), down = state(20, 10), hit = state(20, 10);
    const button = new SimpleButton(up, over, down, hit);
    const replacement = state(30, 12);
    button.upState = replacement;
    assert.equal(up.parent, null);
    assert.equal(replacement.parent, button);
    const manager = new InputManager();
    assert.equal(manager.hitTest(button, 19, 9), true);
    assert.equal(manager.hitTest(button, 20, 9), false);
    assert.equal(hit.visible, false);
    button.event(LayaEvent.MOUSE_DOWN, nativeMouse(LayaEvent.MOUSE_DOWN, button, 2, 2, 1));
    assert.equal(down.visible, true);
    button.enabled = false;
    assert.equal(button.mouseEnabled, false);
    button.mouseEnabled = false;
    button.enabled = true;
    assert.equal(button.mouseEnabled, false, "authored mouseEnabled survives enabled toggles");

    const priorUp = button.upState;
    assert.throws(() => button.upState = button as DisplayObject, /ancestors/);
    assert.equal(button.upState, priorUp, "self rejection is atomic");
    const ancestor = new DisplayObject(); ancestor.addChild(button);
    assert.throws(() => button.upState = ancestor, /ancestors/);
    assert.equal(button.upState, priorUp, "ancestor rejection is atomic");
    ancestor.removeChild(button);

    class HostileMouseState extends DisplayObject {
        override get mouseEnabled(): boolean { return super.mouseEnabled; }
        override set mouseEnabled(value: boolean) {
            if (!value) throw new Error("hostile mouse setter");
            super.mouseEnabled = value;
        }
    }
    const hostileMouse = new HostileMouseState();
    button.overState = hostileMouse;
    assert.equal(button.overState, hostileMouse);
    assert.equal(over.parent, null);
    assert.equal(hostileMouse.parent, button);
    assert.equal(hostileMouse.mouseEnabled, false, "native state mutation bypasses hostile override");

    class HostileAttachButton extends SimpleButton {
        attachCalls = 0;
        override addChild<T extends LayaNode>(node: T): T {
            this.attachCalls++;
            super.addChild(node);
            throw new Error("hostile attach");
        }
    }
    const hostileButton = new HostileAttachButton();
    const attachState = state(4, 4);
    hostileButton.upState = attachState;
    assert.equal(hostileButton.attachCalls, 0);
    assert.equal(hostileButton.upState, attachState);
    assert.equal(attachState.parent, hostileButton);

    class HostileBeforeRemoveButton extends SimpleButton {
        removeCalls = 0;
        override removeChild<T extends LayaNode>(_node: T): T {
            this.removeCalls++;
            throw new Error("hostile remove before");
        }
    }
    class HostileAfterRemoveButton extends SimpleButton {
        removeCalls = 0;
        override removeChild<T extends LayaNode>(node: T): T {
            this.removeCalls++;
            super.removeChild(node);
            throw new Error("hostile remove after");
        }
    }
    for (const hostileRemove of [new HostileBeforeRemoveButton(state(3, 3)), new HostileAfterRemoveButton(state(3, 3))]) {
        const oldState = hostileRemove.upState!;
        const nextState = state(5, 5);
        hostileRemove.upState = nextState;
        assert.equal(hostileRemove.removeCalls, 0);
        assert.equal(hostileRemove.upState, nextState);
        assert.equal(nextState.parent, hostileRemove);
        assert.equal(oldState.parent, null);
    }

    class HostileBeforeSetParentState extends DisplayObject {
        setParentCalls = 0;
        protected override _setParent(_value: LayaNode, _index: number = -1): void {
            this.setParentCalls++;
            throw new Error("hostile _setParent before");
        }
    }
    class HostileAfterSetParentState extends DisplayObject {
        setParentCalls = 0;
        protected override _setParent(value: LayaNode, index: number = -1): void {
            this.setParentCalls++;
            super._setParent(value, index);
            throw new Error("hostile _setParent after");
        }
    }
    for (const hostileState of [new HostileBeforeSetParentState(), new HostileAfterSetParentState()]) {
        hostileState.name = "hostile";
        hostileState.mouseEnabled = true;
        hostileState.visible = true;
        const beforeState = button.upState;
        const beforeChildren = Array.from(button.children);
        assert.throws(() => button.upState = hostileState, /canonical Laya DisplayObject _setParent/);
        assert.equal(hostileState.setParentCalls, 0, "hostile lifecycle override is rejected before invocation");
        assert.equal(button.upState, beforeState);
        assert.deepEqual(Array.from(button.children), beforeChildren);
        assert.ok(hostileState.parent == null);
        assert.equal(hostileState.name, "hostile");
        assert.equal(hostileState.mouseEnabled, true);
        assert.equal(hostileState.visible, true);
    }

    const reentrantState = state(7, 7);
    const beforeReentrantState = button.upState;
    const beforeReentrantChildren = Array.from(button.children);
    const internals = (node: LayaNode) => node as unknown as {
        _children: LayaNode[]; _$children: LayaNode[];
        _parent: LayaNode | null | undefined; _$parent: LayaNode | null | undefined;
    };
    const beforeActualChildren = Array.from(internals(button)._children);
    const beforeOldActualParent = beforeReentrantState ? internals(beforeReentrantState)._parent : undefined;
    const beforeOldLogicalParent = beforeReentrantState ? internals(beforeReentrantState)._$parent : undefined;
    const beforeCandidateActualParent = internals(reentrantState)._parent;
    const beforeCandidateLogicalParent = internals(reentrantState)._$parent;
    reentrantState.on(LayaEvent.ADDED, reentrantState, () => {
        try { reentrantState.removeSelf(); } catch { }
    });
    assert.throws(() => button.upState = reentrantState, /poisoned/);
    assert.equal(button.upState, beforeReentrantState, "reentrant ADDED rejection restores the state slot");
    assert.deepEqual(Array.from(button.children), beforeReentrantChildren, "reentrant ADDED rejection restores exact child order");
    assert.deepEqual(internals(button)._children, beforeActualChildren, "rollback restores the actual engine child array");
    if (beforeReentrantState) {
        assert.equal(internals(beforeReentrantState)._parent, beforeOldActualParent);
        assert.equal(internals(beforeReentrantState)._$parent, beforeOldLogicalParent);
    }
    assert.equal(internals(reentrantState)._parent, beforeCandidateActualParent);
    assert.equal(internals(reentrantState)._$parent, beforeCandidateLogicalParent);

    for (const phase of [LayaEvent.ADDED, LayaEvent.REMOVED]) {
        for (const nestedSlot of ["same", "cross"] as const) {
            const initialUp = state(9, 9), initialOver = state(10, 10);
            const guarded = new SimpleButton(initialUp, initialOver);
            const candidate = state(11, 11), nested = state(12, 12);
            const beforeChildren = Array.from(guarded.children);
            const trigger = phase === LayaEvent.ADDED ? candidate : initialUp;
            let nestedAttempts = 0;
            trigger.on(phase, trigger, () => {
                nestedAttempts++;
                try {
                    if (nestedSlot === "same") guarded.upState = nested;
                    else guarded.overState = nested;
                } catch { /* outer transaction must remain poisoned even when the handler catches this */ }
            });
            assert.throws(() => guarded.upState = candidate, /poisoned by reentrant state or child mutation/);
            assert.equal(nestedAttempts, 1, `${phase}/${nestedSlot} adversary ran exactly once`);
            assert.equal(guarded.upState, initialUp);
            assert.equal(guarded.overState, initialOver);
            assert.deepEqual(Array.from(guarded.children), beforeChildren);
            assert.deepEqual(internals(guarded)._children, beforeChildren);
            assert.equal(internals(initialUp)._parent, guarded);
            assert.equal(internals(initialUp)._$parent, guarded);
            assert.equal(internals(initialOver)._parent, guarded);
            assert.equal(internals(initialOver)._$parent, guarded);
            assert.ok(candidate.parent == null);
            assert.ok(nested.parent == null);
            assert.equal(guarded.children.includes(candidate), false);
            assert.equal(guarded.children.includes(nested), false);
        }
    }

    const siblingUp = state(13, 13), siblingOver = state(14, 14);
    const siblingGuarded = new SimpleButton(siblingUp, siblingOver);
    const siblingCandidate = state(15, 15);
    const siblingChildren = Array.from(siblingGuarded.children);
    siblingCandidate.on(LayaEvent.ADDED, siblingCandidate, () => {
        try { siblingOver.removeSelf(); } catch { }
        try { siblingCandidate.removeSelf(); } catch { }
    });
    assert.throws(() => siblingGuarded.upState = siblingCandidate, /poisoned by reentrant state or child mutation/);
    assert.equal(siblingGuarded.upState, siblingUp);
    assert.equal(siblingGuarded.overState, siblingOver);
    assert.deepEqual(Array.from(siblingGuarded.children), siblingChildren);
    assert.deepEqual(internals(siblingGuarded)._children, siblingChildren);
    assert.equal(internals(siblingUp)._parent, siblingGuarded);
    assert.equal(internals(siblingUp)._$parent, siblingGuarded);
    assert.equal(internals(siblingOver)._parent, siblingGuarded);
    assert.equal(internals(siblingOver)._$parent, siblingGuarded);
    assert.ok(siblingCandidate.parent == null);
    assert.equal(siblingGuarded.children.includes(siblingCandidate), false);

    for (const prototypeAttack of ["remove", "add"] as const) {
        const prototypeUp = state(16, 16), prototypeOver = state(17, 17);
        const prototypeGuarded = new SimpleButton(prototypeUp, prototypeOver);
        const prototypeCandidate = state(18, 18), introduced = state(19, 19);
        const prototypeChildren = Array.from(prototypeGuarded.children);
        prototypeCandidate.on(LayaEvent.ADDED, prototypeCandidate, () => {
            try {
                if (prototypeAttack === "remove")
                    LayaNode.prototype.removeChild.call(prototypeGuarded, prototypeOver);
                else
                    LayaNode.prototype.addChildAt.call(prototypeGuarded, introduced, prototypeGuarded.numChildren);
            } catch { /* the canonical primitive must poison the outer transaction before mutation */ }
        });
        assert.throws(() => prototypeGuarded.upState = prototypeCandidate, /poisoned by reentrant state or child mutation/);
        assert.equal(prototypeGuarded.upState, prototypeUp);
        assert.equal(prototypeGuarded.overState, prototypeOver);
        assert.deepEqual(Array.from(prototypeGuarded.children), prototypeChildren);
        assert.deepEqual(internals(prototypeGuarded)._children, prototypeChildren);
        assert.equal(internals(prototypeUp)._parent, prototypeGuarded);
        assert.equal(internals(prototypeUp)._$parent, prototypeGuarded);
        assert.equal(internals(prototypeOver)._parent, prototypeGuarded);
        assert.equal(internals(prototypeOver)._$parent, prototypeGuarded);
        assert.ok(prototypeCandidate.parent == null);
        assert.ok(introduced.parent == null);
        assert.equal(prototypeGuarded.children.includes(prototypeCandidate), false);
        assert.equal(prototypeGuarded.children.includes(introduced), false);
    }

    class HostileMutationHookButton extends SimpleButton {
        protected override _beforeChildMutation(): void { }
    }
    assert.throws(() => new HostileMutationHookButton(), /canonical SimpleButton child-mutation admission hook/);

    class HostileVisibleState extends DisplayObject {
        visibleWrites = 0;
        override get visible(): boolean { return super.visible; }
        override set visible(_value: boolean) { this.visibleWrites++; throw new Error("hostile visible setter"); }
    }
    const hostileVisible = new HostileVisibleState();
    button.downState = hostileVisible;
    assert.equal(hostileVisible.visibleWrites, 0);
    assert.equal(hostileVisible.visible, false);
    button.event(LayaEvent.MOUSE_DOWN, nativeMouse(LayaEvent.MOUSE_DOWN, button, 1, 1, 1));
    assert.equal(hostileVisible.visibleWrites, 0);
    assert.equal(hostileVisible.visible, true);

    const shared = state(15, 8);
    const aliased = new SimpleButton(shared, null, null, shared);
    assert.equal(shared.visible, true, "a visible state aliased as hitTestState remains visible");
    const recursiveHit = new DisplayObject();
    const nested = state(8, 6); nested.pos(12, 4); nested.mouseEnabled = true; recursiveHit.addChild(nested);
    aliased.hitTestState = recursiveHit;
    assert.equal(manager.hitTest(aliased, 13, 5), true, "nested native hit geometry is retained");
    assert.equal(manager.hitTest(aliased, 5, 5), false, "hit geometry is not reduced to aggregate bounds");
});

test("TextField has genuine Flash heritage and a composed native Laya input", () => {
    const field = new TextField();
    const displayProbe: DisplayObject = field;
    const interactiveProbe: InteractiveObject = field;
    assert.ok(field instanceof LayaSprite);
    assert.ok(field instanceof InteractiveObject);
    assert.ok(field instanceof DisplayObject);
    assert.equal(field instanceof LayaInput, false, "TextField uses composition instead of breaking Flash heritage");
    assert.equal("dispatchImeComposition" in field, false, "no public compatibility-looking IME control seam exists");
    assert.equal(displayProbe, field);
    assert.equal(interactiveProbe, field);
    assert.equal(field.root, field);
    const textRoot = new DisplayObject(); textRoot.addChild(field);
    assert.equal(field.root, textRoot);
    assert.equal(field.type, TextFieldType.DYNAMIC);
    assert.equal(field.editable, false);
    field.type = TextFieldType.INPUT;
    field.text = "Bleach";
    field.htmlText = "<b>Bleach</b>";
    assert.equal(field.htmlText, "<b>Bleach</b>");
    field.displayAsPassword = true; assert.equal(field.displayAsPassword, true);
    field.embedFonts = true; assert.equal(field.embedFonts, true);
    field.tabEnabled = true; field.tabIndex = 3; field.doubleClickEnabled = true;
    field.setSelection(1, 3);
    field.focus = true;
    assert.equal(field.selectionBeginIndex, 1); assert.equal(field.selectionEndIndex, 3); assert.equal(field.caretIndex, 3);
    assert.equal(field.focus, true); assert.equal(field.mouseEnabled, true);
    assert.equal(field.editable, true);
    let changed = 0;
    field.addEventListener(Event.CHANGE, () => changed++);
    field.dispatchEvent(new Event(Event.CHANGE));
    assert.equal(changed, 1);
    assert.throws(() => field.type = "password", /TextField.type/);
});

test("native focus, input and IME events project exact Flash-shaped payloads", () => {
    class ProbeTextField extends TextField {
        get nativeInput(): LayaInput { return this._nativeTextInput; }
    }
    const field = new ProbeTextField();
    field.type = TextFieldType.INPUT;
    const focus: FocusEvent[] = [];
    const text: TextEvent[] = [];
    const ime: IMEEvent[] = [];
    field.addEventListener(FocusEvent.FOCUS_IN, event => focus.push(event as FocusEvent));
    field.addEventListener(FocusEvent.FOCUS_OUT, event => focus.push(event as FocusEvent));
    field.addEventListener(TextEvent.TEXT_INPUT, event => {
        text.push(event as TextEvent);
        event.preventDefault();
    });
    field.addEventListener(IMEEvent.IME_COMPOSITION, event => ime.push(event as IMEEvent));
    field.nativeInput.event(LayaEvent.FOCUS);
    const beforeInput = {
        text: "inserted", inputType: "insertText", isComposing: false,
        selectionStart: 0, selectionEnd: 0, nativeEvent: null as unknown, defaultPrevented: false,
        preventDefault(): void { this.defaultPrevented = true; }
    };
    field.nativeInput.event(LayaEvent.BEFORE_INPUT, beforeInput);
    assert.equal(beforeInput.defaultPrevented, true, "Flash cancellation reaches Laya before mutation");
    field.nativeInput.event(LayaEvent.COMPOSITION_START, {
        text: "に", selectionStart: 1, selectionEnd: 1, nativeEvent: { data: "に" }
    });
    field.nativeInput.event(LayaEvent.COMPOSITION_UPDATE, {
        text: "日本", selectionStart: 2, selectionEnd: 2, nativeEvent: { data: "日本" }
    });
    field.nativeInput.event(LayaEvent.COMPOSITION_END, {
        text: "日本語", selectionStart: 3, selectionEnd: 3, nativeEvent: { data: "日本語" }
    });
    field.nativeInput.event(LayaEvent.BLUR);
    assert.deepEqual(focus.map(event => event.type), [FocusEvent.FOCUS_IN, FocusEvent.FOCUS_OUT]);
    assert.ok(focus.every(event => event.target === field && event.bubbles));
    assert.deepEqual(text.map(event => [event.text, event.cancelable]), [["inserted", true]]);
    assert.deepEqual(ime.map(event => [event.text, event.imeClient]), [
        ["に", null], ["日本", null], ["日本語", null]
    ]);
    const invalidErrors: unknown[] = [];
    const previousError = console.error; console.error = value => invalidErrors.push(value);
    try {
        field.nativeInput.event(LayaEvent.COMPOSITION_START, {
            text: "invalid", selectionStart: -1, selectionEnd: 0, nativeEvent: null
        });
    } finally { console.error = previousError; }
    assert.match(String(invalidErrors[0]), /selection/);
});

test("real InputManager hit activates composed TextInputAdapter and keeps Flash target outer", async () => {
    class ProbeTextField extends TextField {
        get nativeInput(): LayaInput { return this._nativeTextInput; }
    }
    class ProbeInputManager extends InputManager {
        bind(stage: Stage): void { this._stage = stage; }
        get hitTarget(): LayaNode { return this._touchTarget; }
    }
    class ProbeTextInputAdapter extends TextInputAdapter {
        keyboardShows = 0;
        constructor() { super(); this._editInline = false; }
        install(stage: Stage): void {
            InputManager.onMouseDownCapture.add(this.onTouchBegin, this);
            stage.on(LayaEvent.MOUSE_UP, this, this.onTouchEnd);
        }
        uninstall(stage: Stage): void {
            InputManager.onMouseDownCapture.remove(this.onTouchBegin, this);
            stage.off(LayaEvent.MOUSE_UP, this, this.onTouchEnd);
        }
        protected override onBegin(): Promise<void> {
            this._visEle = {
                value: this.target.text, selectionStart: 0, selectionEnd: 0, selectionDirection: "none"
            } as HTMLInputElement;
            return Promise.resolve();
        }
        protected override onCanShowKeyboard(): Promise<void> { this.keyboardShows++; return Promise.resolve(); }
        protected override onEnd(target: LayaInput): Promise<void> {
            target.text = this._visEle?.value ?? target.text;
            this._visEle = null;
            return Promise.resolve();
        }
        browserEdit(value: string): void {
            const state = { defaultPrevented: false };
            const before = {
                data: value, inputType: "insertText", isComposing: false, cancelable: true,
                get defaultPrevented(): boolean { return state.defaultPrevented; },
                preventDefault(): void { state.defaultPrevented = true; }
            } as unknown as InputEvent;
            this.processBeforeInput(before);
            if (state.defaultPrevented) return;
            const element = this._visEle;
            element.value = value;
            Object.defineProperties(element, {
                selectionStart: { value: value.length, configurable: true },
                selectionEnd: { value: value.length, configurable: true },
            });
            this.processInputting({ target: element } as unknown as globalThis.Event);
        }
        browserComposition(start: string, update: string, commit: string): void {
            const event = (type: string, data: string): CompositionEvent => ({
                type, data, target: this._visEle
            }) as unknown as CompositionEvent;
            this.processCompositionStart(event("compositionstart", start));
            this.processCompositionUpdate(event("compositionupdate", update));
            this._visEle.value = commit;
            this._visEle.selectionStart = commit.length;
            this._visEle.selectionEnd = commit.length;
            this.processCompositionEnd(event("compositionend", commit));
        }
    }

    const previousStage = ILaya.stage;
    const previousAdapter = PAL.textInput;
    const stage = new Stage(); stage.size(320, 200);
    ILaya.stage = stage;
    const adapter = new ProbeTextInputAdapter();
    (PAL as unknown as { textInput: TextInputAdapter }).textInput = adapter;
    adapter.install(stage);
    try {
        const field = new ProbeTextField(); field.type = TextFieldType.INPUT; field.size(120, 24); field.pos(10, 10);
        field.restrict = "A-Z"; field.maxChars = 8; field.multiline = false; field.wordWrap = true; field.selectable = true;
        stage.addChild(field);
        const manager = new ProbeInputManager(); manager.bind(stage);
        const flashClicks: MouseEvent[] = [];
        const changes: Event[] = [];
        const compositions: IMEEvent[] = [];
        field.addEventListener(MouseEvent.CLICK, event => flashClicks.push(event as MouseEvent));
        field.addEventListener(Event.CHANGE, event => changes.push(event));
        field.addEventListener(IMEEvent.IME_COMPOSITION, event => compositions.push(event as IMEEvent));
        const pointer = (type: string, x = 20, y = 18) => ({ type, pageX: x, pageY: y, clientX: x, clientY: y,
            button: 0, buttons: type === "mousedown" ? 1 : 0, cancelable: true, preventDefault() {} }) as globalThis.MouseEvent;
        const click = async (x: number, y: number): Promise<void> => {
            manager.handleMouse(pointer("mousedown", x, y), 0);
            await new Promise(resolve => setTimeout(resolve, 0));
            manager.handleMouse(pointer("mouseup", x, y), 1);
            await new Promise(resolve => setTimeout(resolve, 0));
        };
        manager.handleMouse(pointer("mousedown"), 0);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(manager.hitTarget, field.nativeInput, "real hit target remains native Input");
        assert.equal(adapter.target, field.nativeInput, "TextInputAdapter owns the composed native Input");
        manager.handleMouse(pointer("mouseup"), 1);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(adapter.keyboardShows, 1, "touch completion reaches the mobile keyboard seam");
        assert.equal(flashClicks.length, 1);
        assert.equal(flashClicks[0].target, field, "Flash source target is the outer TextField");
        assert.equal(changes.length, 0, "focus and click do not fabricate a change");
        adapter.browserEdit("ABC");
        assert.equal(field.text, "ABC");
        assert.equal(changes.length, 1, "real Laya INPUT becomes outer Flash change after mutation");
        assert.equal(changes[0].target, field);
        await click(250, 100);
        assert.equal(adapter.target, null);
        assert.equal(changes.length, 1, "later adapter CHANGE and blur do not duplicate the edited generation");

        await click(20, 18);
        assert.equal(adapter.target, field.nativeInput);
        field.text = "PROGRAM";
        assert.equal(changes.length, 1, "programmatic text assignment while focused is not a user change");
        await click(250, 100);
        assert.equal(changes.length, 1, "programmatic assignment remains silent after real adapter blur");

        await click(20, 18);
        assert.equal(adapter.target, field.nativeInput);
        await click(250, 100);
        assert.equal(changes.length, 1, "untouched real focus and blur emit no Flash change");

        field.restrict = null;
        await click(20, 18);
        adapter.browserComposition("に", "日本", "日本語");
        assert.deepEqual(compositions.map(event => event.text), ["に", "日本", "日本語"]);
        assert.equal(field.nativeInput.composing, false);
        assert.equal(field.nativeInput.compositionText, "");
        assert.equal(field.text, "日本語");
        assert.deepEqual([field.selectionBeginIndex, field.selectionEndIndex, field.caretIndex], [3, 3, 3]);
        assert.equal(changes.length, 2, "composition commit is one dirty user generation");
        await click(250, 100);
        assert.equal(changes.length, 2, "composition blur does not duplicate its committed change");
        assert.deepEqual([field.restrict, field.maxChars, field.multiline, field.wordWrap, field.selectable],
            [null, 8, false, true, true]);
        field.mouseEnabled = false;
        assert.equal(field.nativeInput.mouseEnabled, false, "outer authored mouse policy disables the native hit owner");
    } finally {
        adapter.uninstall(stage);
        await adapter.end();
        (PAL as unknown as { textInput: typeof previousAdapter }).textInput = previousAdapter;
        ILaya.stage = previousStage;
        stage.destroy(true);
    }
});

test("tab traversal uses native Stage focus order and a visible focus indicator", () => {
    class ProbeInputManager extends InputManager { bind(stage: Stage): void { this._stage = stage; } }
    const previousStage = ILaya.stage;
    const stage = new Stage(); stage.size(320, 200); ILaya.stage = stage;
    try {
        const first = new InteractiveObject(); first.name = "first"; first.size(50, 20);
        first.tabIndex = 2; first.tabEnabled = true; first.focusRect = true;
        const second = new InteractiveObject(); second.name = "second"; second.size(50, 20);
        second.tabIndex = 1; second.tabEnabled = true; second.focusRect = true;
        stage.addChildren(first, second);
        const manager = new ProbeInputManager(); manager.bind(stage);
        let prevented = 0;
        const tab = (shiftKey: boolean) => ({ type: "keydown", key: "Tab", keyCode: 9, shiftKey,
            cancelable: true, preventDefault(): void { prevented++; } }) as unknown as KeyboardEvent;
        manager.handleKeys(tab(false));
        assert.equal(stage.focus, second);
        assert.ok(second.getChildByName("__flashFocusIndicator"), "focused control owns a visible native ring");
        manager.handleKeys(tab(false));
        assert.equal(stage.focus, first);
        assert.equal(second.getChildByName("__flashFocusIndicator"), null);
        manager.handleKeys(tab(true));
        assert.equal(stage.focus, second);
        assert.equal(prevented, 3);
        const duplicate = new InteractiveObject(); duplicate.name = "duplicate";
        duplicate.tabEnabled = true; duplicate.tabIndex = second.tabIndex; stage.addChild(duplicate);
        const errors: unknown[] = [];
        const previousError = console.error; console.error = value => errors.push(value);
        try { manager.handleKeys(tab(false)); } finally { console.error = previousError; }
        assert.match(String(errors[0]), /unique tabIndex/);
        assert.equal(stage.focus, second, "ambiguous tab order never changes focus");
    } finally {
        ILaya.stage = previousStage;
        stage.destroy(true);
    }
});

test("real Laya ADDED and REMOVED use one Flash Event through capture, target and bubble", () => {
    const parent = new DisplayObject();
    const child = new DisplayObject();
    for (const type of [Event.ADDED, Event.REMOVED]) {
        const seen: Event[] = [];
        parent.addEventListener(type, event => seen.push(event), true);
        parent.addEventListener(type, event => seen.push(event));
        child.addEventListener(type, event => seen.push(event));
        if (type === Event.ADDED) parent.addChild(child); else parent.removeChild(child);
        assert.equal(seen.length, 3);
        assert.ok(seen.every(event => event === seen[0]));
        assert.equal(seen[0].target, child);
        assert.equal(seen[0].bubbles, true);
    }
});

test("timeline invariants reject fallback and invalid replacement without corrupting state", () => {
    const movie = new MovieClip();
    assert.throws(() => movie.totalFrames, error => error instanceof UnsupportedFlashFeatureError);
    const animator = new AnimatorClip2D();
    const clip = new AnimationClip2D(); clip._duration = 0.5; clip._frameRate = 6; animator.autoPlay = false; animator.clip = clip;
    const timeline = new AnimatorClip2DTimeline(animator);
    movie._bindNativeTimeline(timeline, { idle: 1, done: 3 });
    movie.gotoAndStop("done");
    assert.equal(movie.currentFrame, 3);
    assert.throws(() => movie._bindNativeTimeline(timeline, { broken: 4 }), /outside/);
    assert.equal(movie.currentFrame, 3);
    assert.deepEqual({ ...movie.flashFrameLabels }, { idle: 1, done: 3 });
    const invalid = { totalFrames: 0, currentFrame: 0, playing: false, play() {}, stop() {}, gotoAndStop() {} };
    assert.throws(() => movie._bindNativeTimeline(invalid), /totalFrames/);
    assert.equal(movie.totalFrames, 3);
});

test("neutral Laya host rejects missing native event, selection, cue, frame and time data", () => {
    const host = new LayaAuthoredBindingHost();
    const click = new DisplayObject(); click.name = "button";
    const clickLease = host.attach([{ node: click, nodeId: "button", type: "click", receive: () => undefined }]);
    assert.throws(() => mapLayaAuthoredEventData(click, "click", LayaEvent.CLICK, undefined), /requires a native Laya Event/);
    clickLease.detach();

    const input = new DisplayObject(); input.name = "input"; (input as any).text = "value";
    const inputLease = host.attach([{ node: input, nodeId: "input", type: "input", receive: () => undefined }]);
    assert.throws(() => mapLayaAuthoredEventData(input, "input", LayaEvent.INPUT,
        new LayaEvent().setTo(LayaEvent.INPUT, input, input)), /selectionStart/);
    inputLease.detach();

    const timeline = new DisplayObject(); timeline.name = "timeline";
    const cueLease = host.attach([{ node: timeline, nodeId: "timeline", type: "cue", receive: () => undefined }]);
    assert.throws(() => mapLayaAuthoredEventData(timeline, "cue", LayaEvent.LABEL,
        { timelineId: "timeline", cueId: "start" }), /frame/);
    assert.throws(() => mapLayaAuthoredEventData(timeline, "cue", LayaEvent.LABEL,
        { timelineId: "timeline", cueId: "start", frame: 1 }), /timeMs/);
    cueLease.detach();
});

test("explicit bootstrap loads canonical Laya hierarchy with application linkage and named injection", () => {
    registerAuthoredContentRuntime([
        { id: "fixtures.FlashPanel", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" },
        { id: "fixtures.SubmitButtonLinkage", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Sprite" },
        { id: "fixtures.ButtonStateLinkage", ctor: ButtonStateLinkage, sourceType: "DisplayObject", serializedType: "Sprite" }
    ]);
    // Idempotent identical bootstrap is admitted; Flash aliases and collisions are not.
    registerAuthoredContentRuntime([{
        id: "fixtures.FlashPanel", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite"
    }]);
    assert.throws(() => registerAuthoredContentRuntime([
        { id: "fixtures.Duplicate", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" },
        { id: "fixtures.Duplicate", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" }
    ]), /Duplicate/);
    assert.throws(() => registerAuthoredContentRuntime([{
        id: "flash.display.MovieClip", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite"
    }]), /application-owned/);
    assert.throws(() => registerAuthoredContentRuntime([{
        id: "fixtures.FlashPanel", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Sprite"
    }]), /collision/);
    assert.throws(() => registerAuthoredContentRuntime([{
        id: "fixtures.WrongSerialized", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Input"
    }]), /does not match/);
    const data = JSON.parse(readFileSync(join(process.cwd(), "tests/extensions/authoredContentBridge/fixtures/flash-panel.lh"), "utf8"));
    const serializedTypes: string[] = [];
    const visit = (node: any): void => { serializedTypes.push(node._$type); for (const child of node._$child ?? []) visit(child); };
    visit(data);
    assert.ok(serializedTypes.every(type => type === "Sprite"));
    const errors: unknown[] = [];
    const panel = new PrefabImpl(HierarchyParser, data).create(undefined, errors) as FlashPanel;
    assert.deepEqual(errors, []);
    assert.ok(panel instanceof FlashPanel);
    assert.ok(panel.submitButton instanceof SubmitButtonLinkage, `actual child: ${panel.submitButton?.constructor?.name}`);
    assert.equal(panel.submitButton.hitTestState?.visible, false);
    const mismatched = structuredClone(data);
    mismatched._$type = "Input";
    const mismatchErrors: unknown[] = [];
    assert.ok(!new PrefabImpl(HierarchyParser, mismatched).create(undefined, mismatchErrors));
    assert.match(String(mismatchErrors[0]), /requires serialized type 'Sprite'/);
});

test("transpiled-style class keeps Flash add/remove APIs and bound method identity", () => {
    const panel = createPanel();
    const animator = new AnimatorClip2D();
    const clip = new AnimationClip2D(); clip._duration = 0.5; clip._frameRate = 6; animator.autoPlay = false; animator.clip = clip;
    panel._bindNativeTimeline(new AnimatorClip2DTimeline(animator), { idle: 1, done: 3 });
    panel.activate();
    panel.submitButton.event(LayaEvent.CLICK, nativeMouse(LayaEvent.CLICK, panel.submitButton, 40, 24, 0));
    assert.equal(panel.clickCount, 1); assert.equal(panel.status, "clicked"); assert.equal(panel.currentFrame, 3);
    panel.deactivate();
    panel.submitButton.event(LayaEvent.CLICK, nativeMouse(LayaEvent.CLICK, panel.submitButton, 40, 24, 0));
    assert.equal(panel.clickCount, 1);
});

function state(width: number, height: number): DisplayObject {
    const value = new DisplayObject(); value.size(width, height); return value;
}
function nativeMouse(type: string, target: DisplayObject, x: number, y: number, buttons: number): LayaEvent {
    const event = new LayaEvent(); event.touchPos.setTo(x, y); event.button = 0;
    Object.defineProperty(event, "nativeEvent", { value: { buttons, ctrlKey: false, altKey: false, shiftKey: false }, configurable: true });
    event.setTo(type, target, target); return event;
}
function createPanel(): FlashPanel {
    registerAuthoredContentRuntime([
        { id: "fixtures.FlashPanel", ctor: FlashPanel, sourceType: "MovieClip", serializedType: "Sprite" },
        { id: "fixtures.SubmitButtonLinkage", ctor: SubmitButtonLinkage, sourceType: "SimpleButton", serializedType: "Sprite" },
        { id: "fixtures.ButtonStateLinkage", ctor: ButtonStateLinkage, sourceType: "DisplayObject", serializedType: "Sprite" }
    ]);
    const data = JSON.parse(readFileSync(join(process.cwd(), "tests/extensions/authoredContentBridge/fixtures/flash-panel.lh"), "utf8"));
    const errors: unknown[] = [];
    const panel = new PrefabImpl(HierarchyParser, data).create(undefined, errors) as FlashPanel;
    assert.deepEqual(errors, []); return panel;
}
