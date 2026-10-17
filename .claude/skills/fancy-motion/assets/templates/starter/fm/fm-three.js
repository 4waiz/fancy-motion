// fm-three.js — Three.js helpers for /fancy-motion: a pinned renderer, DOM↔3D quad projection,
// an instanced voxel builder with baked contact shading, a CPU-driven particle field, a fading
// grid floor, a "screen hole" material (lets DOM screens show through with correct occlusion),
// and TTF loading for extruded type. Everything renders from explicit time — no clocks.
// Part of the /fancy-motion skill (author: Awaiz Ahmed).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Font } from "three/addons/loaders/FontLoader.js";

export { THREE };

export function createRenderer(canvas, { width = 1920, height = 1080, exposure = 1.0, shadows = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.setClearColor(0x000000, 0);
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x; use light.shadow.radius for softness
  }
  return renderer;
}

// ---------------------------------------------------------------- projection
const _v = new THREE.Vector3();
/** World point → screen pixels. Returns [x, y, inFront]. */
export function toScreen(camera, p, w = 1920, h = 1080) {
  _v.copy(p).project(camera);
  return [(_v.x * 0.5 + 0.5) * w, (-_v.y * 0.5 + 0.5) * h, _v.z < 1];
}
/** Four world-space corners of a w×h plane on object's local XY (TL, TR, BR, BL). */
export function planeCorners(object, w, h) {
  object.updateWorldMatrix(true, false);
  return [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(object.matrixWorld));
}
/** Project an object's local w×h plane to a screen quad for pinToQuad(). */
export function projectPlane(camera, object, w, h, sw = 1920, sh = 1080) {
  return planeCorners(object, w, h).map((p) => toScreen(camera, p, sw, sh).slice(0, 2));
}

/** Position + look-at + fov in one call (keeps camera moves declarative). */
export function aim(camera, pos, target, fov) {
  camera.position.set(pos[0], pos[1], pos[2]);
  if (fov && camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(target[0], target[1], target[2]);
  camera.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- voxels
let roundedBox = null;
/** Unit voxel with soft bevels and a baked top-light/bottom-dark gradient (cheap contact AO). */
export function voxelGeometry() {
  if (roundedBox) return roundedBox;
  const g = new RoundedBoxGeometry(1, 1, 1, 2, 0.07);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = 0.78 + 0.22 * THREE.MathUtils.smoothstep(y, -0.5, 0.45);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return (roundedBox = g);
}

/**
 * Collect boxes, then build one InstancedMesh. Each box may carry assembly data so a whole
 * object can fly together from scattered voxels (depth-scatter-assemble) driven by time.
 */
export class Voxels {
  constructor() {
    this.items = [];
  }
  add(x, y, z, sx, sy, sz, color, extra = {}) {
    this.items.push({ x, y, z, sx, sy, sz, color: new THREE.Color(color), ...extra });
    return this;
  }
  /** A filled block of unit cells from (x0,y0,z0), size (nx,ny,nz) cells of `cell` units. */
  block(x0, y0, z0, nx, ny, nz, cell, colorFn, extra = {}) {
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++)
        for (let k = 0; k < nz; k++) {
          const c = typeof colorFn === "function" ? colorFn(i, j, k) : colorFn;
          if (c == null) continue;
          this.add(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, z0 + (k + 0.5) * cell, cell, cell, cell, c, extra);
        }
    return this;
  }
  build({ roughness = 0.82, metalness = 0, castShadow = true, receiveShadow = true, emissive = null } = {}) {
    const mat = new THREE.MeshStandardMaterial({ roughness, metalness, vertexColors: true, flatShading: false });
    if (emissive) {
      mat.emissive = new THREE.Color(emissive.color);
      mat.emissiveIntensity = emissive.intensity ?? 1;
    }
    const mesh = new THREE.InstancedMesh(voxelGeometry(), mat, this.items.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    const m = new THREE.Matrix4();
    this.items.forEach((b, i) => {
      m.makeScale(b.sx, b.sy, b.sz).setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, b.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.items = this.items;
    mesh.frustumCulled = false;
    return mesh;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/**
 * Set every instance from a per-item function f(item, index) → {p:[x,y,z], r:[rx,ry,rz], s:k} or
 * null for "at rest". Skips work when the whole mesh is at rest and already written.
 */
export function poseInstances(mesh, f) {
  const items = mesh.userData.items;
  let allRest = true;
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    const o = f(b, i);
    if (!o) {
      _m.makeScale(b.sx, b.sy, b.sz).setPosition(b.x, b.y, b.z);
    } else {
      allRest = false;
      _e.set(o.r?.[0] || 0, o.r?.[1] || 0, o.r?.[2] || 0);
      _q.setFromEuler(_e);
      const k = o.s ?? 1;
      _s.set(b.sx * k, b.sy * k, b.sz * k);
      _p.set(o.p[0], o.p[1], o.p[2]);
      _m.compose(_p, _q, _s);
    }
    mesh.setMatrixAt(i, _m);
  }
  if (allRest && mesh.userData.atRest) return;
  mesh.userData.atRest = allRest;
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- materials
/**
 * Writes transparent black with no blending: punches a hole in the WebGL canvas so a DOM screen
 * placed *under* the canvas shows through, while anything rendered in front still occludes it.
 */
export function holeMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending, depthWrite: true, toneMapped: false });
}

/** Ink floor with a restrained perspective grid that fades with distance. */
export function gridFloor({ size = 200, color = "#68c9ba", base = "#101114", spacing = 1, line = 0.025, fadeNear = 6, fadeFar = 42, intensity = 0.55 } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBase: { value: new THREE.Color(base) },
      uSpacing: { value: spacing },
      uLine: { value: line },
      uNear: { value: fadeNear },
      uFar: { value: fadeFar },
      uIntensity: { value: intensity },
      uOpacity: { value: 1 },
      uCenter: { value: new THREE.Vector3() },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uColor,uBase,uCenter; uniform float uSpacing,uLine,uNear,uFar,uIntensity,uOpacity; varying vec3 vW;
      void main(){
        vec2 g = abs(fract(vW.xz/uSpacing - 0.5) - 0.5) / fwidth(vW.xz/uSpacing);
        float l = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 g5 = abs(fract(vW.xz/(uSpacing*5.0) - 0.5) - 0.5) / fwidth(vW.xz/(uSpacing*5.0));
        float l5 = 1.0 - min(min(g5.x, g5.y), 1.0);
        float d = distance(vW.xz, uCenter.xz);
        float fade = 1.0 - smoothstep(uNear, uFar, d);
        vec3 c = uBase + uColor * (0.32*l + 0.5*l5) * uIntensity * fade;
        gl_FragColor = vec4(c, uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = false;
  return mesh;
}

/** Soft radial glow sprite texture (generated, deterministic). */
export function glowTexture(size = 128, inner = 0.0, falloff = 1.6) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `rgba(255,255,255,${Math.pow(1 - i / 10, falloff).toFixed(3)})`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- particles
/**
 * CPU-driven point field: you write positions/colors/sizes per frame from time (deterministic),
 * the shader draws soft discs (shape 0) or crisp pixels (shape 1), size-attenuated.
 */
export class Particles {
  constructor(count, { additive = false, pixelScale = 900 } = {}) {
    this.count = count;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
      uniforms: { uScale: { value: pixelScale }, uShape: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC=color; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; uniform float uShape, uOpacity;
        void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d)*2.0; float disc=1.0-smoothstep(0.55,1.0,r); float sq=1.0-smoothstep(0.86,1.0,max(abs(d.x),abs(d.y))*2.0);
          float a=mix(disc,sq,uShape)*vA*uOpacity; if(a<0.003) discard; gl_FragColor=vec4(vC,a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }
  commit() {
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- type
/**
 * Load a three.js typeface JSON made offline by scripts/make_typeface.py (no runtime font parser,
 * no network). Returns a Font for TextGeometry.
 */
export async function loadFont(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${url}: ${res.status}`);
  return new Font(await res.json());
}
