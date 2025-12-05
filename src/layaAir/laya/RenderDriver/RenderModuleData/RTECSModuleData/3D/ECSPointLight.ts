import { ShadowMode } from "../../../../d3/core/light/ShadowMode";
import { Scene3D } from "../../../../d3/core/scene/Scene3D";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { IPointLightData } from "../../Design/3D/I3DRenderModuleData";
import { ECSTransform } from "../ECSTransform";
import { ECSSceneNodeData } from "./ECSSceneNodeData";

export class ECSPointLight implements IPointLightData {

    _nativeObj: any;

    private _transform: ECSTransform;
    public get transform(): ECSTransform {
        return this._transform;
    }
    public set transform(value: ECSTransform) {
        this._transform = value;
        this._nativeObj.setTransform(value._nativeObj);
    }

    public get range(): number {
        return this._nativeObj.range;
    }
    public set range(value: number) {
        this._nativeObj.range = value;
    }

    public get shadowResolution(): number {
        return this._nativeObj.shadowResolution;
    }
    public set shadowResolution(value: number) {
        this._nativeObj.shadowResolution = value;
    }

    public get shadowDistance(): number {
        return this._nativeObj.shadowDistance;
    }
    public set shadowDistance(value: number) {
        this._nativeObj.shadowDistance = value;
    };

    public get shadowMode(): ShadowMode {
        return this._nativeObj.shadowMode;
    }
    public set shadowMode(value: ShadowMode) {
        this._nativeObj.shadowMode = value;
    };

    public get shadowStrength(): number {
        return this._nativeObj.shadowStrength;
    }
    public set shadowStrength(value: number) {
        this._nativeObj.shadowStrength = value;
    }

    public get shadowDepthBias(): number {
        return this._nativeObj.shadowDepthBias;
    }
    public set shadowDepthBias(value: number) {
        this._nativeObj.shadowDepthBias = value;
    }

    public get shadowNormalBias(): number {
        return this._nativeObj.shadowNormalBias;
    }
    public set shadowNormalBias(value: number) {
        this._nativeObj.shadowNormalBias = value;
    }

    public get shadowNearPlane(): number {
        return this._nativeObj.shadowNearPlane;
    }
    public set shadowNearPlane(value: number) {
        this._nativeObj.shadowNearPlane = value;
    }

    setOwner(owner: Sprite3D): void {
        let scenePtr = (owner.scene as Scene3D)._sceneModuleData as ECSSceneNodeData;
        let transform = owner.transform as ECSTransform;
        this._nativeObj.addToEntity(scenePtr, transform._entityID);
    }

    removeOwner(): void {
        this._nativeObj.removeFromScene();
    }

    constructor() {
        this._nativeObj = new (window as any).conchRTPointLight();
    }
}