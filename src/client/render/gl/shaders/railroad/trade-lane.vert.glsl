#version 300 es
precision highp float;

// Trade lanes (DarkStar S7): every railroad is one straight segment between
// its two stations, drawn as an instanced quad with round caps.

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance: x0, y0, x1, y1 (tile coordinates of the two ends)
layout(location = 1) in vec4 aSeg;
// Per-instance: head fraction, tail fraction (revealed from each end while
// under construction; 1,1 when complete), kind (0 lane, 1 ghost, 2 highlight)
layout(location = 2) in vec4 aStyle;

uniform mat3 uCamera;
uniform float uHalfWidth; // world units

out vec2 vWorldPos;
out float vAlong;  // world units along the segment, from the first end
out float vAcross; // signed world units off the centreline
flat out float vLen;
flat out vec4 vStyle;

void main() {
  vec2 a = aSeg.xy + 0.5;
  vec2 b = aSeg.zw + 0.5;
  vec2 d = b - a;
  float len = max(length(d), 1e-4);
  vec2 dir = d / len;
  vec2 n = vec2(-dir.y, dir.x);
  float along = mix(-uHalfWidth, len + uHalfWidth, aPos.x);
  float across = (aPos.y * 2.0 - 1.0) * uHalfWidth;
  vec2 p = a + dir * along + n * across;

  vWorldPos = p;
  vAlong = along;
  vAcross = across;
  vLen = len;
  vStyle = aStyle;

  vec3 clip = uCamera * vec3(p, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
