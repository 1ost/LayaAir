import { Scene3D } from "../../../../d3/core/scene/Scene3D";
import { Sprite3D } from "../../../../d3/core/Sprite3D";
import { Matrix4x4 } from "../../../../maths/Matrix4x4";
import { ICameraNodeData } from "../../Design/3D/I3DRenderModuleData";
import { ECSTransform } from "../ECSTransform";
import { ECSSceneNodeData } from "./ECSSceneNodeData";

export class ECSCameraNodeData implements ICameraNodeData {
    private _transform: ECSTransform;
    public get transform(): ECSTransform {
        return this._transform;
    }
    public set transform(value: ECSTransform) {
        this._transform = value;
        this._nativeObj.setTransform(value._nativeObj);
    }
    public get farplane(): number {
        return this._nativeObj._farplane;
    }
    public set farplane(value: number) {
        this._nativeObj._farplane = value;
    }

    public get nearplane(): number {
        return this._nativeObj._nearplane;
    }
    public set nearplane(value: number) {
        this._nativeObj._nearplane = value;
    }

    public get fieldOfView(): number {
        return this._nativeObj._fieldOfView;
    }
    public set fieldOfView(value: number) {
        this._nativeObj._fieldOfView = value;
    }

    public get aspectRatio(): number {
        return this._nativeObj._aspectRatio;
    }
    public set aspectRatio(value: number) {
        this._nativeObj._aspectRatio = value;
    }

    _nativeObj: any;
    constructor() {
        this._nativeObj = new (window as any).conchRTCameraNodeData();
    }

    setProjectionViewMatrix(value: Matrix4x4): void {
        value && this._nativeObj.setProjectionViewMatrix(value);
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
