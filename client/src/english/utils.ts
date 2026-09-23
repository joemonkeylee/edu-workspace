export function getVoaId(
  bookIdx: number,
  lessonIdx: number,
  voaStartIds: number[] = [1001, 2001, 3001, 4001],
  lessonsCount: number[] = [144, 96, 60, 48],
): number | null {
  if (
    bookIdx < 0 ||
    bookIdx >= voaStartIds.length ||
    lessonIdx < 0 ||
    lessonIdx >= lessonsCount[bookIdx]
  ) {
    return null
  }
  return voaStartIds[bookIdx] + lessonIdx
}

export const getFCPRange = (value: number) => {
  if (value <= 1.8) return { grade: '优秀', range: '<=1.8s', impact: '用户尽快看到内容，体验流畅' }
  if (value <= 3) return { grade: '需要改进', range: '1.8s ~ 3s', impact: '内容加载稍慢，可能影响用户耐心' }
  return { grade: '差', range: '>3s', impact: '内容加载过慢，用户可能流失' }
}

export const getLCPRange = (value: number) => {
  if (value <= 2.5) return { grade: '优秀', range: '<=2.5s', impact: '主要内容快速加载，用户满意' }
  if (value <= 4) return { grade: '需要改进', range: '2.5s ~ 4s', impact: '加载较慢，用户体验受影响' }
  return { grade: '差', range: '>4s', impact: '加载缓慢，用户流失风险高' }
}

export const getFIDRange = (value: number) => {
  if (value <= 100) return { grade: '优秀', range: '<=100ms', impact: '交互响应快，不卡顿' }
  if (value <= 300) return { grade: '需要改进', range: '100ms ~ 300ms', impact: '交互稍有延迟，体验一般' }
  return { grade: '差', range: '>300ms', impact: '交互卡顿，用户体验差' }
}

export const getCLSRange = (value: number) => {
  if (value <= 0.1) return { grade: '优秀', range: '<=0.1', impact: '页面稳定，无跳动' }
  if (value <= 0.25) return { grade: '需要改进', range: '0.1 ~ 0.25', impact: '页面有轻微跳动，影响体验' }
  return { grade: '差', range: '>0.25', impact: '页面严重跳动，影响阅读' }
}

export const getTTFBRange = (value: number) => {
  if (value <= 100) return { grade: '优秀', range: '<=100ms', impact: '响应快，页面加载开始快' }
  if (value <= 300) return { grade: '需要改进', range: '100ms ~ 300ms', impact: '响应稍慢，影响加载速度' }
  return { grade: '差', range: '>300ms', impact: '响应慢，页面加载延迟' }
}

export const getTTIRange = (value: number) => {
  if (value <= 3800) return { grade: '优秀', range: '<=3.8s', impact: '页面快速可交互，体验好' }
  if (value <= 7300) return { grade: '需要改进', range: '3.8s ~ 7.3s', impact: '页面响应较慢，体验一般' }
  return { grade: '差', range: '>7.3s', impact: '页面响应慢，用户体验差' }
}
