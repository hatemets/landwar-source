#version 300 es
precision highp float;

uniform vec2 uBarSize;
uniform float uBorderWidth;
uniform vec3 uThresholds;
uniform vec3 uColorRed;
uniform vec3 uColorOrange;
uniform vec3 uColorYellow;
uniform vec3 uColorGreen;
uniform float uSolid;       // 1.0 = veterancy pip: fill solid with uSolidColor
uniform vec3 uSolidColor;

in vec2 vLocalPos;
flat in float vProgress;

out vec4 fragColor;

// Signed distance to a rounded box centred on the origin (iq).
float sdRoundBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Coverage of a shape from its signed distance, anti-aliased over one screen
// pixel (aa = world units per pixel).
float coverage(float d, float aa) {
  return clamp(0.5 - d / aa, 0.0, 1.0);
}

// Smooth red -> orange -> yellow -> green ramp; each step blends over a short
// span around its threshold so the colour glides as health changes.
vec3 healthColor(float p) {
  const float W = 0.06;
  vec3 c = uColorRed;
  c = mix(c, uColorOrange, smoothstep(uThresholds.x - W, uThresholds.x + W, p));
  c = mix(c, uColorYellow, smoothstep(uThresholds.y - W, uThresholds.y + W, p));
  c = mix(c, uColorGreen, smoothstep(uThresholds.z - W, uThresholds.z + W, p));
  return c;
}

void main() {
  vec2 size = uBarSize;
  vec2 p = vLocalPos - 0.5 * size;
  float aa = max(fwidth(vLocalPos.x), 1e-4);

  // Veterancy pips: small solid rounded rectangles.
  if (uSolid > 0.5) {
    float d = sdRoundBox(p, 0.5 * size, 0.5 * min(size.x, size.y));
    float a = coverage(d, aa);
    if (a < 0.003) discard;
    fragColor = vec4(uSolidColor, a);
    return;
  }

  // Track: a pill with a translucent dark body.
  float r = 0.5 * size.y;
  float dTrack = sdRoundBox(p, 0.5 * size, r);
  float aTrack = coverage(dTrack, aa);
  if (aTrack < 0.003) discard;

  // Fill: inset by the border width, clipped to progress, same pill profile.
  float bw = uBorderWidth;
  vec2 inner = 0.5 * size - bw;
  float fillW = max(vProgress, 0.0) * 2.0 * inner.x;
  float fillCx = -inner.x + 0.5 * fillW;
  vec2 fp = p - vec2(fillCx, 0.0);
  float dFill = sdRoundBox(fp, vec2(0.5 * fillW, inner.y), max(inner.y - 0.02, 0.0));
  float aFill = fillW > 0.01 ? coverage(dFill, aa) : 0.0;

  // A light top edge and a darker bottom edge give the fill some volume.
  float v = clamp((p.y + inner.y) / max(2.0 * inner.y, 1e-4), 0.0, 1.0);
  vec3 base = healthColor(vProgress);
  vec3 fillCol = mix(base * 1.18, base * 0.78, v);

  vec3 trackCol = vec3(0.04, 0.05, 0.07);
  float trackA = 0.72 * aTrack;
  vec3 color = mix(trackCol, fillCol, aFill);
  float alpha = max(trackA, aFill * aTrack);
  fragColor = vec4(color, alpha);
}
