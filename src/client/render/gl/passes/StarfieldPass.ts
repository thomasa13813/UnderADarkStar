/**
 * StarfieldPass — the deep-space background under the map.
 *
 * Draws the shipped starfield image (the home page's sky, rendered larger by
 * scripts/generateStarfield.ts so its grain is about a tile per pixel) over
 * the map quad, so it pans and zooms with the map; TerrainPass then blends
 * translucent water ("deep space") over it. Outside the map quad the clear
 * colour stays, matching the opaque impassable void inside it, so a map's
 * silhouette still reads. The image is scaled to cover the whole map with its
 * aspect preserved, centred and cropped on the long side. Magnified pixels stay crisp (NEAREST, matching the home page's
 * `image-rendering: pixelated`); minified ones are mipmapped so a zoomed-out
 * view doesn't shimmer.
 *
 * Nothing is drawn until the image has loaded; the clear colour shows
 * meanwhile.
 */

import { assetUrl } from "src/core/AssetUrls";
import type { RenderSettings } from "../RenderSettings";
import vertSrc from "../shaders/shared/map-quad.vert.glsl?raw";
import fragSrc from "../shaders/starfield/starfield.frag.glsl?raw";
import { createMapQuad, createProgram } from "../utils/GlUtils";

const starfieldUrl = assetUrl("images/starfield-map.png");

export class StarfieldPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture | null = null;
  private imgW = 1;
  private imgH = 1;
  private disposed = false;

  private uCamera: WebGLUniformLocation;
  private uUvScale: WebGLUniformLocation;
  private uUvOffset: WebGLUniformLocation;

  constructor(
    private gl: WebGL2RenderingContext,
    private settings: RenderSettings,
    private mapW: number,
    private mapH: number,
  ) {
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uUvScale = gl.getUniformLocation(this.program, "uUvScale")!;
    this.uUvOffset = gl.getUniformLocation(this.program, "uUvOffset")!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, "uMapSize"), mapW, mapH);

    this.vao = createMapQuad(gl, mapW, mapH);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.disposed) return;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.imgW = img.naturalWidth || 1;
      this.imgH = img.naturalHeight || 1;
      this.tex = tex;
    };
    img.src = starfieldUrl;
  }

  /**
   * Map-space UV → image UV: cover the map with the image's aspect preserved,
   * centred, cropping the long side.
   */
  static uvTransform(
    mapW: number,
    mapH: number,
    imgW: number,
    imgH: number,
  ): { scale: [number, number]; offset: [number, number] } {
    const s = Math.max(mapW / imgW, mapH / imgH);
    const sx = mapW / (s * imgW);
    const sy = mapH / (s * imgH);
    return { scale: [sx, sy], offset: [0.5 * (1 - sx), 0.5 * (1 - sy)] };
  }

  /** Draw the background. Call before terrain with blending disabled. */
  draw(cameraMatrix: Float32Array): void {
    if (!this.tex) return;
    const gl = this.gl;
    const { scale, offset } = StarfieldPass.uvTransform(
      this.mapW,
      this.mapH,
      this.imgW,
      this.imgH,
    );
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uUvScale, scale[0], scale[1]);
    gl.uniform2f(this.uUvOffset, offset[0], offset[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.disposed = true;
    const gl = this.gl;
    gl.deleteProgram(this.program);
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = null;
  }
}
