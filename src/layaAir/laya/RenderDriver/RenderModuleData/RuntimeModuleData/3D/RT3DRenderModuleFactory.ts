import { Laya } from "../../../../../Laya";
import { Laya3DRender } from "../../../../d3/RenderObjs/Laya3DRender";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { Vector3 } from "../../../../maths/Vector3";
import { ICameraNodeData, IDirectLightData, IPointLightData, ISceneNodeData, ISimpleSkinRenderNode, ISkinRenderNode, ISpotLightData } from "../../Design/3D/I3DRenderModuleData";
import { I3DRenderModuleFactory } from "../../Design/3D/I3DRenderModuleFactory";
import { NativeBounds } from "./NativeBounds";
import { RTTransform3D } from "./RTTransform3D";
import { RTCameraNodeData, RTSceneNodeData } from "./RT3DRenderModuleData";
import { RTBaseRenderNode } from "./RTBaseRenderNode";
import { RTDirectLight } from "./RTDirectLight";
import { RTLightmapData } from "./RTLightmap";
import { RTMeshRenderNode } from "./RTMeshRenderNode";
import { RTPointLight } from "./RTPointLight";
import { RTReflectionProb } from "./RTReflectionProb";
import { RTSimpleSkinRenderNode } from "./RTSimpleSkinRenderNode";
import { RTSkinRenderNode } from "./RTSkinRenderNode";
import { RTVolumetricGI } from "./RTVolumetricGI";
import { Transform3D } from "../../../../d3/core/Transform3D";
import { ECSSpotLight } from "../../RTECSModuleData/3D/ECSSpotLight";

export class RT3DRenderModuleFactory implements I3DRenderModuleFactory {


    createTransform(owner: Sprite3D): Transform3D {
        return new RTTransform3D(owner);
    }
    createBounds(min: Vector3, max: Vector3): NativeBounds {
        return new NativeBounds(min, max);
    }
    createVolumetricGI(): RTVolumetricGI {
        return new RTVolumetricGI();
    }
    createReflectionProbe(): RTReflectionProb {
        return new RTReflectionProb();
    }
    createLightmapData(): RTLightmapData {
        return new RTLightmapData();
    }
    createDirectLight(): IDirectLightData {
        return new RTDirectLight();
    }
    createSpotLight(): ISpotLightData {
        return new ECSSpotLight();
    }
    createPointLight(): IPointLightData {
        return new RTPointLight();
    }
    createCameraModuleData(): ICameraNodeData {
        return new RTCameraNodeData();
    }
    createSceneModuleData(): ISceneNodeData {
        return new RTSceneNodeData();
    }

    createBaseRenderNode(): RTBaseRenderNode {
        return new RTBaseRenderNode();
    }
    createMeshRenderNode(): RTMeshRenderNode {
        return new RTMeshRenderNode();
    }

    createSkinRenderNode(): ISkinRenderNode {
        return new RTSkinRenderNode();
    }

    createSimpleSkinRenderNode(): ISimpleSkinRenderNode {
        return new RTSimpleSkinRenderNode();
    }

}

Laya.addBeforeInitCallback(() => {
    if (!Laya3DRender.Render3DModuleDataFactory)
        Laya3DRender.Render3DModuleDataFactory = new RT3DRenderModuleFactory();
})