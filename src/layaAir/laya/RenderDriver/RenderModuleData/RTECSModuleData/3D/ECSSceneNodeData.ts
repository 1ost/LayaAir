import { ISceneNodeData } from "../../Design/3D/I3DRenderModuleData";

export class ECSSceneNodeData implements ISceneNodeData {
    private _lightmapDirtyFlag: number;
    public get lightmapDirtyFlag(): number {
        // return this._nativeObj._lightmapDirtyFlag;
        return this._lightmapDirtyFlag;
    }
    public set lightmapDirtyFlag(value: number) {
        this._lightmapDirtyFlag = value;
    }

    _nativeObj: any;
    constructor() {
        this._nativeObj = new (window as any).conchECSRTSceneNodeData();
    }
}