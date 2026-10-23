#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1]

uniform vec3 uColor;
uniform float uIsDiagonal;
uniform float uAlpha;

uniform sampler2D uStatusAtlas;
uniform float uHasAtlas;

out vec4 fragColor;

const vec3 OUTLINE_BLACK = vec3(0.0);
const vec3 ALLIANCE_GREEN = vec3(0.0, 0.9, 0.2); // Official Alliance Green

// 8 unit directions for the outline dilation sample ring (matching status-icon.frag.glsl)
const vec2 kRing[8] = vec2[8](
  vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
  vec2(0.707, 0.707), vec2(-0.707, 0.707),
  vec2(0.707, -0.707), vec2(-0.707, -0.707)
);

// Coverage of the reticle shape at p, with strokes widened by grow.
float reticleMask(vec2 p, float grow) {
  float r = length(p);
  float aa = 0.05;
  // Ring arcs, broken at the diagonals.
  float ringD = abs(r - 0.74) - (0.04 + grow);
  float ang = abs(atan(p.y, p.x));
  float toDiag = abs(mod(ang, 1.5707963) - 0.7853982); // 0 on a diagonal
  float arc = smoothstep(0.24, 0.30, toDiag + grow * 0.5);
  float ring = (1.0 - smoothstep(-aa, aa, ringD)) * arc;
  // Inner ticks on the axes.
  float ax = abs(p.x), ay = abs(p.y);
  float hw = 0.035 + grow;
  float h = (1.0 - smoothstep(hw - aa, hw + aa, ay)) *
            smoothstep(0.30 - grow - aa, 0.30 - grow + aa, ax) *
            (1.0 - smoothstep(0.54 + grow - aa, 0.54 + grow + aa, ax));
  float v = (1.0 - smoothstep(hw - aa, hw + aa, ax)) *
            smoothstep(0.30 - grow - aa, 0.30 - grow + aa, ay) *
            (1.0 - smoothstep(0.54 + grow - aa, 0.54 + grow + aa, ay));
  // Centre pip.
  float pip = 1.0 - smoothstep(0.07 + grow - aa, 0.07 + grow + aa, r);
  return max(max(ring, pip), max(h, v));
}

void main() {
  if (uIsDiagonal > 0.5) {
    // 1. Calculate Diagonal X with black outline
    float d1 = abs(vLocal.x - vLocal.y) * 0.7071;
    float d2 = abs(vLocal.x + vLocal.y) * 0.7071;
    float minD = min(d1, d2);
    float circleMask = 1.0 - smoothstep(0.85, 0.98, length(vLocal));
    float lineAlpha = (1.0 - smoothstep(0.08, 0.16, minD)) * circleMask;
    float outlineAlpha = (1.0 - smoothstep(0.20, 0.30, minD)) * circleMask;
    float blend = outlineAlpha > 0.01 ? lineAlpha / outlineAlpha : 1.0;
    vec3 xCol = mix(OUTLINE_BLACK, uColor, blend);
    float xAlpha = outlineAlpha;

    // 2. Alliance Handshake Icon with 8-ring dark outline (matching status-icon.frag.glsl)
    vec4 iconTexel = vec4(0.0);
    if (uHasAtlas > 0.5) {
      // Map vLocal [-1.10, +1.10] to icon UV [0, 1] (Y flipped for WebGL)
      vec2 iconUV = vec2(
        (vLocal.x / 1.50) + 0.5,
        1.0 - ((vLocal.y / 1.50) + 0.5)
      );

      if (iconUV.x >= 0.0 && iconUV.x <= 1.0 && iconUV.y >= 0.0 && iconUV.y <= 1.0) {
        // Handshake Icon UV in status-atlas.png (col 0, row 1, cell 256x256, 16px pad)
        // mix(16/768, 240/768, iconUV.x) and mix(272/1024, 496/1024, iconUV.y)
        vec2 atlasUV = vec2(
          mix(0.0208333, 0.3125, iconUV.x),
          mix(0.265625, 0.484375, iconUV.y)
        );
        iconTexel = texture(uStatusAtlas, atlasUV);

        // 8-ring dark outline dilation (matching status-icon.frag.glsl)
        float uStatusOutlinePx = 4.0; // 4px outline radius
        vec2 uStatusTexel = vec2(1.0 / 768.0, 1.0 / 1024.0);
        vec2 sampleStep = uStatusTexel * uStatusOutlinePx;
        float ring = 0.0;
        for (int i = 0; i < 8; i++) {
          ring = max(ring, texture(uStatusAtlas, atlasUV + kRing[i] * sampleStep).a);
        }
        float outlineA = ring * (1.0 - iconTexel.a);
        iconTexel = vec4(mix(OUTLINE_BLACK, iconTexel.rgb, iconTexel.a), max(iconTexel.a, outlineA));
      }
    }

    // 3. Composite Alliance Handshake OVER the Red X reticle
    vec3 finalCol = mix(xCol, iconTexel.rgb, iconTexel.a);
    float finalAlpha = max(xAlpha, iconTexel.a);

    if (finalAlpha < 0.01) discard;
    fragColor = vec4(finalCol, finalAlpha * uAlpha);
  } else {
    // Targeting reticle: four ring arcs, inner ticks and a centre pip, with
    // a dark rim and a soft drop shadow so it lifts off any terrain.
    float shadow = reticleMask(vLocal - vec2(0.05, 0.07), 0.06);
    float rim = reticleMask(vLocal, 0.035);
    float body = reticleMask(vLocal, 0.0);
    // Light from the top: the upper half of each stroke is a touch brighter.
    vec3 lit = mix(uColor * 0.85, min(uColor + 0.25, vec3(1.0)), 0.5 - 0.5 * vLocal.y);

    vec3 col = mix(OUTLINE_BLACK, lit, body);
    float a = max(rim * 0.4, body);
    // Shadow sits under everything else.
    float outA = a + shadow * 0.18 * (1.0 - a);
    vec3 outC = (col * a) / max(outA, 1e-4);
    if (outA < 0.01) discard;
    fragColor = vec4(outC, outA * 0.95);
  }
}
