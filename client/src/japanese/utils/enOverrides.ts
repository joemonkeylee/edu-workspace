/**
 * 日语课程英文覆盖字典（lessonId → 翻译后的 title/description）
 * 原始 pack 是 es（西语），我们把描述翻成英文，title 大部分已经是英文
 * 没填的字段 fallback 到原 JSON
 */
export const LANG_OVERRIDES: Record<string, { title?: string; description?: string }> = {
  // ===== HIRAGANA =====
  'hiragana-01': {
    description: 'The 5 Japanese vowels — the foundation of all hiragana',
  },
  'hiragana-02': {
    description: 'Learn the ka-row consonants and their stroke order',
  },
  'hiragana-03': {
    description: 'The sa-row: sa, shi, su, se, so — notice shi is irregular',
  },
  'hiragana-04': {
    description: 'The ta-row: ta, chi, tsu, te, to — chi and tsu have irregular readings',
  },
  'hiragana-05': {
    description: 'The na-row: na, ni, nu, ne, no — straightforward, no irregularities',
  },
  'hiragana-06': {
    description: 'The ha-row: ha, hi, fu, he, ho — fu is not hu',
  },
  'hiragana-07': {
    description: 'The ma-row, ya-row, ra-row, wa-row and ん (the n sound)',
  },
  'hiragana-08': {
    title: 'Hiragana: Dakuten (゛) and Handakuten (゜)',
    description: 'Voiced and semi-voiced sounds — ga/gi/gu, pa/pi/pu etc.',
  },
  'hiragana-09': {
    title: 'Hiragana: Combinations (Yōon)',
    description: 'Small ya/yu/yo that combine with consonants: kya, ryu, jyo...',
  },
  'hiragana-10': {
    title: 'Hiragana: Small tsu (っ) and long vowels',
    description: 'Small tsu = double consonant (kitte, sakkā), あ/い/う for long vowels',
  },

  // ===== KATAKANA =====
  'katakana-01': {
    description: 'The same 5 vowels, but katakana style — used for foreign words',
  },
  'katakana-02': {
    title: 'Katakana: ka-row + sa-row',
    description: 'Ka~ko and Sa~so in katakana — notice some shapes are very different from hiragana',
  },
  'katakana-03': {
    title: 'Katakana: ta-row + na-row',
    description: 'Ta~to and Na~no in katakana',
  },
  'katakana-04': {
    title: 'Katakana: ha-row + ma-row',
    description: 'Ha~ho and Ma~mo in katakana',
  },
  'katakana-05': {
    title: 'Katakana: ya/ra/wa + n',
    description: 'Ya~yo, Ra~ro, Wa, Wo, N — katakana endings',
  },
  'katakana-06': {
    title: 'Katakana: Dakuten and Handakuten',
    description: 'G, Z, D, B, P sounds in katakana — same logic as hiragana',
  },

  // ===== KANJI (skip these for now if you're W1-2) =====
  'kanji-n5-01': { title: 'Kanji: Numbers and Time', description: '一, 二, 三, 十, 百, 年, 月, 日...' },
  'kanji-n5-02': { title: 'Kanji: People and Nature', description: '人, 男, 女, 子, 天, 空, 海...' },
  'kanji-n5-03': { title: 'Kanji: Basic Actions', description: '行, 来, 出, 入, 食, 飲...' },
  'kanji-n5-04': { title: 'Kanji: Position and Concepts', description: '上, 下, 中, 外, 内, 大, 小...' },

  // ===== GRAMMAR N5 =====
  'grammar-n5-01': {
    title: 'Grammar N5: X は Y です',
    description: 'The most basic Japanese sentence pattern: X wa Y desu = X is Y',
  },
  'grammar-n5-02': { title: 'Grammar N5: ~ですか？', description: 'Question marker — ですか at the end of a statement turns it into a yes/no question' },
  'grammar-n5-03': { title: 'Building sentences: SOV + particles は・を・に', description: 'Subject-Object-Verb order, marked with は (topic), を (object), に (time)' },
  'grammar-n5-04': { title: 'Verbs: ます form (present polite)', description: 'ます = polite present. Take dictionary form, conjugate to masu stem, add ます' },
  'grammar-n5-05': { title: 'Past simple: ました / ませんでした', description: 'Past tense of ます form — ました (did), ませんでした (did not)' },
  'grammar-n5-06': { title: 'い-adjectives: conjugation', description: 'い adjectives: い→く for adverb, take out い + かった for past' },
  'grammar-n5-07': { title: 'な-adjectives: conjugation', description: 'な adjectives: add な before nouns, です for polite, じゃない for negative' },
  'grammar-n5-08': { title: 'Particles の and も', description: 'の = possessive (my book), も = also/too' },
  'grammar-n5-09': { title: 'Existential: ある vs いる', description: 'ある for inanimate objects, いる for people/animals' },
  'grammar-n5-10': { title: 'Counters: つ, 人, 枚, 本', description: 'Japanese counting is tricky — different counters for different things' },
  'grammar-n5-11': { title: 'Te-form: 〜て (connecting actions)', description: 'て-form connects two actions: wake up て 洗脸 て 食べる' },
  'grammar-n5-12': { title: 'Desires and suggestions: 〜たい, 〜ましょう', description: 'たい = want to, ましょう = let\'s' },
  'grammar-n5-13': { title: 'Negation and formality', description: 'だ (casual), ではない (casual neg), じゃありません (polite neg)' },
  'grammar-n5-14': { title: 'Place and movement particles: で and へ', description: 'で = where action happens, へ (or に) = direction' },
  'grammar-n5-15': { title: 'Connecting nouns: と and や', description: 'と = and (closed list), や = and among others' },
  'grammar-n5-16': { title: 'Demonstratives: これ/それ/あれ', description: 'これ = this, それ = that (near you), あれ = that (far from both)' },
  'grammar-n5-17': { title: 'Interrogatives: 何, どこ, いつ, だれ', description: 'What, where, when, who — question words go before ですか' },
  'grammar-n5-18': { title: 'Modal particles: ね, よ, から, まで', description: 'ね = seeking agreement, よ = asserting, から = from, まで = until' },
  'grammar-n5-19': { title: 'Requests and permission with te-form', description: 'てください = please do, てもいい = may I, てはいけない = must not' },
  'grammar-n5-20': { title: 'Connectors with て', description: 'でも/しかし = but, そして/それから = and then, ないで = without doing' },

  // ===== VOCAB N5 =====
  'vocab-n5-01': { title: 'First words: Greetings', description: 'こんにちは, ありがとう, さようなら — your survival kit' },
  'vocab-n5-02': { title: 'Vocab N5: Numbers 1-10', description: 'いち, に, さん, よん/し, ご, ろく, なな/しち, はち, く/きゅう, じゅう' },
  'vocab-n5-03': { title: 'Vocab N5: People and Family', description: '人, 父, 母, 子, 男, 女, 友達' },
  'vocab-n5-04': { title: 'Food and Drink', description: 'ご飯, 水, お茶, パン, 肉, 魚, 野菜' },
  'vocab-n5-05': { title: 'Places', description: '家, 学校, 会社, 駅, 店, 図書館, 公園' },
  'vocab-n5-06': { title: 'Time and Weather', description: '朝, 夜, 今日, 明日, 雨, 雪, 暑い' },
  'vocab-n5-07': { title: 'Daily Verbs 1', description: '食べる, 飲む, 見る, 聞く, 話す, 読む' },
  'vocab-n5-08': { title: 'Daily Verbs 2', description: '行く, 来る, 帰る, 作る, 買う, 売る' },
  'vocab-n5-09': { title: 'い-Adjectives', description: '大きい, 小さい, 新しい, 古い, 面白い, 高い' },
  'vocab-n5-10': { title: 'な-Adjectives', description: '静か, きれい, 便利, 元気, 同じ' },

  // ===== READING N5 =====
  'reading-n5-01': { title: 'Reading N5: My Day', description: 'Vocab about daily routine, present simple, basic particles' },
  'reading-n5-02': { title: 'Reading N5: My Family', description: 'Describe your family — ages, jobs, ている for states' },
  'reading-n5-03': { title: 'Reading N5: School', description: 'Student life — schedules, subjects, て-form connectors' },
  'reading-n5-04': { title: 'Reading N5: Shopping', description: 'Going shopping — past tense, prices, adjectives' },
  'reading-n5-05': { title: 'Reading N5: At the Restaurant', description: 'Ordering food — 〜てください, descriptions with な-adjectives' },
  'reading-n5-06': { title: 'Reading N5: The Weekend', description: 'Narration of past events with て-form and chained verbs' },

  // ===== GRAMMAR N4 (skip for now, you'll get here after N5) =====
  'grammar-n4-01': { title: 'Te-form uses: 〜ている (continuous)', description: 'ている = action in progress OR state (知っている = I know)' },
  'grammar-n4-02': { title: 'Conditional: 〜たら, 〜ば', description: 'たら = casual if/when, ば = general if — first real conditionals' },
  'grammar-n4-03': { title: 'Giving and receiving: あげる・もらう・くれる', description: 'Core gift verbs — direction matters: I→you=あげる, you→me=くれる' },
  'grammar-n4-04': { title: 'Passive form: 〜られる', description: 'れる/られる = "is done by..." — common in news and passive situations' },
  'grammar-n4-05': { title: 'Conditionals: なら and 〜と', description: 'なら = if [you say], と = whenever / natural consequence' },
  'grammar-n4-06': { title: 'Causative: 〜させる / 〜せる', description: 'Make someone do: 子供に野菜を食べさせる' },
  'grammar-n4-07': { title: 'Potential: 〜できる / 〜える / 〜られる', description: 'Can do — potential form. 日本語が読める = I can read Japanese' },
  'grammar-n4-08': { title: 'Obligation and permission', description: 'なければならない = must, なくてもいい = don\'t have to' },
  'grammar-n4-09': { title: 'Intention and plans: 〜つもり / 〜予定', description: 'つもり = intention, 予定 = schedule/plan' },
  'grammar-n4-10': { title: 'Change of state: 〜ようにする / 〜ようになる', description: 'ようにする = try to / make it so, ようになる = come to be able to' },
  'grammar-n4-11': { title: 'Appearance and info: そうだ / みたいだ / らしい / ようだ', description: 'Four ways to say "seems like / looks like" — different nuances' },
  'grammar-n4-12': { title: 'Direction and result: 〜ていく / 〜てくる / 〜てしまう / 〜ておく', description: 'Auxiliary verbs that add movement, completion, preparation' },
  'grammar-n4-13': { title: 'Nominalization with こと', description: 'ことがある = sometimes, ことにする = decide to, ことになる = it\'s been decided' },
  'grammar-n4-14': { title: 'Comparison: 〜より〜ほう / 〜すぎる / 〜にくい・やすい', description: 'More than, too easy/hard, difficult/easy to do' },

  // ===== VOCAB N4 =====
  'vocab-n4-01': { title: 'Transitive vs Intransitive Verbs', description: 'つける/つく, 始める/始まる — the bane of every learner' },
  'vocab-n4-02': { title: 'Useful N4 Expressions', description: 'Set phrases: お先に失礼します, よろしくお願いします' },
  'vocab-n4-03': { title: 'N4 Verbs: つける/つく, 直す/直る', description: 'Pairs you\'ll mix up for months' },
  'vocab-n4-04': { title: 'Abstract Nouns: 経験, 意見, 関係, 文化', description: 'Nouns that come up in discussions and essays' },
  'vocab-n4-05': { title: 'Communication and Work Nouns', description: '会議, 仕事, 質問, 答え — office vocab' },
  'vocab-n4-06': { title: 'Movement and Change Verbs', description: '動く, 変わる, 進む, 遅れる' },
  'vocab-n4-07': { title: 'Time and Frequency', description: '時々, たまに, しばしば, 毎週, 毎月' },
  'vocab-n4-08': { title: 'N4 Adjectives: Personality and Feelings', description: '優しい, 厳しい, 退屈, 楽しみ' },
  'vocab-n4-09': { title: 'N4 Expressions: やっぱり, せっかく', description: 'Tricky adverbs that don\'t translate cleanly' },
  'vocab-n4-10': { title: 'Mixed N4 Review Vocab', description: 'Random mix to test yourself' },
};

/**
 * 根据 lang 返回 lesson 的本地化 title 和 description
 */
export function localizeLesson<T extends { id: string; title: string; description: string }>(
  lesson: T,
  lang: 'en' | 'es',
): { title: string; description: string } {
  if (lang === 'es') {
    return { title: lesson.title, description: lesson.description };
  }
  const ov = LANG_OVERRIDES[lesson.id];
  return {
    title: ov?.title ?? lesson.title,
    description: ov?.description ?? lesson.description,
  };
}

/**
 * 处理 items 和 steps：
 * - ES：原样返回
 * - EN：back 字段查 VOCAB_TRANSLATIONS 词典翻译，
 *        explanation/mnemonic 隐藏（原 pack 是西语的，太长不翻）
 *        steps 的 title/instruction 也隐藏
 */
export function localizeLessonFull<T extends import('@/japanese/types/lesson').Lesson>(
  lesson: T,
  lang: 'en' | 'es',
): T {
  if (lang === 'es') return lesson;

  const result = { ...lesson };

  // items
  if (lesson.items) {
    result.items = lesson.items.map((item) => {
      const backEn = VOCAB_TRANSLATIONS[item.front] ?? item.back;
      return {
        ...item,
        back: backEn,
        explanation: undefined,  // 原 explanation 全是西语，EN 模式隐藏
        mnemonic: undefined,       // 同理
      };
    });
  }

  // steps — 隐藏西语标题和指令，但保留 type/itemIndices
  if (lesson.steps) {
    result.steps = lesson.steps.map((s) => ({
      type: s.type,
      itemIndices: s.itemIndices,
      // 不保留 title / instruction（全西语）
    }));
  }

  return result;
}

/** 从 front（日文词）查英文翻译（back 字段） */
const VOCAB_TRANSLATIONS: Record<string, string> = {
  // === 问候 vocab-n5-01 ===
  'こんにちは': 'hello',
  'ありがとう': 'thank you',
  'すみません': 'excuse me / sorry',
  'おはよう': 'good morning',
  'さようなら': 'goodbye',
  'はい': 'yes',
  'いいえ': 'no',
  'おねがいします': 'please',

  // === 数字 vocab-n5-02 ===
  '一（いち）': '1 — one',
  '二（に）': '2 — two',
  '三（さん）': '3 — three',
  '四（よん）': '4 — four',
  '五（ご）': '5 — five',
  '六（ろく）': '6 — six',
  '七（なな）': '7 — seven',
  '八（はち）': '8 — eight',
  '九（きゅう）': '9 — nine',
  '十（じゅう）': '10 — ten',

  // === 家人 vocab-n5-03 ===
  'あなた': 'you',
  'わたし': 'I / me',
  'おかあさん': 'mom',
  'おとうさん': 'dad',
  'りょうしん': 'parents',
  'ともだち': 'friend',
  'がくせい': 'student',
  'せんせい': 'teacher',

  // === 食物 vocab-n5-04 ===
  'ご飯': 'rice / meal',
  'パン': 'bread',
  '水': 'water',
  'お茶': 'green tea',
  'おいしい': 'delicious',
  '果物': 'fruit',
  '野菜': 'vegetable',
  '肉': 'meat',
  '魚': 'fish',

  // === 地点 vocab-n5-05 ===
  '学校': 'school',
  'へや': 'room',
  'げんかん': 'entrance',
  'ろうか': 'corridor',
  'きょうしつ': 'classroom',
  '図書館': 'library',
  '公園': 'park',
  '駅': 'station',
  '店': 'shop',
  'レストラン': 'restaurant',

  // === 时间/天气 vocab-n5-06 ===
  '今日': 'today',
  '明日': 'tomorrow',
  '昨日': 'yesterday',
  '今': 'now',
  '朝': 'morning',
  '夜': 'night',
  '雨': 'rain',
  '天気': 'weather',
  '暑い': 'hot',

  // === 动词 vocab-n5-07 ===
  '食べる': 'to eat',
  '飲む': 'to drink',
  '見る': 'to see / watch',
  '聞く': 'to listen / ask',
  '話す': 'to speak',
  '読む': 'to read',
  '書く': 'to write',

  // === 动词 vocab-n5-08 ===
  '行く': 'to go',
  '来る': 'to come',
  '買う': 'to buy',
  'する': 'to do',
  'ある': 'to exist (inanimate)',
  'いる': 'to exist (animate)',
  '休む': 'to rest',
  '働く': 'to work',
  '勉強する': 'to study',

  // === い形容词 vocab-n5-09 ===
  '大きい': 'big',
  '小さい': 'small',
  '新しい': 'new',
  '古い': 'old',
  '高い': 'tall / expensive',
  '安い': 'cheap',
  '面白い': 'interesting / fun',

  // === な形容词 vocab-n5-10 ===
  '静か': 'quiet',
  'きれい': 'beautiful / clean',
  '便利': 'convenient',
  '元気': 'energetic / healthy',
  '同じ': 'same',
  '親切な': 'kind',
  '正直な': 'honest',
  '丁寧な': 'polite',
  '複雑な': 'complicated',

  // === N4 vocab ===
  'つける': 'to turn on (trans.)',
  'つく': 'to turn on (intrans.)',
  '直す': 'to fix (trans.)',
  '直る': 'to be fixed (intrans.)',
  '壊す': 'to break (trans.)',
  '壊れる': 'to break (intrans.)',
  '消す': 'to turn off / erase (trans.)',
  '消える': 'to go out / disappear (intrans.)',
  '閉める': 'to close (trans.)',
  '閉まる': 'to close (intrans.)',
  '開ける': 'to open (trans.)',
  '開く': 'to open (intrans.)',
  '落とす': 'to drop / lose (trans.)',
  '落ちる': 'to fall (intrans.)',
  '引っ越す': 'to move (house)',
  '逃げる': 'to escape',
  '渡る': 'to cross',
  '曲がる': 'to turn',
  '動く': 'to move',
  '止まる': 'to stop',
  '集まる': 'to gather',
  '待つ': 'to wait',
  '会う': 'to meet',

  // === 副词 N4 ===
  'たぶん': 'maybe / probably',
  'ぜひ': 'by all means',
  'なるほど': 'ah, I see',
  'あるいは': 'or / alternatively',
  'たまに': 'occasionally',
  '時々': 'sometimes',
  'いつも': 'always',
  'まだ': 'still / not yet',
  'もう': 'already',
  '突然': 'suddenly',
  '急に': 'suddenly',
  'だんだん': 'gradually',
  '最近': 'recently',
  '大体': 'generally / roughly',
  'たいてい': 'usually',

  // === 抽象名词 N4 ===
  '経験': 'experience',
  '意見': 'opinion',
  '関係': 'relationship',
  '文化': 'culture',
  '原因': 'cause / reason',
  '結果': 'result',
  '場合': 'case / situation',
  '問題': 'problem',
  '方法': 'method / way',
  '目的': 'purpose / objective',
  '計画': 'plan',
  '報告': 'report',
  '確認': 'confirmation',
  '連絡': 'contact / communication',
  '社会': 'society',

  // === N4 固定表达 ===
  'やっぱり': 'as expected / after all',
  'やはり': 'as expected / after all',
  'せっかく': 'since (you\'ve already made the effort)',
  'どうせ': 'anyway / in any case',
  'わざわざ': 'especially / going out of the way',
  'なかなか': 'quite / [+ neg] not easily',
  'ほとんど': 'almost all / almost never',
  'たいへん': 'very / terribly',
  'とても': 'very',
  'ところで': 'by the way / changing topic',
  'ところが': 'however (unexpected result)',
  'それに': 'moreover / and on top of that',
  'もちろん': 'of course',
  'いい': 'good',
  'めんどうな': 'troublesome / annoying',
  'そう': 'so / that way',
  'とっても': 'very',
  'まっすぐ': 'straight',
  'ほか': 'other / besides',
  'おくに': 'country (polite)',
  'とおり': 'as / according to',

  // === 其他 ===
  '病院': 'hospital',
  '銀行': 'bank',
  '郵便局': 'post office',
  'メニュー': 'menu',
  '注文': 'order (food)',
  '予約': 'reservation',
  'きっぷ': 'ticket',
  'わたしの': 'my',
  'ときどき': 'sometimes',
  'ながい': 'long',
  'みじかい': 'short',
  'よこ': 'side',
  'うしろ': 'back',
  'まえ': 'front',
  'そと': 'outside',
  'うち': 'inside / my house',
  'みせ': 'shop',
  'てんぽ': 'store',
  'かぞく': 'family',
  'ひと': 'person',
  'しゅうまつ': 'weekend',
  'じゅぎょう': 'class / lesson',
  'すんでいる': 'living',
};

