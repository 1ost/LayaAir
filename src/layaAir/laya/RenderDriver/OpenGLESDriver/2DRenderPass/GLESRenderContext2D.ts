import { BufferTargetType, BufferUsage } from "../../../RenderEngine/RenderEnum/BufferTargetType";
import { DrawType } from "../../../RenderEngine/RenderEnum/DrawType";
import { MeshTopology } from "../../../RenderEngine/RenderEnum/RenderPologyMode";
import { RenderTargetFormat } from "../../../RenderEngine/RenderEnum/RenderTargetFormat";
import { Config } from "../../../../Config";
import { Shader3D, ShaderFeatureType } from "../../../RenderEngine/RenderShader/Shader3D";
import { SubShader } from "../../../RenderEngine/RenderShader/SubShader";
import { VertexDeclaration } from "../../../RenderEngine/VertexDeclaration";
import { LayaGL } from "../../../layagl/LayaGL";
import { Color } from "../../../maths/Color";
import { Vector4 } from "../../../maths/Vector4";
import { Vector3 } from "../../../maths/Vector3";
import { VertexElement } from "../../../renders/VertexElement";
import { VertexElementFormat } from "../../../renders/VertexElementFormat";
import { FastSinglelist } from "../../../utils/SingletonList";
import { IRenderContext2D } from "../../DriverDesign/2DRenderPass/IRenderContext2D";
import { IRenderCMD } from "../../DriverDesign/RenderDevice/IRenderCMD";
import { InternalTexture } from "../../DriverDesign/RenderDevice/InternalTexture";
import { ShaderData, ShaderDataType } from "../../DriverDesign/RenderDevice/ShaderData";
import { RenderState } from "../../RenderModuleData/Design/RenderState";
import { GLESInternalRT } from "../RenderDevice/GLESInternalRT";
import { GLESRenderGeometryElement } from "../RenderDevice/GLESRenderGeometryElement";
import { GLESShaderData } from "../RenderDevice/GLESShaderData";
import { GLESVertexBuffer } from "../RenderDevice/GLESVertexBuffer";
import { GLESRenderElement2D } from "./GLESRenderElement2D";

export class GLESRenderContext2D implements IRenderContext2D {

    static isCreateBlitScreenELement = false;

    static blitScreenElement: GLESRenderElement2D;

    private _tempList: any = [];

    /**
     * @internal
     */
    _nativeObj: any;

    private _dist: GLESInternalRT;

    private _offscreenX: number = 0;
    private _offscreenY: number = 0;
    private _offscreenWidth: number = 0;
    private _offscreenHeight: number = 0;

    public get invertY(): boolean {
        return this._nativeObj.invertY;
    }

    public set invertY(value: boolean) {
        this._nativeObj.invertY = value;
    }

    public get pipelineMode(): string {
        return this._nativeObj.pipelineMode;
    }

    public set pipelineMode(value: string) {
        this._nativeObj.pipelineMode = value;
    }

    constructor() {
        this._nativeObj = new (window as any).conchGLESRenderContext2D();
        this._nativeObj.setGlobalConfigShaderData((Shader3D._configDefineValues as any)._nativeObj);
        this._nativeObj.pipelineMode = "Forward";
    }

    private _passData: GLESShaderData = null;
    private _passDataShell: GLESShaderData = new GLESShaderData(null, false);
    public get passData(): GLESShaderData {
        this._passDataShell._nativeObj = this._nativeObj.passData;
        return this._passDataShell;
    }
    public set passData(value: GLESShaderData) {
        this._passData = value;
        this._nativeObj.passData = value ? value._nativeObj : null;
    }


    drawRenderElementList(list: FastSinglelist<GLESRenderElement2D>): number {
        for (let index = 0; index < list.length; index++) {
            const element = list.elements[index];
            if (element.beforeRender || element.afterRender) {
                for (let cursor = 0; cursor < list.length; cursor++) this.drawRenderElementOne(list.elements[cursor]);
                return list.length;
            }
        }
        this._tempList.length = 0;
        let listelement = list.elements;
        listelement.forEach((element) => {
            this._tempList.push(element._nativeObj);
        });
        return this._nativeObj.drawRenderElementList(this._tempList, list.length);
    }

    setRenderTarget(value: GLESInternalRT, clear: boolean, clearColor: Color): void {
        this._dist = value;
        this._nativeObj.setRenderTarget(value ? value._nativeObj : null, clear, clearColor);
    }

    getRenderTarget(): GLESInternalRT {
        return this._dist;
    }

    getCurrentTargetColorFormat(): RenderTargetFormat {
        return this._dist?.colorFormat ?? (Config.isAlpha ? RenderTargetFormat.R8G8B8A8 : RenderTargetFormat.R8G8B8);
    }

    copyCurrentTargetToTexture(destination: InternalTexture, width: number, height: number, sourceX: number = 0, sourceY: number = 0, destinationX: number = 0, destinationY: number = 0): void {
        LayaGL.renderEngine.copySubFrameBuffertoTex(destination, 0, destinationX, destinationY, sourceX, sourceY, width, height);
    }

    setOffscreenView(width: number, height: number, x: number = 0, y: number = 0): void {
        this._offscreenWidth = width;
        this._offscreenHeight = height;
        this._offscreenX = x;
        this._offscreenY = y;
        this._nativeObj.setOffscreenView(width, height, x, y);
    }

    getOffscreenView(out: Vector4): void {
        out.setValue(this._offscreenX, this._offscreenY, this._offscreenWidth, this._offscreenHeight);
    }

    drawRenderElementOne(node: GLESRenderElement2D): void {
        node.beforeRender?.(this);
        this._nativeObj.drawRenderElementOne(node._nativeObj);
        node.afterRender?.(this);
    }

    runOneCMD(cmd: IRenderCMD): void {
        this._nativeObj.runOneCMD((cmd as any)._nativeObj);
    }

    runCMDList(cmds: IRenderCMD[]): void {
        let nativeobCMDs: any[] = [];
        cmds.forEach(element => {
            nativeobCMDs.push((element as any)._nativeObj);
        });

        this._nativeObj.runCMDList(nativeobCMDs);
    }





}
