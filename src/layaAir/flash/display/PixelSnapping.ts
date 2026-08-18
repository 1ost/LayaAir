/** Values accepted by `Bitmap.pixelSnapping`. */
export class PixelSnapping {
    static readonly NEVER = "never" as const;
    static readonly AUTO = "auto" as const;
    static readonly ALWAYS = "always" as const;
}

Object.freeze(PixelSnapping);
