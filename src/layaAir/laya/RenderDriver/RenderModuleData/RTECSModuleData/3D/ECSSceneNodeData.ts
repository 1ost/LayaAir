import { ISceneNodeData } from "../../Design/3D/I3DRenderModuleData";

export class ECSSceneNodeData implements ISceneNodeData {
    public get lightmapDirtyFlag(): number {
        return this._nativeObj._lightmapDirtyFlag;
    }
    public set lightmapDirtyFlag(value: number) {
        this._nativeObj._lightmapDirtyFlag = value;
    }

    _nativeObj: any;
    constructor() {
        this._nativeObj = new (window as any).conchECSRTSceneNodeData();
    }
}