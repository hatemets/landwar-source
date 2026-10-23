#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1] over ±HALF tiles

uniform float uElapsed;      // wall-clock ms since activation
uniform vec3  uColor;        // RGB [0-1], the owner's color lifted toward white
uniform float uPxPerTile;    // camera zoom (pixels per tile)
uniform float uRippleRadius; // screen px — outer radius the rings reach
uniform float uPinSize;      // screen px — half-height of the beacon diamond
uniform float uLineWidth;    // screen px — ring stroke width
uniform float uDuration;     // ms

out vec4 fragColor;

const float HALF = 16.0; // quad half-size in tiles (must match vertex shader)
const float TILT = 0.55; // ground-plane squash: rings read as lying flat

// Waypoint beacon: a faceted diamond drops onto the target and settles over
// a soft ground shadow while two rings ripple outward across the ground.

float easeOutBack(float x) {
  float c = 1.70158;
  float y = x - 1.0;
  return 1.0 + (c + 1.0) * y * y * y + c * y * y;
}

// Signed distance to a rhombus with half-extents b (iq).
float sdRhombus(vec2 p, vec2 b) {
  p = abs(p);
  vec2 q = b - 2.0 * p;
  float h = clamp((q.x * b.x - q.y * b.y) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}

vec4 over(vec4 top, vec4 under) {
  float a = top.a + under.a * (1.0 - top.a);
  vec3 c = (top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / max(a, 1e-4);
  return vec4(c, a);
}

void main() {
  float t = uElapsed / uDuration;
  if (t >= 1.0) discard;

  vec2 p = vLocal * HALF * uPxPerTile; // screen px from the target, +y down
  float sc = uPxPerTile > 10.0 ? 1.0 + (uPxPerTile - 10.0) / 20.0 : 1.0;
  float fade = 1.0 - smoothstep(0.7, 1.0, t);

  vec4 col = vec4(0.0);

  // --- Ground: tilted coordinates so circles become flat ellipses ---
  vec2 g = vec2(p.x, p.y / TILT);
  float gr = length(g);

  // Two staggered ripple rings.
  for (int k = 0; k < 2; k++) {
    float tk = clamp((t - float(k) * 0.22) / 0.78, 0.0, 1.0);
    if (tk <= 0.0) continue;
    float e = 1.0 - (1.0 - tk) * (1.0 - tk);
    float r = mix(uPinSize * 0.6, uRippleRadius * sc, e);
    float w = uLineWidth * sc * (1.0 - 0.5 * tk);
    float ring = 1.0 - smoothstep(w * 0.5 - 0.75, w * 0.5 + 0.75, abs(gr - r));
    float a = ring * (1.0 - tk) * 0.9;
    col = over(vec4(uColor, a), col);
  }

  // Soft contact shadow, tightening as the beacon lands.
  float drop = clamp(t / 0.35, 0.0, 1.0);
  float lift = (1.0 - easeOutBack(drop)) * 18.0 * sc; // px above its rest point
  float shadowR = uPinSize * sc * (1.1 + lift / (18.0 * sc));
  float shadow = exp(-(gr * gr) / (2.0 * shadowR * shadowR * 0.35)) * 0.45;
  col = over(vec4(0.0, 0.0, 0.0, shadow * drop), col);

  // --- Beacon: a faceted diamond resting just above the ground ---
  vec2 b = vec2(uPinSize * 0.62, uPinSize) * sc;
  vec2 c = vec2(0.0, -b.y - 2.0 * sc - lift);
  vec2 q = p - c;
  float d = sdRhombus(q, b);
  float aa = 0.75;
  float body = 1.0 - smoothstep(-aa, aa, d);
  if (body > 0.0) {
    // Four facets lit from the top-left: bright, mid, mid, dark.
    float lit = q.x < 0.0
      ? (q.y < 0.0 ? 1.0 : 0.62)
      : (q.y < 0.0 ? 0.78 : 0.42);
    vec3 face = uColor * lit + vec3(1.0) * (lit > 0.9 ? 0.28 : 0.0);
    // Thin dark rim and a specular glint near the top.
    float rim = smoothstep(-1.6, -0.4, d);
    face = mix(face, uColor * 0.25, rim * 0.8);
    float glint = exp(-dot(q - vec2(-b.x * 0.3, -b.y * 0.45), q - vec2(-b.x * 0.3, -b.y * 0.45)) / (2.0 * sc * sc * 1.2));
    face += glint * 0.6;
    col = over(vec4(face, body), col);
  }

  col.a *= fade;
  if (col.a < 0.01) discard;
  fragColor = col;
}
