import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useJpStore } from '@/japanese/store/useJpStore';
import { localizeLessonFull } from '@/japanese/utils/enOverrides';
import { FlashCard } from '@/japanese/components/FlashCard';
import { PickExercise } from '@/japanese/components/PickExercise';
import { TypeExercise } from '@/japanese/components/TypeExercise';
import type { Lesson, LessonStep, LessonItem } from '@/japanese/types/lesson';
import { ChevronLeft, ChevronRight, CheckCircle2, BookOpen } from 'lucide-react';

const STEP_LABEL: Record<string, string> = {
  introduce: '认识',
  recognize: '选择练习',
  recall: '打字练习',
  'listen-transcribe': '听写',
  'fill-blank-multi': '填空',
  summary: '完成',
};

function makePool(lesson: Lesson, field: 'back' | 'front'): string[] {
  return [...new Set(lesson.items.map((it) => it[field]).filter(Boolean))] as string[];
}

export function JpStudy() {
  const { lessonId } = useParams();
  const { init, lessons, completeLesson, lang } = useJpStore();

  useEffect(() => { init(); }, [init]);

  const lesson = useMemo(() => lessons.find((l) => l.id === lessonId), [lessons, lessonId]);

  if (!lesson) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-muted-foreground">课程不存在</p>
        <Link to="/jp/lessons">
          <Button variant="outline" className="mt-4">返回列表</Button>
        </Link>
      </div>
    );
  }

  // 本地化：ES 原样，EN 翻译 items.back + 隐藏 explanation/mnemonic + 精简 steps
  const lesson$ = localizeLessonFull(lesson, lang);
  const [stepIdx, setStepIdx] = useState(0);
  const [itemIdx, setItemIdx] = useState(0);
  const [finished, setFinished] = useState(false);

  const step = lesson$.steps[stepIdx];
  const totalSteps = lesson$.steps.length;
  const progressPct = (stepIdx / totalSteps) * 100;

  function handleNextStep() {
    if (itemIdx < (step.itemIndices.length || 1) - 1) {
      setItemIdx((i) => i + 1);
    } else if (stepIdx < totalSteps - 1) {
      setStepIdx((s) => s + 1);
      setItemIdx(0);
    } else {
      completeLesson(lesson!.id);
      setFinished(true);
    }
  }

  function handlePrevStep() {
    if (itemIdx > 0) {
      setItemIdx((i) => i - 1);
    } else if (stepIdx > 0) {
      const prevStep = lesson$.steps[stepIdx - 1];
      setStepIdx((s) => s - 1);
      setItemIdx((prevStep.itemIndices.length || 1) - 1);
    }
  }

  if (finished) {
    return <LessonCompleteView lessonTitle={lesson$.title} lessonId={lesson.id} />;
  }

  const curItemIdx = step.itemIndices[itemIdx] ?? itemIdx;
  const item = lesson$.items[curItemIdx];
  const pool = makePool(lesson, step.type === 'recognize' ? 'back' : 'front');

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Link to="/jp/lessons">
          <Button variant="outline" size="sm" className="gap-1">
            <ChevronLeft className="h-4 w-4" /> 返回
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{localizeLessonFull(lesson!, lang).title}</div>
          <Progress value={progressPct} className="mt-1 h-1.5" />
        </div>
        <div className="text-xs text-muted-foreground">{stepIdx + 1}/{totalSteps}</div>
      </div>

      {step.type !== 'summary' && (
        <div className="text-center">
          <Badge variant="outline" className="text-xs">
            {STEP_LABEL[step.type] ?? step.type}
          </Badge>
          {step.title && <h2 className="mt-1 text-lg font-semibold text-foreground">{step.title}</h2>}
          {step.instruction && <p className="mt-1 text-xs text-muted-foreground">{step.instruction}</p>}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        {renderStepContent(step, item, pool, step.type, handleNextStep)}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          item {itemIdx + 1}/{step.itemIndices.length || 1}
        </span>
        <span className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrevStep}
            disabled={stepIdx === 0 && itemIdx === 0}
          >
            <ChevronLeft className="h-4 w-4" /> 上一个
          </Button>
          <Button variant="ghost" size="sm" onClick={handleNextStep}>
            下一个 <ChevronRight className="h-4 w-4" />
          </Button>
        </span>
      </div>
    </div>
  );
}

function renderStepContent(
  step: LessonStep,
  item: LessonItem,
  pool: string[],
  type: string,
  onNext: () => void,
) {
  switch (type) {
    case 'introduce':
      return <IntroduceStep item={item} onNext={onNext} />;

    case 'recognize':
      return (
        <PickExercise
          question={item.front}
          correct={item.back}
          optionsPool={pool}
          direction="kana→romaji"
          onResult={() => {}}
        />
      );

    case 'recall':
      return (
        <TypeExercise
          question={item.front}
          label={`输入「${item.back}」的假名（日语字母）`}
          onResult={() => {}}
        />
      );

    case 'listen-transcribe':
      return (
        <TypeExercise
          question={item.front}
          label="听发音并输入对应的罗马字"
          onResult={() => {}}
        />
      );

    case 'fill-blank-multi':
      return <IntroduceStep item={item} onNext={onNext} />;

    case 'summary':
      return (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <h3 className="text-lg font-semibold text-foreground">这一步完成！</h3>
          <p className="text-sm text-muted-foreground">继续下一个 step 来巩固吧</p>
          <Button onClick={onNext}>继续 →</Button>
        </div>
      );

    default:
      return <IntroduceStep item={item} onNext={onNext} />;
  }
}

function IntroduceStep({ item, onNext }: { item: LessonItem; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <FlashCard front={item.front} back={item.back} reading={item.reading} mnemonic={item.mnemonic} />
      {item.explanation && (
        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{item.explanation}</div>
      )}
      <div className="text-center">
        <Button onClick={onNext}>下一个 →</Button>
      </div>
    </div>
  );
}

function LessonCompleteView({ lessonTitle }: { lessonTitle: string; lessonId: string }) {
  return (
    <div className="mx-auto max-w-md space-y-6 p-8 text-center">
      <div className="rounded-xl border border-green-300 bg-green-50 p-8 shadow-sm dark:border-green-700 dark:bg-green-950/30">
        <CheckCircle2 className="mx-auto h-16 w-16 text-green-600 dark:text-green-400" />
        <h2 className="mt-4 text-2xl font-bold text-green-700 dark:text-green-300">课程完成！</h2>
        <p className="mt-2 text-sm text-green-700/80 dark:text-green-300/70">
          《{lessonTitle}》已完成，这些卡片会进入你的每日复习队列
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Button asChild variant="outline">
          <Link to="/jp">
            <BookOpen className="mr-2 h-4 w-4" /> 回到首页
          </Link>
        </Button>
        <Button asChild>
          <Link to="/jp/lessons">继续学习</Link>
        </Button>
      </div>
    </div>
  );
}
