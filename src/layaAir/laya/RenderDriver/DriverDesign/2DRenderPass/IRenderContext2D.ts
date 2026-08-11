import { Color } from "../../../maths/Color";
import { Vector4 } from "../../../maths/Vector4";
import { SingletonList } from "../../../utils/SingletonList";
import { InternalRenderTarget } from "../RenderDevice/InternalRenderTarget";
import { InternalTexture } from "../RenderDevice/InternalTexture";
import { IRenderCMD } from "../RenderDevice/IRenderCMD";
import { ShaderData } from "../RenderDevice/ShaderData";
import { IRenderElement2D } from "./IRenderElement2D";
import { RenderTargetFormat } from "../../../RenderEngine/RenderEnum/RenderTargetFormat";

/**
 * @blueprintIgnore
 */
export interface IRenderContext2D {

    invertY: boolean;
    pipelineMode: string;
    passData: ShaderData;
    setRenderTarget(value: InternalRenderTarget, clear: boolean, clearColor: Color): void;
    getRenderTarget(): InternalRenderTarget;
    /** Format of the active color target, including the platform backbuffer. */
    getCurrentTargetColorFormat(): RenderTargetFormat;
    setOffscreenView(width: number, height: number, x?: number, y?: number): void;
    getOffscreenView(out: Vector4): void;
    /** Copies pixels already rendered in the active target into a sampleable texture. */
    copyCurrentTargetToTexture(destination: InternalTexture, width: number, height: number, sourceX?: number, sourceY?: number, destinationX?: number, destinationY?: number): void;
    drawRenderElementOne(node: IRenderElement2D): void;
    drawRenderElementList(list: SingletonList<IRenderElement2D>): number;
    runOneCMD(cmd: IRenderCMD): void
    runCMDList(cmds: IRenderCMD[]): void;
}
