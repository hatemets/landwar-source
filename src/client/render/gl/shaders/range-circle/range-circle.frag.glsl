#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1]

uniform float uRadius;
uniform vec3 uColor;

out vec4 fragColor;

// Range dome seen from above: a faint fill that brightens toward the rim
// (fresnel-like), a crisp hairline edge, and a soft glint on the upper-left
// shoulder so the area reads as a raised shield rather than a flat disc.
void main() {
  float dist = length(vLocal) * (uRadius + 1.0); // world-space distance from center
  float px = max(fwidth(dist), 1e-4);            // tiles per screen pixel
  float r = dist / uRadius;                      // 0 at centre, 1 on the edge

  float inside = 1.0 - smoothstep(uRadius - px, uRadius + px, dist);
  if (inside <= 0.0) discard;

  // Fresnel-style fill: nearly clear in the middle, denser near the rim.
  float fill = mix(0.06, 0.22, r * r * r);

  // Hairline rim (about 1.5 screen px) with a dark inner companion line.
  float rim = 1.0 - smoothstep(0.0, 1.5 * px, abs(dist - (uRadius - px)));
  float inner = 1.0 - smoothstep(0.0, 1.0 * px, abs(dist - (uRadius - 3.0 * px)));

  // Glint: brightest on the upper-left shoulder of the dome.
  vec2 dir = normalize(vLocal + 1e-5);
  float facing = max(dot(dir, normalize(vec2(-0.6, -0.8))), 0.0);
  float glint = pow(facing, 6.0) * smoothstep(0.55, 0.95, r) * 0.35;

  vec3 col = uColor;
  float alpha = fill + glint;
  col = mix(col, vec3(1.0), glint);
  alpha = max(alpha, rim * 0.85);
  col = mix(col, uColor * 0.2, inner * 0.6 * (1.0 - rim));
  alpha = max(alpha, inner * 0.25);

  fragColor = vec4(col, alpha * inside);
}
