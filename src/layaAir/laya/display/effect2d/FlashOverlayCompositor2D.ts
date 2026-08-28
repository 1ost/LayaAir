import { IRenderContext2D } from "../../RenderDriver/DriverDesign/2DRenderPass/IRenderContext2D";
import { ShaderDataType } from "../../RenderDriver/DriverDesign/RenderDevice/ShaderData";
import { RenderState } from "../../RenderDriver/RenderModuleData/Design/RenderState";
import { RenderTargetFormat } from "../../RenderEngine/RenderEnum/RenderTargetFormat";
import { Shader3D, ShaderFeatureType } from "../../RenderEngine/RenderShader/Shader3D";
import { SubShader } from "../../RenderEngine/RenderShader/SubShader";
import { Vector4 } from "../../maths/Vector4";
import { Material } from "../../resource/Material";
import { RenderTexture2D } from "../../resource/RenderTexture2D";
import { Shader2D } from "../../webgl/shader/d2/Shader2D";
import { ITextureCompositor2D } from "../ITextureCompositor2D";

const FLASH_OVERLAY_VERTEX = `
#define SHADER_NAME FlashOverlayCompositor2D
#include "Sprite2DVertex.glsl";
void main() {
    vertexInfo info;
    getVertexInfo(info);
    v_texcoordAlpha = info.texcoordAlpha;
    v_color = info.color;
    v_useTex = info.useTex;
    v_useClip = info.useClip;
    v_customs = info.customs;
    gl_Position = getPosition(info.pos);
}`;

const FLASH_OVERLAY_FRAGMENT = `
#define SHADER_NAME FlashOverlayCompositor2D
#if defined(GL_FRAGMENT_PRECISION_HIGH)
precision highp float;
#else
precision mediump float;
#endif
#include "Sprite2DFrag.glsl";

vec3 flashOverlay(vec3 backdrop, vec3 source) {
    vec3 low = 2.0 * backdrop * source;
    vec3 high = 1.0 - 2.0 * (1.0 - backdrop) * (1.0 - source);
    return mix(low, high, step(vec3(0.5), backdrop));
}

void main() {
    clip();
    vec4 source = getSpriteTextureColor();
    float useTex = step(1.0, v_useTex);
    source = source * useTex + (1.0 - useTex);
#ifdef UV_CLIP_GPU
    if (v_useClip >= 1.0) {
        vec2 uv = v_texcoordAlpha.xy;
        vec4 bounds = v_customs;
        if (uv.x < bounds.x || uv.x > bounds.x + bounds.z || uv.y < bounds.y || uv.y > bounds.y + bounds.w)
            discard;
    }
#endif
    source.a *= v_color.w;
    vec4 vertexColor = v_color;
#ifndef GAMMASPACE
    vertexColor = gammaToLinear(v_color);
#endif
    source.rgb *= vertexColor.rgb;

    vec2 backdropUv = (gl_FragCoord.xy - u_OverlayViewport.xy) / u_OverlayViewport.zw;
    vec4 backdrop = transspaceColor(texture2D(u_OverlayBackdrop, backdropUv));
    vec3 sourceStraight = source.a > 0.0 ? source.rgb / source.a : vec3(0.0);
    vec3 backdropStraight = backdrop.a > 0.0 ? backdrop.rgb / backdrop.a : vec3(0.0);
    vec3 blended = flashOverlay(backdropStraight, sourceStraight);
    gl_FragColor = vec4(
        source.rgb * (1.0 - backdrop.a)
            + backdrop.rgb * (1.0 - source.a)
            + blended * source.a * backdrop.a,
        source.a + backdrop.a - source.a * backdrop.a
    );
}`;

let registered = false;

function registerFlashOverlayShader(): void {
    if (registered) return;
    const shader = Shader3D.add("FlashOverlayCompositor2D", false, false);
    shader.shaderType = ShaderFeatureType.D2_TextureSV;
    const subShader = new SubShader(Shader2D.graphicsAttribute, {
        u_OverlayBackdrop: ShaderDataType.Texture2D,
        u_OverlayViewport: ShaderDataType.Vector4,
    });
    shader.addSubShader(subShader);
    const pass = subShader.addShaderPass(FLASH_OVERLAY_VERTEX, FLASH_OVERLAY_FRAGMENT);
    pass.statefirst = true;
    pass.renderState.depthWrite = false;
    pass.renderState.depthTest = RenderState.DEPTHTEST_OFF;
    // The fragment shader returns the complete premultiplied SrcOver result,
    // including the captured backdrop. A second fixed-function blend would
    // apply backdrop alpha twice.
    pass.renderState.blend = RenderState.BLEND_DISABLE;
    pass.renderState.cull = RenderState.CULL_NONE;
    registered = true;
}

/**
 * Premultiplied-alpha reference implementation of Flash blend mode 13.
 * Kept public so exact CPU pixel receipts can authenticate the GPU equation.
 */
export function flashOverlayPremultipliedPixel(
    source: readonly [number, number, number, number],
    backdrop: readonly [number, number, number, number],
): [number, number, number, number] {
    const sourceAlpha = source[3];
    const backdropAlpha = backdrop[3];
    const output: [number, number, number, number] = [0, 0, 0, sourceAlpha + backdropAlpha - sourceAlpha * backdropAlpha];
    for (let channel = 0; channel < 3; channel++) {
        const sourceStraight = sourceAlpha > 0 ? source[channel] / sourceAlpha : 0;
        const backdropStraight = backdropAlpha > 0 ? backdrop[channel] / backdropAlpha : 0;
        const blended = backdropStraight < 0.5
            ? 2 * backdropStraight * sourceStraight
            : 1 - 2 * (1 - backdropStraight) * (1 - sourceStraight);
        output[channel] = source[channel] * (1 - backdropAlpha)
            + backdrop[channel] * (1 - sourceAlpha)
            + blended * sourceAlpha * backdropAlpha;
    }
    return output;
}

/** Captures the active 2D target and composites one Sprite with Flash overlay. */
export class FlashOverlayCompositor2D implements ITextureCompositor2D {
    private _material: Material;
    private backdrop: RenderTexture2D;
    private readonly viewport = new Vector4();

    get material(): Material {
        if (!this._material) {
            registerFlashOverlayShader();
            this._material = new Material();
            this._material.setShaderName("FlashOverlayCompositor2D");
            this._material.lock = true;
        }
        return this._material;
    }

    beforeComposite(context: IRenderContext2D): void {
        const target = context.getRenderTarget();
        context.getOffscreenView(this.viewport);
        const targetTexture = target?._texturesResolve?.[0] ?? target?._textures[0];
        const sourceX = targetTexture ? 0 : Math.max(0, Math.floor(this.viewport.x));
        const sourceY = targetTexture ? 0 : Math.max(0, Math.floor(this.viewport.y));
        const width = Math.max(1, Math.floor(targetTexture?.width ?? this.viewport.z));
        const height = Math.max(1, Math.floor(targetTexture?.height ?? this.viewport.w));
        const format = context.getCurrentTargetColorFormat();
        this.requireBackdrop(width, height, format);
        context.copyCurrentTargetToTexture(this.backdrop._texture, width, height, sourceX, sourceY);
        this.viewport.setValue(sourceX, sourceY, width, height);
        this.material.setTexture("u_OverlayBackdrop", this.backdrop);
        this.material.setVector4("u_OverlayViewport", this.viewport);
    }

    destroy(): void {
        if (this.backdrop && !this.backdrop._inPool) RenderTexture2D.recoverToPool(this.backdrop);
        this.backdrop = null;
        this._material?.destroy();
        this._material = null;
    }

    private requireBackdrop(width: number, height: number, format: RenderTargetFormat): void {
        if (this.backdrop && (this.backdrop._inPool || this.backdrop.destroyed
            || this.backdrop.width !== width || this.backdrop.height !== height
            || this.backdrop.getColorFormat() !== format)) {
            if (!this.backdrop._inPool) RenderTexture2D.recoverToPool(this.backdrop);
            this.backdrop = null;
        }
        if (!this.backdrop)
            this.backdrop = RenderTexture2D.createFromPool(width, height, format, RenderTargetFormat.None);
    }
}
