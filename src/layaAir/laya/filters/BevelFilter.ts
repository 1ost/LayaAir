import { FlashGradientFilterEffect2D } from "../display/effect2d/FlashGradientFilterEffect2D";
import { PostProcess2DEffect } from "../display/PostProcess2DEffect";
import { ClassUtils } from "../utils/ClassUtils";
import { Filter } from "./Filter";

export class BevelFilter extends Filter {
    _effect2D: FlashGradientFilterEffect2D;

    constructor(
        highlightColor = "#ffffff",
        shadowColor = "#000000",
        blurX = 4,
        blurY = 4,
        angle = 0,
        distance = 0,
        strength = 1,
        inner = false,
        knockout = false,
        onTop = false,
        compositeSource = true,
    ) {
        super();
        this._effect2D = new FlashGradientFilterEffect2D({
            mode: "bevel",
            highlightColor,
            shadowColor,
            blurX,
            blurY,
            angle,
            distance,
            strength,
            inner,
            knockout,
            onTop,
            compositeSource,
        });
    }

    getEffect(): PostProcess2DEffect {
        return this._effect2D;
    }
}

ClassUtils.regClass("BevelFilter", BevelFilter);
