import assert from "node:assert/strict";
import test from "node:test";
import { ILaya } from "../../src/layaAir/ILaya";
import { Event as LayaEvent } from "../../src/layaAir/laya/events/Event";
import { InputManager } from "../../src/layaAir/laya/events/InputManager";
import { HierarchyParser } from "../../src/layaAir/laya/loaders/HierarchyParser";
import { LayaGL } from "../../src/layaAir/laya/layagl/LayaGL";
import { NoRender2DProcess } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/2DRenderPass/NoRender2DProcess";
import { NoRenderDeviceFactory } from "../../src/layaAir/laya/RenderDriver/NoRenderDriver/DriverDevice/NoRenderDeviceFactory";
import { PrefabImpl } from "../../src/layaAir/laya/resource/PrefabImpl";
import "../../src/layaAir/laya/ModuleDef";
import { DisplayObject, flashDisplayObjectNativeHost } from "../../src/layaAir/flash/display/DisplayObject";
import { isFlashSimpleButton } from "../../src/layaAir/flash/display/SimpleButton";
import {
    AUTHORED_CONTENT_RUNTIME_IDS,
    AuthoredButtonState,
    isAuthoredSimpleButton,
    registerAuthoredContentPrimitives,
} from "../../src/extensions/authoredContent/runtime/AuthoredRuntimePrimitives";

LayaGL.render2DRenderPassFactory = new NoRender2DProcess();
LayaGL.renderDeviceFactory = new NoRenderDeviceFactory();
Object.defineProperty(ILaya, "stage", {
    value: {
        _graphicUpdateList: new Set(),
        _tranMatrixUpdateList: new Set(),
        _componentDriver: { _toDestroys: new Set() },
    },
    configurable: true,
});

test("authored SimpleButton hierarchy owns four independent states and follows exact pointer transitions", () => {
    registerAuthoredContentPrimitives();
    const errors: unknown[] = [];
    const prefab = new PrefabImpl(HierarchyParser, {
        "_$ver": 1,
        "_$id": "button",
        "_$type": "Sprite",
        "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.button,
        name: "Btn_Close",
        width: 28,
        height: 19,
        "_$child": [
            stateHierarchy("upState", "up", 0, 0, 28, 19),
            stateHierarchy("overState", "over", 0, 0, 28, 19),
            stateHierarchy("downState", "down", 0, 0, 28, 19),
            stateHierarchy("hitTestState", "up", 4, 3, 10, 6),
        ],
    });
    const instance = prefab.create({}, errors);
    assert.deepEqual(errors, []);
    assert.equal(isAuthoredSimpleButton(instance), true);
    if (!isAuthoredSimpleButton(instance))
        throw new TypeError("Authored SimpleButton hierarchy did not produce its registered runtime primitive");
    assert.equal(isFlashSimpleButton(instance), true);

    const states = [instance.upState, instance.overState, instance.downState, instance.hitTestState];
    assert.ok(states.every(state => state instanceof AuthoredButtonState));
    assert.notEqual(instance.upState, instance.hitTestState, "shared source character must deserialize as independently owned state objects");
    assert.deepEqual(Array.from(instance.children), states,
        "deserialized state objects must remain independently owned direct children of the button");
    assert.deepEqual(states.map(state => state?.mouseEnabled), [false, false, false, false]);
    assert.deepEqual(states.map(state => state?.visible), [true, false, false, false]);

    instance.event(LayaEvent.MOUSE_OVER, nativeMouse(LayaEvent.MOUSE_OVER, instance, 5, 4, 0));
    assert.deepEqual(states.map(state => state?.visible), [false, true, false, false]);
    instance.event(LayaEvent.MOUSE_DOWN, nativeMouse(LayaEvent.MOUSE_DOWN, instance, 5, 4, 1));
    assert.deepEqual(states.map(state => state?.visible), [false, false, true, false]);
    instance.event(LayaEvent.MOUSE_UP, nativeMouse(LayaEvent.MOUSE_UP, instance, 5, 4, 0));
    assert.deepEqual(states.map(state => state?.visible), [false, true, false, false]);
    instance.event(LayaEvent.MOUSE_OUT, nativeMouse(LayaEvent.MOUSE_OUT, instance, 20, 15, 0));
    assert.deepEqual(states.map(state => state?.visible), [true, false, false, false]);

    const manager = new InputManager();
    const nativeButton = flashDisplayObjectNativeHost(instance);
    assert.equal(manager.hitTest(nativeButton, 4, 3), true);
    assert.equal(manager.hitTest(nativeButton, 13.99, 8.99), true);
    assert.equal(manager.hitTest(nativeButton, 14, 8), false);
    assert.equal(manager.hitTest(nativeButton, 3.99, 4), false);
    instance.destroy(true);

    const emptyStateErrors: unknown[] = [];
    const emptyStateInstance = new PrefabImpl(HierarchyParser, {
        "_$ver": 1,
        "_$id": "empty-state-button",
        "_$type": "Sprite",
        "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.button,
        width: 28,
        height: 19,
        "_$child": [
            stateHierarchy("upState", "up", 0, 0, 28, 19),
            emptyStateHierarchy("overState"),
            stateHierarchy("downState", "down", 0, 0, 28, 19),
            emptyStateHierarchy("hitTestState"),
        ],
    }).create({}, emptyStateErrors);
    assert.deepEqual(emptyStateErrors, []);
    assert.equal(isAuthoredSimpleButton(emptyStateInstance), true);
    if (!isAuthoredSimpleButton(emptyStateInstance))
        throw new TypeError("Empty-state hierarchy did not produce its registered runtime primitive");
    const emptyStates = [
        emptyStateInstance.upState,
        emptyStateInstance.overState,
        emptyStateInstance.downState,
        emptyStateInstance.hitTestState,
    ];
    assert.equal(new Set(emptyStates).size, 4);
    assert.deepEqual(emptyStates.map(state => state?.numChildren), [1, 0, 1, 0]);
    emptyStateInstance.event(LayaEvent.MOUSE_OVER, nativeMouse(LayaEvent.MOUSE_OVER, emptyStateInstance, 5, 4, 0));
    assert.deepEqual(emptyStates.map(state => state?.visible), [false, true, false, false],
        "an empty over state must remain empty instead of falling back to the up state");
    assert.equal(manager.hitTest(flashDisplayObjectNativeHost(emptyStateInstance), 5, 4), false,
        "an empty hit state must disable hit testing instead of falling back to visible state geometry");
    emptyStateInstance.destroy(true);
});

function stateHierarchy(name: string, visualName: string, x: number, y: number, width: number, height: number): object {
    return {
        "_$type": "Sprite",
        "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.buttonState,
        name,
        "_$child": [{ "_$type": "Sprite", name: visualName, x, y, width, height }],
    };
}

function emptyStateHierarchy(name: string): object {
    return {
        "_$type": "Sprite",
        "_$runtime": AUTHORED_CONTENT_RUNTIME_IDS.buttonState,
        name,
        "_$child": [],
    };
}

function nativeMouse(type: string, target: DisplayObject, x: number, y: number, buttons: number): LayaEvent {
    const event = new LayaEvent();
    event.touchPos.setTo(x, y);
    event.button = 0;
    Object.defineProperty(event, "nativeEvent", {
        value: { buttons, ctrlKey: false, altKey: false, shiftKey: false },
        configurable: true,
    });
    event.setTo(type, target, target);
    return event;
}
