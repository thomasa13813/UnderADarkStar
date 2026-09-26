#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: x, y, innerRadius, outerRadius
layout(location = 1) in vec4 aInstance;
// Per-instance: 0 = self, 1 = ally, 2 = enemy
layout(location = 2) in float aRelation;

uniform mat3 uCamera;
// Punitive-strike badges (relation 3/4, DarkStar H19): radius and stroke in
// world units, sized from the zoom so the ring follows the structure icon.
uniform float uBadgeRadius;
uniform float uBadgeStroke;

out vec2 vLocal;              // [-1, +1] local coords
flat out float vInnerRadius;
flat out float vOuterRadius;
flat out float vRelation;
flat out float vStrokeWidth;  // world units; < 0 = the style's default

void main() {
  vLocal = aPos * 2.0 - 1.0;
  vRelation = aRelation;
  bool badge = aRelation > 2.5;
  vInnerRadius = badge ? uBadgeRadius : aInstance.z;
  vOuterRadius = badge ? uBadgeRadius : aInstance.w;
  vStrokeWidth = badge ? uBadgeStroke : -1.0;

  // Expand quad to cover outer circle bbox + padding
  float r = vOuterRadius + (badge ? uBadgeStroke : 0.0) + 2.0;
  vec2 center = aInstance.xy + 0.5;
  vec2 worldPos = center + vLocal * r;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
