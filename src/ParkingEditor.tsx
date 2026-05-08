import { useState, useRef, useEffect, useCallback } from 'react'

type Point = { x: number; y: number }
type Quad = [Point, Point, Point, Point]

interface Space {
  id: string
  points: Quad
}

const COLORS = [
  '#00e676', '#ffea00', '#ff6d00', '#00e5ff',
  '#e040fb', '#ff1744', '#00b0ff', '#76ff03',
]
const HANDLE_R = 8

function insidePolygon(pt: Point, pts: Point[]): boolean {
  let inside = false
  const n = pts.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x, yi = pts[i].y
    const xj = pts[j].x, yj = pts[j].y
    if (((yi > pt.y) !== (yj > pt.y)) &&
      pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export default function ParkingEditor() {
  const [phase, setPhase] = useState<'setup' | 'edit'>('setup')
  const [imgSrc, setImgSrc] = useState('')
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [count, setCount] = useState(4)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [selected, setSelected] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ si: number; pi: number } | null>(null)
  const spacesRef = useRef(spaces)
  spacesRef.current = spaces

  const loadFile = (file: File) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setImgSrc(url)
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    }
    img.src = url
  }

  const create = () => {
    const { w, h } = imgSize
    const sw = w / count
    const y1 = Math.round(h * 0.25)
    const y2 = Math.round(h * 0.75)
    const initial: Space[] = Array.from({ length: count }, (_, i) => ({
      id: `P${i + 1}`,
      points: [
        { x: Math.round(i * sw),       y: y1 },
        { x: Math.round((i + 1) * sw), y: y1 },
        { x: Math.round((i + 1) * sw), y: y2 },
        { x: Math.round(i * sw),       y: y2 },
      ],
    }))
    setSpaces(initial)
    setSelected(null)
    setPhase('edit')
  }

  const draw = useCallback((spaceList: Space[], sel: number | null) => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)

    spaceList.forEach((s, idx) => {
      const color = COLORS[idx % COLORS.length]
      const isSel = idx === sel
      const pts = s.points

      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.closePath()
      ctx.fillStyle = color + '40'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = isSel ? 4 : 2
      ctx.stroke()

      pts.forEach(p => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2)
        ctx.fillStyle = isSel ? '#fff' : color
        ctx.fill()
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1.5
        ctx.stroke()
      })

      const cx = pts.reduce((a, p) => a + p.x, 0) / 4
      const cy = pts.reduce((a, p) => a + p.y, 0) / 4
      const fs = Math.max(18, img.naturalWidth / 60)
      ctx.font = `bold ${fs}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#000a'
      ctx.fillText(s.id, cx + 2, cy + 2)
      ctx.fillStyle = '#fff'
      ctx.fillText(s.id, cx, cy)
    })
  }, [])

  useEffect(() => {
    if (phase !== 'edit') return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = imgSize.w
    canvas.height = imgSize.h
    draw(spaces, selected)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    if (phase === 'edit') draw(spaces, selected)
  }, [spaces, selected, draw, phase])

  const toImgPt = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = toImgPt(e)
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const hitR = HANDLE_R * (c.width / r.width)

    for (let si = spacesRef.current.length - 1; si >= 0; si--) {
      for (let pi = 0; pi < 4; pi++) {
        const h = spacesRef.current[si].points[pi]
        if (Math.hypot(pt.x - h.x, pt.y - h.y) < hitR) {
          drag.current = { si, pi }
          setSelected(si)
          return
        }
      }
    }
    for (let si = spacesRef.current.length - 1; si >= 0; si--) {
      if (insidePolygon(pt, spacesRef.current[si].points)) {
        setSelected(si)
        return
      }
    }
    setSelected(null)
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag.current) return
    const pt = toImgPt(e)
    const { si, pi } = drag.current
    setSpaces(prev => prev.map((s, i) => {
      if (i !== si) return s
      const pts = [...s.points] as Quad
      pts[pi] = pt
      return { ...s, points: pts }
    }))
  }

  const onMouseUp = () => { drag.current = null }

  const saveJson = () => {
    const out = spaces.map(s => ({
      id: s.id,
      points: s.points.map(p => [Math.round(p.x), Math.round(p.y)]),
    }))
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'parking_spaces.json'
    a.click()
  }

  if (phase === 'setup') {
    return (
      <div className="parking-setup">
        <div className="setup-card">
          <h2 className="setup-title">주차면 편집</h2>

          <div className="setup-field">
            <span className="setup-label">이미지 파일</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) loadFile(e.target.files[0]); e.target.value = '' }}
            />
            <button className="btn" onClick={() => fileRef.current?.click()}>파일 선택</button>
            {imgSrc
              ? <span className="setup-hint ok">{imgSize.w} × {imgSize.h} px</span>
              : <span className="setup-hint">선택된 파일 없음</span>}
          </div>

          <div className="setup-field">
            <span className="setup-label">주차면 수</span>
            <input
              type="number"
              min={1}
              max={8}
              value={count}
              onChange={e => setCount(Math.min(8, Math.max(1, parseInt(e.target.value) || 1)))}
              className="count-input"
            />
            <span className="setup-hint">1 ~ 8개</span>
          </div>

          <button className="create-btn" onClick={create} disabled={!imgSrc}>
            생성
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="parking-edit-layout">
      <div className="parking-canvas-wrap">
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ maxWidth: '100%', maxHeight: '100%', cursor: 'crosshair', display: 'block' }}
        />
      </div>

      <div className="parking-bottom">
        <div className="space-list">
          {spaces.map((s, i) => (
            <div
              key={i}
              className={`space-row ${i === selected ? 'active' : ''}`}
              onClick={() => setSelected(i)}
            >
              <span className="space-dot" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="space-num">{i + 1}번</span>
              <span className="space-id-label">ID</span>
              <input
                value={s.id}
                onChange={e => setSpaces(prev =>
                  prev.map((x, j) => j === i ? { ...x, id: e.target.value } : x)
                )}
                onClick={ev => ev.stopPropagation()}
                className="space-id-input"
              />
            </div>
          ))}
        </div>

        <div className="parking-bottom-actions">
          <button className="action-btn" onClick={() => { setPhase('setup'); setSpaces([]) }}>
            다시 설정
          </button>
          <button className="action-btn save-json-btn" onClick={saveJson}>
            JSON 저장
          </button>
        </div>
      </div>
    </div>
  )
}
