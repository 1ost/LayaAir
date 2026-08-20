import { isFlashPoint, Point } from "./Point";

interface MatrixState {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
}

const MATRIX_VALUES = new WeakMap<object, MatrixState>();

function state(value: Matrix): MatrixState {
    const result = MATRIX_VALUES.get(value);
    if (!result) throw new TypeError("Invalid Matrix receiver");
    return result;
}

/** @internal Nominal proof for authenticated runtime `is` checks. */
export function isFlashMatrix(value: unknown): value is Matrix {
    return typeof value === "object" && value !== null && MATRIX_VALUES.has(value);
}

function matrixValue(value: Matrix, parameter: string): MatrixState {
    if (!isFlashMatrix(value)) throw new TypeError(`${parameter} must be a Matrix`);
    return state(value);
}

function pointValue(value: Point, parameter: string): Point {
    if (!isFlashPoint(value)) throw new TypeError(`${parameter} must be a Point`);
    return value;
}

/** Exact source-visible `flash.geom.Matrix`, independent of Laya's native matrix class. */
export class Matrix {
    constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
        if (new.target !== Matrix) throw new TypeError("Matrix is not extensible");
        MATRIX_VALUES.set(this, {
            a: Number(a), b: Number(b), c: Number(c), d: Number(d), tx: Number(tx), ty: Number(ty),
        });
        Object.seal(this);
    }

    get a(): number { return state(this).a; }
    set a(value: number) { state(this).a = Number(value); }
    get b(): number { return state(this).b; }
    set b(value: number) { state(this).b = Number(value); }
    get c(): number { return state(this).c; }
    set c(value: number) { state(this).c = Number(value); }
    get d(): number { return state(this).d; }
    set d(value: number) { state(this).d = Number(value); }
    get tx(): number { return state(this).tx; }
    set tx(value: number) { state(this).tx = Number(value); }
    get ty(): number { return state(this).ty; }
    set ty(value: number) { state(this).ty = Number(value); }

    clone(): Matrix {
        const value = state(this);
        return new Matrix(value.a, value.b, value.c, value.d, value.tx, value.ty);
    }

    concat(matrix: Matrix): void {
        const current = state(this);
        const value = matrixValue(matrix, "matrix");
        const { a, b, c, d, tx, ty } = current;
        current.a = a * value.a + b * value.c;
        current.b = a * value.b + b * value.d;
        current.c = c * value.a + d * value.c;
        current.d = c * value.b + d * value.d;
        current.tx = tx * value.a + ty * value.c + value.tx;
        current.ty = tx * value.b + ty * value.d + value.ty;
    }

    copyFrom(sourceMatrix: Matrix): void {
        const current = state(this);
        const value = matrixValue(sourceMatrix, "sourceMatrix");
        Object.assign(current, value);
    }

    createBox(scaleX: number, scaleY: number, rotation = 0, tx = 0, ty = 0): void {
        const current = state(this);
        const xScale = Number(scaleX);
        const yScale = Number(scaleY);
        const radians = Number(rotation);
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        Object.assign(current, {
            a: cosine * xScale,
            b: sine * yScale,
            c: -sine * xScale,
            d: cosine * yScale,
            tx: Number(tx),
            ty: Number(ty),
        });
    }

    createGradientBox(width: number, height: number, rotation = 0, tx = 0, ty = 0): void {
        const current = state(this);
        const boxWidth = Number(width);
        const boxHeight = Number(height);
        const radians = Number(rotation);
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        const xScale = boxWidth / 1638.4;
        const yScale = boxHeight / 1638.4;
        Object.assign(current, {
            a: cosine * xScale,
            b: sine * yScale,
            c: -sine * xScale,
            d: cosine * yScale,
            tx: Number(tx) + boxWidth / 2,
            ty: Number(ty) + boxHeight / 2,
        });
    }

    deltaTransformPoint(point: Point): Point {
        const current = state(this);
        const value = pointValue(point, "point");
        return new Point(
            value.x * current.a + value.y * current.c,
            value.x * current.b + value.y * current.d,
        );
    }

    identity(): void {
        const current = state(this);
        Object.assign(current, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    }

    invert(): void {
        const current = state(this);
        const { a, b, c, d, tx, ty } = current;
        const determinant = a * d - b * c;
        if (determinant === 0) {
            Object.assign(current, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
            return;
        }
        Object.assign(current, {
            a: d / determinant,
            b: -b / determinant,
            c: -c / determinant,
            d: a / determinant,
            tx: (c * ty - d * tx) / determinant,
            ty: -(a * ty - b * tx) / determinant,
        });
    }

    rotate(angle: number): void {
        const current = state(this);
        const radians = Number(angle);
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        const { a, b, c, d, tx, ty } = current;
        Object.assign(current, {
            a: a * cosine - b * sine,
            b: a * sine + b * cosine,
            c: c * cosine - d * sine,
            d: c * sine + d * cosine,
            tx: tx * cosine - ty * sine,
            ty: tx * sine + ty * cosine,
        });
    }

    scale(sx: number, sy: number): void {
        const current = state(this);
        const xScale = Number(sx);
        const yScale = Number(sy);
        current.a *= xScale;
        current.c *= xScale;
        current.tx *= xScale;
        current.b *= yScale;
        current.d *= yScale;
        current.ty *= yScale;
    }

    setTo(a: number, b: number, c: number, d: number, tx: number, ty: number): void {
        const current = state(this);
        Object.assign(current, {
            a: Number(a), b: Number(b), c: Number(c), d: Number(d), tx: Number(tx), ty: Number(ty),
        });
    }

    toString(): string {
        const value = state(this);
        return `(a=${value.a}, b=${value.b}, c=${value.c}, d=${value.d}, tx=${value.tx}, ty=${value.ty})`;
    }

    transformPoint(point: Point): Point {
        const current = state(this);
        const value = pointValue(point, "point");
        return new Point(
            value.x * current.a + value.y * current.c + current.tx,
            value.x * current.b + value.y * current.d + current.ty,
        );
    }

    translate(dx: number, dy: number): void {
        const current = state(this);
        current.tx += Number(dx);
        current.ty += Number(dy);
    }
}

Object.freeze(Matrix.prototype);
