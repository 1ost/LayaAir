#define SHADER_NAME flashGradientFilter2D

#include "OutputTransform.glsl";

varying vec2 v_Texcoord0;

float sourceAlpha(vec2 uv)
{
    return texture2D(u_MainTex, uv).a;
}

float blurredAlpha(vec2 uv)
{
    const float steps = 8.0;
    vec2 texel = vec2(u_filterInfo1.x / u_filterInfo1.z, u_filterInfo1.y / u_filterInfo1.w) / steps * 2.0;
    float alpha = 0.0;
    for (float y = 0.0; y <= steps; ++y) {
        for (float x = 0.0; x <= steps; ++x) {
            vec2 offset = vec2((x - steps * 0.5) * texel.x, (y - steps * 0.5) * texel.y);
            alpha += sourceAlpha(uv + offset);
        }
    }
    return alpha / ((steps + 1.0) * (steps + 1.0));
}

vec4 gradientColor(float t)
{
    float count = max(u_gradientInfo.x, 1.0);
    float r0 = u_gradientRatios0.x;
    float r1 = u_gradientRatios0.y;
    float r2 = u_gradientRatios0.z;
    float r3 = u_gradientRatios0.w;
    float r4 = u_gradientRatios1.x;
    float r5 = u_gradientRatios1.y;

    if (count <= 1.0 || t <= r0) return u_gradientColor0;
    if (count <= 2.0 || t <= r1) return mix(u_gradientColor0, u_gradientColor1, clamp((t - r0) / max(r1 - r0, 0.0001), 0.0, 1.0));
    if (count <= 3.0 || t <= r2) return mix(u_gradientColor1, u_gradientColor2, clamp((t - r1) / max(r2 - r1, 0.0001), 0.0, 1.0));
    if (count <= 4.0 || t <= r3) return mix(u_gradientColor2, u_gradientColor3, clamp((t - r2) / max(r3 - r2, 0.0001), 0.0, 1.0));
    if (count <= 5.0 || t <= r4) return mix(u_gradientColor3, u_gradientColor4, clamp((t - r3) / max(r4 - r3, 0.0001), 0.0, 1.0));
    if (t <= r5) return mix(u_gradientColor4, u_gradientColor5, clamp((t - r4) / max(r5 - r4, 0.0001), 0.0, 1.0));
    return u_gradientColor5;
}

vec4 premultiply(vec4 color)
{
    color.rgb *= color.a;
    return color;
}

vec4 over(vec4 fg, vec4 bg)
{
    return fg + bg * (1.0 - fg.a);
}

void main()
{
    vec4 src = texture2D(u_MainTex, v_Texcoord0);
    float angle = u_filterInfo2.x;
    float distance = u_filterInfo2.y;
    float strength = u_filterInfo2.z;
    float mode = u_filterInfo2.w;
    float inner = u_filterFlags.x;
    float knockout = u_filterFlags.y;
    float onTop = u_filterFlags.z;
    float compositeSource = u_filterFlags.w;

    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 offset = vec2(direction.x * distance / u_filterInfo1.z, direction.y * distance / u_filterInfo1.w);
    float centerAlpha = blurredAlpha(v_Texcoord0);
    float offsetAlpha = blurredAlpha(v_Texcoord0 - offset);
    float sourceMask = src.a;
    float outsideMask = 1.0 - sourceMask;
    float mask = mix(outsideMask, sourceMask, inner);

    vec4 effect = vec4(0.0);
    if (mode < 1.5) {
        float amount = clamp(offsetAlpha * mask * strength, 0.0, 1.0);
        effect = premultiply(gradientColor(clamp(offsetAlpha, 0.0, 1.0)) * amount);
    } else {
        float highlight = max(centerAlpha - offsetAlpha, 0.0);
        float shadow = max(offsetAlpha - centerAlpha, 0.0);
        float edge = max(highlight, shadow) * mask;
        float ratio = shadow > highlight ? 0.0 : 1.0;
        if (mode > 2.5) {
            effect = premultiply(mix(u_shadowColor, u_highlightColor, ratio) * clamp(edge * strength, 0.0, 1.0));
        } else {
            effect = premultiply(gradientColor(ratio) * clamp(edge * strength, 0.0, 1.0));
        }
    }

    vec4 base = compositeSource > 0.5 && knockout < 0.5 ? src : vec4(0.0);
    gl_FragColor = onTop > 0.5 ? over(base, effect) : over(effect, base);
    gl_FragColor = outputTransform(gl_FragColor);
}
