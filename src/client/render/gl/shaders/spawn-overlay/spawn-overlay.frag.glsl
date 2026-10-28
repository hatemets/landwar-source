#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;
uniform vec2 uMapSize;

uniform float uBreathRadius;   // normalized [0..1], animated via sin

// Configurable parameters (from render settings)
uniform float uHighlightRadiusSq; // tile highlight radius squared
uniform float uHighlightAlpha;    // tile highlight opacity
uniform vec4 uSelfRing;           // (ringR, glowWidth, pulse 0..1, _) — self marker
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

  // --- Self marker: a large ring with a soft glow that pulses in place ---
  if (vKind < 1.5) {
    float ringR = uSelfRing.x;
    float px = max(fwidth(dist), 1e-4);          // tiles per screen pixel
    float pulse = uSelfRing.z;
    float sigma = max(uSelfRing.y * (0.75 + 0.35 * pulse), 2.0 * px);
    float d = abs(dist - ringR);

    // A crisp rim that stays at least ~1.5 px wide zoomed out.
    float rimW = max(0.3, 1.5 * px);
    float rim = 1.0 - smoothstep(rimW - px, rimW + px, d);
    float glow = exp(-(d * d) / (2.0 * sigma * sigma)) * (0.55 + 0.3 * pulse);
    // A faint fill inside the ring, clear at the centre so the territory
    // shows through.
    float fill = dist < ringR ? (dist / ringR) * (dist / ringR) * 0.18 : 0.0;

    float a = max(max(rim * 0.95, glow), fill);
    if (a <= 0.01) discard;
    vec3 c = mix(vColor, vec3(1.0), rim * 0.6);
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
