// Smooth ownership (included into territory.frag and border-stamp.frag).
//
// Tiles are squares, so drawing each fragment in the colour of the tile under
// it gives stair-stepped edges. Instead, resolve the owner at the fragment's
// sub-tile position from the four nearest tile centres: each owner scores the
// bilinear weights of the corners it holds, and the highest score wins. The
// boundary between two owners is where their scores meet, which follows a
// smooth curve through the tile grid. With uSmoothEdges off it degrades to
// the plain tile lookup (also used when zoomed far out).
//
// Expects uTileTex, uMapSize and uSmoothEdges to be declared, and OWNER_MASK
// / FALLOUT_BIT to be defined.

struct SmoothOwner {
  uint key;    // tile value masked to owner + fallout bit
  ivec2 tile;  // the winner's corner tile nearest the fragment
  uint rival;  // runner-up key (meaningless when rivalScore == 0)
  float edge;  // winner score minus runner-up score; 0 on the boundary
  float rivalScore;
  bool smoothed; // false when the plain tile lookup was used
};

const uint SO_KEY_MASK = uint(OWNER_MASK) | (1u << FALLOUT_BIT);

uint soKeyAt(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uMapSize.x) || c.y >= int(uMapSize.y))
    return 0u;
  return texelFetch(uTileTex, c, 0).r & SO_KEY_MASK;
}

SmoothOwner smoothOwner(vec2 worldPos) {
  SmoothOwner so;
  // Zoomed far out a tile covers a pixel or two and curves are invisible;
  // keep the plain lookup there so borders stay a full tile wide.
  float tilePixels = 1.0 / max(fwidth(worldPos.x), 1e-6);
  if (uSmoothEdges == 0 || tilePixels < 3.0) {
    so.tile = ivec2(floor(worldPos));
    so.key = soKeyAt(so.tile);
    so.rival = 0u;
    so.edge = 1.0;
    so.rivalScore = 0.0;
    so.smoothed = false;
    return so;
  }

  vec2 q = worldPos - 0.5;
  ivec2 b = ivec2(floor(q));
  vec2 f = q - vec2(b);
  ivec2 c[4] = ivec2[4](b, b + ivec2(1, 0), b + ivec2(0, 1), b + ivec2(1, 1));
  float w[4] = float[4](
    (1.0 - f.x) * (1.0 - f.y),
    f.x * (1.0 - f.y),
    (1.0 - f.x) * f.y,
    f.x * f.y
  );
  uint k[4];
  for (int i = 0; i < 4; i++) k[i] = soKeyAt(c[i]);

  float s[4];
  for (int i = 0; i < 4; i++) {
    s[i] = 0.0;
    for (int j = 0; j < 4; j++) {
      if (k[j] == k[i]) s[i] += w[j];
    }
  }

  // Winner: highest score; ties go to the nearer corner so the result is
  // stable along the exact midline.
  int bi = 0;
  for (int i = 1; i < 4; i++) {
    if (s[i] > s[bi] + 1e-5 || (abs(s[i] - s[bi]) <= 1e-5 && w[i] > w[bi]))
      bi = i;
  }
  so.key = k[bi];

  // The winner's tile nearest the fragment carries its per-tile data.
  int ti = bi;
  for (int i = 0; i < 4; i++) {
    if (k[i] == so.key && w[i] > w[ti]) ti = i;
  }
  so.tile = c[ti];

  so.rivalScore = 0.0;
  so.rival = 0u;
  for (int i = 0; i < 4; i++) {
    if (k[i] != so.key && s[i] > so.rivalScore) {
      so.rivalScore = s[i];
      so.rival = k[i];
    }
  }
  so.edge = s[bi] - so.rivalScore;
  so.smoothed = true;
  return so;
}
