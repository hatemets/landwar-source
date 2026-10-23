#version 300 es
precision highp float;

in vec2 vWorld;

uniform vec2 uCenter;
uniform float uHalfSize;
uniform float uTime;     // frame tick counter (increments each frame)
uniform vec3 uColor;     // RGB [0-1], already lightened

out vec4 fragColor;

// Selection brackets: four rounded corner brackets around the unit, with a
// dark rim for contrast and a slow, shallow breath (no blinking stipple).
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vWorld - (floor(uCenter) + 0.5);
  float px = max(fwidth(p.x), 1e-4);               // tiles per screen pixel
  float breathe = 0.5 + 0.5 * sin(uTime * 0.06);
  float hs = uHalfSize + 0.15 + 0.15 * breathe;

  // Outline of a rounded square, kept only near the corners.
  float d = abs(sdRoundBox(p, vec2(hs), hs * 0.35));
  float bracketLen = hs * 0.55;
  vec2 ap = abs(p);
  float nearCorner = step(hs - bracketLen, min(ap.x, ap.y));

  float w = max(0.12, 1.2 * px);                   // stroke half-width
  float body = (1.0 - smoothstep(w - px, w + px, d)) * nearCorner;
  float rim = (1.0 - smoothstep(w + px, w + 2.5 * px, d)) * nearCorner;

  float a = max(body, rim * 0.55);
  if (a < 0.01) discard;
  vec3 col = mix(vec3(0.0), uColor, body);
  fragColor = vec4(col, a * (0.85 + 0.15 * breathe));
}
