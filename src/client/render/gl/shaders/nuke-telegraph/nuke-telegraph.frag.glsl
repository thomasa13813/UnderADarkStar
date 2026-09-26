#version 300 es
precision highp float;

in vec2 vLocal;
flat in float vInnerRadius;
flat in float vOuterRadius;
flat in float vRelation;        // 0 = self, 1 = ally, 2 = enemy, 3/4 = badge
flat in float vStrokeWidth;     // badge stroke in world units, or < 0

uniform float uTime;            // seconds
uniform vec4 uTelegraphStyle;   // (strokeWidth, dashLen, gapLen, rotationSpeed)
uniform vec4 uTelegraphAlpha;   // (baseAlpha, pulseAmplitude, pulseSpeed, fillAlphaOffset)
uniform vec3 uColorSelf;
uniform vec3 uColorAlly;
uniform vec3 uColorEnemy;

out vec4 fragColor;

void main() {
  float strokeWidth = vStrokeWidth >= 0.0 ? vStrokeWidth : uTelegraphStyle.x;
  float dashLen = uTelegraphStyle.y;
  float gapLen = uTelegraphStyle.z;
  float rotationSpeed = uTelegraphStyle.w;
  float baseAlphaVal = uTelegraphAlpha.x;
  float pulseAmp = uTelegraphAlpha.y;
  float pulseSpd = uTelegraphAlpha.z;
  float fillAlphaOff = uTelegraphAlpha.w;

  float paddedR = vOuterRadius + (vStrokeWidth >= 0.0 ? vStrokeWidth : 0.0) + 2.0;
  float dist = length(vLocal) * paddedR;

  // Base alpha with gentle pulsation
  float baseAlpha = baseAlphaVal + pulseAmp * sin(uTime * pulseSpd);

  // Inner circle: filled disc + stroke
  float innerFill = 1.0 - smoothstep(vInnerRadius - 0.5, vInnerRadius, dist);
  float innerStroke = smoothstep(vInnerRadius - strokeWidth - 0.5, vInnerRadius - strokeWidth, dist)
                    * (1.0 - smoothstep(vInnerRadius + strokeWidth, vInnerRadius + strokeWidth + 0.5, dist));

  // Outer circle: dashed ring
  float outerRing = smoothstep(vOuterRadius - strokeWidth - 0.5, vOuterRadius - strokeWidth, dist)
                  * (1.0 - smoothstep(vOuterRadius + strokeWidth, vOuterRadius + strokeWidth + 0.5, dist));

  // Dash pattern on outer ring
  float angle = atan(vLocal.y, vLocal.x);
  float arcPos = angle * vOuterRadius;
  float period = dashLen + gapLen;
  float dashPhase = mod(arcPos + uTime * rotationSpeed, period);
  float dashAlpha = 1.0 - smoothstep(dashLen - 0.5, dashLen + 0.5, dashPhase);

  // A punitive-strike badge (relation 3 or 4, DarkStar H19) is a plain
  // solid ring: no fill over the silo's sprite, no dashes.
  bool badge = vRelation > 2.5;

  // Combine
  float fillAlpha = badge ? 0.0 : innerFill * max(0.0, baseAlpha - fillAlphaOff);
  float strokeAlpha = innerStroke * baseAlpha;
  float outerAlpha = outerRing * (badge ? 1.0 : dashAlpha) * baseAlpha;

  float alpha = max(max(fillAlpha, strokeAlpha), outerAlpha);
  if (alpha < 0.01) discard;

  // 3 and 4 are the punitive-strike badges on a flagged silo (DarkStar
  // H19): red for a Nuclear Warhead launch, white for Antimatter.
  vec3 color = vRelation < 0.5 ? uColorSelf
             : vRelation < 1.5 ? uColorAlly
             : vRelation < 2.5 ? uColorEnemy
             : vRelation < 3.5 ? vec3(1.0, 0.22, 0.18)
             : vec3(0.97, 0.97, 1.0);
  fragColor = vec4(color, alpha);
}
