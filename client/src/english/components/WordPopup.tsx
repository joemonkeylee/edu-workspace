import type { DictEntry } from '../dictionary'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface WordPopupProps {
  word: DictEntry | null
  loading?: boolean
  miss?: string | null
  error?: boolean
  onClose: () => void
}

export default function WordPopup({ word, loading = false, miss = null, error = false, onClose }: WordPopupProps) {
  const open = !!(word || loading || miss || error)
  const us = word?.usphone ? `/${word.usphone}/` : ''
  const uk = word?.ukphone ? `/${word.ukphone}/` : ''
  const heading = loading ? '查词中…' : word ? word.name : miss || ''

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-[40%]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-normal text-primary">{heading}</DialogTitle>
          {error ? (
            <DialogDescription>词典加载失败，请检查网络后再试</DialogDescription>
          ) : !loading && (us || uk) ? (
            <div className="flex flex-wrap gap-4 text-muted-foreground">
              {us && <span>US <strong>{us}</strong></span>}
              {uk && <span>UK <strong>{uk}</strong></span>}
            </div>
          ) : null}
        </DialogHeader>
        {!loading && !error && word ? (
          <div>
            <p className="mb-2 text-foreground">Translations:</p>
            <ul className="list-none space-y-2 p-0 m-0">
              {word.trans?.length ? word.trans.map((t, i) => (
                <li key={i} className="whitespace-pre-wrap rounded bg-muted px-3 py-2 text-foreground">
                  {t.split('\n').map((line, j) => (
                    <span key={j}>{line}{j < t.replace(/\r\n/g, '\n').split('\n').length - 1 && <br />}</span>
                  ))}
                </li>
              )) : null}
            </ul>
          </div>
        ) : null}
        {!loading && !error && !word && miss ? (
          <p className="text-muted-foreground text-sm">词典未收录该词</p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
