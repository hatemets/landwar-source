#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;
uniform vec2 uMapSize;

uniform float uBreathRadius;   // normalized [0..1], animated via sin

// Configurable parameters (from render settings)
uniform float uHighlightRadiusSq; // tile highlight radius squared
uniform float uHighlightAlpha;    // tile highlight opacity
uniform vec4 uSelfOrbit;          // (orbitR, dotR, angle, _) — swirling self marker
uniform vec4 uMateRadii;          // (minR, maxR, _, _)
uniform vec2 uGradientStops;      // (innerEdge, solidEnd)

in vec2 vWorldPos;
flat in vec2 vCenter;
flat in float vKind;   // 0 = enemy highlight, 1 = self ring, 2 = teammate ring
flat in vec3 vColor;

out vec4 fragColor;

void main() {
  float dx = vWorldPos.x - vCenter.x;
  float dy = vWorldPos.y - vCenter.y;
  float distSq = dx * dx + dy * dy;
  float dist = sqrt(distSq);

  // --- Enemy tile highlights: only unowned tiles within radius ---
  if (vKind < 0.5) {
    ivec2 tc = ivec2(floor(vWorldPos));
    if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
      discard;
    if (distSq > uHighlightRadiusSq) discard;
    uint raw = texelFetch(uTileTex, tc, 0).r;
    if ((raw & uint(OWNER_MASK)) != 0u) discard; // owned tile → no highlight
    fragColor = vec4(vColor, uHighlightAlpha);
    return;
  }

  // --- Self marker: a glowing dot orbiting the spawn, trailing a fading arc ---
  if (vKind < 1.5) {
    float orbitR = uSelfOrbit.x;
    float px = max(fwidth(dist), 1e-4);          // tiles per screen pixel
    float dotR = max(uSelfOrbit.y, 2.5 * px);    // stays visible zoomed out
    float angle = uSelfOrbit.z;
    vec2 dotPos = orbitR * vec2(cos(angle), sin(angle));
    float d = length(vec2(dx, dy) - dotPos);

    float core = 1.0 - smoothstep(dotR - px, dotR + px, d);
    float halo = exp(-(d * d) / (2.0 * (dotR * 1.8) * (dotR * 1.8)));

    // Trail: the arc of the orbit just behind the dot, thinning and fading.
    const float TAU = 6.2831853;
    const float TRAIL = 2.4;                      // radians of trail
    float behind = mod(angle - atan(dy, dx), TAU);
    float tail = 0.0;
    if (behind < TRAIL) {
      float k = 1.0 - behind / TRAIL;
      float width = dotR * (0.25 + 0.75 * k);
      float band = 1.0 - smoothstep(width - px, width + px, abs(dist - orbitR));
      tail = band * k * k * 0.8;
    }
    // A faint full orbit line anchors the motion.
    float track = (1.0 - smoothstep(0.0, 1.5 * px, abs(dist - orbitR))) * 0.18;

    float a = max(max(core, halo * 0.7), max(tail, track));
    if (a <= 0.01) discard;
    vec3 c = mix(vColor, vec3(1.0), core * 0.85);
    fragColor = vec4(c, a);
    return;
  }

  // --- Teammate breathing ring ---
  float minR = uMateRadii.x;
  float maxR = uMateRadii.y;
  vec3 color = vColor;

  // Breathing ring: the gradient halo shrinks/expands in radius AND its
  // opacity pulses in phase with the breath — both driven by uBreathRadius.
  // Smooth bell shape: glow ramps up from center to the inner edge, stays
  // solid through the ring's body, then fades out past solidEnd.
  float scale = 0.5 + 0.65 * uBreathRadius; // 0.5 → 1.15 of base radius
  float bMinR = minR * scale;
  float bMaxR = maxR * scale;
  float range = bMaxR - bMinR;
  float t = (dist - bMinR) / range;
  float solidEnd = uGradientStops.y;
  float alpha = 0.0;
  if (dist < bMinR) {
    // Inner glow: transparent at the center (so your territory shows through)
    // ramping up to fully solid at the ring's inner edge.
    alpha = dist / max(bMinR, 0.001);
  } else if (t < solidEnd) {
    alpha = 1.0;
  } else if (t < 1.0) {
    alpha = 1.0 - (t - solidEnd) / (1.0 - solidEnd);
  }
  if (alpha <= 0.0) discard;
  // Opacity pulses 65% → 100% in phase with the radius.
  alpha *= 0.65 + 0.35 * uBreathRadius;
  fragColor = vec4(color, alpha);
}
