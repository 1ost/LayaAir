function numberValue(value: number): number { return Number(value); }

const POINT_VALUES = new WeakSet<object>();

/** @internal Nominal guard shared only by other canonical Flash geometry values. */
export function isFlashPoint(value: unknown): value is Point {
    return typeof value === "object" && value !== null && POINT_VALUES.has(value);
}

function pointValue(value: Point, parameter: string): Point {
    if (!isFlashPoint(value))
        throw new TypeError(`${parameter} must be a Point`);
    return value;
}

/** Exact source-visible `flash.geom.Point` value shape. */
export class Point {
    x: number;
    y: number;

    constructor(x = 0, y = 0) {
        POINT_VALUES.add(this);
        this.x = numberValue(x);
        this.y = numberValue(y);
    }

    static distance(pt1: Point, pt2: Point): number {
        const first = pointValue(pt1, "pt1");
        const second = pointValue(pt2, "pt2");
        return Math.hypot(first.x - second.x, first.y - second.y);
    }

    static interpolate(pt1: Point, pt2: Point, f: number): Point {
        const first = pointValue(pt1, "pt1");
        const second = pointValue(pt2, "pt2");
        const fraction = numberValue(f);
        return new Point(
            second.x + (first.x - second.x) * fraction,
            second.y + (first.y - second.y) * fraction,
        );
    }

    static polar(length: number, angle: number): Point {
        const radius = numberValue(length);
        const radians = numberValue(angle);
        return new Point(radius * Math.cos(radians), radius * Math.sin(radians));
    }

    add(v: Point): Point {
        const value = pointValue(v, "v");
        return new Point(this.x + value.x, this.y + value.y);
    }

    clone(): Point { return new Point(this.x, this.y); }

    copyFrom(sourcePoint: Point): void {
        const value = pointValue(sourcePoint, "sourcePoint");
        this.x = value.x;
        this.y = value.y;
    }

    equals(toCompare: Point): boolean {
        const value = pointValue(toCompare, "toCompare");
        return this.x === value.x && this.y === value.y;
    }

    get length(): number { return Math.hypot(this.x, this.y); }

    normalize(thickness: number): void {
        const target = numberValue(thickness);
        const length = this.length;
        if (length !== 0) {
            this.x *= target / length;
            this.y *= target / length;
        }
    }

    offset(dx: number, dy: number): void {
        this.x += numberValue(dx);
        this.y += numberValue(dy);
    }

    setTo(xa: number, ya: number): void {
        this.x = numberValue(xa);
        this.y = numberValue(ya);
    }

    subtract(v: Point): Point {
        const value = pointValue(v, "v");
        return new Point(this.x - value.x, this.y - value.y);
    }

    toString(): string { return `(x=${this.x}, y=${this.y})`; }
}
