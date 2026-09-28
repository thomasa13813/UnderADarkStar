#version 300 es
precision highp float;
uniform sampler2D uTex;
// Map-space UV (from the shared map-quad vertex shader) → image UV; cover-fit
// or tiled, see StarfieldPass.uvTransform.
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
in vec2 vUV;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(uTex, vUV * uUvScale + uUvOffset).rgb, 1.0);
}
