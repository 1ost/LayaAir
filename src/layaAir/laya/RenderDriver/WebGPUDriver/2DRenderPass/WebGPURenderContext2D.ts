import { Config } from "../../../../Config";
import { RenderClearFlag } from "../../../RenderEngine/RenderEnum/RenderClearFlag";
import { RenderTargetFormat } from "../../../RenderEngine/RenderEnum/RenderTargetFormat";
import { Shader3D } from "../../../RenderEngine/RenderShader/Shader3D";
import { LayaGL } from "../../../layagl/LayaGL";
import { Color } from "../../../maths/Color";
import { Vector2 } from "../../../maths/Vector2";
import { Vector4 } from "../../../maths/Vector4";
import { Viewport } from "../../../maths/Viewport";
import { SingletonList } from "../../../utils/SingletonList";
import { Stat } from "../../../utils/Stat";
import { ShaderDefines2D } from "../../../webgl/shader/d2/ShaderDefines2D";
import { IRenderContext2D } from "../../DriverDesign/2DRenderPass/IRenderContext2D";
import { IRenderElement2D } from "../../DriverDesign/2DRenderPass/IRenderElement2D";
import { IRenderCMD } from "../../DriverDesign/RenderDevice/IRenderCMD";
import { InternalRenderTarget } from "../../DriverDesign/RenderDevice/InternalRenderTarget";
import { InternalTexture } from "../../DriverDesign/RenderDevice/InternalTexture";
import { ShaderData } from "../../DriverDesign/RenderDevice/ShaderData";
import { WebDefineDatas } from "../../RenderModuleData/WebModuleData/WebDefineDatas";
import { WebGPUBindGroup } from "../RenderDevice/WebGPUBindGroupCache";
import { WebGPUBindGroupHelper } from "../RenderDevice/WebGPUBindGroupHelper";
import { WebGPUCommandUniformMap } from "../RenderDevice/WebGPUCommandUniformMap";
import { WebGPUInternalRT } from "../RenderDevice/WebGPUInternalRT";
import { WebGPUInternalTex } from "../RenderDevice/WebGPUInternalTex";
import { WebGPURenderCommandEncoder } from "../RenderDevice/WebGPURenderCommandEncoder";
import { WebGPUGlobalPipeLineCacheInfo } from "../RenderDevice/WebGPURenderDeviceFactory";
import { WebGPURenderEngine } from "../RenderDevice/WebGPURenderEngine";
import { WebGPURenderPassHelper } from "../RenderDevice/WebGPURenderPassHelper";
import { WebGPUShaderData } from "../RenderDevice/WebGPUShaderData";
import { WebGPUStatis } from "../RenderDevice/WebGPUStatis/WebGPUStatis";
import { WebGPUUniformBufferBase } from "../RenderDevice/WebGPUUniform/WebGPUUniformBufferBase";
import { WebGPURenderElement2D } from "./WebGPURenderElement2D";

/**
 * WebGPU渲染上下文（2D）
 */
export class WebGPURenderContext2D implements IRenderContext2D {
    static _instance: WebGPURenderContext2D;
    static _globalConfigShaderData: WebDefineDatas;

    private _globalComkeyCounter: number = 0;

    private _globalComkeyNameMap: any = {};

    private _globalRendercacheInfoMap: Map<number, WebGPUGlobalPipeLineCacheInfo> = new Map();

    private _passData: WebGPUShaderData;

    private _offscreenWidth: number;

    private _offscreenHeight: number;

    private _offscreenX: number = 0;

    private _offscreenY: number = 0;

    private _needClearColor: boolean;

    private _needStart: boolean = true;

    private _viewport: Viewport;

    private _clearColor: Color;

    private renderCommand: WebGPURenderCommandEncoder = new WebGPURenderCommandEncoder(); //渲染命令编码器

    private _passUniformBuffer: WebGPUUniformBufferBase;

    _cacheGlobalDefines: WebDefineDatas = new WebDefineDatas();

    _destRT: WebGPUInternalRT;

    invertY: boolean = false;

    pipelineMode: string = 'Forward';

    device: GPUDevice; //GPU设备

    //cacheData
    _passBindGroup: WebGPUBindGroup;
    _curRenderCacheInfo: WebGPUGlobalPipeLineCacheInfo;
    _curRenderGlobalKey: number;
    _curDefineChangeFlag: Vector2;
    _pipelineChange: Vector2;

    get passData(): ShaderData {
        return this._passData;
    }

    set passData(value: ShaderData) {
        if (value == this._passData)
            return;
        this._passData = value as WebGPUShaderData;

    }

    constructor() {
        WebGPURenderContext2D._instance = this;
        WebGPURenderContext2D._globalConfigShaderData = Shader3D._configDefineValues as WebDefineDatas;
        this.device = WebGPURenderEngine._instance.getDevice();
        this._clearColor = new Color();
        this._viewport = new Viewport();
    }

    getOffscreenView(out: Vector4): void {
        out.setValue(this._offscreenX, this._offscreenY, this._offscreenWidth, this._offscreenHeight);
    }

    //全局组合生成的id
    private globalComkeyToID(name: string): number {
        if (this._globalComkeyNameMap[name] !== undefined) {
            return this._globalComkeyNameMap[name];
        } else {
            const id = this._globalComkeyCounter++;
            this._globalComkeyNameMap[name] = id;
            return id;
        }
    }

    private _getPassCacheKey() {
        let key: string = `${this._passData ? this._passData._id : -1},+${this._destRT == WebGPURenderEngine._instance._screenRT ? 0 : 1}`;
        this._curRenderGlobalKey = this.globalComkeyToID(key);
        let pipelineLayout = this._getRenderPipeLine();
        if (!this._globalRendercacheInfoMap.has(this._curRenderGlobalKey)) {
            let cacheInfo = new WebGPUGlobalPipeLineCacheInfo();
            this._curRenderCacheInfo = cacheInfo;
            this._cacheGlobalDefines.cloneTo(cacheInfo.globalDefineData);
            this._curRenderCacheInfo.globalDefineChangeFlag.setValue(Stat.loopCount, WebGPURenderEngine._instance._framePassCount)
            cacheInfo.globalPipelineCacheKey = pipelineLayout;
            cacheInfo.pipeLineChangeFlag.setValue(Stat.loopCount, WebGPURenderEngine._instance._framePassCount);
            this._pipelineChange = cacheInfo.pipeLineChangeFlag;
            this._globalRendercacheInfoMap.set(this._curRenderGlobalKey, cacheInfo);
        } else {
            this._curRenderCacheInfo = this._globalRendercacheInfoMap.get(this._curRenderGlobalKey);
            if (this._curRenderCacheInfo.globalPipelineCacheKey == pipelineLayout) {
                this._pipelineChange = this._curRenderCacheInfo.pipeLineChangeFlag;
            } else {
                this._pipelineChange = this._curRenderCacheInfo.pipeLineChangeFlag;
                this._curRenderCacheInfo.globalPipelineCacheKey = pipelineLayout;
                this._curRenderCacheInfo.pipeLineChangeFlag.setValue(Stat.loopCount, WebGPURenderEngine._instance._framePassCount);
            }
            if (!this._curRenderCacheInfo.globalDefineData.isEual(this._cacheGlobalDefines)) {
                this._cacheGlobalDefines.cloneTo(this._curRenderCacheInfo.globalDefineData);
                this._curRenderCacheInfo.globalDefineChangeFlag.setValue(Stat.loopCount, WebGPURenderEngine._instance._framePassCount)
            }
        }
        this._curDefineChangeFlag = this._curRenderCacheInfo.globalDefineChangeFlag
    }

    private _getRenderPipeLine(): string {
        if (this.passData) {
            const engine = WebGPURenderEngine._instance;
            let globalCommand = ["Sprite2DPass"];
            let globalResource = WebGPUBindGroupHelper.createBindPropertyInfoArrayByCommandMap(0, globalCommand);
            let globalLayoutInfo = engine.bindGroupCache.getLayoutInfo(globalCommand, this._passData, null, globalResource, ~0);
            return `${this._destRT.stateCacheID},(${globalLayoutInfo.id})`;
        } else {
            return `${this._destRT.stateCacheID},(null)`
        }
    }



    private _prepareContext() {
        //shaderDefine
        let comDef = this._cacheGlobalDefines;
        if (this._passData) {
            this._passData._defineDatas.cloneTo(comDef);
            let commandArray = ["Sprite2DPass"];
            let resource = WebGPUBindGroupHelper.createBindPropertyInfoArrayByCommandMap(0, commandArray);
            let unifcom = LayaGL.renderDeviceFactory.createGlobalUniformMap("Sprite2DPass") as WebGPUCommandUniformMap;
            this._passUniformBuffer = this._passData.createUniformBuffer("Sprite2DPass", unifcom);
            this._passUniformBuffer.upload();
            this._passBindGroup = (LayaGL.renderEngine as WebGPURenderEngine).bindGroupCache.getBindGroup(commandArray, this._passData, null, resource, ~0);
        } else {
            WebGPURenderContext2D._globalConfigShaderData.cloneTo(comDef);
            this._passBindGroup = WebGPURenderEngine._instance.bindGroupCache.getBindGroup([], null, null, [], 0);
            this._passUniformBuffer = null;
        }
        let returnGamma: boolean = !(this._destRT) || ((this._destRT)._textures[0].gammaCorrection != 1);
        if (this._destRT == WebGPURenderEngine._instance._screenRT) {
            returnGamma = true;
        }
        if (returnGamma) {
            comDef.add(ShaderDefines2D.GAMMASPACE);
        } else {
            comDef.remove(ShaderDefines2D.GAMMASPACE);
        }


        if (this.invertY) {//这里为啥是反的？
            comDef.remove(ShaderDefines2D.INVERTY);
        } else {
            comDef.add(ShaderDefines2D.INVERTY);
        }
        this._getPassCacheKey();

    }

    /**
 * 提交渲染命令
 */
    private _submit() {
        const engine = WebGPURenderEngine._instance;
        this.renderCommand.end();
        engine.upload(); //上传Uniform数据
        this.device.queue.submit([this.renderCommand.finish()]);
        this._needStart = true;
        WebGPUStatis.addSubmit(); //统计提交次数
    }

    /**
     * 设置屏幕渲染目标
     */
    private _setScreenRT() {
        if (!this._destRT) { //如果渲染目标为空，设置成屏幕渲染目标，绘制到画布上
            this.setRenderTarget(null, this._needClearColor, this._clearColor);
        }
    }

    /**
     * 准备录制渲染命令
     */
    private _start() {
        this._setScreenRT();
        this._destRT = this._destRT || WebGPURenderEngine._instance._screenRT;
        const renderPassDesc: GPURenderPassDescriptor
            = WebGPURenderPassHelper.getDescriptor(this._destRT, this._needClearColor ? RenderClearFlag.Color : RenderClearFlag.Nothing, this._clearColor);
        this.renderCommand.startRender(renderPassDesc);
        this.renderCommand.setViewport(this._viewport.x, this._viewport.y, this._viewport.width, this._viewport.height, 0, 1);
        this._needClearColor = false;
    }

    /**@internal */
    _needGlobalData() {
        return !!this.passData;
    }

    getRenderTarget(): InternalRenderTarget {
        return this._destRT;
    }

    drawRenderElementList(list: SingletonList<IRenderElement2D>): number {
        const len = list.length;
        if (len === 0) return 0; //没有需要渲染的对象

        // A compositor hook must observe every pixel submitted before its
        // element. Break the batch and submit the list in display order.
        for (let i = 0; i < len; i++) {
            const element = list.elements[i];
            if (element.beforeRender || element.afterRender) {
                for (let cursor = 0; cursor < len; cursor++) {
                    this.drawRenderElementOne(list.elements[cursor]);
                }
                return len;
            }
        }

        if (this._needStart) {
            this._start();
            this._needStart = false;
        }
        this._prepareContext();

        const elements = list.elements;
        for (let i = 0, n = list.length; i < n; i++) {
            (elements[i] as WebGPURenderElement2D)._prepare(this);
        }
        WebGPURenderEngine._instance.gpuBufferMgr.upload();
        for (let i = 0, n = list.length; i < n; i++) {
            (elements[i] as WebGPURenderElement2D)._render(this, this.renderCommand);
        }
        this._submit();
        WebGPURenderEngine._instance._framePassCount++;
        return 0;
    }

    setOffscreenView(width: number, height: number, x: number = 0, y: number = 0): void {
        this._offscreenWidth = width;
        this._offscreenHeight = height;
        this._offscreenX = x;
        this._offscreenY = y;
    }

    setRenderTarget(value: InternalRenderTarget, clear: boolean, clearColor: Color): void {
        const engine = WebGPURenderEngine._instance;
        const gpuTarget = value as WebGPUInternalRT;

        if (!this._needClearColor) {
            this._needClearColor = clear;
        }
        if (clear) {
            clearColor && clearColor.cloneTo(this._clearColor);
        }

        if (engine.hasScreenCleared) {
            this._needClearColor = false;
        }

        if (!gpuTarget || this._destRT !== gpuTarget) {
            this._destRT = gpuTarget;
            this._needStart = true;
        }

        let rt = gpuTarget;

        if (!rt) {
            // 如果没有设置渲染目标，则使用屏幕渲染目标
            rt = engine._screenRT;
        }
        let tex = rt._textures[0];
        this._viewport.set(0, 0, tex.width, tex.height);
    }

    getCurrentTargetColorFormat(): RenderTargetFormat {
        return this._destRT?.colorFormat ?? (Config.isAlpha ? RenderTargetFormat.R8G8B8A8 : RenderTargetFormat.R8G8B8);
    }

    copyCurrentTargetToTexture(destination: InternalTexture, width: number, height: number, sourceX: number = 0, sourceY: number = 0, destinationX: number = 0, destinationY: number = 0): void {
        // WebGPU copies cannot be encoded while a render pass is open. Submit
        // it, copy the resolved color attachment, then restart with loadOp=load.
        if (!this._needStart) {
            this._submit();
        }

        const activeTarget = this._destRT || WebGPURenderEngine._instance._screenRT;
        const source = activeTarget._texturesResolve?.[0] || activeTarget._textures[0];
        const target = destination as WebGPUInternalTex;
        const encoder = this.device.createCommandEncoder({ label: "LayaAir 2D compositor backdrop copy" });
        encoder.copyTextureToTexture(
            { texture: source.resource, origin: { x: sourceX, y: sourceY, z: 0 } },
            { texture: target.resource, origin: { x: destinationX, y: destinationY, z: 0 } },
            { width, height, depthOrArrayLayers: 1 }
        );
        this.device.queue.submit([encoder.finish()]);
        this._needStart = true;
    }

    drawRenderElementOne(node: IRenderElement2D): void {
        const element = node as WebGPURenderElement2D;
        element.beforeRender?.(this);
        if (this._needStart) {
            this._start();
            this._needStart = false;
        }
        this._prepareContext();
        element._prepare(this);
        WebGPURenderEngine._instance.gpuBufferMgr.upload();
        element._render(this, this.renderCommand);
        this._submit();
        element.afterRender?.(this);
        WebGPURenderEngine._instance._framePassCount++;
    }

    runOneCMD(cmd: IRenderCMD): void {
        cmd.apply(this);
    }

    runCMDList(cmds: IRenderCMD[]): void {
        cmds.forEach(cmd => cmd.apply(this));
    }


}
