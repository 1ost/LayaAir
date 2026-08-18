export function flashBlurDimension(value: unknown): number {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return Number.NaN;
    return Math.max(0, Math.min(255, numeric));
}

export function flashQuality(value: unknown): number {
    const integer = Number(value) >> 0;
    return Math.max(0, Math.min(15, integer));
}

export function flashStrength(value: unknown): number {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return 0;
    return Math.max(0, Math.min(255, numeric));
}

export function flashFilterAlpha(value: unknown): number {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return 0;
    return Math.floor(Math.max(0, Math.min(1, numeric)) * 255) / 255;
}

export function flashRgb(value: unknown): number { return Number(value) >>> 0 & 0xffffff; }
export function flashAngle(value: unknown): number { return Number(value) % 360; }
