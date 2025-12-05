import { Camera } from "../../../../d3/core/Camera";
import { IndexFormat } from "../../../../RenderEngine/RenderEnum/IndexFormat";
import { VertexDeclaration } from "../../../../RenderEngine/VertexDeclaration";
import { IRenderContext3D } from "../../../DriverDesign/3DRenderPass/I3DRenderPass";
import { ISceneRenderManager } from "../../../DriverDesign/3DRenderPass/ISceneRenderManager";
import { IIndexBuffer } from "../../../DriverDesign/RenderDevice/IIndexBuffer";
import { IVertexBuffer } from "../../../DriverDesign/RenderDevice/IVertexBuffer";
import { ECSSceneNodeData } from "../3D/ECSSceneNodeData";
import { IRender3DProcess } from "../../../DriverDesign/3DRenderPass/I3DRenderPass"
import { GLES3DRenderPassFactory } from "../../../OpenGLESDriver/3DRenderPass/GLES3DRenderPassFactory";

export class ECSRT3DRenderPassFactory extends GLES3DRenderPassFactory {
    createRender3DProcess(): IRender3DProcess {
        return new ECS3DRenderProcess();
    }
}


export class ECS3DRenderProcess implements IRender3DProcess {
    _nativeObj: any;

    render3DManager: ISceneRenderManager;

    destroy(): void {

    };
    constructor() {
        this._nativeObj = new (window as any).conchECSManager();
    }
    fowardRender(context: IRenderContext3D, camera: Camera): void {
        this._nativeObj.ECSUpdata((context.sceneModuleData as ECSSceneNodeData)._nativeObj);
    }
}

export class ECSMeshVertexBuffer implements IVertexBuffer {
    vertexDeclaration: VertexDeclaration;
    instanceBuffer: boolean;
    setData(buffer: ArrayBuffer, bufferOffset: number, dataStartIndex: number, dataCount: number): void {
        throw new Error("Method not implemented.");
    }
    setDataLength(byteLength: number): void {
        throw new Error("Method not implemented.");
    }
    destroy(): void {
        throw new Error("Method not implemented.");
    }

}


export class ECSIndexBuffer implements IIndexBuffer {
    indexType: IndexFormat;
    indexCount: number;
    destroy(): void {
        throw new Error("Method not implemented.");
    }
    _setIndexDataLength(data: number): void {
        throw new Error("Method not implemented.");
    }
    _setIndexData(data: Uint32Array | Uint16Array | Uint8Array, bufferOffset: number): void {
        throw new Error("Method not implemented.");
    }
    setData(buffer: ArrayBuffer, bufferOffset: number, dataStartIndex: number, dataCount: number): void {
        throw new Error("Method not implemented.");
    }


}