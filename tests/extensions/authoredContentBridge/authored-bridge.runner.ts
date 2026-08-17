import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ILaya } from "../../../src/layaAir/ILaya";
import { AnimationClip2D } from "../../../src/layaAir/laya/components/AnimationClip2D";
import { AnimatorClip2D } from "../../../src/layaAir/laya/components/AnimatorClip2D";
import { Sprite as LayaSprite } from "../../../src/layaAir/laya/display/Sprite";
import { Event as LayaEvent } from "../../../src/layaAir/laya/events/Event";
import { InputManager } from "../../../src/layaAir/laya/events/InputManager";
import { PAL } from "../../../src/layaAir/laya/platform/PlatformAdapters";
import { HierarchyParser } from "../../../src/layaAir/laya/loaders/HierarchyParser";
import { LayaGL } from "../../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
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
ILaya.stage = { _graphicUpdateList: new Set(), _tranMatrixUpdateList: new Set() } as any;
ILaya.timer = { callLater: (): void => undefined } as any;
ILaya.systemTimer = { callLater: (): void => undefined, runCallLater: (): void => undefined } as any;
(PAL as any).textInput = {
    target: null,
    begin(target: unknown): void { this.target = target; },
    end(): void { this.target = null; },
    setText: (): void => undefined,
    setSelection: (): void => undefined,
    syncSelection: (): void => undefined,
    syncText: (): void => undefined
};

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

    const shared = state(15, 8);
    const aliased = new SimpleButton(shared, null, null, shared);
    assert.equal(shared.visible, true, "a visible state aliased as hitTestState remains visible");
    const recursiveHit = new DisplayObject();
    const nested = state(8, 6); nested.pos(12, 4); nested.mouseEnabled = true; recursiveHit.addChild(nested);
    aliased.hitTestState = recursiveHit;
    assert.equal(manager.hitTest(aliased, 13, 5), true, "nested native hit geometry is retained");
    assert.equal(manager.hitTest(aliased, 5, 5), false, "hit geometry is not reduced to aggregate bounds");
});

test("TextField is a real Laya input with Flash type semantics and source event methods", () => {
    const field = new TextField();
    const displayProbe: DisplayObject = field;
    const interactiveProbe: InteractiveObject = field;
    assert.ok(field instanceof LayaSprite);
    assert.equal(displayProbe, field);
    assert.equal(interactiveProbe, field);
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
    const field = new TextField();
    field.type = TextFieldType.INPUT;
    const focus: FocusEvent[] = [];
    const text: TextEvent[] = [];
    const ime: IMEEvent[] = [];
    field.addEventListener(FocusEvent.FOCUS_IN, event => focus.push(event as FocusEvent));
    field.addEventListener(FocusEvent.FOCUS_OUT, event => focus.push(event as FocusEvent));
    field.addEventListener(TextEvent.TEXT_INPUT, event => text.push(event as TextEvent));
    field.addEventListener(IMEEvent.IME_COMPOSITION, event => ime.push(event as IMEEvent));
    field.event(LayaEvent.FOCUS);
    field.text = "native exact value";
    field.event(LayaEvent.INPUT);
    field.event(LayaEvent.COMPOSITION_START, {
        text: "に", selectionStart: 1, selectionEnd: 1, nativeEvent: { data: "に" }
    });
    field.event(LayaEvent.COMPOSITION_UPDATE, {
        text: "日本", selectionStart: 2, selectionEnd: 2, nativeEvent: { data: "日本" }
    });
    field.dispatchImeComposition("end", "日本語", 3, 3, { data: "日本語" });
    field.event(LayaEvent.BLUR);
    assert.deepEqual(focus.map(event => event.type), [FocusEvent.FOCUS_IN, FocusEvent.FOCUS_OUT]);
    assert.ok(focus.every(event => event.target === field && event.bubbles));
    assert.deepEqual(text.map(event => event.text), ["native exact value"]);
    assert.deepEqual(ime.map(event => [event.compositionPhase, event.text,
        event.selectionBeginIndex, event.selectionEndIndex]), [
        ["start", "に", 1, 1], ["update", "日本", 2, 2], ["end", "日本語", 3, 3]
    ]);
    assert.throws(() => field.dispatchImeComposition("start", "invalid", -1, 0), /selection/);
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
