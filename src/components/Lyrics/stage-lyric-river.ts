import * as THREE from 'three'
import { getDotSpriteTexture } from '../../lib/dot-texture'

const MAX_PARTICLES = 840

/** 根据 Mineradio 的五条星河流线生成；动画在 GPU 中计算，共享圆点纹理不在此释放。 */
export function createLyricStarRiver(pixel: { value: number }): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.BufferGeometry()
  const seeds = new Float32Array(MAX_PARTICLES)
  const lanes = new Float32Array(MAX_PARTICLES)
  const depths = new Float32Array(MAX_PARTICLES)
  for (let i = 0; i < MAX_PARTICLES; i++) {
    seeds[i] = Math.random() * 1000
    lanes[i] = Math.random()
    depths[i] = Math.random()
  }
  // Three.js 通过 position 的数量确定非索引绘制范围，实际位置由 shader 生成。
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3))
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1))
  geometry.setAttribute('lane', new THREE.BufferAttribute(lanes, 1))
  geometry.setAttribute('depthSeed', new THREE.BufferAttribute(depths, 1))
  geometry.setDrawRange(0, 420)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: getDotSpriteTexture() },
      uTime: { value: 0 },
      uPixel: pixel,
      uBass: { value: 0 },
      uBeat: { value: 0 },
      uWidth: { value: 4.2 },
      uHeight: { value: 0.58 },
      uOpacity: { value: 0 },
      uColorA: { value: new THREE.Color('#9cffdf') },
      uColorB: { value: new THREE.Color('#fff7d2') },
      uSize: { value: 1 },
      uMotion: { value: 1 },
    },
    vertexShader: `
      attribute float seed, lane, depthSeed;
      uniform float uTime, uPixel, uBass, uBeat, uWidth, uHeight, uSize, uMotion;
      varying float vSeed, vLane, vGlow, vReadability;
      float hash(float n) { return fract(sin(n) * 43758.5453123); }
      void main() {
        float time = uTime * uMotion;
        float band = floor(lane * 5.0);
        float local = fract(lane * 5.0);
        float speed = 0.030 + hash(seed * 1.71) * 0.055 + band * 0.005;
        float flow = fract(hash(seed * 2.13) + time * speed);
        float x = (flow - 0.5) * uWidth * (1.08 + hash(seed * 5.1) * 0.18);
        float curve = sin(flow * 6.2831853 * (0.92 + hash(seed * 4.0) * 0.46) + seed * 0.071 + time * 0.34);
        float breath = sin(time * (0.42 + hash(seed * 6.9) * 0.42) + seed * 0.093);
        float y = (band - 2.0) * uHeight * 0.24
          + curve * uHeight * (0.20 + hash(seed * 9.0) * 0.18)
          + (local - 0.5) * uHeight * 0.16 + breath * uHeight * 0.10;
        float z = -0.08 + (depthSeed - 0.5) * 0.44
          + sin(time * (0.18 + hash(seed) * 0.24) + seed) * 0.08;
        float edge = smoothstep(0.0, 0.18, flow) * (1.0 - smoothstep(0.82, 1.0, flow));
        vSeed = seed;
        vLane = lane;
        vGlow = edge * (0.62 + 0.38 * sin(time * (0.9 + hash(seed * 8.0) * 0.7) + seed));
        vReadability = mix(0.18, 1.0, smoothstep(0.12, 0.42, abs(y) / max(uHeight, 0.01)));
        vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
        float size = (0.030 + hash(seed * 12.0) * 0.040 + vGlow * 0.024 + uBeat * 0.010)
          * (1.0 + uBass * 0.18) * uSize;
        gl_PointSize = clamp(size * uPixel * 120.0 / max(0.45, -mv.z), 1.0, 10.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColorA, uColorB;
      uniform float uOpacity, uTime, uBeat, uMotion;
      varying float vSeed, vLane, vGlow, vReadability;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.02) discard;
        float twinkle = pow(0.5 + 0.5 * sin(uTime * uMotion * (0.55 + fract(vSeed) * 0.35) + vSeed), 4.0);
        float blend = clamp(smoothstep(0.12, 0.92, vLane) * 0.45 + twinkle * 0.42 + vGlow * 0.26, 0.0, 1.0);
        vec3 color = mix(uColorA, uColorB, blend);
        float alpha = tex.a * uOpacity * vReadability * vGlow * (0.20 + vGlow * 0.78 + twinkle * 0.32 + uBeat * 0.10);
        gl_FragColor = vec4(color * (0.82 + vGlow * 0.72 + twinkle * 0.32), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.position.set(0, 0.18, 1.2)
  points.renderOrder = 38
  return points
}
