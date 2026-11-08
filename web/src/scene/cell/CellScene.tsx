/**
 * Stylized cell surface with EGFR and MET. Schematic shapes, not structures: the receptors are
 * stacked beads, the membrane is two sheets of lipid heads. Illustrative mechanism only.
 *
 * Only amivantamab is drawn at the receptors (verified: binds the extracellular domains of EGFR
 * and MET). Osimertinib and lazertinib appear as label callouts in the DOM, never at a site.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  CapsuleGeometry, Color, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, DoubleSide, AdditiveBlending,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { theme } from "../colors.ts";
import { MECHANISMS, type CellProduct } from "./mechanisms.ts";
import { CELL_LABEL_POS, CellLabelProjector } from "./labels.ts";
import { useCellDive } from "./store.ts";

export const DIVE_SECONDS = 1.5;
const START = new Vector3(-7, 15, 30);
const START_T = new Vector3(0, -1, 0);
const END = new Vector3(0.7, 5.2, 11.2);
const END_T = new Vector3(0, 1.9, -0.6);

const LEAFLET = 0.32;
const HEAD_R = 0.1;

/** Gentle dome so the sheet reads as part of a cell, not a floor. */
export function membraneY(x: number, z: number): number {
  return -0.011 * x * x - 0.016 * (z + 1) * (z + 1);
}

interface ReceptorSpec { kind: "egfr" | "met"; x: number; z: number; hero: boolean; }

const RECEPTORS: ReceptorSpec[] = [
  { kind: "egfr", x: -1.1, z: 0, hero: true },
  { kind: "met", x: 1.1, z: 0, hero: true },
  { kind: "egfr", x: -6.2, z: -2.2, hero: false },
  { kind: "met", x: -8.6, z: -5.0, hero: false },
  { kind: "egfr", x: 3.9, z: -3.1, hero: false },
  { kind: "egfr", x: 6.4, z: -0.6, hero: false },
];

/** Bead layout above the membrane (x offset, height, radius). */
const EGFR_BEADS: [number, number, number][] = [[0, 0.82, 0.27], [0.13, 1.33, 0.24], [-0.04, 1.84, 0.28], [0.09, 2.33, 0.23]];
const MET_BEADS: [number, number, number][] = [[0, 0.8, 0.22], [-0.06, 1.18, 0.25], [0.02, 1.86, 0.5]];

/** Where each hero receptor's top sits: the antibody arms end here. */
const EGFR_TOP = new Vector3(-1.1 + 0.09, 2.33 + 0.08, 0);
const MET_TOP = new Vector3(1.1 + 0.02, 1.86 + 0.3, 0);
const HINGE = new Vector3(0, 3.35, 0.05);

function easeInOut(t: number) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

function Membrane() {
  const upper = useRef<InstancedMesh>(null);
  const lower = useRef<InstancedMesh>(null);
  const res = useMemo(() => {
    const t = theme();
    return {
      geo: new IcosahedronGeometry(HEAD_R, 1),
      up: new MeshStandardMaterial({ color: new Color().copy(t.muted).multiplyScalar(0.7), roughness: 0.55, metalness: 0.05 }),
      low: new MeshStandardMaterial({ color: new Color().copy(t.muted).multiplyScalar(0.42), roughness: 0.6, metalness: 0.05 }),
      band: new PlaneGeometry(24, 14, 48, 28),
      bandMat: new MeshBasicMaterial({ color: new Color().copy(t.blue).multiplyScalar(0.22), transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }),
    };
  }, []);
  useEffect(() => () => { for (const r of Object.values(res)) r.dispose(); }, [res]);

  const points = useMemo(() => {
    const out: number[] = [];
    const step = 0.25;
    for (let x = -11; x <= 11; x += step) {
      for (let z = -8; z <= 4.2; z += step * 0.88) {
        const row = Math.round((z + 8) / (step * 0.88));
        const xx = x + (row % 2 ? step / 2 : 0);
        if (RECEPTORS.some((r) => Math.hypot(xx - r.x, z - r.z) < 0.4)) continue;
        out.push(xx, z);
      }
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    const m = new Matrix4();
    const n = points.length / 2;
    for (let i = 0; i < n; i++) {
      const x = points[i * 2];
      const z = points[i * 2 + 1];
      const y = membraneY(x, z);
      const j = Math.sin(i * 12.9898) * 0.03;
      upper.current?.setMatrixAt(i, m.makeTranslation(x, y + LEAFLET + j, z));
      lower.current?.setMatrixAt(i, m.makeTranslation(x + 0.05, y - LEAFLET - j, z + 0.04));
    }
    for (const im of [upper.current, lower.current]) if (im) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }, [points]);

  // The band between the leaflets stands in for the lipid tails.
  useLayoutEffect(() => {
    const pos = res.band.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = -pos.getY(i) - 2;
      pos.setXYZ(i, x, membraneY(x, z), z);
    }
    pos.needsUpdate = true;
    res.band.computeVertexNormals();
  }, [res]);

  const n = points.length / 2;
  return (
    <group>
      <instancedMesh ref={upper} args={[res.geo, res.up, n]} />
      <instancedMesh ref={lower} args={[res.geo, res.low, n]} />
      <mesh geometry={res.band} material={res.bandMat} />
    </group>
  );
}

function Receptor({ spec, mats, geos }: {
  spec: ReceptorSpec;
  mats: { egfr: MeshStandardMaterial; met: MeshStandardMaterial };
  geos: { bead: SphereGeometry; stalk: CylinderGeometry; tail: CapsuleGeometry };
}) {
  const y0 = membraneY(spec.x, spec.z);
  const mat = spec.kind === "egfr" ? mats.egfr : mats.met;
  const beads = spec.kind === "egfr" ? EGFR_BEADS : MET_BEADS;
  return (
    <group position={[spec.x, y0, spec.z]}>
      {beads.map(([dx, h, r], i) => (
        <mesh key={i} geometry={geos.bead} material={mat} position={[dx, h, 0]} scale={[r, r * (spec.kind === "met" && i === 2 ? 0.78 : 1), r]} />
      ))}
      <mesh geometry={geos.stalk} material={mat} position={[0, 0.05, 0]} scale={[1, 1.15, 1]} />
      <mesh geometry={geos.tail} material={mat} position={[0.04, -0.95, 0]} rotation={[0, 0, 0.12]} />
    </group>
  );
}

const Yup = new Vector3(0, 1, 0);

/** A capsule from a to b. Built once. */
function Segment({ a, b, r, mat }: { a: Vector3; b: Vector3; r: number; mat: MeshStandardMaterial }) {
  const { geo, pos, quat } = useMemo(() => {
    const d = new Vector3().subVectors(b, a);
    const len = d.length();
    return {
      geo: new CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 14),
      pos: new Vector3().addVectors(a, b).multiplyScalar(0.5),
      quat: new Quaternion().setFromUnitVectors(Yup, d.normalize()),
    };
  }, [a, b, r]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={mat} position={pos} quaternion={quat} />;
}

/** Bispecific antibody: one arm on EGFR, one on MET, Fc pointing away from the cell. */
function Antibody({ animate, dim }: { animate: boolean; dim: boolean }) {
  const group = useRef<Group>(null);
  const arrived = useCellDive((s) => s.arrived);
  const t = useRef(animate ? 0 : 1);
  const mat = useMemo(() => {
    const c = theme().blue;
    return new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.35, toneMapped: false, transparent: true });
  }, []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    mat.emissiveIntensity = dim ? 0.08 : 0.6;
    mat.opacity = dim ? 0.32 : 1;
    mat.depthWrite = !dim;
  }, [dim, mat]);

  const pts = useMemo(() => {
    const armA = EGFR_TOP.clone();
    const armB = MET_TOP.clone();
    return { armA, armB, fcTop: HINGE.clone().add(new Vector3(0.05, 1.15, 0)) };
  }, []);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    if (arrived && t.current < 1) t.current = Math.min(1, t.current + dt / 1.2);
    g.position.y = (1 - easeOut(t.current)) * 3.2;
    CELL_LABEL_POS.antibody.set(pts.fcTop.x + 0.3, pts.fcTop.y + 0.02 + g.position.y, 0);
  });

  return (
    <group ref={group} position={[0, animate ? 3.2 : 0, 0]}>
      <Segment a={HINGE} b={pts.armA} r={0.15} mat={mat} />
      <Segment a={HINGE} b={pts.armB} r={0.15} mat={mat} />
      <Segment a={HINGE} b={pts.fcTop} r={0.17} mat={mat} />
    </group>
  );
}

function DiveCamera({ animate }: { animate: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const arrive = useCellDive((s) => s.arrive);
  const t = useRef(animate ? 0 : 1);
  const target = useRef(new Vector3());

  const place = (k: number) => {
    camera.position.lerpVectors(START, END, k);
    target.current.lerpVectors(START_T, END_T, k);
    camera.lookAt(target.current);
    if (controls) { controls.target.copy(target.current); controls.update(); }
  };

  useLayoutEffect(() => {
    place(easeInOut(t.current));
    if (t.current >= 1) arrive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

  useFrame((_, dt) => {
    if (t.current >= 1) return;
    const skipped = useCellDive.getState().arrived;
    t.current = skipped ? 1 : Math.min(1, t.current + dt / DIVE_SECONDS);
    place(easeInOut(t.current));
    if (t.current >= 1 && !skipped) arrive();
  });
  return null;
}

export function CellScene({ product, animate }: { product: CellProduct; animate: boolean }) {
  const m = MECHANISMS[product];
  const arrived = useCellDive((s) => s.arrived);
  const res = useMemo(() => {
    const t = theme();
    return {
      mats: {
        egfr: new MeshStandardMaterial({ color: new Color().copy(t.ivory).multiplyScalar(0.92), roughness: 0.42, metalness: 0.08, emissive: t.ivory, emissiveIntensity: 0.08 }),
        met: new MeshStandardMaterial({ color: new Color().copy(t.muted).lerp(t.accent, 0.35), roughness: 0.45, metalness: 0.06, emissive: t.muted, emissiveIntensity: 0.05 }),
      },
      geos: {
        bead: new SphereGeometry(1, 28, 20),
        stalk: new CylinderGeometry(0.06, 0.06, 1.1, 10),
        tail: new CapsuleGeometry(0.2, 0.55, 6, 14),
      },
    };
  }, []);
  useEffect(() => () => {
    for (const x of Object.values(res.mats)) x.dispose();
    for (const x of Object.values(res.geos)) x.dispose();
  }, [res]);

  const ink = useMemo(() => theme().ink.clone(), []);
  return (
    <>
      <color attach="background" args={[ink]} />
      <fog attach="fog" args={[ink, 10, 32]} />
      <hemisphereLight args={["#cfe6ff", "#0a1320", 0.55]} />
      <directionalLight position={[4, 9, 6]} intensity={1.5} />
      <pointLight position={[-5, 3, 4]} intensity={14} distance={16} color={theme().blue} />
      <pointLight position={[5, -2, 3]} intensity={8} distance={14} color={theme().accent} />
      <OrbitControls
        makeDefault
        enabled={arrived}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={5}
        maxDistance={16}
        minPolarAngle={0.5}
        maxPolarAngle={Math.PI * 0.56}
        rotateSpeed={0.5}
      />
      <DiveCamera animate={animate} />
      <Membrane />
      {RECEPTORS.map((r, i) => <Receptor key={i} spec={r} mats={res.mats} geos={res.geos} />)}
      {m.antibody === "bound" && <Antibody key={product} animate={animate} dim={product !== "rybrevant"} />}

      <CellLabelProjector />
    </>
  );
}
