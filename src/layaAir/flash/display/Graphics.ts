import { Graphics as LayaGraphics } from "../../laya/display/Graphics";
import { UnsupportedFlashFeatureError } from "../events/UnsupportedFlashFeatureError";

interface Paint { readonly color: string; }
interface Stroke extends Paint { readonly thickness: number; }

const GRAPHICS_VALUES = new WeakSet<object>();

/** @internal Read-only nominal proof for canonical Flash graphics values. */
export function isFlashGraphics(value: unknown): value is Graphics {
    return typeof value === "object" && value !== null && GRAPHICS_VALUES.has(value);
}

function finite(value: number, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new TypeError(`${label} must be finite`);
    return value;
}

function paint(color: number, alpha: number, label: string): Paint {
    if (typeof color !== "number" || !Number.isFinite(color))
        throw new TypeError(`${label}.color must be finite`);
    finite(alpha, `${label}.alpha`);
    const rgb = color >>> 0;
    const red = rgb >>> 16 & 0xFF;
    const green = rgb >>> 8 & 0xFF;
    const blue = rgb & 0xFF;
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    return { color: `rgba(${red},${green},${blue},${clampedAlpha})` };
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
    }

    beginFill(color: number, alpha = 1): void {
        this._flushPath();
        this._fill = paint(color, alpha, "Graphics.beginFill");
    }

    beginGradientFill(
        type?: string, colors?: readonly number[], alphas?: readonly number[],
        ratios?: readonly number[], matrix: unknown = null, spreadMethod = "pad",
        interpolationMethod = "rgb", focalPointRatio = 0
    ): never {
        void type; void colors; void alphas; void ratios; void matrix;
        void spreadMethod; void interpolationMethod; void focalPointRatio;
        throw new UnsupportedFlashFeatureError(
            "flash.display.Graphics.beginGradientFill",
            "gradient conversion requires the dedicated Matrix/gradient pixel workpack"
        );
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
        return super.drawRect(x, y, width, height, this._fill?.color ?? null,
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
        const radius = ellipseWidth / 2;
        return super.drawRoundRect(x, y, width, height, radius, radius, radius, radius,
            this._fill?.color ?? null, this._stroke?.color ?? null, this._stroke?.thickness ?? 1);
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
        super.clear(recoverCmds);
    }
}
