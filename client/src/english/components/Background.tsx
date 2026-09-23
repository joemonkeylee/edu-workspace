import { useEffect, useRef } from 'react'

interface BackgroundProps {
  baseColor?: { r: number; g: number; b: number }
  isDarkMode?: boolean
}

const Delaunay = {
  distance: (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
    Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2)),

  circumcircle: (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
  ) => {
    const A = p2.x - p1.x
    const B = p2.y - p1.y
    const C = p3.x - p1.x
    const D = p3.y - p1.y
    const E = A * (p1.x + p2.x) + B * (p1.y + p2.y)
    const F = C * (p1.x + p3.x) + D * (p1.y + p3.y)
    const G = 2 * (A * (p3.y - p2.y) - B * (p3.x - p2.x))
    if (Math.abs(G) < 0.000001) return null
    const center = { x: (D * E - B * F) / G, y: (A * F - C * E) / G }
    return { center, radius: Delaunay.distance(center, p1) }
  },

  pointInCircle: (
    p: { x: number; y: number },
    circle: { center: { x: number; y: number }; radius: number },
  ) => Delaunay.distance(p, circle.center) < circle.radius,

  triangulate: (points: { x: number; y: number }[]) => {
    if (points.length < 3) return []
    const superTriangle = [
      { x: -10000, y: -10000 },
      { x: 10000, y: -10000 },
      { x: 0, y: 10000 },
    ]
    let triangles = [[0, 1, 2]]
    for (let i = 0; i < points.length; i++) {
      const point = points[i]
      const edges: number[][] = []
      const newTriangles: number[][] = []
      for (const triangle of triangles) {
        const p1 = triangle[0] < 3 ? superTriangle[triangle[0]] : points[triangle[0] - 3]
        const p2 = triangle[1] < 3 ? superTriangle[triangle[1]] : points[triangle[1] - 3]
        const p3 = triangle[2] < 3 ? superTriangle[triangle[2]] : points[triangle[2] - 3]
        const circle = Delaunay.circumcircle(p1, p2, p3)
        if (circle && Delaunay.pointInCircle(point, circle)) {
          edges.push([triangle[0], triangle[1]])
          edges.push([triangle[1], triangle[2]])
          edges.push([triangle[2], triangle[0]])
        } else {
          newTriangles.push(triangle)
        }
      }
      const uniqueEdges: number[][] = []
      for (const edge of edges) {
        const reversedEdge = [edge[1], edge[0]]
        if (!edges.some((e) => e[0] === reversedEdge[0] && e[1] === reversedEdge[1])) {
          uniqueEdges.push(edge)
        }
      }
      for (const edge of uniqueEdges) {
        newTriangles.push([edge[0], edge[1], i + 3])
      }
      triangles = newTriangles
    }
    const finalTriangles: number[][] = []
    for (const triangle of triangles) {
      if (!triangle.some((index) => index < 3)) {
        finalTriangles.push(triangle.map((index) => index - 3))
      }
    }
    return finalTriangles
  },
}

export default function Background({
  baseColor = { r: 0, g: 74, b: 153 },
  isDarkMode = false,
}: BackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const setCanvasSize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    setCanvasSize()

    const generateGradientBackground = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let startColor: string, endColor: string
      if (isDarkMode) {
        startColor = `rgb(${Math.max(0, baseColor.r - 10)}, ${Math.max(0, baseColor.g - 10)}, ${Math.max(0, baseColor.b - 10)})`
        endColor = `rgb(${Math.max(0, baseColor.r - 40)}, ${Math.max(0, baseColor.g - 40)}, ${Math.max(0, baseColor.b - 40)})`
      } else {
        startColor = `rgb(${Math.min(255, baseColor.r + 30)}, ${Math.min(255, baseColor.g + 30)}, ${Math.min(255, baseColor.b + 30)})`
        endColor = `rgb(${Math.min(255, baseColor.r + 10)}, ${Math.min(255, baseColor.g + 10)}, ${Math.min(255, baseColor.b + 10)})`
      }
      const baseGradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      baseGradient.addColorStop(0, startColor)
      baseGradient.addColorStop(1, endColor)
      ctx.fillStyle = baseGradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const pointCount = 8
      const points: { x: number; y: number }[] = []
      points.push({ x: 0, y: 0 }, { x: canvas.width, y: 0 }, { x: canvas.width, y: canvas.height }, { x: 0, y: canvas.height })
      points.push({ x: canvas.width / 2, y: 0 }, { x: canvas.width, y: canvas.height / 2 }, { x: canvas.width / 2, y: canvas.height }, { x: 0, y: canvas.height / 2 })

      const cellSize = Math.sqrt((canvas.width * canvas.height) / (pointCount * 1.5))
      const gridWidth = Math.ceil(canvas.width / cellSize)
      const gridHeight = Math.ceil(canvas.height / cellSize)
      const grid: boolean[][] = []
      for (let i = 0; i < gridHeight; i++) grid.push(new Array(gridWidth).fill(false))

      let attempts = 0
      let placedPoints = 0
      while (placedPoints < pointCount && attempts < 1000) {
        const gridX = Math.floor(Math.random() * gridWidth)
        const gridY = Math.floor(Math.random() * gridHeight)
        const x = gridX * cellSize + cellSize * 0.25 + Math.random() * cellSize * 0.5
        const y = gridY * cellSize + cellSize * 0.25 + Math.random() * cellSize * 0.5
        const clampedX = Math.max(0, Math.min(canvas.width, x))
        const clampedY = Math.max(0, Math.min(canvas.height, y))
        let canPlace = true
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gridX + dx
            const ny = gridY + dy
            if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight && grid[ny][nx]) {
              canPlace = false
              break
            }
          }
          if (!canPlace) break
        }
        if (canPlace) {
          grid[gridY][gridX] = true
          points.push({ x: clampedX, y: clampedY })
          placedPoints++
        }
        attempts++
      }
      if (placedPoints < pointCount) {
        for (let i = placedPoints; i < pointCount; i++) {
          const x = (i / pointCount) * canvas.width + Math.random() * canvas.width * 0.1
          const y = ((i % 4) / 4) * canvas.height + Math.random() * canvas.height * 0.1
          points.push({ x: Math.max(0, Math.min(canvas.width, x)), y: Math.max(0, Math.min(canvas.height, y)) })
        }
      }

      const triangles = Delaunay.triangulate(points)
      for (const triangle of triangles) {
        const p1 = points[triangle[0]]
        const p2 = points[triangle[1]]
        const p3 = points[triangle[2]]
        const colorVariation = 30
        const baseVariation = (Math.random() - 0.5) * 15
        const mainColor = {
          r: Math.max(0, Math.min(255, baseColor.r + baseVariation)),
          g: Math.max(0, Math.min(255, baseColor.g + baseVariation)),
          b: Math.max(0, Math.min(255, baseColor.b + baseVariation)),
        }
        const color1 = {
          r: Math.max(0, Math.min(255, mainColor.r + (Math.random() - 0.5) * colorVariation)),
          g: Math.max(0, Math.min(255, mainColor.g + (Math.random() - 0.5) * colorVariation)),
          b: Math.max(0, Math.min(255, mainColor.b + (Math.random() - 0.5) * colorVariation)),
        }
        const color2 = {
          r: Math.max(0, Math.min(255, mainColor.r + (Math.random() - 0.5) * colorVariation)),
          g: Math.max(0, Math.min(255, mainColor.g + (Math.random() - 0.5) * colorVariation)),
          b: Math.max(0, Math.min(255, mainColor.b + (Math.random() - 0.5) * colorVariation)),
        }
        const gradient = ctx.createLinearGradient(p1.x, p1.y, p3.x, p3.y)
        gradient.addColorStop(0, `rgb(${color1.r}, ${color1.g}, ${color1.b})`)
        gradient.addColorStop(0.5, `rgb(${(color1.r + color2.r) / 2}, ${(color1.g + color2.g) / 2}, ${(color1.b + color2.b) / 2})`)
        gradient.addColorStop(1, `rgb(${color2.r}, ${color2.g}, ${color2.b})`)
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.lineTo(p3.x, p3.y)
        ctx.closePath()
        ctx.fillStyle = gradient
        ctx.fill()
      }
    }

    generateGradientBackground()
    const handleResize = () => {
      setCanvasSize()
      generateGradientBackground()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [baseColor, isDarkMode])

  return (
    <div className="fixed inset-0 -z-10">
      <canvas ref={canvasRef} />
    </div>
  )
}
