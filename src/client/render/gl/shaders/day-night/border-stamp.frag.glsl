#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;
uniform sampler2D uPalette;
uniform sampler2D uBorderTex;     // RGBA8 — border flags from BorderComputePass
uniform sampler2D uDefenseCoverageTex; // R8 — 1.0 = defended by same-owner post
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — affiliation colors (row 0 = border)
uniform vec2 uMapSize;
uniform int uAltView;
uniform float uHighlightBrighten;
uniform float uDefenseCheckerDarken;
uniform float uEmbargoTintRatio;
uniform float uFriendlyTintRatio;
uniform vec3 uEmbargoTint;
uniform vec3 uFriendlyTint;

uniform int uSmoothEdges;         // 1 = curved territory edges (smooth-owner)
uniform float uBorderBand;        // smooth-mode border width, in score units (0..1]

in vec2 vWorldPos;
out vec4 fragColor;

// @include smooth-owner

void main() {
  ivec2 here = ivec2(floor(vWorldPos));
  if (here.x < 0 || here.y < 0 || here.x >= int(uMapSize.x) || here.y >= int(uMapSize.y)) discard;

  SmoothOwner so = smoothOwner(vWorldPos);
  float aa = max(fwidth(so.edge), 1e-4);

  ivec2 tc = so.tile;
  uint owner = so.key & uint(OWNER_MASK);
  if (owner == 0u) discard;

  // Read pre-computed border flags from BorderComputePass
  vec4 borderData = texelFetch(uBorderTex, tc, 0);
  float borderType = borderData.r;      // 0=interior, ~0.5=normal, ~1.0=highlight
  bool defense = texelFetch(uDefenseCoverageTex, tc, 0).r > 0.5; // same-owner defense post nearby
  float relation = borderData.a;        // 0.0=neutral, ~0.5=friendly, ~1.0=embargo

  bool isBorder = borderType > 0.25;
  bool isHighlightBorder = borderType > 0.75;

  // Coverage of the border stroke at this fragment.
  float alpha;
  if (so.rivalScore > 0.0 || !so.smoothed) {
    // A different owner (or empty ground) shares this cell: the stroke runs
    // along the smooth boundary, uBorderBand wide, anti-aliased on both
    // sides. In tile mode the tile flag decides, as before.
    bool sameOwnerRival = (so.rival & uint(OWNER_MASK)) == owner;
    float inner = 1.0 - smoothstep(uBorderBand - aa, uBorderBand, so.edge);
    float outer = so.rival == 0u ? smoothstep(0.0, aa, so.edge) : 1.0;
    alpha = !so.smoothed
      ? (isBorder ? 1.0 : 0.0)
      : (sameOwnerRival ? 0.0 : inner * outer);
  } else {
    // Interior cell: only the thickened hover highlight draws here.
    alpha = isHighlightBorder ? 1.0 : 0.0;
  }
  if (alpha <= 0.0) discard;

  // --- Border stamp: full-brightness border color ---
  {
    vec3 bc;
    if (uAltView != 0) {
      // Alt-view: pure affiliation color from palette row 0
      bc = texelFetch(uAffiliation, ivec2(int(owner), 0), 0).rgb;
    } else {
      float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
      bc = texture(uPalette, vec2(u, 0.75)).rgb;
      if (isHighlightBorder) {
        bc = mix(bc, vec3(1.0), uHighlightBrighten);
      }
      // Relationship tint (applied BEFORE defense checkerboard, matching game)
      if (relation > 0.75) {
        bc = mix(bc, uEmbargoTint, uEmbargoTintRatio);
      } else if (relation > 0.25) {
        bc = mix(bc, uFriendlyTint, uFriendlyTintRatio);
      }
      // Defense bonus: checkerboard darken (applied AFTER tint, matching game)
      if (defense) {
        bool checker = ((tc.x + tc.y) & 1) == 1;
        if (checker) bc *= uDefenseCheckerDarken;
      }
    }
    fragColor = vec4(bc, alpha);
  }
}
