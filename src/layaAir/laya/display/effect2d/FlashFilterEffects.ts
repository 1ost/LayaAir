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
import { Material } from "../../resource/Material";
import { RenderTexture2D } from "../../resource/RenderTexture2D";
import { PostProcess2D, PostProcessRenderContext2D } from "../PostProcess2D";
import { PostProcess2DEffect } from "../PostProcess2DEffect";
import { Blit2DCMD } from "../Scene2DSpecial/RenderCMD2D/Blit2DCMD";

export interface FlashBlurEffectOptions {
    blurX: number;
    blurY: number;
    quality: number;
}

export interface FlashShadowEffectOptions extends FlashBlurEffectOptions {
    distance: number;
    angleRadians: number;
    color: number;
    alpha: number;
    strength: number;
    inner: boolean;
    knockout: boolean;
    hideObject: boolean;
}

export const FLASH_IDENTITY_COLOR_MATRIX = Object.freeze([
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
]) as readonly number[];

/** Explicit-level samples keep generated filter taps valid on WebGPU. */
const FLASH_TEXTURE_SAMPLING = `
#ifdef GRAPHICS_API_WEBGPU
  #define FLASH_TEXTURE_2D(textureName, uv) texture2DLodEXT(textureName, uv, 0.0)
#else
  #define FLASH_TEXTURE_2D(textureName, uv) texture2D(textureName, uv)
#endif
`;

const FILTER_VERTEX = `
#define SHADER_NAME FlashFilter2D
varying vec2 v_Texcoord0;
void main() {
  gl_Position = vec4(a_PositionTexcoord.xy * u_centerScale, 0.0, 1.0);
  v_Texcoord0 = a_PositionTexcoord.zw;
  #ifdef INVERTY
    gl_Position.y = -gl_Position.y;
  #endif
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

function effectiveBlurDimension(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 0;
}

function effectiveOffset(distance: number, angleRadians: number): { x: number; y: number } {
    if (!Number.isFinite(distance) || !Number.isFinite(angleRadians)) return { x: 0, y: 0 };
    const x = distance * Math.cos(angleRadians);
    const y = distance * Math.sin(angleRadians);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 0, y: 0 };
}

export function flashBoxKernelMargins(blur: number, quality: number): { before: number; after: number } {
    const taps = Math.max(1, Math.round(effectiveBlurDimension(blur)));
    const passes = Number.isFinite(quality) ? Math.max(0, Math.min(15, Math.trunc(quality))) : 0;
    const negativeSampleReach = Math.floor(taps / 2) * passes;
    const positiveSampleReach = (taps - 1 - Math.floor(taps / 2)) * passes;
    // Sampling displacement and impulse/output displacement have opposite signs.
    return { before: positiveSampleReach, after: negativeSampleReach };
}

const COPY_VERTEX = `
#define SHADER_NAME FlashFilterCopy2D
varying vec2 v_Texcoord0;
void main() {
  gl_Position = vec4(a_PositionTexcoord.xy * u_centerScale + u_centerOffset, 0.0, 1.0);
  v_Texcoord0 = a_PositionTexcoord.zw;
  #ifdef INVERTY
    gl_Position.y = -gl_Position.y;
  #endif
}`;

const COPY_FRAGMENT = `
#define SHADER_NAME FlashFilterCopy2D
${FLASH_TEXTURE_SAMPLING}
#include "Color.glsl"
#include "OutputTransform.glsl";
varying vec2 v_Texcoord0;
void main() {
  gl_FragColor = outputTransform(FLASH_TEXTURE_2D(u_MainTex, v_Texcoord0) * u_OwnerAlpha);
}`;

let copyShaderRegistered = false;
function registerCopyShader(): void {
    if (copyShaderRegistered) return;
    copyShaderRegistered = true;
    const shader = Shader3D.add("FlashFilterCopy2D");
    shader.shaderType = ShaderFeatureType.PostProcess;
    const subShader = new SubShader(
        { a_PositionTexcoord: [0, ShaderDataType.Vector4] },
        {
            u_centerScale: ShaderDataType.Vector2,
            u_centerOffset: ShaderDataType.Vector2,
            u_MainTex: ShaderDataType.Texture2D,
            u_OwnerAlpha: ShaderDataType.Float,
        },
    );
    shader.addSubShader(subShader);
    configurePass(subShader.addShaderPass(COPY_VERTEX, COPY_FRAGMENT));
}

const registeredBlurTaps = new Set<number>();
function blurShaderName(taps: number): string { return `FlashBoxBlur2D_${taps}`; }

/** Register one exact Flash/FFDec box kernel, including even-kernel asymmetry. */
export function registerFlashBoxBlurShader(taps: number): string {
    taps = Math.max(1, Math.round(taps));
    const name = blurShaderName(taps);
    if (registeredBlurTaps.has(taps)) return name;
    registeredBlurTaps.add(taps);
    const first = -Math.floor(taps / 2);
    const samples: string[] = [];
    for (let index = 0; index < taps; index++)
        samples.push(`sum += sampleTransparent(v_Texcoord0 + u_Direction * ${first + index}.0);`);
    const fragment = `
#define SHADER_NAME ${name}
${FLASH_TEXTURE_SAMPLING}
varying vec2 v_Texcoord0;
vec4 sampleTransparent(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return FLASH_TEXTURE_2D(u_MainTex, uv);
}
void main() {
  vec4 sum = vec4(0.0);
  ${samples.join("\n  ")}
  gl_FragColor = sum / ${taps}.0;
}`;
    const shader = Shader3D.add(name);
    shader.shaderType = ShaderFeatureType.PostProcess;
    const subShader = new SubShader(
        { a_PositionTexcoord: [0, ShaderDataType.Vector4] },
        {
            u_centerScale: ShaderDataType.Vector2,
            u_MainTex: ShaderDataType.Texture2D,
            u_Direction: ShaderDataType.Vector2,
        },
    );
    shader.addSubShader(subShader);
    configurePass(subShader.addShaderPass(FILTER_VERTEX, fragment));
    return name;
}

abstract class FlashRenderTextureEffect extends PostProcess2DEffect {
    protected recover(key: string, context: PostProcessRenderContext2D): void {
        const owner = this as unknown as Record<string, RenderTexture2D>;
        const texture = owner[key];
        if (texture && texture !== context.destination) {
            RenderTexture2D.recoverToPool(texture);
            owner[key] = null;
        }
    }

    protected requireTarget(
        key: string,
        width: number,
        height: number,
        context: PostProcessRenderContext2D,
    ): RenderTexture2D {
        const owner = this as unknown as Record<string, RenderTexture2D>;
        let texture = owner[key];
        if (texture && (texture._inPool || texture.destroyed || texture.width !== width || texture.height !== height)) {
            RenderTexture2D.recoverToPool(texture);
            texture = null;
        }
        if (!texture)
            texture = context.getRenderTexture(width, height, RenderTargetFormat.R8G8B8A8, RenderTargetFormat.None);
        owner[key] = texture;
        return texture;
    }
}

export class FlashBlurEffect2D extends FlashRenderTextureEffect {
    private copyMaterial: Material;
    private horizontalMaterial: Material;
    private verticalMaterial: Material;
    private copyElement: IRenderElement2D;
    private horizontalElement: IRenderElement2D;
    private verticalElement: IRenderElement2D;
    private primary: RenderTexture2D;
    private secondary: RenderTexture2D;

    readonly options: Readonly<FlashBlurEffectOptions>;

    constructor(options: Readonly<FlashBlurEffectOptions>) {
        super();
        this.options = Object.freeze({
            blurX: effectiveBlurDimension(options.blurX),
            blurY: effectiveBlurDimension(options.blurY),
            quality: Number.isFinite(options.quality) ? Math.max(0, Math.min(15, Math.trunc(options.quality))) : 0,
        });
    }

    effectInit(postprocess: PostProcess2D): void {
        this._owner = postprocess;
        registerCopyShader();
        this.copyMaterial = new Material();
        this.copyMaterial.setShaderName("FlashFilterCopy2D");
        this.copyMaterial.setVector2("u_centerOffset", new Vector2(0, 0));
        this.copyMaterial.setFloat("u_OwnerAlpha", 1);
        this.copyElement = renderElement(this.copyMaterial);

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
    }

    render(context: PostProcessRenderContext2D): void {
        const source = context.indirectTarget;
        const horizontalMargins = flashBoxKernelMargins(this.options.blurX, this.options.quality);
        const verticalMargins = flashBoxKernelMargins(this.options.blurY, this.options.quality);
        const expanded = context.expandOutputBounds(
            horizontalMargins.before, verticalMargins.before,
            horizontalMargins.after, verticalMargins.after,
        );
        const primary = this.requireTarget("primary", expanded.width, expanded.height, context);
        const secondary = this.requireTarget("secondary", expanded.width, expanded.height, context);

        this.copyMaterial.setTexture("u_MainTex", source);
        this.copyMaterial.setFloat("u_OwnerAlpha", context.takeOwnerAlpha());
        this.copyMaterial.setVector2("u_centerScale", new Vector2(source.width / expanded.width, source.height / expanded.height));
        this.copyMaterial.setVector2("u_centerOffset", new Vector2(
            (expanded.left - expanded.right) / expanded.width,
            (expanded.top - expanded.bottom) / expanded.height,
        ));
        context.command.setRenderTarget(primary, true, Color.CLEAR);
        context.command.drawRenderElement(this.copyElement, Matrix.EMPTY);

        this.horizontalMaterial.setTexture("u_MainTex", primary);
        this.horizontalMaterial.setVector2("u_Direction", new Vector2(1 / expanded.width, 0));
        this.verticalMaterial.setTexture("u_MainTex", secondary);
        // Texture Y is inverted. This sign also preserves even-kernel placement.
        this.verticalMaterial.setVector2("u_Direction", new Vector2(0, -1 / expanded.height));
        for (let pass = 0; pass < this.options.quality; pass++) {
            context.command.setRenderTarget(secondary, true, Color.CLEAR);
            context.command.drawRenderElement(this.horizontalElement, Matrix.EMPTY);
            context.command.setRenderTarget(primary, true, Color.CLEAR);
            context.command.drawRenderElement(this.verticalElement, Matrix.EMPTY);
        }
        context.destination = primary;
    }

    clearRT(context: PostProcessRenderContext2D): void {
        this.recover("secondary", context);
        this.recover("primary", context);
    }

    destroy(): void {
        super.destroy();
        for (const key of ["primary", "secondary"]) {
            const texture = (this as unknown as Record<string, RenderTexture2D>)[key];
            if (texture) RenderTexture2D.recoverToPool(texture);
            (this as unknown as Record<string, RenderTexture2D>)[key] = null;
        }
        this.copyMaterial?.destroy(); this.horizontalMaterial?.destroy(); this.verticalMaterial?.destroy();
        this.copyElement?.destroy(); this.horizontalElement?.destroy(); this.verticalElement?.destroy();
        this.copyMaterial = this.horizontalMaterial = this.verticalMaterial = null;
        this.copyElement = this.horizontalElement = this.verticalElement = null;
    }
}

const SHADOW_SEED_FRAGMENT = `
#define SHADER_NAME FlashShadowSeed2D
${FLASH_TEXTURE_SAMPLING}
varying vec2 v_Texcoord0;
float sourceAlpha(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return FLASH_TEXTURE_2D(u_MainTex, uv).a;
}
void main() {
  float source = sourceAlpha(v_Texcoord0 - u_Offset);
  float alpha = (u_Inner == 1 ? 1.0 - source : source) * u_Color.a;
  gl_FragColor = vec4(u_Color.rgb * alpha, alpha);
}`;

const SHADOW_COMPOSE_FRAGMENT = `
#define SHADER_NAME FlashShadowCompose2D
${FLASH_TEXTURE_SAMPLING}
varying vec2 v_Texcoord0;
void main() {
  vec4 source = FLASH_TEXTURE_2D(u_SourceTex, v_Texcoord0);
  vec4 shadow = clamp(FLASH_TEXTURE_2D(u_ShadowTex, v_Texcoord0) * u_Strength, 0.0, 1.0);
  vec4 result = shadow;
  if (u_Inner == 1) {
    if (u_Knockout == 1 || u_HideObject == 1) result = shadow * source.a;
    else result = shadow * source.a + source * (1.0 - shadow.a);
  } else if (u_Knockout == 1) result = shadow * (1.0 - source.a);
  else if (u_HideObject == 0) result = source + shadow * (1.0 - source.a);
  gl_FragColor = result;
}`;

let shadowShadersRegistered = false;
function registerShadowShaders(): void {
    if (shadowShadersRegistered) return;
    shadowShadersRegistered = true;
    const attributes: Record<string, [number, ShaderDataType]> = { a_PositionTexcoord: [0, ShaderDataType.Vector4] };
    const seed = Shader3D.add("FlashShadowSeed2D");
    seed.shaderType = ShaderFeatureType.PostProcess;
    const seedSub = new SubShader(attributes, {
        u_centerScale: ShaderDataType.Vector2,
        u_MainTex: ShaderDataType.Texture2D,
        u_Offset: ShaderDataType.Vector2,
        u_Color: ShaderDataType.Vector4,
        u_Inner: ShaderDataType.Int,
    });
    seed.addSubShader(seedSub);
    configurePass(seedSub.addShaderPass(FILTER_VERTEX, SHADOW_SEED_FRAGMENT));
    const compose = Shader3D.add("FlashShadowCompose2D");
    compose.shaderType = ShaderFeatureType.PostProcess;
    const composeSub = new SubShader(attributes, {
        u_centerScale: ShaderDataType.Vector2,
        u_SourceTex: ShaderDataType.Texture2D,
        u_ShadowTex: ShaderDataType.Texture2D,
        u_Strength: ShaderDataType.Float,
        u_Inner: ShaderDataType.Int,
        u_Knockout: ShaderDataType.Int,
        u_HideObject: ShaderDataType.Int,
    });
    compose.addSubShader(composeSub);
    configurePass(composeSub.addShaderPass(FILTER_VERTEX, SHADOW_COMPOSE_FRAGMENT));
}

export class FlashShadowEffect2D extends FlashRenderTextureEffect {
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

    readonly options: Readonly<FlashShadowEffectOptions>;

    constructor(options: Readonly<FlashShadowEffectOptions>) {
        super();
        this.options = Object.freeze({
            ...options,
            distance: Number.isFinite(options.distance) ? options.distance : 0,
            angleRadians: Number.isFinite(options.angleRadians) ? options.angleRadians : 0,
            blurX: effectiveBlurDimension(options.blurX),
            blurY: effectiveBlurDimension(options.blurY),
            quality: Number.isFinite(options.quality) ? Math.max(0, Math.min(15, Math.trunc(options.quality))) : 0,
        });
    }

    effectInit(postprocess: PostProcess2D): void {
        this._owner = postprocess;
        registerCopyShader();
        registerShadowShaders();
        this.copyMaterial = new Material();
        this.copyMaterial.setShaderName("FlashFilterCopy2D");
        this.copyMaterial.setVector2("u_centerOffset", new Vector2(0, 0));
        this.copyMaterial.setFloat("u_OwnerAlpha", 1);
        this.copyElement = renderElement(this.copyMaterial);
        this.seedMaterial = new Material();
        this.seedMaterial.setShaderName("FlashShadowSeed2D");
        this.seedMaterial.setVector2("u_centerScale", new Vector2(1, 1));
        this.seedMaterial.setInt("u_Inner", this.options.inner ? 1 : 0);
        this.seedMaterial.setVector4("u_Color", new Vector4(
            (this.options.color >> 16 & 255) / 255,
            (this.options.color >> 8 & 255) / 255,
            (this.options.color & 255) / 255,
            this.options.alpha,
        ));
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
        this.composeMaterial.setShaderName("FlashShadowCompose2D");
        this.composeMaterial.setVector2("u_centerScale", new Vector2(1, 1));
        this.composeMaterial.setFloat("u_Strength", this.options.strength);
        this.composeMaterial.setInt("u_Inner", this.options.inner ? 1 : 0);
        this.composeMaterial.setInt("u_Knockout", this.options.knockout ? 1 : 0);
        this.composeMaterial.setInt("u_HideObject", this.options.hideObject ? 1 : 0);
        this.composeMaterial.lock = true;
        this.composeElement = renderElement(this.composeMaterial);
    }

    render(context: PostProcessRenderContext2D): void {
        const source = context.indirectTarget;
        const offset = effectiveOffset(this.options.distance, this.options.angleRadians);
        const offsetX = offset.x;
        const offsetY = offset.y;
        const horizontalMargins = flashBoxKernelMargins(this.options.blurX, this.options.quality);
        const verticalMargins = flashBoxKernelMargins(this.options.blurY, this.options.quality);
        const expanded = context.expandOutputBounds(
            horizontalMargins.before + Math.max(0, -offsetX),
            verticalMargins.before + Math.max(0, -offsetY),
            horizontalMargins.after + Math.max(0, offsetX),
            verticalMargins.after + Math.max(0, offsetY),
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
        this.composeMaterial.setTexture("u_ShadowTex", primary);
        context.command.setRenderTarget(output, true, Color.CLEAR);
        context.command.drawRenderElement(this.composeElement, Matrix.EMPTY);
        context.destination = output;
    }

    clearRT(context: PostProcessRenderContext2D): void {
        for (const key of ["original", "primary", "secondary", "output"]) this.recover(key, context);
    }

    destroy(): void {
        super.destroy();
        for (const key of ["original", "primary", "secondary", "output"]) {
            const texture = (this as unknown as Record<string, RenderTexture2D>)[key];
            if (texture) RenderTexture2D.recoverToPool(texture);
            (this as unknown as Record<string, RenderTexture2D>)[key] = null;
        }
        for (const material of [this.copyMaterial, this.seedMaterial, this.horizontalMaterial, this.verticalMaterial, this.composeMaterial]) material?.destroy();
        for (const element of [this.copyElement, this.seedElement, this.horizontalElement, this.verticalElement, this.composeElement]) element?.destroy();
        this.copyMaterial = this.seedMaterial = this.horizontalMaterial = this.verticalMaterial = this.composeMaterial = null;
        this.copyElement = this.seedElement = this.horizontalElement = this.verticalElement = this.composeElement = null;
    }
}

const COLOR_MATRIX_FRAGMENT = `
#define SHADER_NAME FlashStraightColorMatrix2D
${FLASH_TEXTURE_SAMPLING}
#include "Color.glsl"
#include "OutputTransform.glsl";
varying vec2 v_Texcoord0;
void main() {
  vec4 premultiplied = FLASH_TEXTURE_2D(u_MainTex, v_Texcoord0) * u_OwnerAlpha;
  vec4 straight = vec4(premultiplied.a > 0.000001 ? premultiplied.rgb / premultiplied.a : vec3(0.0), premultiplied.a);
  vec4 transformed = vec4(dot(straight, u_RowR), dot(straight, u_RowG), dot(straight, u_RowB), dot(straight, u_RowA)) + u_Offsets / 255.0;
  transformed = clamp(transformed, 0.0, 1.0);
  gl_FragColor = outputTransform(vec4(transformed.rgb * transformed.a, transformed.a));
}`;

let colorMatrixShaderRegistered = false;
function registerColorMatrixShader(): void {
    if (colorMatrixShaderRegistered) return;
    colorMatrixShaderRegistered = true;
    const shader = Shader3D.add("FlashStraightColorMatrix2D");
    shader.shaderType = ShaderFeatureType.PostProcess;
    const subShader = new SubShader(
        { a_PositionTexcoord: [0, ShaderDataType.Vector4] },
        {
            u_centerScale: ShaderDataType.Vector2,
            u_MainTex: ShaderDataType.Texture2D,
            u_OwnerAlpha: ShaderDataType.Float,
            u_RowR: ShaderDataType.Vector4,
            u_RowG: ShaderDataType.Vector4,
            u_RowB: ShaderDataType.Vector4,
            u_RowA: ShaderDataType.Vector4,
            u_Offsets: ShaderDataType.Vector4,
        },
    );
    shader.addSubShader(subShader);
    configurePass(subShader.addShaderPass(FILTER_VERTEX, COLOR_MATRIX_FRAGMENT));
}

export class FlashColorMatrixEffect2D extends FlashRenderTextureEffect {
    override readonly ownsOwnerAlpha = true;
    private material: Material;
    private element: IRenderElement2D;
    private destination: RenderTexture2D;

    constructor(readonly matrix: readonly number[]) {
        super();
        if (matrix.length !== 20) throw new TypeError("Flash color matrix must contain exactly 20 values");
    }

    effectInit(postprocess: PostProcess2D): void {
        this._owner = postprocess;
        registerColorMatrixShader();
        this.material = new Material();
        this.material.setShaderName("FlashStraightColorMatrix2D");
        this.material.setVector2("u_centerScale", new Vector2(1, 1));
        this.material.setFloat("u_OwnerAlpha", 1);
        this.material.setVector4("u_RowR", new Vector4(this.matrix[0], this.matrix[1], this.matrix[2], this.matrix[3]));
        this.material.setVector4("u_RowG", new Vector4(this.matrix[5], this.matrix[6], this.matrix[7], this.matrix[8]));
        this.material.setVector4("u_RowB", new Vector4(this.matrix[10], this.matrix[11], this.matrix[12], this.matrix[13]));
        this.material.setVector4("u_RowA", new Vector4(this.matrix[15], this.matrix[16], this.matrix[17], this.matrix[18]));
        this.material.setVector4("u_Offsets", new Vector4(this.matrix[4], this.matrix[9], this.matrix[14], this.matrix[19]));
        this.material.lock = true;
        this.element = renderElement(this.material);
    }

    render(context: PostProcessRenderContext2D): void {
        const source = context.indirectTarget;
        const destination = this.requireTarget("destination", source.width, source.height, context);
        this.material.setTexture("u_MainTex", source);
        this.material.setFloat("u_OwnerAlpha", context.takeOwnerAlpha());
        context.command.setRenderTarget(destination, true, Color.CLEAR);
        context.command.drawRenderElement(this.element, Matrix.EMPTY);
        context.destination = destination;
    }

    clearRT(context: PostProcessRenderContext2D): void { this.recover("destination", context); }

    destroy(): void {
        super.destroy();
        if (this.destination) RenderTexture2D.recoverToPool(this.destination);
        this.destination = null;
        this.material?.destroy(); this.element?.destroy();
        this.material = null; this.element = null;
    }
}

export interface FlashRgba { r: number; g: number; b: number; a: number; }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

/** Straight-RGBA CPU oracle for the exact 4x5 shader, including alpha terms. */
export function applyFlashColorMatrixPixel(pixel: Readonly<FlashRgba>, matrix: readonly number[]): FlashRgba {
    if (matrix.length !== 20) throw new TypeError("Flash color matrix must contain exactly 20 values");
    const input = [pixel.r, pixel.g, pixel.b, pixel.a];
    const channel = (row: number): number => clamp01(
        matrix[row * 5] * input[0]
        + matrix[row * 5 + 1] * input[1]
        + matrix[row * 5 + 2] * input[2]
        + matrix[row * 5 + 3] * input[3]
        + matrix[row * 5 + 4] / 255,
    );
    return { r: channel(0), g: channel(1), b: channel(2), a: channel(3) };
}

/** CPU tap positions shared by pixel tests and the generated GPU kernel. */
export function flashBoxKernelOffsets(size: number): readonly number[] {
    const taps = Math.max(1, Math.round(size));
    const first = -Math.floor(taps / 2);
    return Object.freeze(Array.from({ length: taps }, (_, index) => first + index));
}
