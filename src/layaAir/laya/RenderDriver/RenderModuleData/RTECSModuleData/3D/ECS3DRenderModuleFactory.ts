
import { Laya } from "../../../../../Laya";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { Laya3DRender } from "../../../../d3/RenderObjs/Laya3DRender";
import { RT3DRenderModuleFactory } from "../../RuntimeModuleData/3D/RT3DRenderModuleFactory";
import { ECSTransform } from "../ECSTransform";
import { ECSCameraNodeData } from "./ECSCameraNodeData";
import { ECSMeshRenderNode } from "./ECSBaseRenderNode";
import { ECSDirectLight } from "./ECSDirectLight";
import { ECSPointLight } from "./ECSPointLight";
import { ECSSpotLight } from "./ECSSpotLight";
import { ECSSceneNodeData } from "./ECSSceneNodeData";


export class ECS3DRenderModuleFactory extends RT3DRenderModuleFactory {
    createTransform(owner: Sprite3D): ECSTransform {
        return new ECSTransform(owner);
    }
    createDirectLight(): ECSDirectLight {
        return new ECSDirectLight();
    }
    // createSpotLight(): ECSSpotLight {
    //     return new ECSSpotLight();
    // }
    // createPointLight(): ECSPointLight {
    //     return new ECSPointLight();
    // }
    createCameraModuleData(): ECSCameraNodeData {
        return new ECSCameraNodeData();
    }
    createMeshRenderNode(): ECSMeshRenderNode {
        return new ECSMeshRenderNode();
    }
}

Laya.addBeforeInitCallback(() => {
    if (!Laya3DRender.Render3DModuleDataFactory)
        Laya3DRender.Render3DModuleDataFactory = new ECS3DRenderModuleFactory();
})