import { useMemo, useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'

const lightColors = ['#f0ebff', '#dfd5fe', '#b8a3fb', '#9373ff', '#6841ea']
const darkColors = ['#4e4181', '#3f3663', '#352f4c', '#522bd6', '#6841ea']

function getRandomColor(theme: 'light' | 'dark') {
  const colors = theme === 'dark' ? darkColors : lightColors
  return colors[Math.floor(Math.random() * colors.length)]
}

export default function RandomBg({
  width = '100%',
  height = '100%',
  className,
}: {
  width?: string | number
  height?: string | number
  className?: string
}) {
  const { resolvedMode } = useTheme()
  const [localTheme, setLocalTheme] = useState(resolvedMode)

  useEffect(() => {
    setLocalTheme(resolvedMode)
  }, [resolvedMode])

  const shapes = useMemo(() => {
    const count = 6
    const arr = []
    for (let i = 0; i < count; i++) {
      const size = 30 + Math.random() * 70
      const x = Math.random() * 100
      const y = Math.random() * 100
      const color = getRandomColor(localTheme)
      const shapeType = Math.random() > 0.5 ? 'circle' : 'rect'
      arr.push({ size, x, y, color, shapeType })
    }
    return arr
  }, [localTheme])

  const bgColor = localTheme === 'dark' ? '#121212' : '#f9f9f9'

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={{ display: 'block', backgroundColor: bgColor }}
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map(({ size, x, y, color, shapeType }, i) =>
        shapeType === 'circle' ? (
          <circle key={i} cx={x} cy={y} r={size / 2} fill={color} fillOpacity={0.3} />
        ) : (
          <rect
            key={i}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            fill={color}
            fillOpacity={0.3}
            rx={size / 5}
            ry={size / 5}
          />
        ),
      )}
    </svg>
  )
}
