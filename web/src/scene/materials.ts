/** Shader materials for the observatory. Created once; uniforms are mutated in place. */
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from "three";

const FRESNEL_VERT = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Translucent glass tissue. Fresnel rim light, a soft key-light sheen, fine horizontal contour
 * lines (like imaging slices) and darker, cooler back faces so the volume reads as deep.
 * Additive, so it needs no sorting.
 */
export function glassMaterial(accent: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAccent: { value: accent.clone() },
      uIvory: { value: new Color("#F2F7FA") },
      uDeep: { value: new Color("#3b4fd8") },
      uOpacity: { value: 1 },
      uLineFreq: { value: 9.0 },
      uFocus: { value: 0 },
      uBreath: { value: 0 },
    },
    vertexShader: FRESNEL_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uAccent;
      uniform vec3 uIvory;
      uniform vec3 uDeep;
      uniform float uOpacity;
      uniform float uLineFreq;
      uniform float uFocus;
      uniform float uBreath;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying vec3 vLocal;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewV);
        float ndv = abs(dot(n, v));
        float rim = pow(1.0 - ndv, 2.4);
        float edge = pow(1.0 - ndv, 6.0);
        // Key light from the upper left: a soft glassy sheen on the front faces.
        vec3 L = normalize(vec3(-0.45, 0.75, 0.5));
        vec3 nf = gl_FrontFacing ? n : -n;
        float sheen = pow(max(dot(reflect(-v, nf), L), 0.0), 18.0);
        float top = clamp(nf.y * 0.5 + 0.5, 0.0, 1.0);
        // Imaging-slice contours, crisper toward the rim.
        float f = vLocal.y * uLineFreq;
        float d = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-4);
        float line = 1.0 - min(d, 1.0);
        float lineMask = line * (0.08 + 0.6 * rim);
        vec3 body = mix(uDeep, uAccent, 0.55 + 0.45 * top);
        vec3 col = body * (0.03 + 0.95 * rim) + mix(uAccent, uIvory, 0.5) * lineMask * 0.5;
        col += uIvory * edge * 0.55;
        col += mix(uAccent, uIvory, 0.7) * sheen * 0.22;
        // Back faces: the far wall of the lung, dimmer and cooler, gives the glass depth.
        if (!gl_FrontFacing) col = mix(col, uDeep * (0.02 + 0.5 * rim), 0.55) * 0.6;
        col *= 0.94 + 0.12 * uBreath;
        gl_FragColor = vec4(col * uOpacity * (1.0 - 0.45 * uFocus), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** Airway tubes: brighter at the trachea, fading toward the finest branches. */
export function airwayMaterial(accent: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAccent: { value: accent.clone() },
      uIvory: { value: new Color("#F2F7FA") },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      varying float vDepth;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        vDepth = aDepth;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAccent;
      uniform vec3 uIvory;
      uniform float uOpacity;
      varying float vDepth;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewV)));
        float rim = pow(1.0 - ndv, 1.6);
        float gen = clamp(vDepth / 7.0, 0.0, 1.0);
        vec3 base = mix(mix(uIvory, uAccent, 0.62), uAccent, gen);
        float k = mix(0.62, 0.5, gen) * (0.12 + 1.1 * rim);
        gl_FragColor = vec4(base * k * uOpacity, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Tumor hotspot core: a slowly undulating surface, emissive enough to bloom. */
export function tumorMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uTime: { value: 0 },
      uGain: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying float vBump;
      void main() {
        vec3 p = position;
        float b = sin(p.x * 9.0 + uTime * 0.6) * sin(p.y * 11.0 - uTime * 0.4) * sin(p.z * 8.0 + uTime * 0.5);
        b += 0.5 * sin(p.x * 21.0 + p.y * 17.0 + uTime * 0.3);
        vBump = b;
        p += normal * b * 0.07;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGain;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying float vBump;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewV)));
        float rim = pow(1.0 - ndv, 1.8);
        vec3 col = uColor * (0.75 + 1.6 * rim + 0.25 * vBump) * uGain;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    toneMapped: false,
  });
}

/** Soft camera-facing glow disc. */
export function haloMaterial(color: Color, strength = 1): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float g = pow(max(0.0, 1.0 - d), 2.4);
        gl_FragColor = vec4(uColor * g * uStrength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/** Points for airflow, drawn as soft round sprites. */
export function flowMaterial(color: Color, size: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uSize: { value: size }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uSize;
      attribute float aSeed;
      varying float vSeed;
      void main() {
        vSeed = aSeed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (0.6 + 0.6 * aSeed) * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(uColor * a * a * (0.5 + 0.7 * vSeed) * uOpacity, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * The floor of the observatory: a dark disc that falls off to the background, with a soft pool
 * of the accent light under the lungs and two faint rings that ground them.
 */
export function floorMaterial(accent: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAccent: { value: accent.clone() },
      uSlate: { value: new Color("#64748b") },
      uFocus: { value: 0 },
      uBreath: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vXZ = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAccent;
      uniform vec3 uSlate;
      uniform float uFocus;
      uniform float uBreath;
      varying vec2 vXZ;
      float ring(float r, float at, float w) {
        float aa = fwidth(r);
        return 1.0 - smoothstep(0.0, w + aa, abs(r - at));
      }
      void main() {
        float r = length(vXZ * vec2(1.0, 1.15));
        float pool = exp(-r * r / 7.5) * (0.16 + 0.04 * uBreath);
        float wide = exp(-r * r / 90.0);
        float rings = ring(r, 3.05, 0.008) * 0.32 + ring(r, 3.35, 0.004) * 0.16;
        rings *= smoothstep(9.0, 2.0, r);
        vec3 col = uAccent * pool + uSlate * wide * 0.045 + uAccent * rings * 0.5;
        gl_FragColor = vec4(col * (1.0 - 0.35 * uFocus), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/**
 * The journey path: a thin ribbon on the floor. uv.x runs 0..1 along the path in journey order;
 * a slow light travels along it from the first station to the last.
 */
export function pathMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float core = smoothstep(0.35, 1.0, across);
        float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float travel = fract(vUv.x * 3.0 - uTime * 0.07);
        float pulse = smoothstep(0.86, 0.995, travel) * (1.0 - smoothstep(0.995, 1.0, travel));
        vec3 col = uColor * (0.22 * core + 0.06 * across + pulse * core * 0.9);
        gl_FragColor = vec4(col * ends * uOpacity, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/** A soft vertical light from a station's floor marker up to the bottom of its panel. */
export function beamMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float g = pow(across, 1.6) * pow(1.0 - vUv.y, 1.4);
        gl_FragColor = vec4(uColor * g * 0.16 * uStrength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** The floor marker under a station: a thin ring around a faint disc. */
export function plinthMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float aa = fwidth(r);
        float ring = 1.0 - smoothstep(0.0, 0.02 + aa, abs(r - 0.82));
        float disc = (1.0 - smoothstep(0.0, 0.82, r)) * 0.18;
        float glow = exp(-r * r * 3.0) * 0.25;
        gl_FragColor = vec4(uColor * (ring * 0.7 + disc + glow) * uStrength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
