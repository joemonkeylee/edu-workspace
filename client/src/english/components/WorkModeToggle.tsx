import { WorkModes, type WorkModeType } from '../constants'
import { cn } from '@/lib/utils'

interface Props {
  workMode: WorkModeType
  onChangeWorkMode: (mode: WorkModeType) => void
}

/** 听写 / 打字 开关：独立于顶栏，用于骑在分割线上 */
export default function WorkModeToggle({ workMode, onChangeWorkMode }: Props) {
  const segBtn = (active: boolean) =>
    cn(
      'h-7 px-2.5 text-xs font-normal rounded-sm transition-all',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
    )

  return (
    <div className="flex items-center rounded-md border border-border bg-muted p-0.5">
      <button
        className={segBtn(workMode === WorkModes.LISTEN)}
        onClick={() => onChangeWorkMode(WorkModes.LISTEN)}
        type="button"
        title="听写模式"
      >
        听写
      </button>
      <button
        className={segBtn(workMode === WorkModes.Type)}
        onClick={() => onChangeWorkMode(WorkModes.Type)}
        type="button"
        title="打字模式"
      >
        打字
      </button>
    </div>
  )
}
