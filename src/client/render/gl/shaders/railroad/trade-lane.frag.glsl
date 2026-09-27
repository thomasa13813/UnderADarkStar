#version 300 es
precision highp float;
precision highp usampler2D;

// Trade lanes (DarkStar S7): anti-aliased straight segments coloured by the
// owner of the tile under each fragment, as the tile rails were.

uniform usampler2D uTileTex;         // R16UI — tile state (for owner lookup)
uniform sampler2D  uPalette;         // RGBA32F — player colors
uniform usampler2D uTerrainTex;      // R8UI — terrain bytes (bit 7 = isLand)
uniform sampler2D  uEffect;          // RGBA32F — shared effect palette, keyed by
                                     //   ownerID; the railroad block starts at
                                     //   row RAILROAD_EFFECT_ROW_BASE (see
                                     //   trail.frag.glsl for the row layout)

uniform vec2 uMapSize;
uniform float uZoom;
uniform float uTime;
uniform float uHalfWidth;            // world units
uniform float uRailAlpha;
uniform float uRailFade;             // Zoom-based fade multiplier (0..1)
uniform float uGhostOwnerID;         // Player smallID for ghost lane color
uniform float uLocalPlayerID;        // Local player smallID (0 = none)
uniform vec3 uLocalRailColor;        // Lane color for the local player's lanes
uniform float uHoverOwner;           // Hovered territory's owner smallID (0 = none)

in vec2 vWorldPos;
in float vAlong;
in float vAcross;
flat in float vLen;
flat in vec4 vStyle;
out vec4 fragColor;

// The owner's railroad cosmetic color, if equipped (see railroad.frag.glsl's
// history: the same catalog attributes look identical on trails).
bool railroadEffectColor(int owner, out vec3 color) {
  const int rowBase = RAILROAD_EFFECT_ROW_BASE;
  int count = int(texelFetch(uEffect, ivec2(owner, rowBase), 0).a + 0.5);
  if (count <= 0) return false;
  if (count == 1) {
    color = texelFetch(uEffect, ivec2(owner, rowBase), 0).rgb;
  } else if (int(texelFetch(uEffect, ivec2(owner, rowBase + 1), 0).a + 0.5) == 1) {
    float frequency = texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a;
    float t = uTime * frequency;
    int i = int(t) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(t));
  } else {
    float colorSize = max(texelFetch(uEffect, ivec2(owner, rowBase + 2), 0).a, 0.001);
    float movementSpeed = texelFetch(uEffect, ivec2(owner, rowBase + 3), 0).a;
    float cycle = colorSize * float(count);
    float phase =
      fract((vWorldPos.x + vWorldPos.y - uTime * movementSpeed) / cycle);
    float f = phase * float(count);
    int i = int(f) % count;
    int j = (i + 1) % count;
    vec3 a = texelFetch(uEffect, ivec2(owner, rowBase + i), 0).rgb;
    vec3 b = texelFetch(uEffect, ivec2(owner, rowBase + j), 0).rgb;
    color = mix(a, b, fract(f));
  }
  return true;
}

void main() {
  // Distance to the segment with round caps.
  float over = max(max(-vAlong, vAlong - vLen), 0.0);
  float dist = sqrt(over * over + vAcross * vAcross);
  float aa = 0.75 / uZoom; // ~1 screen pixel in world units
  float cov = 1.0 - smoothstep(uHalfWidth - aa, uHalfWidth + aa, dist);
  if (cov <= 0.002) discard;

  float kind = vStyle.z;
  // Under construction: the lane grows in from both ends.
  if (kind < 0.5) {
    float t = clamp(vAlong / vLen, 0.0, 1.0);
    if (t > vStyle.x && t < 1.0 - vStyle.y) discard;
  }

  ivec2 tc = ivec2(floor(vWorldPos));
  bool onMap = tc.x >= 0 && tc.y >= 0 && tc.x < int(uMapSize.x) && tc.y < int(uMapSize.y);

  vec3 color;
  float alpha = uRailAlpha * cov * uRailFade;
  if (kind > 0.5 && kind < 1.5) {
    // Ghost lane: the builder's colour, half strength.
    color = uGhostOwnerID <= 0.0
      ? vec3(0.75)
      : (uGhostOwnerID == uLocalPlayerID
        ? uLocalRailColor
        : texture(uPalette, vec2((uGhostOwnerID + 0.5) / float(PALETTE_SIZE), 0.75)).rgb);
    alpha *= 0.5;
  } else {
    uint owner = onMap ? (texelFetch(uTileTex, tc, 0).r & uint(OWNER_MASK)) : 0u;
    color = owner == 0u
      ? vec3(0.75)
      : (owner == uint(uLocalPlayerID)
        ? uLocalRailColor
        : texture(uPalette, vec2((float(owner) + 0.5) / float(PALETTE_SIZE), 0.75)).rgb);
    vec3 effectRGB;
    if (owner != 0u &&
        (owner == uint(uLocalPlayerID) || owner == uint(uHoverOwner + 0.5)) &&
        railroadEffectColor(int(owner), effectRGB)) {
      color = effectRGB;
    }
    // A strait crossing: the bridge's red-brown shows through.
    if (onMap && (texelFetch(uTerrainTex, tc, 0).r & 0x80u) == 0u) {
      color = mix(vec3(0.773, 0.271, 0.282), color, 0.5);
    }
    // Snapping a new station onto this lane: green.
    if (kind > 1.5) color = vec3(0.2, 0.85, 0.3);
  }
  // A dark rim keeps the lane legible over any territory colour.
  float rim = smoothstep(uHalfWidth - aa - 0.6 / uZoom, uHalfWidth - aa, dist);
  color = mix(color, color * 0.35, rim * 0.8);
  fragColor = vec4(color, alpha);
}
