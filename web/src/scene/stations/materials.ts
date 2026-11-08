/**
 * Shaders for the journey stations: the frosted glass panel, the glass plinth, the soft light
 * pool on the floor, and the path ribbon. All colors are slate for structure and indigo for
 * focus; cyan and magenta appear only as a faint tint on the polarity bands.
 */
import { AdditiveBlending, Color, DoubleSide, NormalBlending, ShaderMaterial } from "three";
import { PANEL } from "../layout.ts";

export const STATION_COLORS = {
  slate: new Color("#7c8aa5"),
  slateBright: new Color("#cbd5e1"),
  indigo: new Color("#818cf8"),
  pos: new Color("#42e8d3"),
  neg: new Color("#f16c91"),
};

const SIMPLE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * Frosted glass panel. Opaque enough that a station behind it does not read through when
 * the camera is close, with a lit top edge, polarity guides at -2..+2 and the selected week
 * range as a faint band.
 */
export function panelMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSize: { value: [PANEL.width, PANEL.height] },
      uStep: { value: PANEL.polarityStep },
      uRange: { value: [-PANEL.width / 2, PANEL.width / 2] },
      uEdge: { value: STATION_COLORS.slate.clone() },
      uFocusColor: { value: STATION_COLORS.indigo.clone() },
      uFocus: { value: 0 },
      uHover: { value: 0 },
      uDim: { value: 0 },
      uPos: { value: STATION_COLORS.pos.clone() },
      uNeg: { value: STATION_COLORS.neg.clone() },
    },
    vertexShader: SIMPLE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec2 uSize;
      uniform float uStep;
      uniform vec2 uRange;
      uniform vec3 uEdge;
      uniform vec3 uFocusColor;
      uniform float uFocus;
      uniform float uHover;
      uniform float uDim;
      uniform vec3 uPos;
      uniform vec3 uNeg;
      varying vec2 vUv;
      float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main() {
        vec2 p = (vUv - 0.5) * uSize;
        float d = sdRound(p, uSize * 0.5 - 0.004, 0.11);
        float aa = fwidth(d);
        float inside = 1.0 - smoothstep(-aa, aa, d);
        if (inside <= 0.0) discard;
        float rim = 1.0 - smoothstep(0.0, aa * 1.6, abs(d + aa * 1.2));
        float innerGlow = exp(d * 22.0) * 0.5;

        // Polarity guides. Zero is the strongest.
        float w = fwidth(p.y);
        float lines = 0.0;
        for (int k = -2; k <= 2; k++) {
          float y = float(k) * uStep;
          float l = 1.0 - smoothstep(0.0, w * 1.15, abs(p.y - y));
          lines += l * (k == 0 ? 0.5 : 0.2);
        }
        float inX = step(uRange.x, p.x) * step(p.x, uRange.y);

        // Frosted glass body: darker at the base, a cool sheen at the top, lit from the plinth below.
        float yN = vUv.y;
        // Values are linear; the composer converts to sRGB on output.
        vec3 col = mix(vec3(0.003, 0.004, 0.007), vec3(0.008, 0.01, 0.018), smoothstep(0.0, 1.0, yN));
        col += uFocusColor * (0.006 + 0.016 * uFocus) * (1.0 - smoothstep(0.0, 0.35, yN));
        // Diagonal sheen, very faint.
        float sheen = 1.0 - smoothstep(0.0, 0.18, abs((vUv.x * 0.6 + vUv.y) - 1.15));
        col += vec3(0.8, 0.86, 1.0) * sheen * 0.006;
        col += uEdge * 0.01 * inX;
        vec3 tint = p.y > 0.0 ? uPos : uNeg;
        col += tint * smoothstep(0.0, uStep * 2.4, abs(p.y)) * 0.007 * inX;
        col += uEdge * lines * (0.42 + 0.22 * inX);

        vec3 edgeCol = mix(uEdge, uFocusColor, uFocus);
        float topLit = 0.6 + 0.6 * smoothstep(-0.2, 0.5, p.y / uSize.y);
        col += edgeCol * (rim * (0.5 + 0.7 * uFocus + 0.35 * uHover) * topLit + innerGlow * (0.08 + 0.2 * uFocus));

        float a = mix(0.84, 0.9, uFocus) * (1.0 - 0.55 * uDim);
        col *= 1.0 - 0.5 * uDim;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
}

/** Glass plinth: a dark translucent slab with a bright rim where light catches its edges. */
export function plinthMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uEdge: { value: STATION_COLORS.slate.clone() },
      uFocusColor: { value: STATION_COLORS.indigo.clone() },
      uFocus: { value: 0 },
      uHover: { value: 0 },
      uDim: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      varying float vTop;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vTop = normal.y;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uEdge;
      uniform vec3 uFocusColor;
      uniform float uFocus;
      uniform float uHover;
      uniform float uDim;
      varying vec3 vN;
      varying vec3 vView;
      varying float vTop;
      void main() {
        float side = 1.0 - abs(vTop);
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.6);
        vec3 edge = mix(uEdge, uFocusColor, uFocus);
        // Top face: dark smoked glass. Side wall: a thin band that catches the light.
        vec3 col = vec3(0.004, 0.005, 0.009);
        col += edge * side * (0.22 + 0.25 * fres) * (1.0 + 0.9 * uFocus + 0.4 * uHover);
        float a = mix(0.62, 0.9, side) * (1.0 - 0.5 * uDim);
        col *= 1.0 - 0.45 * uDim;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/** Thin lit ring on the plinth's top edge. */
export function ringMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uEdge: { value: STATION_COLORS.slateBright.clone() },
      uFocusColor: { value: STATION_COLORS.indigo.clone() },
      uFocus: { value: 0 },
      uHover: { value: 0 },
      uDim: { value: 0 },
    },
    vertexShader: SIMPLE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uEdge;
      uniform vec3 uFocusColor;
      uniform float uFocus;
      uniform float uHover;
      uniform float uDim;
      varying vec2 vUv;
      void main() {
        vec3 c = mix(uEdge * 0.55, uFocusColor * 1.6, uFocus) * (1.0 + 0.4 * uHover);
        gl_FragColor = vec4(c * (1.0 - 0.6 * uDim), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** Soft pool of light on the floor around a plinth. */
export function poolMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: STATION_COLORS.slate.clone() },
      uFocusColor: { value: STATION_COLORS.indigo.clone() },
      uFocus: { value: 0 },
      uDim: { value: 0 },
    },
    vertexShader: SIMPLE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uFocusColor;
      uniform float uFocus;
      uniform float uDim;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float g = exp(-r * r * 4.5) * (1.0 - smoothstep(0.85, 1.0, r));
        vec3 c = mix(uColor * 0.09, uFocusColor * 0.16, uFocus) * g * (1.0 - 0.7 * uDim);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/**
 * The journey path ribbon. uv.x runs along the path in world units, uv.y across it (-1..1).
 * A thin core line with a soft falloff, and short dashes that drift outward from the lungs
 * when motion is allowed.
 */
export function pathMaterial(length: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: STATION_COLORS.slate.clone() },
      uDash: { value: STATION_COLORS.slateBright.clone() },
      uLit: { value: STATION_COLORS.indigo.clone() },
      uTime: { value: 0 },
      uLength: { value: length },
      uReach: { value: 0 },
      uReachAmt: { value: 0 },
    },
    vertexShader: SIMPLE_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uDash;
      uniform float uTime;
      uniform float uLength;
      uniform vec3 uLit;
      uniform float uReach;
      uniform float uReachAmt;
      varying vec2 vUv;
      void main() {
        float s = vUv.x;
        float v = abs(vUv.y);
        float aa = fwidth(v);
        float core = 1.0 - smoothstep(0.1 - aa, 0.1 + aa, v);
        float glow = exp(-v * v * 9.0);
        // Fade in from under the lungs, fade out toward the viewer.
        float ends = smoothstep(0.0, 1.4, s) * (1.0 - smoothstep(uLength - 2.2, uLength, s));
        float dash = smoothstep(0.35, 0.5, fract(s * 1.6 - uTime * 0.35)) * (1.0 - smoothstep(0.5, 0.65, fract(s * 1.6 - uTime * 0.35)));
        // With a station in focus, the route from the lungs to it lights up in indigo.
        float lit = (1.0 - smoothstep(uReach - 0.2, uReach + 0.15, s)) * uReachAmt;
        vec3 base = mix(uColor, uLit * 1.3, lit);
        vec3 c = base * (core * 0.5 + glow * (0.09 + 0.08 * lit)) + uDash * dash * core * 0.32;
        gl_FragColor = vec4(c * ends, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}
