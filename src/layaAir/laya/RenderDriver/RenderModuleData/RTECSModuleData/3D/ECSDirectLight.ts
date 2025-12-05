import { ShadowCascadesMode } from "../../../../d3/core/light/ShadowCascadesMode";
import { ShadowMode } from "../../../../d3/core/light/ShadowMode";
import { Scene3D } from "../../../../d3/core/scene/Scene3D";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { Vector3 } from "../../../../maths/Vector3";
import { IDirectLightData } from "../../Design/3D/I3DRenderModuleData";
import { ECSTransform } from "../ECSTransform";
import { ECSSceneNodeData } from "./ECSSceneNodeData";

export class ECSDirectLight implements IDirectLightData {

    public get shadowNearPlane(): number {
        return this._nativeObj._shadowNearPlane;
    }
    public set shadowNearPlane(value: number) {
        this._nativeObj._shadowNearPlane = value;
    }

    public get shadowCascadesMode(): ShadowCascadesMode {
        return this._nativeObj._shadowCascadesMode;
    }
    public set shadowCascadesMode(value: ShadowCascadesMode) {
        this._nativeObj._shadowCascadesMode = value;
    }
    private _transform: ECSTransform;
    public get transform(): ECSTransform {
        return this._transform;
    }
    public set transform(value: ECSTransform) {
        this._transform = value;
        this._nativeObj.setTransform(value._nativeObj);
    }

    public get shadowResolution(): number {
        return this._nativeObj._shadowResolution;
    }
    public set shadowResolution(value: number) {
        this._nativeObj._shadowResolution = value;
    }

    public get shadowDistance(): number {
        return this._nativeObj._shadowDistance;
    }
    public set shadowDistance(value: number) {
        this._nativeObj._shadowDistance = value;
    }

    public get shadowMode(): ShadowMode {
        return this._nativeObj._shadowMode;
    }
    public set shadowMode(value: ShadowMode) {
        this._nativeObj._shadowMode = value;
    }

    public get shadowStrength(): number {
        return this._nativeObj._shadowStrength;
    }
    public set shadowStrength(value: number) {
        this._nativeObj._shadowStrength = value;
    }
    public get shadowDepthBias(): number {
        return this._nativeObj._shadowDepthBias;
    }
    public set shadowDepthBias(value: number) {
        this._nativeObj._shadowDepthBias = value;
    }

    public get shadowNormalBias(): number {
        return this._nativeObj._shadowNormalBias;
    }
    public set shadowNormalBias(value: number) {
        this._nativeObj._shadowNormalBias = value;
    }

    public get shadowTwoCascadeSplits(): number {
        return this._nativeObj._shadowTwoCascadeSplits;
    }
    public set shadowTwoCascadeSplits(value: number) {
        this._nativeObj._shadowTwoCascadeSplits = value;
    }

    setShadowFourCascadeSplits(value: Vector3): void {
        value && this._nativeObj.setShadowFourCascadeSplits(value);
    }

    setDirection(value: Vector3): void {
        value && this._nativeObj.setDirection(value);
    }

    setOwner(owner: Sprite3D): void {
        let scenePtr = (owner.scene as Scene3D)._sceneModuleData as ECSSceneNodeData;
        let transform = owner.transform as ECSTransform;
        this._nativeObj.addToEntity(scenePtr, transform._entityID);
    }

    removeOwner(): void {
        this._nativeObj.removeFromScene();
    }

    _nativeObj: any;

    constructor() {
        this._nativeObj = new (window as any).conchRTDirectLight();
    }

}