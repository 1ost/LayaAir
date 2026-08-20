import { Color } from "../../maths/Color";
import { Matrix } from "../../maths/Matrix";
import { Vector2 } from "../../maths/Vector2";
import { Vector4 } from "../../maths/Vector4";
import { LayaGL } from "../../layagl/LayaGL";
import { IRenderElement2D } from "../../RenderDriver/DriverDesign/2DRenderPass/IRenderElement2D";
import { ShaderDataType } from "../../RenderDriver/DriverDesign/RenderDevice/ShaderData";
import { RenderState } from "../../RenderDriver/RenderModuleData/Design/RenderState";
import { RenderTargetFormat } from "../../RenderEngine/RenderEnum/RenderTargetFormat";
import { Shader3D, ShaderFeatureType } from "../../RenderEngine/RenderShader/Shader3D";
import { SubShader } from "../../RenderEngine/RenderShader/SubShader";
import { Filter } from "../../filters/Filter";
import { Material } from "../../resource/Material";
import { RenderTexture2D } from "../../resource/RenderTexture2D";
import { PostProcess2D, PostProcessRenderContext2D } from "../PostProcess2D";
import { PostProcess2DEffect } from "../PostProcess2DEffect";
import { Blit2DCMD } from "../Scene2DSpecial/RenderCMD2D/Blit2DCMD";
import { flashBoxKernelMargins, registerFlashBoxBlurShader } from "./FlashFilterEffects";

export type FlashBevelPlacement = "inner" | "outer" | "full";

export interface FlashGradientBevelEffectOptions {
    readonly distance: number;
    readonly angleRadians: number;
    readonly colors: readonly number[] | null;
    readonly alphas: readonly number[] | null;
    readonly ratios: readonly number[] | null;
    readonly blurX: number;
    readonly blurY: number;
    readonly strength: number;
    readonly quality: number;
    readonly type: FlashBevelPlacement;
    readonly knockout: boolean;
    readonly compositeSource: boolean;
}

/** Exact normalized output of the LayaAir-owned SWF BEVELFILTER decoder. */
export interface FlashAuthoredBevelFilterOptions {
    readonly sourceType: "BEVELFILTER";
    readonly distance: number;
    readonly angleRadians: number;
    readonly highlightColor: number;
    readonly highlightAlpha: number;
    readonly shadowColor: number;
    readonly shadowAlpha: number;
    readonly blurX: number;
    readonly blurY: number;
    readonly strength: number;
    readonly passes: number;
    readonly innerShadow: boolean;
    readonly onTop: boolean;
    readonly knockout: boolean;
    readonly compositeSource: boolean;
}

interface FlashBevelGradient {
    readonly colors: readonly number[];
    readonly alphas: readonly number[];
    readonly ratios: readonly number[];
}

interface NormalizedFlashBevelEffectOptions extends Omit<FlashGradientBevelEffectOptions, "colors" | "alphas" | "ratios"> {
    readonly gradient: FlashBevelGradient;
}

const FLASH_TEXTURE_SAMPLING = `
#ifdef GRAPHICS_API_WEBGPU
  #define FLASH_BEVEL_TEXTURE_2D(textureName, uv) texture2DLodEXT(textureName, uv, 0.0)
#else
  #define FLASH_BEVEL_TEXTURE_2D(textureName, uv) texture2D(textureName, uv)
#endif
`;

const FILTER_VERTEX = `
#define SHADER_NAME FlashBevel2D
varying vec2 v_Texcoord0;
void main() {
  gl_Position = vec4(a_PositionTexcoord.xy * u_centerScale, 0.0, 1.0);
  v_Texcoord0 = a_PositionTexcoord.zw;
  #ifdef INVERTY
    gl_Position.y = -gl_Position.y;
  #endif
}`;

const COPY_VERTEX = `
#define SHADER_NAME FlashBevelCopy2D
varying vec2 v_Texcoord0;
void main() {
  gl_Position = vec4(a_PositionTexcoord.xy * u_centerScale + u_centerOffset, 0.0, 1.0);
  v_Texcoord0 = a_PositionTexcoord.zw;
  #ifdef INVERTY
    gl_Position.y = -gl_Position.y;
  #endif
}`;

const COPY_FRAGMENT = `
#define SHADER_NAME FlashBevelCopy2D
${FLASH_TEXTURE_SAMPLING}
varying vec2 v_Texcoord0;
void main() {
  gl_FragColor = FLASH_BEVEL_TEXTURE_2D(u_MainTex, v_Texcoord0) * u_OwnerAlpha;
}`;

const SEED_FRAGMENT = `
#define SHADER_NAME FlashBevelSeed2D
${FLASH_TEXTURE_SAMPLING}
varying vec2 v_Texcoord0;
float sourceAlpha(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return FLASH_BEVEL_TEXTURE_2D(u_MainTex, uv).a;
}
void main() {
  float center = sourceAlpha(v_Texcoord0);
  float positive = sourceAlpha(v_Texcoord0 - u_Offset);
  float negative = sourceAlpha(v_Texcoord0 + u_Offset);

  // FFDec applies strength to each temporary drop-shadow field, composes the
  // opposing fields, blurs them, then applies strength again for ramp lookup.
  float highlightInnerBase = clamp((1.0 - positive) * u_PreStrength, 0.0, 1.0) * center;
  float shadowInnerBase = clamp((1.0 - negative) * u_PreStrength, 0.0, 1.0) * center;
  float highlightInner = highlightInnerBase * (1.0 - shadowInnerBase);
  float shadowInner = shadowInnerBase * (1.0 - highlightInnerBase);

  float highlightOuterBase = clamp(negative * u_PreStrength, 0.0, 1.0) * (1.0 - center);
  float shadowOuterBase = clamp(positive * u_PreStrength, 0.0, 1.0) * (1.0 - center);
  float highlightOuter = highlightOuterBase * (1.0 - shadowOuterBase);
  float shadowOuter = shadowOuterBase * (1.0 - highlightOuterBase);

  float highlight = highlightInner + highlightOuter * (1.0 - highlightInner);
  float shadow = shadowInner + shadowOuter * (1.0 - shadowInner);
  // FFDec draws blue then red with SrcOver onto opaque black.
  gl_FragColor = vec4(highlight, 0.0, shadow * (1.0 - highlight), 1.0);
}`;

function configurePass(pass: ReturnType<SubShader["addShaderPass"]>): void {
    pass.statefirst = true;
    pass.renderState.depthWrite = false;
    pass.renderState.depthTest = RenderState.DEPTHTEST_OFF;
    pass.renderState.blend = RenderState.BLEND_DISABLE;
    pass.renderState.cull = RenderState.CULL_NONE;
}

function renderElement(material: Material): IRenderElement2D {
    const element = LayaGL.render2DRenderPassFactory.createRenderElement2D();
    element.geometry = Blit2DCMD.InvertQuadGeometry;
    element.nodeCommonMap = null;
    element.renderStateIsBySprite = false;
    element.materialShaderData = material.shaderData;
    element.subShader = material.shader.getSubShaderAt(0);
    return element;
}

let commonShadersRegistered = false;
function registerCommonShaders(): void {
    if (commonShadersRegistered) return;
    commonShadersRegistered = true;
    const attributes: Record<string, [number, ShaderDataType]> = { a_PositionTexcoord: [0, ShaderDataType.Vector4] };
    const copy = Shader3D.add("FlashBevelCopy2D");
    copy.shaderType = ShaderFeatureType.PostProcess;
    const copySub = new SubShader(attributes, {
        u_centerScale: ShaderDataType.Vector2,
        u_centerOffset: ShaderDataType.Vector2,
        u_MainTex: ShaderDataType.Texture2D,
        u_OwnerAlpha: ShaderDataType.Float,
    });
    copy.addSubShader(copySub);
    configurePass(copySub.addShaderPass(COPY_VERTEX, COPY_FRAGMENT));

    const seed = Shader3D.add("FlashBevelSeed2D");
    seed.shaderType = ShaderFeatureType.PostProcess;
    const seedSub = new SubShader(attributes, {
        u_centerScale: ShaderDataType.Vector2,
        u_MainTex: ShaderDataType.Texture2D,
        u_Offset: ShaderDataType.Vector2,
        u_PreStrength: ShaderDataType.Float,
    });
    seed.addSubShader(seedSub);
    configurePass(seedSub.addShaderPass(FILTER_VERTEX, SEED_FRAGMENT));
}

const composeShaders = new Set<number>();
function registerComposeShader(stops: number): string {
    const name = `FlashBevelCompose2D_${stops}`;
    if (composeShaders.has(stops)) return name;
    composeShaders.add(stops);
    const branches: string[] = ["if (position <= u_Ratio0) return u_Color0;"];
    for (let index = 1; index < stops; index++) {
        branches.push(`if (position <= u_Ratio${index}) {
    float span = u_Ratio${index} - u_Ratio${index - 1};
    float amount = span <= 0.0 ? 1.0 : clamp((position - u_Ratio${index - 1}) / span, 0.0, 1.0);
    return mix(u_Color${index - 1}, u_Color${index}, amount);
  }`);
    }
    const fragment = `
#define SHADER_NAME ${name}
${FLASH_TEXTURE_SAMPLING}
varying vec2 v_Texcoord0;
vec4 gradient(float position) {
  ${branches.join("\n  ")}
  return u_Color${stops - 1};
}
void main() {
  vec4 source = FLASH_BEVEL_TEXTURE_2D(u_SourceTex, v_Texcoord0);
  vec4 field = FLASH_BEVEL_TEXTURE_2D(u_FieldTex, v_Texcoord0);
  float signedLevel = clamp((field.r - field.b) * u_Strength, -1.0, 1.0);
  // FFDec indexes a 512-entry ramp with 255 + the signed byte field.
  float position = (255.0 + signedLevel * 255.0) / 511.0;
  vec4 straightBevel = gradient(position);
  vec4 bevel = vec4(straightBevel.rgb * straightBevel.a, straightBevel.a);
  vec4 result = bevel;
  if (u_Type == 1) {
    if (u_Knockout == 1 || u_CompositeSource == 0) result = bevel * source.a;
    else result = bevel * source.a + source * (1.0 - bevel.a);
  } else if (u_Type == 2) {
    if (u_Knockout == 1) result = bevel * (1.0 - source.a);
    else if (u_CompositeSource == 1) result = source + bevel * (1.0 - source.a);
  } else if (u_Knockout == 0 && u_CompositeSource == 1) {
    result = bevel + source * (1.0 - bevel.a);
  }
  gl_FragColor = result;
}`;
    const uniforms: Record<string, ShaderDataType> = {
        u_centerScale: ShaderDataType.Vector2,
        u_SourceTex: ShaderDataType.Texture2D,
        u_FieldTex: ShaderDataType.Texture2D,
        u_Strength: ShaderDataType.Float,
        u_Type: ShaderDataType.Int,
        u_Knockout: ShaderDataType.Int,
        u_CompositeSource: ShaderDataType.Int,
    };
    for (let index = 0; index < stops; index++) {
        uniforms[`u_Color${index}`] = ShaderDataType.Vector4;
        uniforms[`u_Ratio${index}`] = ShaderDataType.Float;
    }
    const shader = Shader3D.add(name);
    shader.shaderType = ShaderFeatureType.PostProcess;
    const subShader = new SubShader({ a_PositionTexcoord: [0, ShaderDataType.Vector4] }, uniforms);
    shader.addSubShader(subShader);
    configurePass(subShader.addShaderPass(FILTER_VERTEX, fragment));
    return name;
}

function effectiveBlur(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 0;
}

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }

function normalizeGradient(
    colors: readonly number[] | null,
    alphas: readonly number[] | null,
    ratios: readonly number[] | null,
): FlashBevelGradient {
    if (!colors || !alphas || !ratios) return Object.freeze({ colors: Object.freeze([0]), alphas: Object.freeze([0]), ratios: Object.freeze([0]) });
    const count = Math.min(15, colors.length, alphas.length, ratios.length);
    if (count === 0) return Object.freeze({ colors: Object.freeze([0]), alphas: Object.freeze([0]), ratios: Object.freeze([0]) });
    const stops = Array.from({ length: count }, (_, index) => ({
        color: Number(colors[index]) >>> 0 & 0xffffff,
        alpha: Math.max(0, Math.min(1, finite(Number(alphas[index])))),
        ratio: Math.max(0, Math.min(255, finite(Number(ratios[index])))),
        index,
    })).sort((left, right) => left.ratio - right.ratio || left.index - right.index);
    return Object.freeze({
        colors: Object.freeze(stops.map(stop => stop.color)),
        alphas: Object.freeze(stops.map(stop => stop.alpha)),
        ratios: Object.freeze(stops.map(stop => stop.ratio / 255)),
    });
}

/** LayaAir-owned GPU implementation shared by API GradientBevel and authored BEVELFILTER. */
export class FlashBevelEffect2D extends PostProcess2DEffect {
    override readonly ownsOwnerAlpha = true;
    private copyMaterial: Material;
    private seedMaterial: Material;
    private horizontalMaterial: Material;
    private verticalMaterial: Material;
    private composeMaterial: Material;
    private copyElement: IRenderElement2D;
    private seedElement: IRenderElement2D;
    private horizontalElement: IRenderElement2D;
    private verticalElement: IRenderElement2D;
    private composeElement: IRenderElement2D;
    private original: RenderTexture2D;
    private primary: RenderTexture2D;
    private secondary: RenderTexture2D;
    private output: RenderTexture2D;

    readonly options: Readonly<NormalizedFlashBevelEffectOptions>;

    constructor(options: Readonly<FlashGradientBevelEffectOptions>) {
        super();
        this.options = Object.freeze({
            distance: finite(Number(options.distance)),
            angleRadians: finite(Number(options.angleRadians)),
            blurX: effectiveBlur(Number(options.blurX)),
            blurY: effectiveBlur(Number(options.blurY)),
            strength: Math.max(0, Math.min(255, finite(Number(options.strength)))),
            quality: Math.max(0, Math.min(15, Number(options.quality) >> 0)),
            type: options.type === "inner" || options.type === "outer" ? options.type : "full",
            knockout: Boolean(options.knockout),
            compositeSource: Boolean(options.compositeSource),
            gradient: normalizeGradient(options.colors, options.alphas, options.ratios),
        });
    }

    effectInit(postprocess: PostProcess2D): void {
        this._owner = postprocess;
        registerCommonShaders();
        this.copyMaterial = new Material();
        this.copyMaterial.setShaderName("FlashBevelCopy2D");
        this.copyMaterial.setVector2("u_centerOffset", new Vector2(0, 0));
        this.copyMaterial.setFloat("u_OwnerAlpha", 1);
        this.copyElement = renderElement(this.copyMaterial);

        this.seedMaterial = new Material();
        this.seedMaterial.setShaderName("FlashBevelSeed2D");
        this.seedMaterial.setVector2("u_centerScale", new Vector2(1, 1));
        this.seedMaterial.setFloat("u_PreStrength", this.options.strength);
        this.seedMaterial.lock = true;
        this.seedElement = renderElement(this.seedMaterial);

        this.horizontalMaterial = new Material();
        this.horizontalMaterial.setShaderName(registerFlashBoxBlurShader(Math.max(1, Math.round(this.options.blurX))));
        this.horizontalMaterial.setVector2("u_centerScale", new Vector2(1, 1));
        this.horizontalMaterial.lock = true;
        this.horizontalElement = renderElement(this.horizontalMaterial);

        this.verticalMaterial = new Material();
        this.verticalMaterial.setShaderName(registerFlashBoxBlurShader(Math.max(1, Math.round(this.options.blurY))));
        this.verticalMaterial.setVector2("u_centerScale", new Vector2(1, 1));
        this.verticalMaterial.lock = true;
        this.verticalElement = renderElement(this.verticalMaterial);

        this.composeMaterial = new Material();
        this.composeMaterial.setShaderName(registerComposeShader(this.options.gradient.colors.length));
        this.composeMaterial.setVector2("u_centerScale", new Vector2(1, 1));
        this.composeMaterial.setFloat("u_Strength", this.options.strength);
        this.composeMaterial.setInt("u_Type", this.options.type === "inner" ? 1 : this.options.type === "outer" ? 2 : 3);
        this.composeMaterial.setInt("u_Knockout", this.options.knockout ? 1 : 0);
        this.composeMaterial.setInt("u_CompositeSource", this.options.compositeSource ? 1 : 0);
        for (let index = 0; index < this.options.gradient.colors.length; index++) {
            const color = this.options.gradient.colors[index];
            this.composeMaterial.setVector4(`u_Color${index}`, new Vector4(
                (color >> 16 & 255) / 255,
                (color >> 8 & 255) / 255,
                (color & 255) / 255,
                this.options.gradient.alphas[index],
            ));
            this.composeMaterial.setFloat(`u_Ratio${index}`, this.options.gradient.ratios[index]);
        }
        this.composeMaterial.lock = true;
        this.composeElement = renderElement(this.composeMaterial);
    }

    render(context: PostProcessRenderContext2D): void {
        const source = context.indirectTarget;
        const offsetX = this.options.distance * Math.cos(this.options.angleRadians);
        const offsetY = this.options.distance * Math.sin(this.options.angleRadians);
        const horizontal = flashBoxKernelMargins(this.options.blurX, this.options.quality);
        const vertical = flashBoxKernelMargins(this.options.blurY, this.options.quality);
        const expanded = context.expandOutputBounds(
            horizontal.before + Math.abs(offsetX), vertical.before + Math.abs(offsetY),
            horizontal.after + Math.abs(offsetX), vertical.after + Math.abs(offsetY),
        );
        const original = this.requireTarget("original", expanded.width, expanded.height, context);
        const primary = this.requireTarget("primary", expanded.width, expanded.height, context);
        const secondary = this.requireTarget("secondary", expanded.width, expanded.height, context);
        const output = this.requireTarget("output", expanded.width, expanded.height, context);

        this.copyMaterial.setTexture("u_MainTex", source);
        this.copyMaterial.setFloat("u_OwnerAlpha", context.takeOwnerAlpha());
        this.copyMaterial.setVector2("u_centerScale", new Vector2(source.width / expanded.width, source.height / expanded.height));
        this.copyMaterial.setVector2("u_centerOffset", new Vector2(
            (expanded.left - expanded.right) / expanded.width,
            (expanded.top - expanded.bottom) / expanded.height,
        ));
        context.command.setRenderTarget(original, true, Color.CLEAR);
        context.command.drawRenderElement(this.copyElement, Matrix.EMPTY);

        this.seedMaterial.setTexture("u_MainTex", original);
        this.seedMaterial.setVector2("u_Offset", new Vector2(offsetX / expanded.width, -offsetY / expanded.height));
        context.command.setRenderTarget(primary, true, Color.CLEAR);
        context.command.drawRenderElement(this.seedElement, Matrix.EMPTY);

        this.horizontalMaterial.setTexture("u_MainTex", primary);
        this.horizontalMaterial.setVector2("u_Direction", new Vector2(1 / expanded.width, 0));
        this.verticalMaterial.setTexture("u_MainTex", secondary);
        this.verticalMaterial.setVector2("u_Direction", new Vector2(0, -1 / expanded.height));
        for (let pass = 0; pass < this.options.quality; pass++) {
            context.command.setRenderTarget(secondary, true, Color.CLEAR);
            context.command.drawRenderElement(this.horizontalElement, Matrix.EMPTY);
            context.command.setRenderTarget(primary, true, Color.CLEAR);
            context.command.drawRenderElement(this.verticalElement, Matrix.EMPTY);
        }

        this.composeMaterial.setTexture("u_SourceTex", original);
        this.composeMaterial.setTexture("u_FieldTex", primary);
        context.command.setRenderTarget(output, true, Color.CLEAR);
        context.command.drawRenderElement(this.composeElement, Matrix.EMPTY);
        context.destination = output;
    }

    clearRT(context: PostProcessRenderContext2D): void {
        for (const key of ["original", "primary", "secondary", "output"]) this.recover(key, context);
    }

    destroy(): void {
        if (this.destroyed) return;
        super.destroy();
        for (const key of ["original", "primary", "secondary", "output"]) {
            const texture = (this as unknown as Record<string, RenderTexture2D>)[key];
            if (texture && !texture._inPool) RenderTexture2D.recoverToPool(texture);
            (this as unknown as Record<string, RenderTexture2D>)[key] = null;
        }
        for (const material of [this.copyMaterial, this.seedMaterial, this.horizontalMaterial, this.verticalMaterial, this.composeMaterial]) material?.destroy();
        for (const element of [this.copyElement, this.seedElement, this.horizontalElement, this.verticalElement, this.composeElement]) element?.destroy();
        this.copyMaterial = this.seedMaterial = this.horizontalMaterial = this.verticalMaterial = this.composeMaterial = null;
        this.copyElement = this.seedElement = this.horizontalElement = this.verticalElement = this.composeElement = null;
    }

    private recover(key: string, context: PostProcessRenderContext2D): void {
        const owner = this as unknown as Record<string, RenderTexture2D>;
        const texture = owner[key];
        if (texture && texture !== context.destination && !texture._inPool) {
            RenderTexture2D.recoverToPool(texture);
            owner[key] = null;
        }
    }

    private requireTarget(key: string, width: number, height: number, context: PostProcessRenderContext2D): RenderTexture2D {
        const owner = this as unknown as Record<string, RenderTexture2D>;
        let texture = owner[key];
        if (texture && (texture._inPool || texture.destroyed || texture.width !== width || texture.height !== height)) {
            if (!texture._inPool) RenderTexture2D.recoverToPool(texture);
            texture = null;
        }
        if (!texture) texture = context.getRenderTexture(width, height, RenderTargetFormat.R8G8B8A8, RenderTargetFormat.None);
        owner[key] = texture;
        return texture;
    }
}

class FlashAuthoredBevelFilter extends Filter {
    constructor(private readonly options: Readonly<FlashGradientBevelEffectOptions>) { super(); }
    getEffect(): PostProcess2DEffect { return new FlashBevelEffect2D(this.options); }
}

/** Internal publisher/runtime seam for decoded SWF BEVELFILTER records. */
export function createFlashAuthoredBevelFilter(options: Readonly<FlashAuthoredBevelFilterOptions>): Filter {
    if (!options || options.sourceType !== "BEVELFILTER") throw new TypeError("Authored bevel sourceType must be BEVELFILTER");
    const number = (name: keyof FlashAuthoredBevelFilterOptions, minimum: number, maximum: number, integer = false): number => {
        const value = Number(options[name]);
        if (!Number.isFinite(value) || value < minimum || value > maximum || integer && !Number.isInteger(value))
            throw new RangeError(`Authored BEVELFILTER ${name} is outside its serialized range`);
        return value;
    };
    const boolean = (name: keyof FlashAuthoredBevelFilterOptions): boolean => {
        const value = options[name];
        if (typeof value !== "boolean") throw new TypeError(`Authored BEVELFILTER ${name} must be boolean`);
        return value;
    };
    const innerShadow = boolean("innerShadow");
    const onTop = boolean("onTop");
    const shadowColor = number("shadowColor", 0, 0xffffff, true);
    const highlightColor = number("highlightColor", 0, 0xffffff, true);
    const shadowAlpha = number("shadowAlpha", 0, 1);
    const highlightAlpha = number("highlightAlpha", 0, 1);
    const normalized: FlashGradientBevelEffectOptions = Object.freeze({
        distance: number("distance", -32768, 32767.99998474121),
        angleRadians: number("angleRadians", -32768, 32767.99998474121),
        colors: Object.freeze([shadowColor, shadowColor, highlightColor, highlightColor]),
        alphas: Object.freeze([shadowAlpha, 0, 0, highlightAlpha]),
        ratios: Object.freeze([0, 127, 128, 255]),
        blurX: number("blurX", 0, 255),
        blurY: number("blurY", 0, 255),
        strength: number("strength", 0, 255.99609375),
        quality: number("passes", 0, 15, true),
        type: onTop && !innerShadow ? "full" : innerShadow ? "inner" : "outer",
        knockout: boolean("knockout"),
        compositeSource: boolean("compositeSource"),
    });
    return new FlashAuthoredBevelFilter(normalized);
}
