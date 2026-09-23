import { RESOURCE_BASE_URL } from './appConfig'

export interface DictEntry {
  name: string
  trans: string[]
  usphone?: string
  ukphone?: string
}

let dictMap: Map<string, DictEntry> | null = null
let pending: Promise<Map<string, DictEntry>> | null = null

export function peekDictionary(): Map<string, DictEntry> | null {
  return dictMap
}

export function loadDictionary(): Promise<Map<string, DictEntry>> {
  if (dictMap) return Promise.resolve(dictMap)
  if (pending) return pending

  pending = fetch(`${RESOURCE_BASE_URL}/data/dictionary.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load dictionary: ${res.status}`)
      return res.json()
    })
    .then((list: DictEntry[]) => {
      const map = new Map<string, DictEntry>()
      for (let i = 0; i < list.length; i++) {
        const entry = list[i]
        if (!entry || !entry.name) continue
        const key = entry.name.toLowerCase()
        if (!map.has(key)) map.set(key, entry)
      }
      dictMap = map
      pending = null
      return map
    })
    .catch((e) => {
      pending = null
      console.error('Failed to load dictionary:', e)
      throw e
    })

  return pending
}
