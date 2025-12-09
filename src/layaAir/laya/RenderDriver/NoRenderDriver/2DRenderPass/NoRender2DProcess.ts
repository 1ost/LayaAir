import { SubShader } from "../../../RenderEngine/RenderShader/SubShader";
import { Color } from "../../../maths/Color";
import { SingletonList } from "../../../utils/SingletonList";
import { I2DRenderPassFactory } from "../../DriverDesign/2DRenderPass/I2DRenderPassFactory";
import { IRenderContext2D } from "../../DriverDesign/2DRenderPass/IRenderContext2D";
import { IPrimitiveRenderElement2D, IRenderElement2D } from "../../DriverDesign/2DRenderPass/IRenderElement2D";
import { Blit2DQuadCMD, Draw2DElementCMD, SetRendertarget2DCMD } from "../../DriverDesign/2DRenderPass/IRender2DCMD";
import { IRenderCMD, SetRenderDataCMD, SetShaderDefineCMD } from "../../DriverDesign/RenderDevice/IRenderCMD";
import { IRenderGeometryElement } from "../../DriverDesign/RenderDevice/IRenderGeometryElement";
import { InternalRenderTarget } from "../../DriverDesign/RenderDevice/InternalRenderTarget";
import { ShaderData } from "../../DriverDesign/RenderDevice/ShaderData";
import { NoRenderSetRenderData, NoRenderSetShaderDefine } from "../DriverDevice/NoRenderDeviceFactory";
import { IRender2DDataHandle, I2DPrimitiveDataHandle, I2DBaseRenderDataHandle, IMesh2DRenderDataHandle, I2DGlobalRenderData, ISpineRenderDataHandle, I2DGraphicWholeBuffer, I2DGraphicIndexDataView, I2DGraphicVertexDataView, IGraphics2DBufferBlock, IGraphics2DVertexBlock } from "../../RenderModuleData/Design/2D/IRender2DDataHandle";
import { IRender2DPass, IRender2DPassManager } from "../../RenderModuleData/Design/2D/IRender2DPass";
import { IRenderStruct2D } from "../../RenderModuleData/Design/2D/IRenderStruct2D";
import { NotImplementedError } from "../../../utils/Error";
import { NoRender2D2DPrimitiveDataHandle, NoRender2DBaseRenderDataHandle, NoRender2DGlobalRenderData, NoRender2DGraphicIndexDataView, NoRender2DGraphics2DVertexBlock, NoRender2DGraphicVertexDataView, NoRender2DGraphicWholeBuffer, NoRender2DMesh2DRenderDataHandle, NoRender2Draphics2DBufferBlock, NoRender2DRender2DDataHandle, NoRender2DRender2DPass, NoRender2DRender2DPassManager, NoRender2DRenderStruct2D, NoRender2DSpineRenderDataHandle } from "./NoRenderPassProcessElement";


export class NoRender2DProcess implements I2DRenderPassFactory {
    createGraphic2DBufferBlock(): IGraphics2DBufferBlock {
        return new NoRender2Draphics2DBufferBlock();
    }
    
    createGraphic2DVertexBlock(): IGraphics2DVertexBlock {
        return new NoRender2DGraphics2DVertexBlock();
    }

    create2DGraphicVertexDataView(wholeBuffer: I2DGraphicWholeBuffer, elementOffset: number, elementSize: number, stride: number): I2DGraphicVertexDataView {
        return new NoRender2DGraphicVertexDataView();
    }
    create2DGraphicIndexDataView(wholeBuffer: I2DGraphicWholeBuffer, elementSize: number): I2DGraphicIndexDataView {
        return new NoRender2DGraphicIndexDataView();
    }
    create2DGraphicIndexBuffer(): I2DGraphicWholeBuffer {
        return new NoRender2DGraphicWholeBuffer();
    }

    create2DGraphicVertexBuffer(): I2DGraphicWholeBuffer {
       return new NoRender2DGraphicWholeBuffer()
    }

    createRender2DPassManager(): IRender2DPassManager {
        return new NoRender2DRender2DPassManager();
    }

    create2DGlobalRenderDataHandle(): I2DGlobalRenderData {
        return new NoRender2DGlobalRenderData();
    }
    createSpineRenderDataHandle(): ISpineRenderDataHandle {
        return new NoRender2DSpineRenderDataHandle();
    }
    createRender2DPass(): IRender2DPass {
        return new NoRender2DRender2DPass();
    }
    createRenderStruct2D(): IRenderStruct2D {
        return new NoRender2DRenderStruct2D();
    }
    createRender2DDataHandle(): IRender2DDataHandle {
        return new NoRender2DRender2DDataHandle();
    }
    create2D2DPrimitiveDataHandle(): I2DPrimitiveDataHandle {
        return new NoRender2D2DPrimitiveDataHandle();
    }
    create2DBaseRenderDataHandle(): I2DBaseRenderDataHandle {
        return new NoRender2DBaseRenderDataHandle();
    }
    createMesh2DRenderDataHandle(): IMesh2DRenderDataHandle {
        return new NoRender2DMesh2DRenderDataHandle();
    }
    createSetRenderDataCMD(): SetRenderDataCMD {
        return new NoRenderSetRenderData();
    }
    createSetShaderDefineCMD(): SetShaderDefineCMD {
        return new NoRenderSetShaderDefine();
    }
    createBlit2DQuadCMDData(): Blit2DQuadCMD {
        return new NoRenderBlit2DquadCMD();
    }
    createDraw2DElementCMDData(): Draw2DElementCMD {
        return new NoRenderDraw2DElementCMD();
    }
    createSetRendertarget2DCMD(): SetRendertarget2DCMD {
        return new NoRenderSetRendertarget2DCMD();
    }
    createRenderElement2D(): IRenderElement2D {
        return new NoRenderElement2D()
    }
    createPrimitiveRenderElement2D(): IPrimitiveRenderElement2D {
        return new NoRenderElement2D();
    }
    createRenderContext2D(): IRenderContext2D {
        return new NoRenderContext2D();
    }

}

export class NoRenderElement2D implements IRenderElement2D {
    type: number;
    owner: IRenderStruct2D;
    nodeCommonMap: string[];
    geometry: IRenderGeometryElement;
    materialShaderData: ShaderData;
    value2DShaderData: ShaderData;
    primitiveShaderData: ShaderData;
    subShader: SubShader;
    renderStateIsBySprite: boolean;
    globalShaderData: ShaderData;

    destroy(): void {

    }

}

export class NoRenderContext2D implements IRenderContext2D {
    passData: ShaderData;
    getRenderTarget(): InternalRenderTarget {
        return null;
    }

    sceneData: ShaderData;
    invertY: boolean;
    pipelineMode: string;
    setRenderTarget(value: InternalRenderTarget, clear: boolean, clearColor: Color): void {

    }
    setOffscreenView(width: number, height: number): void {

    }
    drawRenderElementOne(node: IRenderElement2D): void {

    }
    drawRenderElementList(list: SingletonList<IRenderElement2D>): number {
        return 0;
    }
    runOneCMD(cmd: IRenderCMD): void {
    }
    runCMDList(cmds: IRenderCMD[]): void {
    }
}

export class NoRenderBlit2DquadCMD extends Blit2DQuadCMD {
    apply(context: IRenderContext2D): void {
    }
}

export class NoRenderDraw2DElementCMD extends Draw2DElementCMD {
    setRenderelements(value: IRenderElement2D[]): void {
    }
    apply(context: IRenderContext2D): void {
    }
}

export class NoRenderSetRendertarget2DCMD extends SetRendertarget2DCMD {
    apply(context: IRenderContext2D): void {
    }
}


