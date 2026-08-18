/**
 * Flash display-list blend-mode constants.
 * @see https://airsdk.dev/reference/actionscript/3.0/flash/display/BlendMode.html
 */
export class BlendMode {
    static readonly ADD = "add";
    static readonly ALPHA = "alpha";
    static readonly DARKEN = "darken";
    static readonly DIFFERENCE = "difference";
    static readonly ERASE = "erase";
    static readonly HARDLIGHT = "hardlight";
    static readonly INVERT = "invert";
    static readonly LAYER = "layer";
    static readonly LIGHTEN = "lighten";
    static readonly MULTIPLY = "multiply";
    static readonly NORMAL = "normal";
    static readonly OVERLAY = "overlay";
    static readonly SCREEN = "screen";
    static readonly SHADER = "shader";
    static readonly SUBTRACT = "subtract";
}

Object.freeze(BlendMode);
