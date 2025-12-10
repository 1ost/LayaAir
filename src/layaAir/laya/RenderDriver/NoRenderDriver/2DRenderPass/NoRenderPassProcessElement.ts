import { PostProcess2D } from "../../../display/PostProcess2D";
import { Sprite } from "../../../display/Sprite";
import { Color } from "../../../maths/Color";
import { Matrix } from "../../../maths/Matrix";
import { Rectangle } from "../../../maths/Rectangle";
import { Vector2 } from "../../../maths/Vector2";
import { Vector4 } from "../../../maths/Vector4";
import { BaseTexture } from "../../../resource/BaseTexture";
import { RenderTexture2D } from "../../../resource/RenderTexture2D";
import { BlendMode } from "../../../webgl/canvas/BlendMode";
import { IRenderContext2D } from "../../DriverDesign/2DRenderPass/IRenderContext2D";
import { IRenderElement2D } from "../../DriverDesign/2DRenderPass/IRenderElement2D";
import { IIndexBuffer } from "../../DriverDesign/RenderDevice/IIndexBuffer";
import { IRenderGeometryElement } from "../../DriverDesign/RenderDevice/IRenderGeometryElement";
import { IVertexBuffer } from "../../DriverDesign/RenderDevice/IVertexBuffer";
import { ShaderData } from "../../DriverDesign/RenderDevice/ShaderData";
import { I2DBaseRenderDataHandle, I2DGlobalRenderData, I2DGraphicBufferDataView, I2DGraphicIndexDataView, I2DGraphicVertexDataView, I2DGraphicWholeBuffer, I2DPrimitiveDataHandle, IGraphics2DBufferBlock, IGraphics2DVertexBlock, IMesh2DRenderDataHandle, IRender2DDataHandle, ISpineRenderDataHandle } from "../../RenderModuleData/Design/2D/IRender2DDataHandle";
import { IRender2DPass, IRender2DPassManager } from "../../RenderModuleData/Design/2D/IRender2DPass";
import { IRenderStruct2D } from "../../RenderModuleData/Design/2D/IRenderStruct2D";

export class NoRender2Draphics2DBufferBlock implements IGraphics2DBufferBlock{
    vertexs: IGraphics2DVertexBlock[] = [];
    indexView: I2DGraphicIndexDataView;
    vertexBuffer: IVertexBuffer;

}

export class NoRender2DGraphics2DVertexBlock implements IGraphics2DVertexBlock{
    positions: number[] = [];
    vertexViews: I2DGraphicVertexDataView[] = [];
    
}

export class NoRender2DGraphicVertexDataView implements I2DGraphicVertexDataView
{
    length: number;
    start: number;
    stride: number;
    setData(data: ArrayLike<number>): void {
       
    }

}


export class NoRender2DGraphicIndexDataView implements I2DGraphicIndexDataView{
    length: number;
    setGeometry(value: IRenderGeometryElement): void {
      
    }
    destroy(): void {
      
    }
    setData(data: ArrayLike<number>): void {
      
    }

}
export class NoRender2DGraphicWholeBuffer implements I2DGraphicWholeBuffer{
    buffer: IVertexBuffer | IIndexBuffer;
    resetData(byteLength: number): void {
       
    }
    addDataView?(dataView: I2DGraphicBufferDataView): void {
       
    }
    removeDataView(dataView: I2DGraphicBufferDataView): void {
       
    }
    destroy(): void {
       
    }

}
export class NoRender2DRender2DPassManager implements IRender2DPassManager
{
    addPass(pass: IRender2DPass): void {
       
    }
    removePass(pass: IRender2DPass): void {
       
    }
    apply(context: IRenderContext2D): void {
       
    }
    clear(): void {
       
    }

}
export class NoRender2DGlobalRenderData implements I2DGlobalRenderData
{
    cullRect: Vector4;
    renderLayerMask: number;
    globalShaderData: ShaderData;

}
export class NoRender2DSpineRenderDataHandle implements ISpineRenderDataHandle
{
    baseColor: Color;
    skeleton: spine.Skeleton;
    offset: Vector2;
    lightReceive: boolean;
    needUseMatrix: boolean;
    inheriteRenderData(context: IRenderContext2D): void {
       
    }
    destroy(): void {
       
    }

}
export class NoRender2DRender2DPass implements IRender2DPass
{
    enable: boolean;
    enableBatch: boolean;
    isSupport: boolean;
    root: IRenderStruct2D;
    doClearColor: boolean;
    postProcess: PostProcess2D;
    mask: IRenderStruct2D;
    repaint: boolean;
    renderTexture: RenderTexture2D;
    priority: number;
    shaderData: ShaderData;
    offsetMatrix: Matrix;
    needRender(): boolean {
       return false
    }
    setClearColor(r: number, g: number, b: number, a: number): void {
       
    }
    fowardRender(context: IRenderContext2D): void {
       
    }
    destroy(): void {
       
    }

}
export class NoRender2DRenderStruct2D implements IRenderStruct2D
{
    subStruct: IRenderStruct2D;
    owner: Sprite;
    zIndex: number;
    stackingRoot: boolean;
    enableCulling: boolean;
    inheritedEnableCulling: boolean;
    rect: Rectangle = new Rectangle();
    renderLayer: number;
    parent: IRenderStruct2D;
    children: IRenderStruct2D[] =[];
    renderType: number;
    renderUpdateMask: number;
    renderMatrix: Matrix;
    globalAlpha: number;
    alpha: number;
    blendMode: BlendMode;
    enabled: boolean;
    dcOptimize: boolean;
    inheritedDcOptimize: boolean;
    isRenderStruct: boolean;
    renderElements: IRenderElement2D[];
    spriteShaderData: ShaderData;
    renderDataHandler: IRender2DDataHandle;
    globalRenderData: I2DGlobalRenderData;
    pass: IRender2DPass;
    setRepaint(): void {
        
    }
    addChild(child: IRenderStruct2D, index: number): void {
        
    }
    updateChildIndex(child: IRenderStruct2D, oldIndex: number, index: number): void {
        
    }
    removeChild(child: IRenderStruct2D): void {
        
    }
    setClipRect(rect: Rectangle): void {
        
    }
    setRenderUpdateCallback(func: Function): void {
        
    }
    destroy(): void {
        
    }

}
export class NoRender2DRender2DDataHandle implements IRender2DDataHandle
{
    needUseMatrix: boolean;
    inheriteRenderData(context: IRenderContext2D): void {
        
    }
    destroy(): void {
        
    }

}
export class NoRender2D2DPrimitiveDataHandle implements I2DPrimitiveDataHandle
{
    mask: IRenderStruct2D;
    logicMatrix: Matrix;
    applyVertexBufferBlock(views: IGraphics2DBufferBlock[]): void {
        
    }
    needUseMatrix: boolean;
    inheriteRenderData(context: IRenderContext2D): void {
        
    }
    destroy(): void {
        
    }

}
export class NoRender2DBaseRenderDataHandle implements I2DBaseRenderDataHandle
{
    lightReceive: boolean;
    needUseMatrix: boolean;
    inheriteRenderData(context: IRenderContext2D): void {
        
    }
    destroy(): void {
        
    }

}
export class NoRender2DMesh2DRenderDataHandle implements IMesh2DRenderDataHandle{
    baseColor: Color;
    baseTexture: BaseTexture;
    normal2DTexture: BaseTexture;
    normal2DStrength: number;
    tilingOffset: Vector4;
    lightReceive: boolean;
    needUseMatrix: boolean;
    inheriteRenderData(context: IRenderContext2D): void {
        
    }
    destroy(): void {
        
    }

}