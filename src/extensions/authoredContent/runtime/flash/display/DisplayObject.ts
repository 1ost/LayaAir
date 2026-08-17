import { Sprite as LayaSprite } from "../../../../../layaAir/laya/display/Sprite";
import { FlashEventListener, FlashEventRouter } from "../../FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";

/** Flash display source shape backed by a real Laya Sprite. */
export class DisplayObject extends LayaSprite implements IEventDispatcher {
    private readonly _flashEvents = new FlashEventRouter(this);

    addEventListener(type: string, listener: FlashEventListener, useCapture = false, priority = 0, useWeakReference = false): void {
        this._flashEvents.addEventListener(type, listener, useCapture, priority, useWeakReference);
    }
    removeEventListener(type: string, listener: FlashEventListener, useCapture = false): void {
        this._flashEvents.removeEventListener(type, listener, useCapture);
    }
    dispatchEvent(event: Event): boolean { return this._flashEvents.dispatchEvent(event, this); }
    hasEventListener(type: string): boolean { return this._flashEvents.hasEventListener(type); }
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
