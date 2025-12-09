import { Camera } from "../../../../d3/core/Camera";
import { IndexFormat } from "../../../../RenderEngine/RenderEnum/IndexFormat";
import { VertexDeclaration } from "../../../../RenderEngine/VertexDeclaration";
import { IRenderContext3D } from "../../../DriverDesign/3DRenderPass/I3DRenderPass";
import { ISceneRenderManager } from "../../../DriverDesign/3DRenderPass/ISceneRenderManager";
import { IIndexBuffer } from "../../../DriverDesign/RenderDevice/IIndexBuffer";
import { IVertexBuffer } from "../../../DriverDesign/RenderDevice/IVertexBuffer";
import { IRender3DProcess } from "../../../DriverDesign/3DRenderPass/I3DRenderPass"
import { GLES3DRenderPassFactory } from "../../../OpenGLESDriver/3DRenderPass/GLES3DRenderPassFactory";
import { GLESBufferState } from "../../../OpenGLESDriver/RenderDevice/GLESBufferState";
import { Config } from "../../../../../Config";
import { BufferUsage } from "../../../../RenderEngine/RenderEnum/BufferTargetType";
import { DrawType } from "../../../../RenderEngine/RenderEnum/DrawType";
import { MeshTopology } from "../../../../RenderEngine/RenderEnum/RenderPologyMode";
import { HTMLCanvas } from "../../../../resource/HTMLCanvas";
import { Resource } from "../../../../resource/Resource";
import { ShaderProcessInfo, ShaderCompileDefineBase } from "../../../../webgl/utils/ShaderCompileDefineBase";
import { CommandUniformMap } from "../../../DriverDesign/RenderDevice/CommandUniformMap";
import { IComputeContext } from "../../../DriverDesign/RenderDevice/ComputeShader/IComputeContext";
import { ComputeShaderProcessInfo, IComputeShader } from "../../../DriverDesign/RenderDevice/ComputeShader/IComputeShader";
import { IBufferState } from "../../../DriverDesign/RenderDevice/IBufferState";
import { EDeviceBufferUsage, IDeviceBuffer } from "../../../DriverDesign/RenderDevice/IDeviceBuffer";
import { IRenderGeometryElement } from "../../../DriverDesign/RenderDevice/IRenderGeometryElement";
import { IShaderInstance } from "../../../DriverDesign/RenderDevice/IShaderInstance";
import { ShaderData } from "../../../DriverDesign/RenderDevice/ShaderData";
import { GLESRenderDeviceFactory } from "../../../OpenGLESDriver/RenderDevice/GLESRenderDeviceFactory";
import { VertexMesh } from "../../../../RenderEngine/RenderShader/VertexMesh";
import { NoRender3DRenderPassFactory } from "../../../NoRenderDriver/3DRenderPass/NoRender3DRenderPassFactory";
import { NoRenderBufferState, NoRenderDeviceFactory } from "../../../NoRenderDriver/DriverDevice/NoRenderDeviceFactory";

export class ECSRT3DRenderPassFactory extends NoRender3DRenderPassFactory {
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
        this._nativeObj = new (window as any).conchECSSystem();
    }
    fowardRender(context: IRenderContext3D, camera: Camera): void {
        this._nativeObj.ECSSystemPassUpdata();
    }
}

export class ECSMeshVertexBuffer implements IVertexBuffer {
    vertexDeclaration: VertexDeclaration;
    instanceBuffer: boolean;
    buffer: Float32Array;
    private _bufferLength: number;
    setData(buffer: ArrayBuffer, bufferOffset: number, dataStartIndex: number, dataCount: number): void {
        let count = dataCount > buffer.byteLength ? buffer.byteLength : dataCount;
        this.buffer = new Float32Array(buffer, 0, count / 4);
    }
    setDataLength(byteLength: number): void {
        this._bufferLength = byteLength;
    }
    destroy(): void {
        this.buffer = null;
    }
}


export class ECSIndexBuffer implements IIndexBuffer {
    indexType: IndexFormat;
    indexCount: number;
    buffer: Uint32Array;
    private _bufferLength: number;
    destroy(): void {
        this.buffer = null;
    }
    _setIndexDataLength(data: number): void {
        this._bufferLength = data;
    }
    _setIndexData(data: Uint32Array | Uint16Array | Uint8Array, bufferOffset: number): void {
        if (IndexFormat.UInt16 == this.indexType) {
            this.buffer = new Uint32Array(data.length);
            for (var i = 0; i < data.length; i++) {
                this.buffer[i] = data[i];
            }
        }
    }
    setData(buffer: ArrayBuffer, bufferOffset: number, dataStartIndex: number, dataCount: number): void {

        if (IndexFormat.UInt16 == this.indexType) {
            this.buffer = new Uint32Array(dataCount / 2);
            let oribuffer = new Uint16Array(buffer);
            for (var i = 0; i < oribuffer.length; i++) {
                this.buffer[i] = oribuffer[i];
            }
        } else {
            this.buffer = new Uint32Array(buffer, 0, dataCount);
        }
    }


}


export class ECSBufferState extends NoRenderBufferState {
    _bindedIndexBuffer: ECSIndexBuffer;
    _vertexBuffers: ECSMeshVertexBuffer[];
    _meshNativeObj: any;

    constructor() {
        super();
        this._meshNativeObj = new (window as any).conchECSBevyMeshComponent();
    }
    applyState(vertexBuffers: ECSMeshVertexBuffer[], indexBuffer: ECSIndexBuffer): void {
        this._vertexBuffers = vertexBuffers;
        this._bindedIndexBuffer = indexBuffer;
        //TODO 分拣
        let vertexCount = vertexBuffers[0].buffer.byteLength / vertexBuffers[0].vertexDeclaration.vertexStride;

        for (var i = 0; i < vertexBuffers.length; i++) {
            let vbBuffer = vertexBuffers[i];
            if (vbBuffer.instanceBuffer)
                continue;
            let declaration = vbBuffer.vertexDeclaration;
            let stride = declaration.vertexStride / 4;
            let buffer = vbBuffer.buffer;

            let VAEElement = declaration._VAElements;

            let vbData: Float32Array;
            for (var j = 0; j < VAEElement.length; j++) {
                let element = VAEElement[j];
                let offset;
                switch (element.shaderLocation) {
                    case VertexMesh.MESH_POSITION0:
                    case VertexMesh.MESH_NORMAL0:
                        if (element.format != "vector3") {
                            continue;
                        }
                        vbData = new Float32Array(vertexCount * 3);
                        offset = element.stride / 4;
                        for (var k = 0; k < vertexCount; k++) {
                            let pos = k * 3;
                            let oriPos = k * stride + offset;
                            vbData[pos] = buffer[oriPos];
                            vbData[pos + 1] = buffer[oriPos + 1];
                            vbData[pos + 2] = buffer[oriPos + 2];
                        }
                        if (element.shaderLocation == VertexMesh.MESH_POSITION0)
                            this._setPositionData((vbData.buffer as ArrayBuffer), vbData.byteLength);
                        else
                            this._setNormalData((vbData.buffer as ArrayBuffer), vbData.byteLength);
                        break;
                    case VertexMesh.MESH_TEXTURECOORDINATE0:
                        if (element.format != "vector2") {
                            continue;
                        }
                        vbData = new Float32Array(vertexCount * 2);
                        offset = element.stride / 4;
                        for (var k = 0; k < vertexCount; k++) {
                            let pos = k * 2;
                            let oriPos = k * stride + offset;
                            vbData[pos] = buffer[oriPos];
                            vbData[pos + 1] = buffer[oriPos + 1];

                        }
                        this._setUV0Data(vbData.buffer as ArrayBuffer, vbData.byteLength);
                        break;
                    case VertexMesh.MESH_TANGENT0:
                        if (element.format != "vector4") {
                            continue;
                        }
                        vbData = new Float32Array(vertexCount * 4);
                        offset = element.stride / 4;
                        for (var k = 0; k < vertexCount; k++) {
                            let pos = k * 4;
                            let oriPos = k * stride + offset;
                            vbData[pos] = buffer[oriPos];
                            vbData[pos + 1] = buffer[oriPos + 1];
                            vbData[pos + 2] = buffer[oriPos + 2];
                            vbData[pos + 3] = buffer[oriPos + 3];
                        }
                        this._setTangentData(vbData.buffer as ArrayBuffer, vbData.byteLength);
                        break;
                }
            }
        }
        this._setVertexCount(vertexCount);
        if (indexBuffer && indexBuffer.buffer) {
            let indexCount = indexBuffer.buffer.byteLength / 2;
            this._setIndexCount(indexCount);
            this._setIndices(indexBuffer.buffer.buffer as ArrayBuffer, indexBuffer.buffer.byteLength);
            this._meshNativeObj.applyBuffer();
        }

    }
    destroy(): void {
        this._meshNativeObj.destroy();
    }


    //兼容 代码  暂时创建一个Mesh的资源表
    private _setPositionData(buffer: ArrayBuffer, byteLength: number) {
        this._meshNativeObj.setPositionData(buffer, byteLength);
    }

    private _setNormalData(buffer: ArrayBuffer, byteLength: number) {
        this._meshNativeObj.setNormalData(buffer, byteLength);
    }

    private _setUV0Data(buffer: ArrayBuffer, byteLength: number) {
        this._meshNativeObj.setUV0Data(buffer, byteLength);
    }

    private _setTangentData(buffer: ArrayBuffer, byteLength: number) {
        this._meshNativeObj.setTangentData(buffer, byteLength);
    }

    private _setIndices(buffer: ArrayBuffer, byteLength: number) {
        this._meshNativeObj.setIndices(buffer, byteLength);
    }

    private _setIndexCount(value: number) {
        this._meshNativeObj.setIndexCount(value);
    }

    private _setVertexCount(value: number) {
        this._meshNativeObj.setVertexCount(value);
    }
}



export class ECSRenderDeviceFactory extends NoRenderDeviceFactory {

    createIndexBuffer(bufferUsage: BufferUsage): IIndexBuffer {
        return new ECSIndexBuffer();
    }

    createVertexBuffer(bufferUsageType: BufferUsage): IVertexBuffer {
        return new ECSMeshVertexBuffer();
    }

    createBufferState(): IBufferState {
        return new ECSBufferState();
    }
}