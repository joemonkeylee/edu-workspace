import {
  getCLSRange,
  getFCPRange,
  getFIDRange,
  getLCPRange,
  getTTFBRange,
  getTTIRange,
} from './utils'

export interface VitalInfo {
  name: string
  meaning: string
  idealRange: string
  userImpact: string
  improvementNeeded: string
  referenceLink: string
}

export interface Metric {
  name: string
  value: number
  delta: number
  id: string
  entries: any[]
  rating?: string
}

export function convertMetricToVitalInfo(
  metric: Metric,
): VitalInfo & { rawMetric: Metric } {
  let rangeInfo: {
    grade: string
    range: string
    impact: string
    improvementNeeded: string
    referenceLink: string
  } = {
    grade: '无',
    range: '无',
    impact: '无',
    improvementNeeded: '否',
    referenceLink: '',
  }

  const valueInSeconds = metric.value / 1000

  switch (metric.name) {
    case 'FCP':
      rangeInfo = {
        ...getFCPRange(valueInSeconds),
        improvementNeeded: valueInSeconds > 3 ? '是' : '否',
        referenceLink: 'https://web.dev/first-contentful-paint/',
      }
      break
    case 'LCP':
      rangeInfo = {
        ...getLCPRange(valueInSeconds),
        improvementNeeded: valueInSeconds > 4 ? '是' : '否',
        referenceLink: 'https://web.dev/lcp/',
      }
      break
    case 'INP':
      rangeInfo = {
        ...getFIDRange(valueInSeconds),
        improvementNeeded: valueInSeconds > 0.3 ? '是' : '否',
        referenceLink: 'https://web.dev/inp/',
      }
      break
    case 'CLS':
      rangeInfo = {
        ...getCLSRange(metric.value),
        improvementNeeded: metric.value > 0.25 ? '是' : '否',
        referenceLink: 'https://web.dev/cls/',
      }
      break
    case 'TTFB':
      rangeInfo = {
        ...getTTFBRange(valueInSeconds),
        improvementNeeded: valueInSeconds > 0.3 ? '是' : '否',
        referenceLink: 'https://web.dev/ttfb/',
      }
      break
    case 'TTI':
      rangeInfo = {
        ...getTTIRange(valueInSeconds),
        improvementNeeded: valueInSeconds > 7.3 ? '是' : '否',
        referenceLink: 'https://web.dev/tti/',
      }
      break
    default:
      rangeInfo = {
        grade: '无',
        range: '无',
        impact: '无',
        improvementNeeded: '否',
        referenceLink: '',
      }
  }

  return {
    name: metric.name,
    meaning: `指标 ${metric.name}，当前值 ${metric.value.toFixed(2)} 毫秒 (${rangeInfo.grade})`,
    idealRange: rangeInfo.range,
    userImpact: rangeInfo.impact,
    improvementNeeded: rangeInfo.improvementNeeded,
    referenceLink: rangeInfo.referenceLink,
    rawMetric: metric,
  }
}

export function reportWebVitals(
  onPerfEntry: (metric: Metric) => void,
): void {
  import('web-vitals').then(({ onCLS, onINP, onFCP, onLCP, onTTFB }) => {
    onCLS(onPerfEntry)
    onINP(onPerfEntry)
    onFCP(onPerfEntry)
    onLCP(onPerfEntry)
    onTTFB(onPerfEntry)
  })
}
