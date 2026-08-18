/**
 * Flash stage-rendering quality constants.
 * @see https://airsdk.dev/reference/actionscript/3.0/flash/display/StageQuality.html
 */
export class StageQuality {
    static readonly BEST = "best";
    static readonly HIGH = "high";
    static readonly HIGH_16X16 = "16x16";
    static readonly HIGH_16X16_LINEAR = "16x16linear";
    static readonly HIGH_8X8 = "8x8";
    static readonly HIGH_8X8_LINEAR = "8x8linear";
    static readonly LOW = "low";
    static readonly MEDIUM = "medium";
}

Object.freeze(StageQuality);
