import { Node as LayaNode } from "../../../../../layaAir/laya/display/Node";
import { DisplayObject } from "./DisplayObject";
import { InteractiveObject } from "./InteractiveObject";

/**
 * Preserves Flash's display inheritance and gives unqualified child lookups a
 * Flash-shaped default result while using Laya's native child collection.
 */
export class DisplayObjectContainer extends InteractiveObject {
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
