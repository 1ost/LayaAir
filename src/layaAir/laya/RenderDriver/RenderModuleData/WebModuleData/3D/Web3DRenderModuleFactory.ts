import { stat } from "fs";
import { Laya } from "../../../../../Laya";
import { Laya3DRender } from "../../../../d3/RenderObjs/Laya3DRender";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { Transform3D } from "../../../../d3/core/Transform3D";
import { BoundsImpl } from "../../../../d3/math/BoundsImpl";
import { LayaGL } from "../../../../layagl/LayaGL";
import { Vector3 } from "../../../../maths/Vector3";
import { Stat } from "../../../../utils/Stat";
import { IBaseRenderNode, ICameraNodeData, IDirectLightData, IMeshRenderNode, IPointLightData, IReflectionProbeData, ISceneNodeData, ISimpleSkinRenderNode, ISkinRenderNode, ISpotLightData, IVolumetricGIData } from "../../Design/3D/I3DRenderModuleData";
import { I3DRenderModuleFactory } from "../../Design/3D/I3DRenderModuleFactory";
import { WebBaseRenderNode } from "./WebBaseRenderNode";
import { WebDirectLight } from "./WebDirectLight";
import { WebLightmap } from "./WebLightmap";
import { WebMeshRenderNode } from "./WebMeshRenderNode";
import { WebCameraNodeData, WebSceneNodeData } from "./WebModuleData";
import { WebPointLight } from "./WebPointLight";
import { WebReflectionProbe } from "./WebReflectionProb";
import { WebSkinRenderNode } from "./WebSkinRenderNode";
import { WebSpotLight } from "./WebSpotLight";
import { WebVolumetricGI } from "./WebVolumetricGI";
import { WebSimpleSkinRenderNode } from "./WebSimpleSkinRenderNode";

export class Web3DRenderModuleFactory implements I3DRenderModuleFactory {
  createSimpleSkinRenderNode(): ISimpleSkinRenderNode {
    return new (WebSimpleSkinRenderNode())();
  }

  createTransform(owner: Sprite3D): Transform3D {
    return new Transform3D(owner);
  }

  createBounds(min: Vector3, max: Vector3): BoundsImpl {
    return new BoundsImpl(min, max);
  }

  createVolumetricGI(): IVolumetricGIData {
    return new WebVolumetricGI();
  }

  createReflectionProbe(): IReflectionProbeData {
    return new WebReflectionProbe();
  }

  createLightmapData(): WebLightmap {
    return new WebLightmap();
  }

  createDirectLight(): IDirectLightData {
    return new WebDirectLight();
  }

  createSpotLight(): ISpotLightData {
    return new WebSpotLight();
  }

  createPointLight(): IPointLightData {
    return new WebPointLight();
  }

  createCameraModuleData(): ICameraNodeData {
    return new WebCameraNodeData();
  }

  createSceneModuleData(): ISceneNodeData {
    return new WebSceneNodeData();
  }



  createBaseRenderNode(): IBaseRenderNode {

    let renderNode = new WebBaseRenderNode();
    return renderNode;
  }

  createMeshRenderNode(): IMeshRenderNode {
    return new (WebMeshRenderNode())();
  }

  createSkinRenderNode(): ISkinRenderNode {
    return new (WebSkinRenderNode())();
  }

}


Laya.addBeforeInitCallback(() => {
  if (!Laya3DRender.Render3DModuleDataFactory) {
    Laya3DRender.Render3DModuleDataFactory = new Web3DRenderModuleFactory();
  }
})