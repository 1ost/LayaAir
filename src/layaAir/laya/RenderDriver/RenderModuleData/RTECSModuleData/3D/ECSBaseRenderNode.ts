import { Scene3D } from "../../../../d3/core/scene/Scene3D";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { RTBaseRenderNode } from "../../RuntimeModuleData/3D/RTBaseRenderNode";
import { RTMeshRenderNode } from "../../RuntimeModuleData/3D/RTMeshRenderNode";
import { ECSTransform } from "../ECSTransform";
import { ECSSceneNodeData } from "./ECSSceneNodeData";

export class ECSMeshRenderNode extends RTBaseRenderNode implements RTMeshRenderNode {
    //create runtime Node
    protected _getNativeObj() {
        this._nativeObj = new (window as any).conchRTMeshRenderNode();
    }

    setOwner(owner: Sprite3D): void {
        let scenePtr = (owner.scene as Scene3D)._sceneModuleData as ECSSceneNodeData;
        let transform = owner.transform as ECSTransform;
        this._nativeObj.addToEntity(scenePtr, transform._entityID);
    }

    removeOwner(): void {
        this._nativeObj.removeFromScene();
    }
}