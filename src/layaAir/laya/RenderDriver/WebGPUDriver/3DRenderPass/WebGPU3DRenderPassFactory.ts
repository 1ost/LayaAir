import { Laya } from "../../../../Laya";
import { Laya3DRender } from "../../../d3/RenderObjs/Laya3DRender";
import { LayaGL } from "../../../layagl/LayaGL";
import { DefaultStaticsContext } from "../../../layagl/StatisticsContext";
import { IRender3DProcess, IRenderContext3D, IRenderElement3D, ISkinRenderElement3D } from "../../DriverDesign/3DRenderPass/I3DRenderPass";
import { I3DRenderPassFactory } from "../../DriverDesign/3DRenderPass/I3DRenderPassFactory";
import { BlitQuadCMDData, DrawElementCMDData, DrawNodeCMDData, SetRenderTargetCMD, SetViewportCMD } from "../../DriverDesign/3DRenderPass/IRender3DCMD";
import { ISceneRenderManager } from "../../DriverDesign/3DRenderPass/ISceneRenderManager";
import { ComputeCommandAppatchCMD, SetRenderDataCMD, SetShaderDefineCMD } from "../../DriverDesign/RenderDevice/IRenderCMD";
import { WebBaseRenderNode } from "../../RenderModuleData/WebModuleData/3D/WebBaseRenderNode";
import { WebForwardAddClusterRP } from "../../RenderModuleData/WebModuleData/3D/WebForwardAddRP/WebForwardAddClusterRP";
import { WebForwardAddRP } from "../../RenderModuleData/WebModuleData/3D/WebForwardAddRP/WebForwardAddRP";
import { WebRender3DProcess } from "../../RenderModuleData/WebModuleData/3D/WebForwardAddRP/WebRender3DProcess";
import { WebSceneRenderManager } from "../../RenderModuleData/WebModuleData/3D/WebScene3DRenderManager";
import { WebBaseSpotRP } from "../../RenderModuleData/WebModuleData/3D/WebShadowRP/WebBaseSpotRP";
import { WebDirCascadeShadowRP } from "../../RenderModuleData/WebModuleData/3D/WebShadowRP/WebDirCascadeShadowRP";
import { WebGPUSetRenderData } from "../RenderDevice/WebGPUSetRenderData";
import { WebGPUComputeCommandAppatchCMD, WebGPUSetShaderDefine } from "../RenderDevice/WebGPUSetShaderDefine";
import { WebGPUBaseRenderNode } from "./WebGPUBaseRenderNode";
import { WebGPUBlitQuadCMDData } from "./WebGPURenderCMD/WebGPUBlitQuadCMDData";
import { WebGPUDrawElementCMDData } from "./WebGPURenderCMD/WebGPUDrawElementCMDData";
import { WebGPUDrawNodeCMDData } from "./WebGPURenderCMD/WebGPUDrawNodeCMDData";
import { WebGPUSetRenderTargetCMD } from "./WebGPURenderCMD/WebGPUSetRenderTargetCMD";
import { WebGPUSetViewportCMD } from "./WebGPURenderCMD/WebGPUSetViewportCMD";
import { WebGPURenderContext3D } from "./WebGPURenderContext3D";
import { WebGPURenderElement3D } from "./WebGPURenderElement3D";
import { WebGPUSkinRenderElement3D } from "./WebGPUSkinRenderElement3D";
WebBaseRenderNode.BaseRenderNodeClass = WebGPUBaseRenderNode;
/**
 * WebGPU渲染工厂类
 */
export class WebGPU3DRenderPassFactory implements I3DRenderPassFactory {
    createRender3DProcess(): IRender3DProcess {
        const renderProcess = new WebRender3DProcess();
        const forwardPass = new WebForwardAddRP();
        renderProcess._renderPass = forwardPass;
        forwardPass.mainRenderpass = new WebForwardAddClusterRP();
        forwardPass.dirShadowRenderPass = new WebDirCascadeShadowRP();
        forwardPass.spotShadowRenderPass = new WebBaseSpotRP();
        return renderProcess;
    }
    createRenderContext3D(): IRenderContext3D {
        return new WebGPURenderContext3D();
    }
    createRenderElement3D(): IRenderElement3D {
        return new WebGPURenderElement3D();
    }

    createSkinRenderElement(): ISkinRenderElement3D {
        return new WebGPUSkinRenderElement3D();
    }
    createSceneRenderManager(): ISceneRenderManager {
        return new WebSceneRenderManager();
    }
    createDrawNodeCMDData(): DrawNodeCMDData {
        return new WebGPUDrawNodeCMDData();
    }
    createBlitQuadCMDData(): BlitQuadCMDData {
        return new WebGPUBlitQuadCMDData();
    }
    createDrawElementCMDData(): DrawElementCMDData {
        return new WebGPUDrawElementCMDData();
    }
    createSetViewportCMD(): SetViewportCMD {
        return new WebGPUSetViewportCMD();
    }
    createSetRenderTargetCMD(): SetRenderTargetCMD {
        return new WebGPUSetRenderTargetCMD();
    }
    createSetRenderDataCMD(): SetRenderDataCMD {
        return new WebGPUSetRenderData();
    }
    createSetShaderDefineCMD(): SetShaderDefineCMD {
        return new WebGPUSetShaderDefine();
    }

    createComputeCommandAppatchCMD?(): ComputeCommandAppatchCMD {
        return new WebGPUComputeCommandAppatchCMD();
    }
}

Laya.addBeforeInitCallback(() => {
    if (!Laya3DRender.Render3DPassFactory) {
        Laya3DRender.Render3DPassFactory = new WebGPU3DRenderPassFactory();
        LayaGL.statAgent = new DefaultStaticsContext();
    }
});

Laya.addAfterInitCallback(() => {
    Laya3DRender.Render3DModuleDataFactory.createBaseRenderNode = () => {
        return new WebGPUBaseRenderNode();
    }
});
