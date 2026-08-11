import { NotImplementedError } from "../../../../utils/Error";
import { WebGPURenderEngine } from "../WebGPURenderEngine";
import { ComputeShaderProcessInfo, IComputeShader } from "../../../DriverDesign/RenderDevice/ComputeShader/IComputeShader";
import { WebGPUCommandUniformMap } from "../WebGPUCommandUniformMap";
import { WebGPUBindGroupHelper, WebGPUUniformPropertyBindingInfo } from "../WebGPUBindGroupHelper";
import { Shader3D } from "../../../../RenderEngine/RenderShader/Shader3D";



export class WebGPUComputeShaderInstance implements IComputeShader {
    static idCounter: number = 0;

    private _device;

    private _shaderModule: GPUShaderModule | null = null;

    private _pipelineCache: Map<string, GPUComputePipeline> = new Map();

    private _gpuPipelineLayout: GPUPipelineLayout;

    private _entryPoints: string[] = [];

    _id: number = WebGPUComputeShaderInstance.idCounter++;

    name: string;

    uniformSetMap: Map<number, WebGPUUniformPropertyBindingInfo[]> = new Map();
    uniformCommandMap: WebGPUCommandUniformMap[];
    compilete: boolean = false;

    constructor(name: string) {

        this._device = WebGPURenderEngine._instance.getDevice();
        this.name = name;
    }
    HasKernel(kernel: string): boolean {
        throw new NotImplementedError();
    }


    /**
     * 序列化着色器
     * @returns 序列化后的着色器
     */
    _serializeShader(): ArrayBuffer {
        throw new NotImplementedError();
    }

    /**
     * 反序列化着色器
     * @param buffer 序列化后的着色器
     * @returns 是否反序列化成功
     */
    _deserialize(buffer: ArrayBuffer): boolean {
        throw new NotImplementedError();
    }

    /**
     * 编译计算着色器
     * @param info 着色器编译信息
     */
    public compile(info: ComputeShaderProcessInfo): void {
        const engine = WebGPURenderEngine._instance;
        const defineNames: string[] = [];
        Shader3D._getNamesByDefineData(info.defineData, defineNames);
        const defineMap: Record<string, boolean> = {};
        defineNames.forEach(name => defineMap[name] = true);

        // The public 3.4 tree predates the IDE's dedicated compute GLSL
        // generator. Preserve the current shader-node contract and use Naga's
        // compute conversion directly for sources that carry their bindings.
        let code = info.node.toscript(defineMap, []).join("\n");
        if (!code.startsWith("#version")) code = `#version 450\n${code}`;
        const wgsl = engine.shaderCompiler.naga.glsl_to_wgsl(code, "compute", false);

        let other = info.uniformMaps as WebGPUCommandUniformMap[];
        for (let i = 0, n = other.length; i < n; i++) {
            this.uniformSetMap.set(i, WebGPUBindGroupHelper.createBindPropertyInfoArrayByCommandMap(i, [other[i]._stateName], true));
        }
        this.uniformCommandMap = other;

        //创建BindGroupLayouts
        this._shaderModule = this._device.createShaderModule({
            code: wgsl
        });

        this._shaderModule.getCompilationInfo().then((value: GPUCompilationInfo) => {
            if (value.messages.length > 0) {
                console.warn("WebGPUComputeShaderInstance compile info:", value.messages);
            }
        });
        this.compilete = true;
    }

    getPipelineDescriptor(entryPoint: string): GPUComputePipelineDescriptor {
        let descriptor: GPUComputePipelineDescriptor = {
            label: this.name,
            layout: null,
            compute: {
                module: this._shaderModule!,
                entryPoint: entryPoint
            }
        };

        return descriptor;
    };
}
