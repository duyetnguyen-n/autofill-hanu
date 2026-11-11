import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { VectorPoint } from "./vector-layout";

export default function VectorScene({ points, edges, selectedId, onSelect, onUnavailable, reset, paused }: {
  points: VectorPoint[]; edges: [number, number][]; selectedId: string;
  onSelect(id: string): void; onUnavailable(): void; reset: number; paused: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onUnavailable }), selected = useRef(selectedId), stop = useRef(paused);
  const resetCamera = useRef<(() => void) | undefined>(undefined);
  callbacks.current = { onSelect, onUnavailable }; selected.current = selectedId; stop.current = paused;
  useEffect(() => { resetCamera.current?.(); }, [reset]);
  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { callbacks.current.onUnavailable(); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
    renderer.setClearColor(0x101e1d, 0); container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Bản đồ vector 3D");
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, .1, 100);
    camera.position.set(6, 4.4, 8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .08;
    controls.minDistance = 3; controls.maxDistance = 18; controls.autoRotateSpeed = .3;
    resetCamera.current = () => { camera.position.set(6, 4.4, 8); controls.target.set(0, 0, 0); controls.update(); };
    const grid = new THREE.GridHelper(16, 32, 0x35534e, 0x233c37);
    grid.position.y = -3.7; scene.add(grid);
    const geometry = new THREE.SphereGeometry(.085, 14, 10), material = new THREE.MeshBasicMaterial({ color: 0x79cdb3 });
    const nodes = points.map(point => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...point.position);
      mesh.userData.id = point.id; scene.add(mesh); return mesh;
    });
    const lines = new THREE.BufferGeometry();
    lines.setAttribute("position", new THREE.Float32BufferAttribute(edges.flatMap(([i, j]) => [...points[i].position, ...points[j].position]), 3));
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x4f8a78, transparent: true, opacity: .34 });
    scene.add(new THREE.LineSegments(lines, lineMaterial));
    const ringGeo = new THREE.RingGeometry(.17, .19, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xc0f1df, side: THREE.DoubleSide, transparent: true, opacity: .95 });
    const ring = new THREE.Mesh(ringGeo, ringMat); scene.add(ring);
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let downX = 0, downY = 0, hovered = "", visible = true, documentVisible = !document.hidden, lastFrame = 0;
    const intersects = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(nodes)[0]?.object.userData.id as string | undefined;
    };
    const down = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; };
    const up = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5) return;
      const id = intersects(event); if (id) callbacks.current.onSelect(id);
    };
    const move = (event: PointerEvent) => { hovered = intersects(event) ?? ""; renderer.domElement.style.cursor = hovered ? "pointer" : "grab"; };
    const lost = (event: Event) => { event.preventDefault(); callbacks.current.onUnavailable(); };
    const visibility = () => { documentVisible = !document.hidden; };
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; });
    intersection.observe(container);
    renderer.domElement.addEventListener("pointerdown", down); renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointermove", move); renderer.domElement.addEventListener("webglcontextlost", lost);
    document.addEventListener("visibilitychange", visibility);
    renderer.setAnimationLoop(time => {
      if (!visible || !documentVisible || time - lastFrame < 32) return;
      lastFrame = time; controls.autoRotate = !stop.current; controls.update();
      const active = nodes.find(node => node.userData.id === selected.current);
      ring.visible = Boolean(active);
      if (active) { ring.position.copy(active.position); ring.quaternion.copy(camera.quaternion); }
      nodes.forEach(node => node.scale.setScalar(node === active ? 1.6 : node.userData.id === hovered ? 1.35 : 1));
      renderer.render(scene, camera);
    });
    return () => {
      renderer.setAnimationLoop(null); observer.disconnect(); intersection.disconnect(); controls.dispose();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointermove", move); renderer.domElement.removeEventListener("webglcontextlost", lost);
      geometry.dispose(); material.dispose(); lines.dispose(); lineMaterial.dispose(); ringGeo.dispose(); ringMat.dispose();
      grid.geometry.dispose();
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach(mat => mat.dispose());
      renderer.dispose(); renderer.domElement.remove(); resetCamera.current = undefined;
    };
  }, [points, edges]);
  return <div ref={host} className="kv-webgl"/>;
}
