import { DisplayObject } from "../../src/layaAir/flash/display/DisplayObject";
import { FlashStageBoundary } from "../../src/layaAir/flash/display/FlashStageBoundary";
import { Stage } from "../../src/layaAir/flash/display/Stage";
import { Stage as LayaStage } from "../../src/layaAir/laya/display/Stage";

declare const nativeStage: LayaStage;
declare const display: DisplayObject;

const stage: Stage = Stage.fromNative(nativeStage);
const attached: Stage | null = Stage.forDisplayObject(display);
const width: number = stage.stageWidth;
const parameters: Readonly<Record<string, string>> = stage.loaderInfo.parameters;
const viewport = FlashStageBoundary.claimViewport(nativeStage, { width: 1250, height: 650 });
const viewportDisposed: boolean = viewport.disposed;
viewport.resizeViewport(1024, 576);
viewport.dispose();
stage.align = "TL";
stage.scaleMode = "noScale";
stage.quality = "high";
stage.showDefaultContextMenu = false;
stage.frameRate = 30;

// @ts-expect-error Stage is engine-created and requires an inaccessible authority token.
new Stage();
// @ts-expect-error Only the retained source alignment is admitted.
stage.align = "C";
// @ts-expect-error Laya throttle modes are not Flash numeric frame rates.
stage.frameRate = "fast";
// @ts-expect-error A native Laya Stage is not the source-shaped Stage view.
const leaked: Stage = nativeStage;
// @ts-expect-error Native boundary APIs retain native Stage authority.
FlashStageBoundary.getWidth(stage);

void [attached, width, parameters, viewportDisposed, leaked];
