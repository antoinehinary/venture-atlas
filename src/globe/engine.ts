// One WebGL canvas for every globe on screen. Each globe renders into the screen rectangle of the DOM element
// carrying data-globe-slot="<id>", so six home globes cost one context, and moving a slot animates a "fly-in".
import * as THREE from 'three'
import { geoEquirectangular, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import world from 'world-atlas/countries-110m.json'

export type PointDatum = {
  id: string; lat: number; lon: number; color: string
  size: number          // diameter in CSS px at default zoom
  alpha: number         // 0..1
  shape: 0 | 1 | 2 | 3  // 0 active, 1 acquired (ring), 2 public (core + ring), 3 dead (faint)
  hollow: boolean       // unverified records render hollow
  label?: string
}
export type ArcDatum = { id: string; from: [number, number]; to: [number, number]; color: string; progress: number; alpha: number }
type Handlers = { onHover?: (id: string | null, x: number, y: number) => void; onSelect?: (id: string | null) => void }

const R = 1
const toVec = (lat: number, lon: number, r = R) => {
  const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180
  return new THREE.Vector3(r * Math.cos(p) * Math.sin(l), r * Math.sin(p), r * Math.cos(p) * Math.cos(l))
}

// ---- shared geometry (built once) -----------------------------------------------------------------
let shared: { land: THREE.BufferGeometry; borders: THREE.BufferGeometry; sphere: THREE.SphereGeometry } | null = null
function buildShared() {
  if (shared) return shared
  const W = 1440, H = 720
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  const topo = world as any
  const proj = geoEquirectangular().translate([W / 2, H / 2]).scale(W / (2 * Math.PI))
  ctx.fillStyle = '#fff'; ctx.beginPath(); geoPath(proj, ctx)(feature(topo, topo.objects.land) as any); ctx.fill()
  const px = ctx.getImageData(0, 0, W, H).data
  const pos: number[] = []
  const N = 46000, golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i
    const lat = (Math.asin(y) * 180) / Math.PI, lon = ((((th * 180) / Math.PI) % 360) + 540) % 360 - 180
    const u = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W)), v = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H))
    if (px[(v * W + u) * 4] > 128 && lat > -60) { const p = toVec(lat, lon, R * 1.001); pos.push(p.x, p.y, p.z) }
    void rad
  }
  const land = new THREE.BufferGeometry(); land.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  const b: number[] = []
  const m = mesh(topo, topo.objects.countries) as any
  for (const line of m.coordinates as [number, number][][]) for (let i = 0; i < line.length - 1; i++) {
    const a = toVec(line[i][1], line[i][0], R * 1.002), c = toVec(line[i + 1][1], line[i + 1][0], R * 1.002)
    b.push(a.x, a.y, a.z, c.x, c.y, c.z)
  }
  const borders = new THREE.BufferGeometry(); borders.setAttribute('position', new THREE.Float32BufferAttribute(b, 3))
  shared = { land, borders, sphere: new THREE.SphereGeometry(R, 64, 48) }
  return shared
}

// ---- shaders --------------------------------------------------------------------------------------
const sphereMat = (color: THREE.Color) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: color }, uOpacity: { value: 1 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1. - max(dot(vN, vV), 0.), 2.6); vec3 base = mix(vec3(.018,.028,.05), vec3(.03,.05,.09), vN.y*.5+.5);
      vec3 c = base + uColor * f * .38 + uColor * .03; gl_FragColor = vec4(c * uOpacity, 1.); }`,
})
const atmoMat = (color: THREE.Color) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: color }, uOpacity: { value: 1 } }, side: THREE.BackSide, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthWrite: false,
  vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; void main(){ float a = clamp(-vN.z / .5, 0., 1.); float i = pow(a, 3.2) * .5 + pow(a, 12.) * .35; vec3 c = uColor * i * uOpacity; gl_FragColor = vec4(c, max(c.r, max(c.g, c.b))); }`,
})
const landMat = (color: THREE.Color) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: color }, uOpacity: { value: 1 }, uScale: { value: 1 } }, transparent: true, depthWrite: false,
  vertexShader: `uniform float uScale; varying float vF; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vec3 n = normalize(normalMatrix * position); vF = max(dot(n, normalize(-mv.xyz)), 0.); gl_PointSize = uScale; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vF; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; float a = smoothstep(.5,.25,d) * (.25 + .75 * vF); gl_FragColor = vec4(mix(vec3(.45,.55,.7), uColor, .35), a * .62 * uOpacity); }`,
})
const pointMat = () => new THREE.ShaderMaterial({
  uniforms: { uOpacity: { value: 1 }, uPx: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aShape; attribute float aHollow; uniform float uPx;
    varying vec3 vC; varying float vA; varying float vS; varying float vH; varying float vPx;
    void main(){ vC = aColor; vA = aAlpha; vS = aShape; vH = aHollow; vec4 mv = modelViewMatrix * vec4(position,1.); vPx = aSize * uPx * 3.0; gl_PointSize = vPx; gl_Position = projectionMatrix * mv; }`,
  // The sprite is 3x the nominal diameter: core in the middle third, halo around it.
  fragmentShader: `uniform float uOpacity; varying vec3 vC; varying float vA; varying float vS; varying float vH; varying float vPx;
    void main(){ if (vA < .004) discard; float d = length(gl_PointCoord - .5) * 3.0; float px = 3.0 / max(vPx, 1.);
      float halo = exp(-d * d * 2.6) * .55; float core = smoothstep(.5 + px, .5 - px, d);
      float ring = smoothstep(px * 1.6, 0., abs(d - .5));
      float outer = smoothstep(px * 1.4, 0., abs(d - .86));
      float v;
      if (vS > 2.5) v = ring * .55;                              // dead: faint hollow
      else if (vS > 1.5) v = core + outer * .9 + halo;            // public: core + outer ring
      else if (vS > .5) v = ring + halo * .45 + smoothstep(.16 + px, .16 - px, d);   // acquired: ring + dot
      else v = core + halo;
      if (vH > .5 && vS < .5) v = ring + halo * .35;             // unverified: hollow
      vec3 c = vC * v + vec3(1.) * core * .35 * step(vS, .5) * (1. - vH);
      c *= vA * uOpacity; gl_FragColor = vec4(c, min(1., max(c.r, max(c.g, c.b)))); }`,
})

type Rect = { x: number; y: number; w: number; h: number }
class Globe {
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50); group = new THREE.Group()
  color: THREE.Color; mats: THREE.ShaderMaterial[] = []; borderMat: THREE.LineBasicMaterial
  points: THREE.Points; pointData: PointDatum[] = []; pointPos: THREE.Vector3[] = []
  arcs = new Map<string, { line: THREE.Line; n: number }>(); arcGroup = new THREE.Group()
  rect: Rect | null = null; opacity = 0; lon: number; lat = 22; dist = 4.9; targetDist = 4.9; vLon = 0; vLat = 0
  interactive = false; autoRotate = true; dragging = false; lastInteraction = 0; handlers: Handlers = {}
  flyTo: { lon: number; lat: number } | null = null
  id: string
  constructor(id: string, colorHex: string, index: number) {
    this.id = id
    const s = buildShared()
    this.color = new THREE.Color(colorHex); this.lon = -100 + index * 47
    const sm = sphereMat(this.color), am = atmoMat(this.color), lm = landMat(this.color)
    this.mats = [sm, am, lm]
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 48, 32), am))
    this.group.add(new THREE.Mesh(s.sphere, sm), new THREE.Points(s.land, lm))
    this.borderMat = new THREE.LineBasicMaterial({ color: this.color.clone().lerp(new THREE.Color('#9fb4d0'), 0.6), transparent: true, opacity: 0, depthWrite: false })
    this.group.add(new THREE.LineSegments(s.borders, this.borderMat))
    const pm = pointMat(); this.mats.push(pm)
    this.points = new THREE.Points(new THREE.BufferGeometry(), pm); this.points.frustumCulled = false
    this.group.add(this.points, this.arcGroup); this.scene.add(this.group)
  }
  setPoints(data: PointDatum[]) {
    const g = this.points.geometry, n = data.length
    if (!g.getAttribute('position') || g.getAttribute('position').count !== n) {
      for (const [k, size] of [['position', 3], ['aColor', 3], ['aSize', 1], ['aAlpha', 1], ['aShape', 1], ['aHollow', 1]] as const) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * size), size))
    }
    const P = g.getAttribute('position') as THREE.BufferAttribute, C = g.getAttribute('aColor') as THREE.BufferAttribute
    const S = g.getAttribute('aSize') as THREE.BufferAttribute, A = g.getAttribute('aAlpha') as THREE.BufferAttribute, Sh = g.getAttribute('aShape') as THREE.BufferAttribute, Ho = g.getAttribute('aHollow') as THREE.BufferAttribute
    const col = new THREE.Color()
    this.pointPos = data.map((d, i) => {
      const v = toVec(d.lat, d.lon, R * 1.012); P.setXYZ(i, v.x, v.y, v.z)
      col.set(d.color); C.setXYZ(i, col.r, col.g, col.b); S.setX(i, d.size); A.setX(i, d.alpha); Sh.setX(i, d.shape); Ho.setX(i, d.hollow ? 1 : 0)
      return v
    })
    for (const a of [P, C, S, A, Sh, Ho]) a.needsUpdate = true
    this.pointData = data
  }
  setArcs(data: ArcDatum[]) {
    const seen = new Set<string>()
    for (const d of data) {
      seen.add(d.id)
      let a = this.arcs.get(d.id)
      if (!a) {
        const A = toVec(d.from[0], d.from[1]), B = toVec(d.to[0], d.to[1]), n = 64, pts: THREE.Vector3[] = []
        const ang = A.angleTo(B), lift = 0.06 + ang * 0.16
        for (let i = 0; i <= n; i++) { const t = i / n; pts.push(A.clone().lerp(B, t).normalize().multiplyScalar(R * (1.012 + Math.sin(Math.PI * t) * lift))) }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: d.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
        a = { line, n: n + 1 }; this.arcs.set(d.id, a); this.arcGroup.add(line)
      }
      a.line.geometry.setDrawRange(0, Math.max(0, Math.round(a.n * d.progress)));
      (a.line.material as THREE.LineBasicMaterial).opacity = d.alpha; a.line.visible = d.progress > 0.01 && d.alpha > 0.01
    }
    for (const [id, a] of this.arcs) if (!seen.has(id)) { this.arcGroup.remove(a.line); a.line.geometry.dispose(); this.arcs.delete(id) }
  }
}

export class GlobeEngine {
  renderer: THREE.WebGLRenderer; globes = new Map<string, Globe>(); raf = 0; last = performance.now()
  labelLayer: HTMLDivElement; labels: HTMLDivElement[] = []; hoverId: string | null = null; hoverGlobe: string | null = null
  private drag: { g: Globe; x: number; y: number; moved: number } | null = null
  private tmp = new THREE.Vector3()
  canvas: HTMLCanvasElement
  constructor(canvas: HTMLCanvasElement, labelLayer: HTMLDivElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.renderer.setScissorTest(true); this.renderer.autoClear = false; this.renderer.setClearColor(0x000000, 0)
    this.labelLayer = labelLayer
    for (let i = 0; i < 16; i++) { const d = document.createElement('div'); d.className = 'globe-label'; labelLayer.appendChild(d); this.labels.push(d) }
    window.addEventListener('pointermove', this.onMove); window.addEventListener('pointerdown', this.onDown); window.addEventListener('pointerup', this.onUp)
    window.addEventListener('wheel', this.onWheel, { passive: false })
    this.loop()
  }
  dispose() {
    cancelAnimationFrame(this.raf); this.renderer.dispose()
    window.removeEventListener('pointermove', this.onMove); window.removeEventListener('pointerdown', this.onDown); window.removeEventListener('pointerup', this.onUp); window.removeEventListener('wheel', this.onWheel)
    this.labelLayer.replaceChildren()
  }
  ensure(id: string, color: string, index: number) { let g = this.globes.get(id); if (!g) { g = new Globe(id, color, index); this.globes.set(id, g) } return g }
  /** Drops globes whose field no longer exists. */
  prune(keep: Set<string>) { for (const [id, g] of this.globes) if (!keep.has(id)) { g.points.geometry.dispose(); g.setArcs([]); this.globes.delete(id) } }
  setPoints(id: string, d: PointDatum[]) { this.globes.get(id)?.setPoints(d) }
  setArcs(id: string, d: ArcDatum[]) { this.globes.get(id)?.setArcs(d) }
  setHandlers(id: string, h: Handlers) { const g = this.globes.get(id); if (g) g.handlers = h }
  focus(id: string, lat: number, lon: number) { const g = this.globes.get(id); if (g) { g.flyTo = { lat: Math.max(-60, Math.min(70, lat)), lon }; g.lastInteraction = performance.now() } }
  zoom(id: string, factor: number) { const g = this.globes.get(id); if (g) g.targetDist = Math.max(1.55, Math.min(5.4, g.targetDist * factor)) }

  private slotGlobe(e: Event) { const el = (e.target as HTMLElement | null)?.closest?.('[data-globe-slot]') as HTMLElement | null; return el ? this.globes.get(el.dataset.globeSlot!) ?? null : null }
  private pick(g: Globe, x: number, y: number) {
    if (!g.rect) return null
    let best: string | null = null, bd = Infinity
    const zoomK = 4.9 / g.dist
    for (let i = 0; i < g.pointData.length; i++) {
      const d = g.pointData[i]; if (d.alpha < 0.05) continue
      const s = this.project(g, g.pointPos[i]); if (!s) continue
      const dist = Math.hypot(s.x - x, s.y - y), r = Math.max(7, (d.size * zoomK * this.sizeK(g)) / 2 + 3)
      if (dist < r && dist < bd) { bd = dist; best = d.id }
    }
    return best
  }
  private sizeK(g: Globe) { return g.rect ? Math.max(0.42, Math.min(1, Math.min(g.rect.w, g.rect.h) / 620)) : 1 }
  /** World point -> CSS px, or null when on the far side. */
  private project(g: Globe, local: THREE.Vector3) {
    const v = this.tmp.copy(local).applyMatrix4(g.group.matrixWorld)
    const n = v.clone().normalize(), toCam = g.camera.position.clone().sub(v).normalize()
    if (n.dot(toCam) < 0.08) return null
    v.project(g.camera); const r = g.rect!
    return { x: r.x + ((v.x + 1) / 2) * r.w, y: r.y + ((1 - v.y) / 2) * r.h }
  }
  private onMove = (e: PointerEvent) => {
    if (this.drag) {
      const { g } = this.drag, k = (0.22 * g.dist) / 4.9 * (620 / Math.max(300, g.rect?.h ?? 620))
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y
      g.lon -= dx * k; g.lat = Math.max(-80, Math.min(80, g.lat + dy * k)); g.vLon = -dx * k; g.vLat = dy * k
      this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy); g.lastInteraction = performance.now(); g.flyTo = null
      return
    }
    const g = this.slotGlobe(e)
    const id = g && g.interactive ? this.pick(g, e.clientX, e.clientY) : null
    if (id !== this.hoverId || (id && g)) {
      if (this.hoverGlobe && (!g || g.id !== this.hoverGlobe)) this.globes.get(this.hoverGlobe)?.handlers.onHover?.(null, 0, 0)
      this.hoverId = id; this.hoverGlobe = g?.id ?? null
      g?.handlers.onHover?.(id, e.clientX, e.clientY)
    }
    if (g?.interactive) (e.target as HTMLElement).style.cursor = id ? 'pointer' : 'grab'
  }
  private onDown = (e: PointerEvent) => { const g = this.slotGlobe(e); if (g?.interactive && e.button === 0) { this.drag = { g, x: e.clientX, y: e.clientY, moved: 0 }; g.dragging = true; g.vLon = g.vLat = 0 } }
  private onUp = (e: PointerEvent) => {
    if (!this.drag) return
    const { g, moved } = this.drag; g.dragging = false; this.drag = null
    if (moved < 5) g.handlers.onSelect?.(this.pick(g, e.clientX, e.clientY))
  }
  private onWheel = (e: WheelEvent) => { const g = this.slotGlobe(e); if (g?.interactive) { e.preventDefault(); g.targetDist = Math.max(1.55, Math.min(5.4, g.targetDist * Math.exp(e.deltaY * 0.0012))); g.lastInteraction = performance.now() } }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000); this.last = now
    if (document.hidden) return
    const cw = window.innerWidth, ch = window.innerHeight
    if (this.canvas.width !== Math.round(cw * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(ch * this.renderer.getPixelRatio())) this.renderer.setSize(cw, ch, false)
    this.renderer.setScissor(0, 0, cw, ch); this.renderer.setViewport(0, 0, cw, ch); this.renderer.clear()
    const slots = new Map<string, HTMLElement>()
    document.querySelectorAll<HTMLElement>('[data-globe-slot]').forEach((el) => slots.set(el.dataset.globeSlot!, el))
    let labelled: Globe | null = null
    for (const g of this.globes.values()) {
      const el = slots.get(g.id)
      if (el) {
        const b = el.getBoundingClientRect(), target = { x: b.left, y: b.top, w: b.width, h: b.height }
        g.interactive = el.dataset.interactive === 'true'; g.autoRotate = el.dataset.autorotate !== 'false'
        if (!g.rect || g.opacity < 0.02) g.rect = target
        else { const k = 1 - Math.exp(-dt * 6.5); g.rect = { x: g.rect.x + (target.x - g.rect.x) * k, y: g.rect.y + (target.y - g.rect.y) * k, w: g.rect.w + (target.w - g.rect.w) * k, h: g.rect.h + (target.h - g.rect.h) * k } }
        g.opacity = Math.min(1, g.opacity + dt * 2.2)
        if (!g.interactive) g.targetDist = 4.35
      } else g.opacity = Math.max(0, g.opacity - dt * 4)
      if (!g.rect || g.opacity <= 0.001 || g.rect.w < 2 || g.rect.h < 2) continue
      // motion
      g.dist += (g.targetDist - g.dist) * (1 - Math.exp(-dt * 8))
      if (g.flyTo) {
        let dl = ((g.flyTo.lon - g.lon + 540) % 360) - 180; const k = 1 - Math.exp(-dt * 4)
        g.lon += dl * k; g.lat += (g.flyTo.lat - g.lat) * k; if (Math.abs(dl) < 0.2) g.flyTo = null
      } else if (!g.dragging) {
        g.lon += g.vLon; g.lat = Math.max(-80, Math.min(80, g.lat + g.vLat)); g.vLon *= 0.92; g.vLat *= 0.92
        if (g.autoRotate && now - g.lastInteraction > 2500) g.lon += dt * 5.5
      }
      g.group.rotation.set((g.lat * Math.PI) / 180, (-g.lon * Math.PI) / 180, 0); g.group.updateMatrixWorld(true)
      const r = g.rect
      g.camera.aspect = r.w / r.h; g.camera.position.set(0, 0, r.w < r.h ? g.dist * (r.h / r.w) : g.dist); g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld()
      const sk = this.sizeK(g), pr = this.renderer.getPixelRatio()
      for (const m of g.mats) m.uniforms.uOpacity.value = g.opacity
      g.mats[2].uniforms.uScale.value = Math.max(1.4, 2.5 * sk * (4.9 / g.dist) ** 0.8) * pr
      g.mats[3].uniforms.uPx.value = sk * (4.9 / g.dist) ** 0.7 * pr
      g.borderMat.opacity = g.interactive ? 0.2 * g.opacity : 0.07 * g.opacity
      const x = Math.round(r.x), y = Math.round(ch - r.y - r.h), w = Math.round(r.w), h = Math.round(r.h)
      this.renderer.setViewport(x, y, w, h); this.renderer.setScissor(Math.max(0, x), Math.max(0, y), w, h)
      this.renderer.clearDepth(); this.renderer.render(g.scene, g.camera)
      if (g.interactive) labelled = g
    }
    this.updateLabels(labelled)
  }
  private updateLabels(g: Globe | null) {
    let used = 0
    if (g && g.opacity > 0.9) {
      const cands = g.pointData.map((d, i) => ({ d, i })).filter((c) => c.d.label && c.d.alpha > 0.3).sort((a, b) => (b.d.id === this.hoverId ? 1e9 : b.d.size) - (a.d.id === this.hoverId ? 1e9 : a.d.size))
      const placed: { x: number; y: number }[] = []
      for (const c of cands) {
        if (used >= this.labels.length) break
        const s = this.project(g, g.pointPos[c.i]); if (!s) continue
        if (placed.some((p) => Math.abs(p.x - s.x) < 92 && Math.abs(p.y - s.y) < 17)) continue
        placed.push(s)
        const el = this.labels[used++], off = (c.d.size * (4.9 / g.dist) ** 0.7) / 2 + 6
        if (el.textContent !== c.d.label) el.textContent = c.d.label!
        el.style.transform = `translate(${Math.round(s.x + off)}px, ${Math.round(s.y - 7)}px)`; el.style.opacity = String(Math.min(1, c.d.alpha + 0.2)); el.style.display = 'block'
        el.classList.toggle('hot', c.d.id === this.hoverId)
      }
    }
    for (let i = used; i < this.labels.length; i++) this.labels[i].style.display = 'none'
  }
}
