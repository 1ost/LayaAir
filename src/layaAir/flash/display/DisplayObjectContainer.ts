import { Node as LayaNode } from "../../laya/display/Node";
import { registerSourceDisplayObjectContainerResolver } from "../../laya/display/SourceStageViewRegistry";
import { DisplayObject } from "./DisplayObject";
import { InteractiveObject } from "./InteractiveObject";

const DISPLAY_OBJECT_CONTAINER_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash display containers. */
export function isFlashDisplayObjectContainer(value: unknown): value is DisplayObjectContainer {
    return typeof value === "object" && value !== null && DISPLAY_OBJECT_CONTAINER_VALUES.has(value);
}

/**
 * Preserves Flash's display inheritance and gives unqualified child lookups a
 * Flash-shaped default result while using Laya's native child collection.
 */
export class DisplayObjectContainer extends InteractiveObject {
    constructor() {
        super();
        DISPLAY_OBJECT_CONTAINER_VALUES.add(this);
    }

    override getChildAt<T extends LayaNode = DisplayObject>(
        index: number,
        classType?: new (...args: any[]) => T
    ): T {
        return super.getChildAt(index, classType);
    }

    override getChildByName<T extends LayaNode = DisplayObject>(
        name: string,
        classType?: new (...args: any[]) => T
    ): T {
        return super.getChildByName(name, classType);
    }

    override removeChildAt(index: number, destroy?: boolean): DisplayObject {
        return super.removeChildAt(index, destroy) as DisplayObject;
    }

    override removeChildByName(name: string, destroy?: boolean): DisplayObject {
        return super.removeChildByName(name, destroy) as DisplayObject;
    }
}

registerSourceDisplayObjectContainerResolver(value =>
    isFlashDisplayObjectContainer(value) ? value : null);
