/**
 * RailroadPass — trade lanes (DarkStar S7, docs/DarkStar-Design.md §6.19).
 *
 * Every railroad is one straight segment between its two stations, drawn as
 * an instanced quad with round caps, anti-aliased in screen space and
 * coloured by the owner of the tile under each fragment (as the tile rails
 * were). A lane under construction grows in from both ends. Ghost lanes for
 * the build preview are the same segments at half strength; a lane a new
 * station would snap onto is drawn green. Hidden below a zoom threshold.
 *
 * Data flow:
 *   Float32Array railSegments (RailroadCache.packSegments) → instance buffer
 *   GhostPreviewData         → ghost segments + snap highlights
 *   R8UI terrainTex          → strait crossings get the bridge tint
 *   R16UI tileTex (shared)   → owner lookup for lane color
 *   RGBA32F paletteTex       → player color lookup
 *   RGBA32F effectTex (shared) → per-owner railroad cosmetic effect
 */

import type { GhostPreviewData, TerrainRect } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import fragSrc from "../shaders/railroad/trade-lane.frag.glsl?raw";
import vertSrc from "../shaders/railroad/trade-lane.vert.glsl?raw";
import {
  getPaletteSize,
  MAX_TRAIL_COLORS,
  RAILROAD_EFFECT_BLOCK,
} from "../utils/ColorUtils";
import { createProgram, createTexture2D, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

/** Floats per packed segment: x0, y0, x1, y1, headFrac, tailFrac. */
export const SEGMENT_FLOATS = 6;
// Per-instance: x0, y0, x1, y1, head, tail, kind, pad
const FLOATS_PER_INSTANCE = 8;
const KIND_LANE = 0;
const KIND_GHOST = 1;
const KIND_HIGHLIGHT = 2;

export class RailroadPass {
  private program: WebGLProgram;
  private tileTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private effectTex: WebGLTexture;
  private terrainTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;
  private instancesDirty = false;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uHalfWidth: WebGLUniformLocation;
  private uRailAlpha: WebGLUniformLocation;
  private uRailFade: WebGLUniformLocation;
  private uGhostOwnerID: WebGLUniformLocation;
  private uLocalPlayerID: WebGLUniformLocation;
  private uLocalRailColor: WebGLUniformLocation;
  private uHoverOwner: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;
  private settings: RenderSettings;

  /** The live lanes, packed (see SEGMENT_FLOATS); a copy, ours. */
  private segments = new Float32Array(0);
  private segmentCount = 0;
  /** Ghost lanes as [x0, y0, x1, y1] and the tiles of lanes to highlight. */
  private ghostSegments: number[] = [];
  private highlightTiles: number[] = [];
  private ghostOwnerID = 0;

  private localPlayerID = 0;
  private localRailColor: [number, number, number] = [0.75, 0.75, 0.75];
  /** Hovered territory's owner (0 = none) — shows that player's railroad effect. */
  private hoverOwner = 0;

  /** Wall-clock start, for uTime (seconds) — matches TrailPass so the
   *  railroad effect animates at the same pace as the trail effects. */
  private readonly startTime = performance.now();

  constructor(
    private gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    paletteTex: WebGLTexture,
    effectTex: WebGLTexture,
    terrainBytes: Uint8Array,
    settings: RenderSettings,
  ) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.paletteTex = paletteTex;
    this.effectTex = effectTex;
    this.settings = settings;

    this.program = createProgram(
      gl,
      vertSrc,
      shaderSrc(fragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        RAILROAD_EFFECT_ROW_BASE: RAILROAD_EFFECT_BLOCK * MAX_TRAIL_COLORS,
        ...TILE_DEFINES,
      }),
    );

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uHalfWidth = gl.getUniformLocation(this.program, "uHalfWidth")!;
    this.uRailAlpha = gl.getUniformLocation(this.program, "uRailAlpha")!;
    this.uRailFade = gl.getUniformLocation(this.program, "uRailFade")!;
    this.uGhostOwnerID = gl.getUniformLocation(this.program, "uGhostOwnerID")!;
    this.uLocalPlayerID = gl.getUniformLocation(
      this.program,
      "uLocalPlayerID",
    )!;
    this.uLocalRailColor = gl.getUniformLocation(
      this.program,
      "uLocalRailColor",
    )!;
    this.uHoverOwner = gl.getUniformLocation(this.program, "uHoverOwner")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTerrainTex"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uEffect"), 5);

    // R8UI terrain texture (uploaded once; strait crossings get the bridge tint)
    this.terrainTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: terrainBytes,
      filter: gl.NEAREST,
    });

    // VAO: unit quad + per-instance segment and style
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      64,
      FLOATS_PER_INSTANCE,
    );
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  /** The live lanes, packed SEGMENT_FLOATS per lane; `count` lanes are read. */
  uploadRailSegments(segments: Float32Array, count: number): void {
    const n = count * SEGMENT_FLOATS;
    if (this.segments.length < n) {
      this.segments = new Float32Array(Math.max(n, 64 * SEGMENT_FLOATS));
    }
    this.segments.set(segments.subarray(0, n));
    this.segmentCount = count;
    this.instancesDirty = true;
  }

  setLocalPlayer(smallID: number): void {
    this.localPlayerID = smallID;
  }

  /** Rail color for the local player (0–1 RGB). */
  setLocalRailColor(r: number, g: number, b: number): void {
    this.localRailColor = [r, g, b];
  }

  /** Hovered territory's owner (0 = none) — shows that player's railroad effect. */
  setHighlightOwner(ownerID: number): void {
    this.hoverOwner = ownerID;
  }

  /**
   * Sub-upload terrain bytes for regions that changed (water-nuke
   * conversions). Each rect's bytes are stored row-major, concatenated in
   * `bytes` in rect order; one texSubImage2D per rect.
   */
  applyTerrainRects(rects: readonly TerrainRect[], bytes: Uint8Array): void {
    if (rects.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    let offset = 0;
    for (const r of rects) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        r.x,
        r.y,
        r.w,
        r.h,
        gl.RED_INTEGER,
        gl.UNSIGNED_BYTE,
        bytes,
        offset,
      );
      offset += r.w * r.h;
    }
  }

  updateGhostPreview(data: GhostPreviewData | null): void {
    this.ghostSegments.length = 0;
    this.highlightTiles.length = 0;
    if (data) {
      const w = this.mapW;
      for (const path of data.ghostRailPaths) {
        if (path.length === 0) continue;
        const a = path[0];
        const b = path[path.length - 1];
        this.ghostSegments.push(
          a % w,
          (a - (a % w)) / w,
          b % w,
          (b - (b % w)) / w,
        );
      }
      for (const ref of data.overlappingRailroads)
        this.highlightTiles.push(ref);
      this.ghostOwnerID = data.ownerID;
    } else {
      this.ghostOwnerID = 0;
    }
    this.instancesDirty = true;
  }

  // A lane is highlighted when any tile the build would snap onto lies on
  // it (within a tile of its centreline).
  private touchesHighlight(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): boolean {
    const w = this.mapW;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (const ref of this.highlightTiles) {
      const px = ref % w;
      const py = (ref - px) / w;
      let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = x0 + dx * t - px;
      const ey = y0 + dy * t - py;
      if (ex * ex + ey * ey <= 1.0) return true;
    }
    return false;
  }

  private rebuildInstances(): void {
    const laneCount = this.segmentCount;
    const ghostCount = this.ghostSegments.length / 4;
    const total = laneCount + ghostCount;
    this.instanceBuf.ensureCapacity(Math.max(total, 1));
    const buf = this.instanceBuf.float32;
    let off = 0;
    for (let i = 0; i < laneCount; i++) {
      const s = i * SEGMENT_FLOATS;
      const x0 = this.segments[s];
      const y0 = this.segments[s + 1];
      const x1 = this.segments[s + 2];
      const y1 = this.segments[s + 3];
      buf[off++] = x0;
      buf[off++] = y0;
      buf[off++] = x1;
      buf[off++] = y1;
      buf[off++] = this.segments[s + 4];
      buf[off++] = this.segments[s + 5];
      buf[off++] =
        this.highlightTiles.length > 0 && this.touchesHighlight(x0, y0, x1, y1)
          ? KIND_HIGHLIGHT
          : KIND_LANE;
      buf[off++] = 0;
    }
    for (let i = 0; i < ghostCount; i++) {
      const g = i * 4;
      buf[off++] = this.ghostSegments[g];
      buf[off++] = this.ghostSegments[g + 1];
      buf[off++] = this.ghostSegments[g + 2];
      buf[off++] = this.ghostSegments[g + 3];
      buf[off++] = 1;
      buf[off++] = 1;
      buf[off++] = KIND_GHOST;
      buf[off++] = 0;
    }
    this.instanceCount = total;
    if (total > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf, 0, total * FLOATS_PER_INSTANCE);
    }
    this.instancesDirty = false;
  }

  /** Draw the lanes. Must be called with alpha blending enabled. */
  draw(cameraMatrix: Float32Array, zoom: number): void {
    const gl = this.gl;
    const rs = this.settings.railroad;

    if (this.instancesDirty) this.rebuildInstances();
    if (this.instanceCount === 0) return;

    // Fade out as zoom drops below railMinZoom; fully invisible at railMinZoom - railFadeRange
    const fadeRange = Math.max(rs.railFadeRange, 0);
    const fadeStart = rs.railMinZoom - fadeRange;
    const fade =
      fadeRange <= 0
        ? zoom >= rs.railMinZoom
          ? 1
          : 0
        : Math.min(1, Math.max(0, (zoom - fadeStart) / fadeRange));
    if (fade <= 0) return;

    // Lane width: a fraction of a tile close up, never thinner than ~2 px.
    const halfWidth = Math.max(0.2 * rs.railThickness, 1.0 / zoom);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uTime, (performance.now() - this.startTime) / 1000);
    gl.uniform1f(this.uHalfWidth, halfWidth);
    gl.uniform1f(this.uRailAlpha, rs.railAlpha);
    gl.uniform1f(this.uRailFade, fade);
    gl.uniform1f(this.uGhostOwnerID, this.ghostOwnerID);
    gl.uniform1f(this.uLocalPlayerID, this.localPlayerID);
    gl.uniform1f(this.uHoverOwner, this.hoverOwner);
    gl.uniform3f(
      this.uLocalRailColor,
      this.localRailColor[0],
      this.localRailColor[1],
      this.localRailColor[2],
    );

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTex);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.terrainTex);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
    // Don't delete tileTex, paletteTex, or effectTex — shared with other passes
  }
}
