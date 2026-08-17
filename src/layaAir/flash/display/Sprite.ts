import { DisplayObjectContainer } from "./DisplayObjectContainer";

/** Source-shaped `flash.display.Sprite`, still a native Laya display node. */
export class Sprite extends DisplayObjectContainer {
    buttonMode: boolean = false;
    useHandCursor: boolean = true;
}
