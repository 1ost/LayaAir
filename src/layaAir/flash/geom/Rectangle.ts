import { isFlashPoint, Point } from "./Point";

function numberValue(value: number): number { return Number(value); }

const RECTANGLE_VALUES = new WeakSet<object>();

/** @internal Nominal guard for authenticated runtime `is` checks. */
export function isFlashRectangle(value: unknown): value is Rectangle {
    return typeof value === "object" && value !== null && RECTANGLE_VALUES.has(value);
}

function pointValue(value: Point, parameter: string): Point {
    if (!isFlashPoint(value)) throw new TypeError(`${parameter} must be a Point`);
    return value;
}

function rectangleValue(value: Rectangle, parameter: string): Rectangle {
    if (!isFlashRectangle(value))
        throw new TypeError(`${parameter} must be a Rectangle`);
    return value;
}

/** Exact source-visible `flash.geom.Rectangle` value shape. */
export class Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;

    constructor(x = 0, y = 0, width = 0, height = 0) {
        RECTANGLE_VALUES.add(this);
        this.x = numberValue(x);
        this.y = numberValue(y);
        this.width = numberValue(width);
        this.height = numberValue(height);
    }

    get left(): number { return this.x; }
    set left(value: number) {
        const right = this.right;
        this.x = numberValue(value);
        this.width = right - this.x;
    }

    get right(): number { return this.x + this.width; }
    set right(value: number) { this.width = numberValue(value) - this.x; }

    get top(): number { return this.y; }
    set top(value: number) {
        const bottom = this.bottom;
        this.y = numberValue(value);
        this.height = bottom - this.y;
    }

    get bottom(): number { return this.y + this.height; }
    set bottom(value: number) { this.height = numberValue(value) - this.y; }

    get topLeft(): Point { return new Point(this.left, this.top); }
    set topLeft(value: Point) {
        const point = pointValue(value, "topLeft");
        this.left = point.x;
        this.top = point.y;
    }

    get bottomRight(): Point { return new Point(this.right, this.bottom); }
    set bottomRight(value: Point) {
        const point = pointValue(value, "bottomRight");
        this.right = point.x;
        this.bottom = point.y;
    }

    get size(): Point { return new Point(this.width, this.height); }
    set size(value: Point) {
        const point = pointValue(value, "size");
        this.width = point.x;
        this.height = point.y;
    }

    clone(): Rectangle { return new Rectangle(this.x, this.y, this.width, this.height); }

    contains(x: number, y: number): boolean {
        const px = numberValue(x);
        const py = numberValue(y);
        return this.width > 0 && this.height > 0
            && px >= this.x && px < this.right
            && py >= this.y && py < this.bottom;
    }

    containsPoint(point: Point): boolean {
        const value = pointValue(point, "point");
        return this.contains(value.x, value.y);
    }

    containsRect(rect: Rectangle): boolean {
        const value = rectangleValue(rect, "rect");
        if (this.isEmpty()) return false;
        if (value.width <= 0 || value.height <= 0) return this.contains(value.x, value.y);
        return value.x >= this.left && value.right <= this.right
            && value.y >= this.top && value.bottom <= this.bottom;
    }

    copyFrom(sourceRect: Rectangle): void {
        const value = rectangleValue(sourceRect, "sourceRect");
        this.x = value.x;
        this.y = value.y;
        this.width = value.width;
        this.height = value.height;
    }

    equals(toCompare: Rectangle): boolean {
        const value = rectangleValue(toCompare, "toCompare");
        return this.x === value.x && this.y === value.y
            && this.width === value.width && this.height === value.height;
    }

    inflate(dx: number, dy: number): void {
        const x = numberValue(dx);
        const y = numberValue(dy);
        this.x -= x;
        this.y -= y;
        this.width += x * 2;
        this.height += y * 2;
    }

    inflatePoint(point: Point): void {
        const value = pointValue(point, "point");
        this.inflate(value.x, value.y);
    }

    intersection(toIntersect: Rectangle): Rectangle {
        const value = rectangleValue(toIntersect, "toIntersect");
        if (!this.intersects(value)) return new Rectangle();
        const x = Math.max(this.left, value.left);
        const y = Math.max(this.top, value.top);
        return new Rectangle(
            x, y,
            Math.min(this.right, value.right) - x,
            Math.min(this.bottom, value.bottom) - y,
        );
    }

    intersects(toIntersect: Rectangle): boolean {
        const value = rectangleValue(toIntersect, "toIntersect");
        if (this.isEmpty() || value.isEmpty()) return false;
        return value.left < this.right && value.right > this.left
            && value.top < this.bottom && value.bottom > this.top;
    }

    isEmpty(): boolean { return this.width <= 0 || this.height <= 0; }

    offset(dx: number, dy: number): void {
        this.x += numberValue(dx);
        this.y += numberValue(dy);
    }

    offsetPoint(point: Point): void {
        const value = pointValue(point, "point");
        this.offset(value.x, value.y);
    }

    setEmpty(): void { this.x = this.y = this.width = this.height = 0; }

    setTo(xa: number, ya: number, widtha: number, heighta: number): void {
        this.x = numberValue(xa);
        this.y = numberValue(ya);
        this.width = numberValue(widtha);
        this.height = numberValue(heighta);
    }

    toString(): string {
        return `(x=${this.x}, y=${this.y}, w=${this.width}, h=${this.height})`;
    }

    union(toUnion: Rectangle): Rectangle {
        const value = rectangleValue(toUnion, "toUnion");
        if (this.isEmpty()) return value.isEmpty() ? new Rectangle() : value.clone();
        if (value.isEmpty()) return this.clone();
        const x = Math.min(this.left, value.left);
        const y = Math.min(this.top, value.top);
        return new Rectangle(
            x, y,
            Math.max(this.right, value.right) - x,
            Math.max(this.bottom, value.bottom) - y,
        );
    }
}
