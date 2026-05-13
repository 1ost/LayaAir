import { LayaGL } from "../../layagl/LayaGL";
import { Color } from "../../maths/Color";
import { Matrix } from "../../maths/Matrix";
import { Vector2 } from "../../maths/Vector2";
import { Vector4 } from "../../maths/Vector4";
import { IRenderElement2D } from "../../RenderDriver/DriverDesign/2DRenderPass/IRenderElement2D";
import { RenderTargetFormat } from "../../RenderEngine/RenderEnum/RenderTargetFormat";
import { Material } from "../../resource/Material";
import { RenderTexture2D } from "../../resource/RenderTexture2D";
import { ClassUtils } from "../../utils/ClassUtils";
import { ColorUtils } from "../../utils/ColorUtils";
import { PostProcess2D, PostProcessRenderContext2D } from "../PostProcess2D";
import { PostProcess2DEffect } from "../PostProcess2DEffect";
import { Blit2DCMD } from "../Scene2DSpecial/RenderCMD2D/Blit2DCMD";

export type FlashGradientFilterMode = "gradientGlow" | "gradientBevel" | "bevel";

export interface FlashGradientFilterOptions {
    mode: FlashGradientFilterMode;
    colors?: string[];
    ratios?: number[];
    highlightColor?: string;
    shadowColor?: string;
    blurX?: number;
    blurY?: number;
    angle?: number;
    distance?: number;
    strength?: number;
    inner?: boolean;
    knockout?: boolean;
    onTop?: boolean;
    compositeSource?: boolean;
}

export class FlashGradientFilterEffect2D extends PostProcess2DEffect {
    private _blitElement: IRenderElement2D;
    private _blitmat: Material;
    private _filterElement: IRenderElement2D;
    private _filterMat: Material;
    private _blitExtendRT: RenderTexture2D;
    private _destRT: RenderTexture2D;
    private _centerScale: Vector2 = new Vector2();
    private _filterInfo1: Vector4 = new Vector4(4, 4, 1, 1);
    private _filterInfo2: Vector4 = new Vector4(0, 0, 1, 0);
    private _filterFlags: Vector4 = new Vector4(0, 0, 0, 1);
    private _gradientRatios0: Vector4 = new Vector4(0, 1, 1, 1);
    private _gradientRatios1: Vector4 = new Vector4(1, 1, 0, 0);
    private _gradientInfo: Vector4 = new Vector4(2, 0, 0, 0);
    private _gradientColors: Vector4[] = [
        new Vector4(0, 0, 0, 0),
        new Vector4(1, 1, 1, 1),
        new Vector4(1, 1, 1, 1),
        new Vector4(1, 1, 1, 1),
        new Vector4(1, 1, 1, 1),
        new Vector4(1, 1, 1, 1),
    ];
    private _highlightColor: Vector4 = new Vector4(1, 1, 1, 1);
    private _shadowColor: Vector4 = new Vector4(0, 0, 0, 1);

    constructor(options: FlashGradientFilterOptions) {
        super();
        this.setOptions(options);
    }

    setOptions(options: FlashGradientFilterOptions): void {
        this.mode = options.mode;
        this.blurX = options.blurX ?? 4;
        this.blurY = options.blurY ?? options.blurX ?? 4;
        this.angle = options.angle ?? 0;
        this.distance = options.distance ?? 0;
        this.strength = options.strength ?? 1;
        this.inner = options.inner ?? false;
        this.knockout = options.knockout ?? false;
        this.onTop = options.onTop ?? false;
        this.compositeSource = options.compositeSource ?? true;
        this.setGradient(options.colors ?? ["rgba(0,0,0,0)", "#ffffff"], options.ratios ?? [0, 255]);
        this.setBevelColors(options.highlightColor ?? "#ffffff", options.shadowColor ?? "#000000");
    }

    get mode(): FlashGradientFilterMode {
        if (this._filterInfo2.w === 1) return "gradientBevel";
        if (this._filterInfo2.w === 2) return "bevel";
        return "gradientGlow";
    }

    set mode(value: FlashGradientFilterMode) {
        this._filterInfo2.w = value === "gradientBevel" ? 1 : value === "bevel" ? 2 : 0;
        this._syncVector("u_filterInfo2", this._filterInfo2);
    }

    get blurX(): number {
        return this._filterInfo1.x;
    }

    set blurX(value: number) {
        this._filterInfo1.x = Math.max(0, Number(value) || 0);
        this._syncVector("u_filterInfo1", this._filterInfo1);
    }

    get blurY(): number {
        return this._filterInfo1.y;
    }

    set blurY(value: number) {
        this._filterInfo1.y = Math.max(0, Number(value) || 0);
        this._syncVector("u_filterInfo1", this._filterInfo1);
    }

    get angle(): number {
        return this._filterInfo2.x;
    }

    set angle(value: number) {
        this._filterInfo2.x = Number(value) || 0;
        this._syncVector("u_filterInfo2", this._filterInfo2);
    }

    get distance(): number {
        return this._filterInfo2.y;
    }

    set distance(value: number) {
        this._filterInfo2.y = Number(value) || 0;
        this._syncVector("u_filterInfo2", this._filterInfo2);
    }

    get strength(): number {
        return this._filterInfo2.z;
    }

    set strength(value: number) {
        this._filterInfo2.z = Math.max(0, Number(value) || 0);
        this._syncVector("u_filterInfo2", this._filterInfo2);
    }

    get inner(): boolean {
        return this._filterFlags.x > 0.5;
    }

    set inner(value: boolean) {
        this._filterFlags.x = value ? 1 : 0;
        this._syncVector("u_filterFlags", this._filterFlags);
    }

    get knockout(): boolean {
        return this._filterFlags.y > 0.5;
    }

    set knockout(value: boolean) {
        this._filterFlags.y = value ? 1 : 0;
        this._syncVector("u_filterFlags", this._filterFlags);
    }

    get onTop(): boolean {
        return this._filterFlags.z > 0.5;
    }

    set onTop(value: boolean) {
        this._filterFlags.z = value ? 1 : 0;
        this._syncVector("u_filterFlags", this._filterFlags);
    }

    get compositeSource(): boolean {
        return this._filterFlags.w > 0.5;
    }

    set compositeSource(value: boolean) {
        this._filterFlags.w = value ? 1 : 0;
        this._syncVector("u_filterFlags", this._filterFlags);
    }

    setGradient(colors: string[], ratios: number[]): void {
        const count = Math.max(1, Math.min(6, colors.length));
        this._gradientInfo.x = count;
        for (let i = 0; i < 6; i++) {
            const color = colors[Math.min(i, count - 1)] ?? "#000000";
            this._colorToVector(color, this._gradientColors[i]);
        }
        const normalized = ratios.length > 0 ? ratios : [0, 255];
        this._gradientRatios0.setValue(
            this._ratioAt(normalized, 0, count),
            this._ratioAt(normalized, 1, count),
            this._ratioAt(normalized, 2, count),
            this._ratioAt(normalized, 3, count),
        );
        this._gradientRatios1.setValue(
            this._ratioAt(normalized, 4, count),
            this._ratioAt(normalized, 5, count),
            0,
            0,
        );
        this._syncGradient();
    }

    setBevelColors(highlightColor: string, shadowColor: string): void {
        this._colorToVector(highlightColor, this._highlightColor);
        this._colorToVector(shadowColor, this._shadowColor);
        this._syncVector("u_highlightColor", this._highlightColor);
        this._syncVector("u_shadowColor", this._shadowColor);
    }

    effectInit(postprocess: PostProcess2D): void {
        this._owner = postprocess;
        if (!this._blitmat) {
            this._blitmat = new Material();
            this._blitmat.lock = true;
            this._blitmat.setShaderName("ColorEffect2D");
        }
        if (!this._blitElement) {
            this._blitElement = LayaGL.render2DRenderPassFactory.createRenderElement2D();
            this._blitElement.geometry = Blit2DCMD.InvertQuadGeometry;
            this._blitElement.nodeCommonMap = null;
            this._blitElement.renderStateIsBySprite = false;
            this._blitElement.materialShaderData = this._blitmat.shaderData;
            this._blitElement.subShader = this._blitmat.shader.getSubShaderAt(0);
        }

        if (!this._filterMat) {
            this._filterMat = new Material();
            this._filterMat.setShaderName("FlashGradientFilter2D");
            this._filterMat.lock = true;
        }
        if (!this._filterElement) {
            this._filterElement = LayaGL.render2DRenderPassFactory.createRenderElement2D();
            this._filterElement.geometry = Blit2DCMD.InvertQuadGeometry;
            this._filterElement.nodeCommonMap = null;
            this._filterElement.renderStateIsBySprite = false;
            this._filterElement.materialShaderData = this._filterMat.shaderData;
            this._filterElement.subShader = this._filterMat.shader.getSubShaderAt(0);
        }
        this._syncAll();
    }

    render(context: PostProcessRenderContext2D): void {
        const marginLeft = Math.ceil(Math.max(this.blurX, this.distance, 50));
        const marginTop = Math.ceil(Math.max(this.blurY, this.distance, 50));
        const width = context.indirectTarget.width;
        const height = context.indirectTarget.height;
        const texwidth = width + 2 * marginLeft;
        const texheight = height + 2 * marginTop;
        this._checkRenderTarget(texwidth, texheight, context);

        this._blitmat.setTexture("u_MainTex", context.indirectTarget);
        this._centerScale.setValue(width / texwidth, height / texheight);
        this._blitmat.setVector2("u_centerScale", this._centerScale);
        context.command.setRenderTarget(this._blitExtendRT, true, Color.CLEAR);
        context.command.drawRenderElement(this._blitElement, Matrix.EMPTY);

        this._filterInfo1.z = texwidth;
        this._filterInfo1.w = texheight;
        this._filterMat.setVector4("u_filterInfo1", this._filterInfo1);
        this._filterMat.setTexture("u_MainTex", this._blitExtendRT);
        this._filterMat.setVector2("u_centerScale", Vector2.ONE);
        context.command.setRenderTarget(this._destRT, true, Color.CLEAR);
        context.command.drawRenderElement(this._filterElement, Matrix.EMPTY);
        context.destination = this._destRT;
    }

    clearRT(context: PostProcessRenderContext2D): void {
        if (this._blitExtendRT && this._blitExtendRT !== context.destination) {
            RenderTexture2D.recoverToPool(this._blitExtendRT);
            this._blitExtendRT = null;
        }
        if (this._destRT && this._destRT !== context.destination) {
            RenderTexture2D.recoverToPool(this._destRT);
            this._destRT = null;
        }
    }

    destroy(): void {
        super.destroy();
        if (this._destRT) RenderTexture2D.recoverToPool(this._destRT);
        if (this._blitExtendRT) RenderTexture2D.recoverToPool(this._blitExtendRT);
        this._destRT = null;
        this._blitExtendRT = null;
        this._blitmat?.destroy();
        this._filterMat?.destroy();
        this._blitElement?.destroy();
        this._filterElement?.destroy();
        this._blitmat = null;
        this._filterMat = null;
        this._blitElement = null;
        this._filterElement = null;
    }

    private _ratioAt(ratios: number[], index: number, count: number): number {
        if (index >= count) return 1;
        const value = ratios[Math.min(index, ratios.length - 1)] ?? 255;
        return Math.max(0, Math.min(1, Number(value) / 255));
    }

    private _colorToVector(color: string, out: Vector4): void {
        out.fromArray(ColorUtils.create(color || "#000000").arrColor);
    }

    private _syncVector(name: string, value: Vector4): void {
        if (this._filterMat) this._filterMat.setVector4(name, value);
        this._owner && this._owner._onChangeRender();
    }

    private _syncGradient(): void {
        if (!this._filterMat) return;
        this._filterMat.setVector4("u_gradientInfo", this._gradientInfo);
        this._filterMat.setVector4("u_gradientRatios0", this._gradientRatios0);
        this._filterMat.setVector4("u_gradientRatios1", this._gradientRatios1);
        for (let i = 0; i < 6; i++) {
            this._filterMat.setVector4(`u_gradientColor${i}`, this._gradientColors[i]);
        }
        this._owner && this._owner._onChangeRender();
    }

    private _syncAll(): void {
        this._syncVector("u_filterInfo1", this._filterInfo1);
        this._syncVector("u_filterInfo2", this._filterInfo2);
        this._syncVector("u_filterFlags", this._filterFlags);
        this._syncVector("u_highlightColor", this._highlightColor);
        this._syncVector("u_shadowColor", this._shadowColor);
        this._syncGradient();
    }

    private _checkRenderTarget(width: number, height: number, context: PostProcessRenderContext2D): void {
        if (this._destRT && (this._destRT._inPool || this._destRT.destroyed || this._destRT.width !== width || this._destRT.height !== height)) {
            RenderTexture2D.recoverToPool(this._destRT);
            this._destRT = null;
        }
        if (this._blitExtendRT && (this._blitExtendRT._inPool || this._blitExtendRT.destroyed || this._blitExtendRT.width !== width || this._blitExtendRT.height !== height)) {
            RenderTexture2D.recoverToPool(this._blitExtendRT);
            this._blitExtendRT = null;
        }
        if (!this._destRT) {
            this._destRT = context.getRenderTexture(width, height, RenderTargetFormat.R8G8B8A8, RenderTargetFormat.None);
        }
        if (!this._blitExtendRT) {
            this._blitExtendRT = context.getRenderTexture(width, height, RenderTargetFormat.R8G8B8A8, RenderTargetFormat.None);
        }
    }
}

ClassUtils.regClass("FlashGradientFilterEffect2D", FlashGradientFilterEffect2D);
