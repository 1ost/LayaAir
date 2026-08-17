import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { FlashEventListener, FlashEventRouter } from "../events/FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";

const DISPLAY_EVENTS = new WeakMap<DisplayObject, FlashEventRouter>();
function events(value: DisplayObject): FlashEventRouter {
    let router = DISPLAY_EVENTS.get(value);
    if (!router) DISPLAY_EVENTS.set(value, router = new FlashEventRouter(value));
    return router;
}

/** Flash display source shape backed by a real Laya Sprite. */
export class DisplayObject extends LayaSprite implements IEventDispatcher {
    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        events(this).addEventListener(type, listener, useCapture, priority, useWeakReference);
    }
    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        events(this).removeEventListener(type, listener, useCapture);
    }
    dispatchEvent(event: Event): boolean { return events(this).dispatchEvent(event, this); }
    hasEventListener(type: string): boolean { return events(this).hasEventListener(type); }
    willTrigger(type: string): boolean {
        let node: LayaSprite | null = this;
        while (node) {
            if (FlashEventRouter.forHost(node)?.hasEventListener(type)) return true;
            node = node.parent as LayaSprite | null;
        }
        return false;
    }
    get root(): DisplayObject {
        let value: DisplayObject = this;
        while (value.parent instanceof DisplayObject) value = value.parent;
        return value;
    }
}
