/**
 * MoveIndicatorPass — waypoint beacon at a warship's move target: a shaded
 * diamond drops onto the tile while rings ripple across the ground. Drawn
 * with SDFs in one fragment shader.
 */

import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/move-indicator/move-indicator.frag.glsl?raw";
import vertSrc from "../shaders/move-indicator/move-indicator.vert.glsl?raw";

export class MoveIndicatorPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;

  private uCamera: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uElapsed: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uPxPerTile: WebGLUniformLocation;
  private uRippleRadius: WebGLUniformLocation;
  private uPinSize: WebGLUniformLocation;
  private uLineWidth: WebGLUniformLocation;
  private uDuration: WebGLUniformLocation;

  private active = false;
  private centerX = 0;
  private centerY = 0;
  private colorR = 1;
  private colorG = 0;
  private colorB = 0;
  private startTime = 0;

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;
    this.program = createProgram(gl, vertSrc, fragSrc, "MoveIndicatorPass");

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uElapsed = gl.getUniformLocation(this.program, "uElapsed")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uPxPerTile = gl.getUniformLocation(this.program, "uPxPerTile")!;
    this.uRippleRadius = gl.getUniformLocation(this.program, "uRippleRadius")!;
    this.uPinSize = gl.getUniformLocation(this.program, "uPinSize")!;
    this.uLineWidth = gl.getUniformLocation(this.program, "uLineWidth")!;
    this.uDuration = gl.getUniformLocation(this.program, "uDuration")!;

    // Unit quad [0,1]
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Trigger the move indicator at world tile (x, y) with player color.
   * Each call replaces the previous indicator.
   */
  show(x: number, y: number, r: number, g: number, b: number): void {
    this.active = true;
    this.centerX = x;
    this.centerY = y;
    this.colorR = r;
    this.colorG = g;
    this.colorB = b;
    this.startTime = performance.now();
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (!this.active) return;

    const s = this.settings.moveIndicator;
    const elapsed = performance.now() - this.startTime;
    if (elapsed >= s.duration) {
      this.active = false;
      return;
    }

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uCenter, this.centerX, this.centerY);
    gl.uniform1f(this.uElapsed, elapsed);
    gl.uniform3f(this.uColor, this.colorR, this.colorG, this.colorB);
    gl.uniform1f(this.uPxPerTile, zoom);
    gl.uniform1f(this.uRippleRadius, s.rippleRadius);
    gl.uniform1f(this.uPinSize, s.pinSize);
    gl.uniform1f(this.uLineWidth, s.lineWidth);
    gl.uniform1f(this.uDuration, s.duration);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
