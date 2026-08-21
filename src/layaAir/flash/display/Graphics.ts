import { Graphics as LayaGraphics } from "../../laya/display/Graphics";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";
import { isFlashMatrix, Matrix } from "../geom/Matrix";

interface SolidPaint { readonly kind: "solid"; readonly color: string; readonly argb: number; }
interface GradientPaint {
    readonly kind: "linear-gradient";
    readonly colors: readonly number[];
    readonly alphas: readonly number[];
    readonly ratios: readonly number[];
    readonly matrix: Readonly<{ a: number; b: number; c: number; d: number; tx: number; ty: number }>;
}
type Paint = SolidPaint | GradientPaint;
interface Stroke extends SolidPaint { readonly thickness: number; }

/** @internal CPU-readable record shared with BitmapData.draw. */
export interface FlashGraphicsRasterCommand {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly fill: Paint;
}

const GRAPHICS_VALUES = new WeakSet<object>();
const GRAPHICS_RASTER_COMMANDS = new WeakMap<Graphics, FlashGraphicsRasterCommand[]>();

/** @internal Read-only nominal proof for canonical Flash graphics values. */
export function isFlashGraphics(value: unknown): value is Graphics {
    return typeof value === "object" && value !== null && GRAPHICS_VALUES.has(value);
}

/** @internal Authenticated retained vector records for synchronous BitmapData rasterization. */
export function flashGraphicsRasterCommands(value: Graphics): readonly FlashGraphicsRasterCommand[] {
    if (!isFlashGraphics(value)) throw new TypeError("value must be flash.display.Graphics");
    return GRAPHICS_RASTER_COMMANDS.get(value)!;
}

function finite(value: number, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new TypeError(`${label} must be finite`);
    return value;
}

function paint(color: number, alpha: number, label: string): SolidPaint {
    if (typeof color !== "number" || !Number.isFinite(color))
        throw new TypeError(`${label}.color must be finite`);
    finite(alpha, `${label}.alpha`);
    const rgb = color >>> 0;
    const red = rgb >>> 16 & 0xFF;
    const green = rgb >>> 8 & 0xFF;
    const blue = rgb & 0xFF;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    return {
        kind: "solid",
        color: `rgba(${red},${green},${blue},${clampedAlpha})`,
        argb: ((Math.round(clampedAlpha * 255) << 24) | (rgb & 0x00ffffff)) >>> 0,
    };
}

function gradientValues(values: readonly number[] | undefined, label: string): number[] {
    if (!Array.isArray(values)) throw new TypeError(`${label} must be an Array`);
    return values.map((value, index) => finite(value, `${label}[${index}]`));
}

function gradientPaint(type: string | undefined, colors: readonly number[] | undefined,
    alphas: readonly number[] | undefined, ratios: readonly number[] | undefined,
    matrix: unknown, spreadMethod: string, interpolationMethod: string,
    focalPointRatio: number): GradientPaint {
    if (type !== "linear")
        throw new UnsupportedFlashFeatureError("flash.display.Graphics.beginGradientFill.type",
            "the admitted retained bridge currently supports linear gradients");
    if (spreadMethod !== "pad" || interpolationMethod !== "rgb" || focalPointRatio !== 0)
        throw new UnsupportedFlashFeatureError("flash.display.Graphics.beginGradientFill.options",
            "repeat/reflect, linearRGB and focal gradients require their dedicated raster workpacks");
    const normalizedColors = gradientValues(colors, "Graphics.beginGradientFill.colors").map(value => value >>> 0);
    const normalizedAlphas = gradientValues(alphas, "Graphics.beginGradientFill.alphas")
        .map(value => Math.max(0, Math.min(1, value)));
    const normalizedRatios = gradientValues(ratios, "Graphics.beginGradientFill.ratios")
        .map(value => Math.max(0, Math.min(255, value >>> 0)));
    if (normalizedColors.length < 2 || normalizedColors.length !== normalizedAlphas.length ||
        normalizedColors.length !== normalizedRatios.length)
        throw new RangeError("Graphics.beginGradientFill arrays must have the same length of at least two");
    for (let index = 1; index < normalizedRatios.length; index++)
        if (normalizedRatios[index] < normalizedRatios[index - 1])
            throw new RangeError("Graphics.beginGradientFill.ratios must be ordered");
    const source = matrix === null ? new Matrix() : matrix;
    if (!isFlashMatrix(source)) throw new TypeError("Graphics.beginGradientFill.matrix must be a Matrix or null");
    const snapshot = Object.freeze({
        a: source.a, b: source.b, c: source.c, d: source.d, tx: source.tx, ty: source.ty,
    });
    if (!Number.isFinite(snapshot.a) || !Number.isFinite(snapshot.b) || !Number.isFinite(snapshot.c) ||
        !Number.isFinite(snapshot.d) || !Number.isFinite(snapshot.tx) || !Number.isFinite(snapshot.ty) ||
        snapshot.a * snapshot.d - snapshot.b * snapshot.c === 0)
        throw new RangeError("Graphics.beginGradientFill.matrix must be finite and invertible");
    return Object.freeze({
        kind: "linear-gradient", colors: Object.freeze(normalizedColors),
        alphas: Object.freeze(normalizedAlphas), ratios: Object.freeze(normalizedRatios), matrix: snapshot,
    });
}

/** @internal Sample a retained Flash fill as straight ARGB. */
export function sampleFlashGraphicsFill(fill: Paint, x: number, y: number): number {
    if (fill.kind === "solid") return fill.argb;
    const matrix = fill.matrix;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    const gradientX = (matrix.d * (x - matrix.tx) - matrix.c * (y - matrix.ty)) / determinant;
    const ratio = Math.max(0, Math.min(255, (gradientX + 819.2) * 255 / 1638.4));
    let upper = 1;
    while (upper < fill.ratios.length && ratio > fill.ratios[upper]) upper++;
    if (upper >= fill.ratios.length) upper = fill.ratios.length - 1;
    const lower = Math.max(0, upper - 1);
    const span = fill.ratios[upper] - fill.ratios[lower];
    const amount = span === 0 ? 1 : Math.max(0, Math.min(1, (ratio - fill.ratios[lower]) / span));
    const from = fill.colors[lower], to = fill.colors[upper];
    const channel = (shift: number): number => Math.round(
        ((from >>> shift) & 0xff) + (((to >>> shift) & 0xff) - ((from >>> shift) & 0xff)) * amount);
    const alpha = Math.round((fill.alphas[lower] + (fill.alphas[upper] - fill.alphas[lower]) * amount) * 255);
    return ((alpha << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)) >>> 0;
}

function argbCss(value: number): string {
    return `rgba(${value >>> 16 & 0xff},${value >>> 8 & 0xff},${value & 0xff},${(value >>> 24) / 255})`;
}

/**
 * Flash's stateful vector API projected onto Laya's native command stream.
 * Native five-argument drawRect calls remain available for engine consumers;
 * source-shaped four-argument calls use the active Flash fill and stroke.
 */
export class Graphics extends LayaGraphics {
    private _fill: Paint | null = null;
    private _stroke: Stroke | null = null;
    private _cursorX = 0;
    private _cursorY = 0;
    private _path: number[] | null = null;

    constructor() {
        super();
        GRAPHICS_VALUES.add(this);
        GRAPHICS_RASTER_COMMANDS.set(this, []);
    }

    beginFill(color: number, alpha = 1): void {
        this._flushPath();
        this._fill = paint(color, alpha, "Graphics.beginFill");
    }

    beginGradientFill(
        type?: string, colors?: readonly number[], alphas?: readonly number[],
        ratios?: readonly number[], matrix: unknown = null, spreadMethod = "pad",
        interpolationMethod = "rgb", focalPointRatio = 0
    ): void {
        this._flushPath();
        this._fill = gradientPaint(type, colors, alphas, ratios, matrix,
            spreadMethod, interpolationMethod, finite(focalPointRatio, "Graphics.beginGradientFill.focalPointRatio"));
    }

    endFill(): void {
        this._flushPath();
        this._fill = null;
    }

    lineStyle(
        thickness: number = Number.NaN, color = 0, alpha = 1,
        pixelHinting = false, scaleMode = "normal", caps: string | null = null,
        joints: string | null = null, miterLimit = 3
    ): void {
        this._flushPath();
        if (Number.isNaN(thickness)) {
            this._stroke = null;
            return;
        }
        finite(thickness, "Graphics.lineStyle.thickness");
        finite(miterLimit, "Graphics.lineStyle.miterLimit");
        if (thickness < 0) throw new RangeError("Graphics.lineStyle.thickness must be nonnegative");
        if (scaleMode !== "normal" || caps !== null || joints !== null || miterLimit !== 3)
            throw new UnsupportedFlashFeatureError(
                "flash.display.Graphics.lineStyle",
                "advanced caps, joints and scale modes are not admitted"
            );
        if (pixelHinting && thickness !== 1)
            throw new UnsupportedFlashFeatureError(
                "flash.display.Graphics.lineStyle.pixelHinting",
                "the retained native substitution is proven only for one-pixel primitive borders"
            );
        this._stroke = { ...paint(color, alpha, "Graphics.lineStyle"), thickness };
    }

    moveTo(x: number, y: number): void {
        this._flushPath();
        this._cursorX = finite(x, "Graphics.moveTo.x");
        this._cursorY = finite(y, "Graphics.moveTo.y");
        this._path = [this._cursorX, this._cursorY];
    }

    lineTo(x: number, y: number): void {
        const targetX = finite(x, "Graphics.lineTo.x");
        const targetY = finite(y, "Graphics.lineTo.y");
        if (this._fill) {
            this._path ??= [this._cursorX, this._cursorY];
            this._path.push(targetX, targetY);
        } else if (this._stroke)
            super.drawLine(this._cursorX, this._cursorY, targetX, targetY,
                this._stroke.color, this._stroke.thickness);
        this._cursorX = targetX;
        this._cursorY = targetY;
    }

    private _flushPath(): void {
        const path = this._path;
        this._path = null;
        if (!path || path.length < 6 || !this._fill) return;
        if (this._fill.kind !== "solid")
            throw new UnsupportedFlashFeatureError("flash.display.Graphics.gradientPath",
                "the admitted retained gradient bridge currently rasterizes rectangles");
        super.drawPoly(0, 0, path, this._fill.color,
            this._stroke?.color ?? null, this._stroke?.thickness ?? 1);
    }

    override drawRect(
        x: number, y: number, width: number, height: number,
        fillColor?: unknown, lineColor: unknown = null, lineWidth = 1, percent?: boolean
    ) {
        this._flushPath();
        finite(x, "Graphics.drawRect.x");
        finite(y, "Graphics.drawRect.y");
        finite(width, "Graphics.drawRect.width");
        finite(height, "Graphics.drawRect.height");
        if (arguments.length >= 5)
            return super.drawRect(x, y, width, height, fillColor, lineColor, lineWidth, percent);
        if (!this._fill && !this._stroke)
            return null as unknown as ReturnType<LayaGraphics["drawRect"]>;
        if (this._fill) {
            GRAPHICS_RASTER_COMMANDS.get(this)!.push(Object.freeze({ x, y, width, height, fill: this._fill }));
            if (this._fill.kind === "linear-gradient") {
                const steps = Math.max(1, Math.min(256, Math.ceil(Math.abs(width))));
                let result: ReturnType<LayaGraphics["drawRect"]> = null as unknown as ReturnType<LayaGraphics["drawRect"]>;
                for (let index = 0; index < steps; index++) {
                    const left = x + width * index / steps;
                    const right = x + width * (index + 1) / steps;
                    const color = argbCss(sampleFlashGraphicsFill(this._fill, (left + right) / 2, y + height / 2));
                    result = super.drawRect(left, y, right - left, height, color, null, 0, false);
                }
                return result;
            }
        }
        const activeFillColor = this._fill?.kind === "solid" ? this._fill.color : null;
        return super.drawRect(x, y, width, height, activeFillColor,
            this._stroke?.color ?? null, this._stroke?.thickness ?? 1);
    }

    /**
     * Flash supplies horizontal and vertical ellipse diameters. The retained
     * application only uses equal diameters, which map exactly to Laya's four
     * corner radii. Native Laya calls (nine or more arguments) pass through.
     */
    override drawRoundRect(
        x: number, y: number, width: number, height: number,
        ...rest: unknown[]
    ): ReturnType<LayaGraphics["drawRoundRect"]> {
        this._flushPath();
        finite(x, "Graphics.drawRoundRect.x");
        finite(y, "Graphics.drawRoundRect.y");
        finite(width, "Graphics.drawRoundRect.width");
        finite(height, "Graphics.drawRoundRect.height");
        if (rest.length >= 5)
            return super.drawRoundRect(x, y, width, height, ...rest as Parameters<LayaGraphics["drawRoundRect"]> extends [number, number, number, number, ...infer Tail] ? Tail : never);

        const ellipseWidth = finite(rest[0] as number, "Graphics.drawRoundRect.ellipseWidth");
        const ellipseHeight = rest.length > 1
            ? finite(rest[1] as number, "Graphics.drawRoundRect.ellipseHeight")
            : ellipseWidth;
        if (ellipseWidth !== ellipseHeight)
            throw new UnsupportedFlashFeatureError(
                "flash.display.Graphics.drawRoundRect",
                "non-circular corner ellipses require the vector pixel workpack"
            );
        if (this._fill?.kind === "linear-gradient")
            throw new UnsupportedFlashFeatureError("flash.display.Graphics.gradientRoundRect",
                "the admitted retained gradient bridge currently rasterizes rectangles");
        const radius = ellipseWidth / 2;
        const fillColor = this._fill?.kind === "solid" ? this._fill.color : null;
        return super.drawRoundRect(x, y, width, height, radius, radius, radius, radius,
            fillColor, this._stroke?.color ?? null, this._stroke?.thickness ?? 1);
    }

    /** Preserve Laya's textured-triangle path and reject Flash vector triangles visibly. */
    override drawTriangles(...args: unknown[]): ReturnType<LayaGraphics["drawTriangles"]> {
        this._flushPath();
        if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]))
            throw new UnsupportedFlashFeatureError(
                "flash.display.Graphics.drawTriangles",
                "Flash solid/UV triangle projection requires the vector triangle workpack"
            );
        return super.drawTriangles(...args as Parameters<LayaGraphics["drawTriangles"]>);
    }

    override clear(recoverCmds?: boolean): void {
        this._fill = null;
        this._stroke = null;
        this._cursorX = 0;
        this._cursorY = 0;
        this._path = null;
        GRAPHICS_RASTER_COMMANDS.get(this)!.length = 0;
        super.clear(recoverCmds);
    }
}
