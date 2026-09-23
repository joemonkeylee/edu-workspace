import { useState, useEffect } from 'react'

export default function Loading({ text = 'Loading' }: { text?: string }) {
  const [dots, setDots] = useState('')

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'))
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[9999]">
      <div
        className="min-w-[160px] rounded-lg px-10 py-5 text-center text-lg font-normal text-primary shadow-lg"
        role="status"
        aria-live="polite"
        aria-label={text}
      >
        {text}
        {dots}
      </div>
    </div>
  )
}
