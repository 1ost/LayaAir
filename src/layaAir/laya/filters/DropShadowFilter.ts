import { GlowEffect2D } from "../display/effect2d/GlowEffect2D";
import { PostProcess2DEffect } from "../display/PostProcess2DEffect";
import { ClassUtils } from "../utils/ClassUtils";
import { Filter } from "./Filter";

/**
 * @deprecated use post2DProcess
 * @en Drop shadow filter.
 * @zh 投影滤镜。
 */
export class DropShadowFilter extends Filter {
    _effect2D: GlowEffect2D;

    constructor(color: string, blur = 4, offX = 6, offY = 6, strength = 1) {
        super();
        this._effect2D = new GlowEffect2D(color, blur, offX, offY);
        this._effect2D.strength = strength;
    }

    getEffect(): PostProcess2DEffect {
        return this._effect2D;
    }

    get offY(): number {
        return this._effect2D.offsetY;
    }

    set offY(value: number) {
        this._effect2D.offsetY = value;
        this.onChange();
    }

    get offX(): number {
        return this._effect2D.offsetX;
    }

    set offX(value: number) {
        this._effect2D.offsetX = value;
        this.onChange();
    }

    get color(): string {
        return this._effect2D.color;
    }

    set color(value: string) {
        this._effect2D.color = value;
        this.onChange();
    }

    get blur(): number {
        return this._effect2D.blur;
    }

    set blur(value: number) {
        this._effect2D.blur = value;
        this.onChange();
    }

    get strength(): number {
        return this._effect2D.strength;
    }

    set strength(value: number) {
        this._effect2D.strength = value;
        this.onChange();
    }
}

ClassUtils.regClass("DropShadowFilter", DropShadowFilter);
