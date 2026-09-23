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
  const meanings: Record<string, string> = {
    FCP: '从导航开始到页面首次渲染出任何文本、图像或非空白元素的时间',
    LCP: '从导航开始到页面最大内容元素(图片/文本块)完成渲染的时间',
    INP: '页面生命周期内最长的一次用户交互(点击/按键)响应时间',
    CLS: '页面加载后所有布局偏移的累积分数,值越小越稳定',
    TTFB: '从发起请求到收到服务器首个字节响应的时间(含 DNS/TCP/TLS)',
    TTI: '从导航开始到页面完全可交互(主线程持续 5s 空闲)的时间',
  }

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
    meaning: meanings[metric.name] ?? '未知指标',
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
