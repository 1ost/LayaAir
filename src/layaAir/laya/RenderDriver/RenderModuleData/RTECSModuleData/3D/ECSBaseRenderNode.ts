import { PBRMaterial } from "../../../../d3/core/material/PBRMaterial";
import { PBRStandardMaterial } from "../../../../d3/core/material/PBRStandardMaterial";
import { Scene3D } from "../../../../d3/core/scene/Scene3D";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { Shader3D } from "../../../../RenderEngine/RenderShader/Shader3D";
import { IRenderElement3D } from "../../../DriverDesign/3DRenderPass/I3DRenderPass";
import { GLESShaderData } from "../../../OpenGLESDriver/RenderDevice/GLESShaderData";
import { RTBaseRenderNode } from "../../RuntimeModuleData/3D/RTBaseRenderNode";
import { RTMeshRenderNode } from "../../RuntimeModuleData/3D/RTMeshRenderNode";
import { ECSBufferState } from "../ECSRenderDriver/ECS3DRenderPass";
import { ECSTransform } from "../ECSTransform";

export class ECSMeshRenderNode extends RTBaseRenderNode implements RTMeshRenderNode {
    //create runtime Node
    protected _getNativeObj() {
        this._nativeObj = new (window as any).conchECSMeshRenderNode();
        this._nativeObj.setColorID(PBRMaterial.ALBEDOCOLOR);
        this._nativeObj.setMetallicID(PBRStandardMaterial.METALLIC);
         this._nativeObj.setSmoothness(PBRMaterial.SMOOTHNESS);
    }

    private _transforma: any;

    public get transform() {
        return this._transforma;
    }

    public set transform(value: any) {
        this._nativeObj.setECSTransform(value ? value._nativeObj : null);
        this._transforma = value;
    }

    setOwner(owner: Sprite3D): void {
        this._nativeObj.addToEntity(this._transforma._nativeObj);
    }

    removeOwner(): void {
        this._nativeObj.removeFromScene();
    }

    setRenderelements(value: IRenderElement3D[]): void {
        this._nativeObj.setRenderCount(value.length);
        
        for (var i = 0; i < value.length; i++) {
            this._nativeObj.setDrawByIndex(i, (value[i].geometry.bufferState as ECSBufferState)._meshNativeObj, (value[i].materialShaderData as GLESShaderData)._nativeObj);
        }
    }
}