import { Laya } from "../../../../Laya";
import { LayaGL } from "../../../layagl/LayaGL";
import { I2DRenderPassFactory } from "../../DriverDesign/2DRenderPass/I2DRenderPassFactory";
import { Blit2DQuadCMD, Draw2DElementCMD, SetRendertarget2DCMD } from "../../DriverDesign/2DRenderPass/IRender2DCMD";
import { IRenderContext2D } from "../../DriverDesign/2DRenderPass/IRenderContext2D";
import { IPrimitiveRenderElement2D, IRenderElement2D } from "../../DriverDesign/2DRenderPass/IRenderElement2D";
import { SetRenderDataCMD, SetShaderDefineCMD } from "../../DriverDesign/RenderDevice/IRenderCMD";
import { I2DBaseRenderDataHandle, I2DGlobalRenderData, I2DGraphicIndexDataView, I2DGraphicVertexDataView, I2DGraphicWholeBuffer, I2DPrimitiveDataHandle, IGraphics2DBufferBlock, IGraphics2DVertexBlock, IMesh2DRenderDataHandle, IRender2DDataHandle, ISpineRenderDataHandle } from "../../RenderModuleData/Design/2D/IRender2DDataHandle";
import { IRender2DPass, IRender2DPassManager } from "../../RenderModuleData/Design/2D/IRender2DPass";
import { IRenderStruct2D } from "../../RenderModuleData/Design/2D/IRenderStruct2D";
import { Web2DGraphicsIndexBuffer, Web2DGraphicsVertexBuffer } from "../../RenderModuleData/WebModuleData/2D/Web2DGraphic2DBuffer";
import { Web2DGraphic2DIndexDataView, Web2DGraphic2DVertexDataView } from "../../RenderModuleData/WebModuleData/2D/Web2DGraphic2DBufferDataView";
import { WebRender2DPass, WebRender2DPassManager } from "../../RenderModuleData/WebModuleData/2D/WebRender2DPass";
import { Web2DBaseRenderDataHandle, WebEmptyRender2DDataHandle, WebGraphics2DBufferBlock, WebGraphics2DVertexBlock, WebMesh2DRenderDataHandle, WebPrimitiveDataHandle, WebSpineRenderDataHandle } from "../../RenderModuleData/WebModuleData/2D/WebRenderDataHandle";
import { WebGlobalRenderData, WebRenderStruct2D } from "../../RenderModuleData/WebModuleData/2D/WebRenderStruct2D";
import { WebGPUSetRenderData } from "../RenderDevice/WebGPUSetRenderData";
import { WebGPUSetShaderDefine } from "../RenderDevice/WebGPUSetShaderDefine";
import { WebGPUBlit2DQuadCMD, WebGPUDraw2DElementCMD, WebGPUSetRendertarget2DCMD } from "./WebGPU2DRenderCMD";
import { WebGPUPrimitiveRenderElement2D } from "./WebGPUPrimitiveRenderElement2D";
import { WebGPURenderContext2D } from "./WebGPURenderContext2D";
import { WebGPURenderElement2D } from "./WebGPURenderElement2D";

export class WebGPURender2DProcess implements I2DRenderPassFactory {
    createEmptyRenderDataHandle(): IRender2DDataHandle {
        return new WebEmptyRender2DDataHandle();
    }

    createGraphic2DBufferBlock(): IGraphics2DBufferBlock {
        return new WebGraphics2DBufferBlock();
    }

    createGraphic2DVertexBlock(): IGraphics2DVertexBlock {
        return new WebGraphics2DVertexBlock();
    }

    create2DGraphicVertexDataView(wholeBuffer: I2DGraphicWholeBuffer, elementOffset: number, elementSize: number, stride: number): I2DGraphicVertexDataView {
        return new Web2DGraphic2DVertexDataView(wholeBuffer as Web2DGraphicsVertexBuffer, elementOffset, elementSize, stride);
    }

    create2DGraphicIndexDataView(wholeBuffer: I2DGraphicWholeBuffer, elementSize: number): I2DGraphicIndexDataView {
        return new Web2DGraphic2DIndexDataView(wholeBuffer as Web2DGraphicsIndexBuffer, elementSize);
    }

    create2DGraphicVertexBuffer(): I2DGraphicWholeBuffer {
        return new Web2DGraphicsVertexBuffer();
    }

    create2DGraphicIndexBuffer(): I2DGraphicWholeBuffer {
        return new Web2DGraphicsIndexBuffer();
    }

    createPrimitiveRenderElement2D(): IPrimitiveRenderElement2D {
        return new WebGPUPrimitiveRenderElement2D();
    }

    createRender2DPassManager(): IRender2DPassManager {
        return new WebRender2DPassManager();
    }

    create2DGlobalRenderDataHandle(): I2DGlobalRenderData {
        return new WebGlobalRenderData();
    }

    createSpineRenderDataHandle(): ISpineRenderDataHandle {
        return new WebSpineRenderDataHandle();
    }

    createRender2DPass(): IRender2DPass {
        return new WebRender2DPass();
    }

    createRenderStruct2D(): IRenderStruct2D {
        return new WebRenderStruct2D();
    }

    create2D2DPrimitiveDataHandle(): I2DPrimitiveDataHandle {
        return new WebPrimitiveDataHandle();
    }

    create2DBaseRenderDataHandle(): I2DBaseRenderDataHandle {
        return new Web2DBaseRenderDataHandle();
    }

    createMesh2DRenderDataHandle(): IMesh2DRenderDataHandle {
        return new WebMesh2DRenderDataHandle();
    }

    createSetRenderDataCMD(): SetRenderDataCMD {
        return new WebGPUSetRenderData();
    }

    createSetShaderDefineCMD(): SetShaderDefineCMD {
        return new WebGPUSetShaderDefine();
    }

    createBlit2DQuadCMDData(): Blit2DQuadCMD {
        return new WebGPUBlit2DQuadCMD();
    }

    createDraw2DElementCMDData(): Draw2DElementCMD {
        return new WebGPUDraw2DElementCMD();
    }

    createSetRendertarget2DCMD(): SetRendertarget2DCMD {
        return new WebGPUSetRendertarget2DCMD();
    }

    createRenderElement2D(): IRenderElement2D {
        return new WebGPURenderElement2D();
    }

    createRenderContext2D(): IRenderContext2D {
        return new WebGPURenderContext2D();
    }
}

Laya.addBeforeInitCallback(() => {
    if (!LayaGL.render2DRenderPassFactory)
        LayaGL.render2DRenderPassFactory = new WebGPURender2DProcess();
});
