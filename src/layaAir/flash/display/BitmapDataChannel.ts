/** Channel selectors used by `BitmapData.copyChannel`. */
export class BitmapDataChannel {
    static readonly RED = 1 as const;
    static readonly GREEN = 2 as const;
    static readonly BLUE = 4 as const;
    static readonly ALPHA = 8 as const;
}

Object.freeze(BitmapDataChannel);
