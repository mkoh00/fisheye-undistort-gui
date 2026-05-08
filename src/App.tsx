import { useState, useRef, useEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import cv from '@techstark/opencv-js'
import { waitForOpenCV } from './core/opencvReady'
import { FisheyeUndistorter } from './core/fisheyeUndistorter'
import { fromRawParams } from './core/undistortionParams'
import { imreadFromFile, matToDataUrl } from './core/imageIo'

type K4 = [number, number, number, number]

interface RawParams {
  k: K4  // [fx, fy, cx, cy]
  d: K4  // [k1, k2, k3, k4]
  p: K4  // [fx, fy, cx, cy]
  r: number
}

interface ParamSteps {
  k: K4
  d: K4
  p: K4
  r: number
}

const DEFAULT_PARAMS: RawParams = {
  k: [1544, 1500, 1504, 1500],
  d: [0, 0, 0, 0],
  p: [1000, 1000, 1504, 1500],
  r: -1,
}

const DEFAULT_STEPS: ParamSteps = {
  k: [50, 10, 10, 10],
  d: [0.01, 0.01, 0.01, 0.01],
  p: [10, 10, 10, 10],
  r: 1.0,
}

// ── ParamGroup ─────────────────────────────────────────────────────────────

interface ParamGroupProps {
  title: string
  labels: string[]
  values: number[]
  steps: number[]
  stepInputStep: number
  onValueChange: (i: number, v: number) => void
  onStepChange: (i: number, v: number) => void
}

function ParamGroup({ title, labels, values, steps, stepInputStep, onValueChange, onStepChange }: ParamGroupProps) {
  return (
    <div className="param-group">
      <h4>{title}</h4>
      {labels.map((label, i) => (
        <div key={label} className="param-row">
          <span className="param-label">{label}:</span>
          <input
            type="number"
            className="param-value"
            value={values[i]}
            step={steps[i]}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v)) onValueChange(i, v)
            }}
          />
          <input
            type="number"
            className="param-step"
            value={steps[i]}
            step={stepInputStep}
            min={0.00001}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v) && v > 0) onStepChange(i, v)
            }}
          />
        </div>
      ))}
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [cvReady, setCvReady] = useState(false)
  const [imageName, setImageName] = useState('')
  const [params, setParams] = useState<RawParams>(DEFAULT_PARAMS)
  const [steps, setSteps] = useState<ParamSteps>(DEFAULT_STEPS)
  const [baseParams, setBaseParams] = useState<RawParams>(DEFAULT_PARAMS)
  const [originalDataUrl, setOriginalDataUrl] = useState('')
  const [undistortedDataUrl, setUndistortedDataUrl] = useState('')
  const [processing, setProcessing] = useState(false)

  const srcMatRef = useRef<cv.Mat | null>(null)
  const srcPixelsRef = useRef<Uint8Array | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const paramsRef = useRef(params)
  paramsRef.current = params

  const fileInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    waitForOpenCV().then(() => setCvReady(true))
  }, [])

  // ── Processing ──────────────────────────────────────────────────────────

  const doProcess = useCallback(() => {
    const srcMat = srcMatRef.current
    if (!srcMat) return

    const p = paramsRef.current

    // Force React to paint "Processing..." before the synchronous WASM computation
    flushSync(() => setProcessing(true))

    try {
      const undistortionParams = fromRawParams(p)
      const cx = undistortionParams.k[0][2]
      const cy = undistortionParams.k[1][2]
      const outW = Math.max(2, Math.round(cx) * 2)
      const outH = Math.max(2, Math.round(cy) * 2)

      const undistorter = new FisheyeUndistorter(outW, outH, undistortionParams)

      const undistorted = undistorter.undistortImage(srcMat)

      const withBounds = new cv.Mat(srcMat.rows, srcMat.cols, cv.CV_8UC3)
      withBounds.data.set(srcPixelsRef.current!)
      undistorter.drawUndistortionBoundaries(withBounds)
      undistorter.dispose()

      setOriginalDataUrl(matToDataUrl(withBounds))
      setUndistortedDataUrl(matToDataUrl(undistorted))

      undistorted.delete()
      withBounds.delete()
    } catch (err) {
      console.error('Processing error:', err)
    } finally {
      setProcessing(false)
    }
  }, [])

  const scheduleProcess = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(doProcess, 100)
  }, [doProcess])

  // Reprocess on every param change (debounced)
  useEffect(() => {
    if (cvReady && srcMatRef.current) scheduleProcess()
  }, [params, cvReady, scheduleProcess])

  // ── File handlers ───────────────────────────────────────────────────────

  const handleImageFile = async (file: File) => {
    if (!cvReady) return
    if (srcMatRef.current) {
      srcMatRef.current.delete()
      srcMatRef.current = null
    }
    setImageName(file.name)
    try {
      srcMatRef.current = await imreadFromFile(file)
      srcPixelsRef.current = new Uint8Array(srcMatRef.current.data)
      doProcess()
    } catch (err) {
      console.error('Failed to load image:', err)
    }
  }

  const handleLoadParams = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target!.result as string)
        const loaded: RawParams = {
          k: json.k as K4,
          d: json.d as K4,
          p: json.p as K4,
          r: json.r as number,
        }
        setParams(loaded)
        setBaseParams(loaded)
      } catch {
        alert('Invalid params JSON file')
      }
    }
    reader.readAsText(file)
  }

  const handleSaveParams = () => {
    const blob = new Blob([JSON.stringify(params, null, 4)], { type: 'application/json' })
    triggerDownload(URL.createObjectURL(blob), 'camera_params.json')
  }

  const handleSaveImage = () => {
    if (!undistortedDataUrl) return
    triggerDownload(undistortedDataUrl, imageName ? `undistorted_${imageName}` : 'undistorted.jpg')
  }

  // ── Param updaters ──────────────────────────────────────────────────────

  const updateParam = (group: 'k' | 'd' | 'p', i: number, v: number) =>
    setParams(prev => {
      const arr = [...prev[group]] as K4
      arr[i] = v
      return { ...prev, [group]: arr }
    })

  const updateStep = (group: 'k' | 'd' | 'p', i: number, v: number) =>
    setSteps(prev => {
      const arr = [...prev[group]] as K4
      arr[i] = v
      return { ...prev, [group]: arr }
    })

  // ── Render ──────────────────────────────────────────────────────────────

  const hasImage = !!imageName

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Toolbar */}
      <div className="toolbar">
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          Select Image File
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png"
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files?.[0]) handleImageFile(e.target.files[0])
            e.target.value = ''
          }}
        />
        <span className="filepath">{imageName || 'No file selected'}</span>
        <button
          className="btn"
          onClick={doProcess}
          disabled={!cvReady || !hasImage || processing}
        >
          {!cvReady ? 'Loading OpenCV…' : processing ? 'Processing…' : 'Refresh'}
        </button>
      </div>

      {/* Image panels */}
      <div className="image-viewer">
        {processing && (
          <div className="processing-overlay">Processing…</div>
        )}
        <div className="image-panel">
          {originalDataUrl
            ? <img src={originalDataUrl} alt="original with boundaries" />
            : <span className="placeholder">Original Image</span>}
        </div>
        <div className="image-panel">
          {undistortedDataUrl
            ? <img src={undistortedDataUrl} alt="undistorted" />
            : <span className="placeholder">Undistorted Image</span>}
        </div>
      </div>

      {/* Parameter controls */}
      <div className="controls">
        <div className="param-groups">
          <ParamGroup
            title="K Matrix"
            labels={['fx', 'fy', 'cx', 'cy']}
            values={[...params.k]}
            steps={[...steps.k]}
            stepInputStep={1}
            onValueChange={(i, v) => updateParam('k', i, v)}
            onStepChange={(i, v) => updateStep('k', i, v)}
          />
          <ParamGroup
            title="D Coefficients"
            labels={['k1', 'k2', 'k3', 'k4']}
            values={[...params.d]}
            steps={[...steps.d]}
            stepInputStep={0.001}
            onValueChange={(i, v) => updateParam('d', i, v)}
            onStepChange={(i, v) => updateStep('d', i, v)}
          />
          <ParamGroup
            title="P Matrix"
            labels={['fx', 'fy', 'cx', 'cy']}
            values={[...params.p]}
            steps={[...steps.p]}
            stepInputStep={1}
            onValueChange={(i, v) => updateParam('p', i, v)}
            onStepChange={(i, v) => updateStep('p', i, v)}
          />
          <div className="param-group">
            <h4>Rotation</h4>
            <div className="param-row">
              <span className="param-label">angle:</span>
              <input
                type="number"
                className="param-value"
                value={params.r}
                step={steps.r}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) setParams(prev => ({ ...prev, r: v }))
                }}
              />
              <input
                type="number"
                className="param-step"
                value={steps.r}
                step={0.1}
                min={0.00001}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v > 0) setSteps(prev => ({ ...prev, r: v }))
                }}
              />
            </div>
          </div>
        </div>

        <div className="action-buttons">
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files?.[0]) handleLoadParams(e.target.files[0])
              e.target.value = ''
            }}
          />
          <button className="action-btn" onClick={() => jsonInputRef.current?.click()}>
            Load Parameters
          </button>
          <button className="action-btn" onClick={handleSaveParams}>
            Save Parameters
          </button>
          <button className="action-btn" onClick={() => setParams(baseParams)}>
            Reset Parameters
          </button>
          <button className="action-btn" onClick={handleSaveImage} disabled={!undistortedDataUrl}>
            Save Image
          </button>
        </div>
      </div>
    </div>
  )
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}
