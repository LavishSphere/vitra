/**
 * Evidence dive, in the scene: a sub-second camera glide to one evidence point, a luminous
 * trail from that point to its treatment-journey station, and a halo on the point.
 * The floating quote panel is DOM (ui/EvidencePanel.tsx) pinned to `diveAnchor`.
 *
 * The camera is driven here only while a dive is active. Station and intake flights stay with
 * the camera rig; whichever focus is set last wins.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicMaterial, Mesh, PerspectiveCamera, QuadraticBezierCurve3, ShaderMaterial, TubeGeometry, Vector3,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useVitra } from "../store/useVitra.ts";
import { markPositions } from "./labels.ts";
import { PANEL, frameOf, stationLabelAnchor } from "./layout.ts";
import { polarityColor, theme } from "./colors.ts";
import { GLIDE_SECONDS, cardAnchor, diveKey, divePose, easeInOutCubic, trailControl, type DiveTarget } from "./diveMath.ts";

/** World position the floating panel follows. Mutated in place; the label projector reads it. */
export const diveAnchor = new Vector3();

const TRAIL_SEGMENTS = 64;
const TRAIL_RADIUS = 0.015;
const REVEAL_SECONDS = 0.7;

function trailMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uFrom: { value: new Color() },
      uTo: { value: new Color() },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uFade: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFrom;
      uniform vec3 uTo;
      uniform float uTime;
      uniform float uReveal;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        float u = vUv.x; // 0 at the evidence point, 1 at the station
        if (u > uReveal) discard;
        vec3 col = mix(uFrom, uTo, smoothstep(0.0, 1.0, u));
        // Light runs from the quote toward its station.
        float flow = pow(0.5 + 0.5 * sin(u * 22.0 - uTime * 3.2), 8.0) * 0.9;
        float head = exp(-pow((u - uReveal) * 16.0, 2.0)) * (1.0 - step(0.999, uReveal)) * 1.4;
        float ends = smoothstep(0.0, 0.03, u);
        gl_FragColor = vec4(col * (0.5 + flow + head) * ends * uFade, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function haloRingMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color() }, uFade: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        float d = abs(length(vUv - 0.5) * 2.0 - 0.72);
        float g = exp(-d * d * 220.0) + exp(-d * 9.0) * 0.25;
        gl_FragColor = vec4(uColor * g * uFade, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

interface Glide {
  active: boolean;
  t: number;
  fromPos: Vector3; fromTarget: Vector3; toPos: Vector3; toTarget: Vector3;
}

export interface EvidenceDiveProps {
  /** The dived evidence point, or null for no dive. */
  target: DiveTarget | null;
  animate: boolean;
  /** On exit, glide back to where the dive started. False when another focus takes the camera. */
  homeOnExit?: boolean;
}

export function EvidenceDive({ target, animate, homeOnExit = true }: EvidenceDiveProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const marks = useVitra((s) => s.marks);
  const key = target ? diveKey(target) : null;
  const mark = useMemo(() => (key ? marks.find((m) => m.key === key) : undefined), [marks, key]);

  const trail = useRef<Mesh>(null);
  const halo = useRef<Group>(null);
  const stationHalo = useRef<Group>(null);
  const leader = useRef<Line>(null);
  const mats = useMemo(() => ({
    trail: trailMaterial(), halo: haloRingMaterial(), station: haloRingMaterial(),
    leader: new LineBasicMaterial({ color: new Color("#a5b4fc"), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  }), []);
  const leaderGeo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const scratch = useMemo(() => ({
    p: new Vector3(), end: new Vector3(), ctrl: new Vector3(), goalPos: new Vector3(), goalTarget: new Vector3(),
    homePos: new Vector3(), homeTarget: new Vector3(), hasHome: false,
  }), []);
  const glide = useRef<Glide>({ active: false, t: 0, fromPos: new Vector3(), fromTarget: new Vector3(), toPos: new Vector3(), toTarget: new Vector3() });
  const leaderLine = useMemo(() => new Line(leaderGeo, mats.leader), [leaderGeo, mats.leader]);
  const pending = useRef(false);
  const reveal = useRef(0);
  const fade = useRef(0);
  const live = useRef(false);

  useEffect(() => () => {
    mats.trail.dispose(); mats.halo.dispose(); mats.station.dispose(); mats.leader.dispose(); leaderGeo.dispose();
    trail.current?.geometry.dispose();
  }, [mats, leaderGeo]);

  const startGlide = (toPos: Vector3, toTarget: Vector3) => {
    const g = glide.current;
    if (!controls) return;
    if (!animate) {
      g.active = false;
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      controls.update();
      return;
    }
    g.fromPos.copy(camera.position);
    g.fromTarget.copy(controls.target);
    g.toPos.copy(toPos);
    g.toTarget.copy(toTarget);
    g.t = 0;
    g.active = true;
  };

  // A new target (or the same target after its mark moved) re-aims on the next frame,
  // once the evidence layer has published positions.
  useEffect(() => {
    if (mark && mark.visible) {
      if (!live.current && controls) {
        scratch.homePos.copy(camera.position);
        scratch.homeTarget.copy(controls.target);
        scratch.hasHome = true;
      }
      live.current = true;
      pending.current = true;
      // The hover card would sit on top of the dive card; the next pointer move restores it.
      useVitra.getState().hover(null);
      return;
    }
    if (live.current) {
      live.current = false;
      if (homeOnExit && scratch.hasHome) startGlide(scratch.homePos, scratch.homeTarget);
      else glide.current.active = false;
      scratch.hasHome = false;
    }
    // startGlide reads refs and the camera only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark, controls]);

  // A drag ends the glide where it is.
  useEffect(() => {
    if (!controls) return;
    const stop = () => { glide.current.active = false; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((state, dt) => {
    const step = Math.min(dt, 1 / 20);
    if (pending.current && mark) {
      const d = markPositions.data;
      const o = mark.index * 3;
      if (o + 2 < d.length) {
        pending.current = false;
        const f = frameOf(mark.station);
        scratch.p.set(d[o], d[o + 1], d[o + 2]);
        cardAnchor(scratch.p, f.quaternion, f.position, PANEL.width / 2, diveAnchor);
        // Leader: a hairline from the point to the card, along the glass.
        const lp = leaderGeo.attributes.position as BufferAttribute;
        lp.setXYZ(0, scratch.p.x, scratch.p.y, scratch.p.z);
        lp.setXYZ(1, diveAnchor.x, diveAnchor.y, diveAnchor.z);
        lp.needsUpdate = true;
        leaderGeo.computeBoundingSphere();
        // Trail: from the point, arcing off the glass, to just under the station's label.
        scratch.end.copy(stationLabelAnchor(mark.station)).addScaledVector(f.outward, 0.02);
        scratch.end.y -= 0.04;
        trailControl(scratch.p, scratch.end, f.quaternion, scratch.ctrl);
        const curve = new QuadraticBezierCurve3(scratch.p.clone(), scratch.ctrl.clone(), scratch.end.clone());
        const tube: BufferGeometry = new TubeGeometry(curve, TRAIL_SEGMENTS, TRAIL_RADIUS, 6, false);
        const m = trail.current;
        if (m) { m.geometry.dispose(); m.geometry = tube; }
        polarityColor(mark.aspect.polarity, mats.trail.uniforms.uFrom.value as Color).multiplyScalar(1.6);
        (mats.trail.uniforms.uTo.value as Color).copy(theme().accent).multiplyScalar(1.5);
        polarityColor(mark.aspect.polarity, mats.halo.uniforms.uColor.value as Color).multiplyScalar(1.5);
        (mats.station.uniforms.uColor.value as Color).copy(theme().accent).multiplyScalar(1.2);
        halo.current?.position.copy(scratch.p).addScaledVector(f.outward, 0.03);
        stationHalo.current?.position.copy(scratch.end);
        reveal.current = animate ? 0 : 1;
        // Camera.
        divePose(scratch.p, f.quaternion, f.position, scratch.goalPos, scratch.goalTarget);
        startGlide(scratch.goalPos, scratch.goalTarget);
      }
    }

    const g = glide.current;
    if (g.active && controls) {
      g.t = Math.min(GLIDE_SECONDS, g.t + step);
      const e = easeInOutCubic(g.t / GLIDE_SECONDS);
      camera.position.lerpVectors(g.fromPos, g.toPos, e);
      camera.position.y += Math.sin(Math.PI * e) * 0.18;
      controls.target.lerpVectors(g.fromTarget, g.toTarget, e);
      controls.update();
      if (g.t >= GLIDE_SECONDS) g.active = false;
    }

    // Trail and halos fade in with the dive and out after it.
    const on = live.current && !pending.current ? 1 : 0;
    const k = animate ? 1 - Math.exp(-step * 9) : 1;
    fade.current += (on - fade.current) * k;
    if (on) reveal.current = animate ? Math.min(1, reveal.current + step / REVEAL_SECONDS) : 1;
    const visible = fade.current > 0.003;
    const tm = trail.current;
    if (tm) tm.visible = visible;
    if (halo.current) {
      halo.current.visible = visible;
      const pulse = animate ? 1 + Math.sin(state.clock.elapsedTime * 3) * 0.06 : 1;
      halo.current.scale.setScalar(pulse);
    }
    if (leader.current) leader.current.visible = visible;
    mats.leader.opacity = 0.55 * fade.current;
    if (stationHalo.current) stationHalo.current.visible = visible && reveal.current > 0.98;
    mats.trail.uniforms.uReveal.value = reveal.current;
    mats.trail.uniforms.uFade.value = fade.current;
    mats.trail.uniforms.uTime.value = animate ? state.clock.elapsedTime : 0;
    mats.halo.uniforms.uFade.value = fade.current;
    mats.station.uniforms.uFade.value = fade.current * (reveal.current > 0.98 ? 1 : 0);
  });

  return (
    <>
      <mesh ref={trail} material={mats.trail} visible={false} frustumCulled={false} renderOrder={8} raycast={() => null} />
      <primitive object={leaderLine} ref={leader} visible={false} frustumCulled={false} renderOrder={7} raycast={() => null} />
      <Billboard ref={halo} visible={false}>
        <mesh material={mats.halo} renderOrder={9} raycast={() => null}>
          <planeGeometry args={[0.46, 0.46]} />
        </mesh>
      </Billboard>
      <Billboard ref={stationHalo} visible={false}>
        <mesh material={mats.station} renderOrder={9} raycast={() => null}>
          <planeGeometry args={[0.2, 0.2]} />
        </mesh>
      </Billboard>
    </>
  );
}
