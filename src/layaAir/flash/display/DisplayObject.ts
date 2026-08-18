import { Sprite as LayaSprite } from "../../laya/display/Sprite";
import { Point as LayaPoint } from "../../laya/maths/Point";
import { Rectangle as LayaRectangle } from "../../laya/maths/Rectangle";
import { isFlashPoint, Point } from "../geom/Point";
import { Rectangle } from "../geom/Rectangle";
import { FlashEventListener, FlashEventRouter } from "../events/FlashEventRouter";
import { Event } from "../events/Event";
import { IEventDispatcher } from "../events/EventDispatcher";

const DISPLAY_EVENTS = new WeakMap<DisplayObject, FlashEventRouter>();
const DISPLAY_OBJECT_VALUES = new WeakSet<object>();

/** @internal Nominal guard for authenticated runtime `is` checks and dual native APIs. */
export function isFlashDisplayObject(value: unknown): value is DisplayObject {
    return typeof value === "object" && value !== null && DISPLAY_OBJECT_VALUES.has(value);
}

function events(value: DisplayObject): FlashEventRouter {
    let router = DISPLAY_EVENTS.get(value);
    if (!router) DISPLAY_EVENTS.set(value, router = new FlashEventRouter(value));
    return router;
}

/** Flash display source shape backed by a real Laya Sprite. */
export class DisplayObject extends LayaSprite implements IEventDispatcher {
    constructor() {
        super();
        DISPLAY_OBJECT_VALUES.add(this);
    }

    getBounds(targetCoordinateSpace: DisplayObject): Rectangle;
    getBounds(out?: LayaRectangle): LayaRectangle;
    getBounds(value?: DisplayObject | LayaRectangle): Rectangle | LayaRectangle {
        if (!isFlashDisplayObject(value)) {
            if (value !== undefined && !(value instanceof LayaRectangle))
                throw new TypeError("targetCoordinateSpace must be a DisplayObject");
            return super.getBounds(value);
        }

        const bounds = super.getSelfBounds(undefined, true);
        if (value === this) return new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);

        const corners = [
            new LayaPoint(bounds.x, bounds.y),
            new LayaPoint(bounds.right, bounds.y),
            new LayaPoint(bounds.x, bounds.bottom),
            new LayaPoint(bounds.right, bounds.bottom),
        ].map(point => value.globalToLocal(this.localToGlobal(point, true), true));
        const xs = corners.map(point => point.x);
        const ys = corners.map(point => point.y);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        return new Rectangle(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
    }

    globalToLocal(point: Point): Point;
    globalToLocal(point: LayaPoint, createNewPoint?: boolean, globalNode?: LayaSprite): LayaPoint;
    globalToLocal(point: Point | LayaPoint, createNewPoint = false, globalNode?: LayaSprite): Point | LayaPoint {
        if (isFlashPoint(point)) {
            const value = super.globalToLocal(new LayaPoint(point.x, point.y), true, globalNode);
            return new Point(value.x, value.y);
        }
        if (!(point instanceof LayaPoint)) throw new TypeError("point must be a Point");
        return super.globalToLocal(point, createNewPoint, globalNode);
    }
    localToGlobal(point: Point): Point;
    localToGlobal(point: LayaPoint, createNewPoint?: boolean, globalNode?: LayaSprite): LayaPoint;
    localToGlobal(point: Point | LayaPoint, createNewPoint = false, globalNode?: LayaSprite): Point | LayaPoint {
        if (isFlashPoint(point)) {
            const value = super.localToGlobal(new LayaPoint(point.x, point.y), true, globalNode);
            return new Point(value.x, value.y);
        }
        if (!(point instanceof LayaPoint)) throw new TypeError("point must be a Point");
        return super.localToGlobal(point, createNewPoint, globalNode);
    }
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
