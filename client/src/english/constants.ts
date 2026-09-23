export const SubtitleModes = {
  BLIND: 'blind',
  BLIND_HINT: 'blind_hint',
  CHINESE: 'chinese',
  ENGLISH: 'english',
  FULL: 'full',
} as const

export type SubtitleModeType = (typeof SubtitleModes)[keyof typeof SubtitleModes]

export const WorkModes = {
  LISTEN: 'listen',
  Type: 'type',
} as const

export type WorkModeType = (typeof WorkModes)[keyof typeof WorkModes]

export interface Lesson {
  id: string
  title: string
  trans: string
  src?: string
  newWords?: VocabWord[]
}

export interface BookMeta {
  name: string
  data?: Lesson[]
  tag?: string
  count: number
  series?: string
}

export type VocabWord = { word: string; phonetic?: string; pos?: string; meaning?: string }

export const BOOKS: { id: string; name: string; count: number; tag?: string; series?: string }[] = [
  { id: '74575627913a4f26bb4c498694ef4c72', name: '新概念第一册', count: 72, tag: '新概念英音', series: '新概念英语 · 英音' },
  { id: '40184428b9444d3893427991656b9185', name: '新概念第二册', count: 96, tag: '新概念英音', series: '新概念英语 · 英音' },
  { id: 'bf00250080914cb6810d5c08e4f2e5a6', name: '新概念第三册', count: 60, tag: '新概念英音', series: '新概念英语 · 英音' },
  { id: '283b20da4c9445ff8c19057a4a75973c', name: '新概念第四册', count: 48, tag: '新概念英音', series: '新概念英语 · 英音' },
  { id: 'f8bb0d6ae5eb47b5aa45a49eb9997f46', name: '新概念第一册', count: 72, tag: '新概念美音', series: '新概念英语 · 美音' },
  { id: '8783fdcaf5d34f2fa1ca6bd40fac380b', name: '新概念第二册', count: 96, tag: '新概念美音', series: '新概念英语 · 美音' },
  { id: '54fa25abe61e442c97cee6b6b587970f', name: '新概念第三册', count: 60, tag: '新概念美音', series: '新概念英语 · 美音' },
  { id: 'fb29378303214f1b9cc280a826f0185c', name: '新概念第四册', count: 48, tag: '新概念美音', series: '新概念英语 · 美音' },
  { id: 'f2e3748165ed4aabb8ddc8f419878019', name: 'ListenToThis 初级', count: 247, tag: '经典教材', series: 'ListenToThis 英语听力' },
  { id: '1f715973e88a47998213931c06bc2da7', name: 'ListenToThis 中级', count: 154, tag: '经典教材', series: 'ListenToThis 英语听力' },
  { id: 'a147c9539bcc41ba9599e521fbb664a0', name: 'ListenToThis 高级', count: 108, tag: '经典教材', series: 'ListenToThis 英语听力' },
  { id: '1b78c7a4ea6c48a5b72213092e2ec322', name: 'Speech Repository Beginner', count: 25, tag: '口译练习', series: 'Speech Repository 口译' },
  { id: '332eab98968c406cab27a885e47c24e4', name: 'Speech Repository Intermediate', count: 7, tag: '口译练习', series: 'Speech Repository 口译' },
  { id: '7fee3f213ae542dc9184a12618f6468d', name: 'Speech Repository Advanced', count: 19, tag: '口译练习', series: 'Speech Repository 口译' },
  { id: '6f9bd3f5e5834ded8a301fce24815623', name: 'Speech Repository Very advanced', count: 7, tag: '口译练习', series: 'Speech Repository 口译' },
  { id: '2293cecb54ab48289e194c1333e4a614', name: '听见英国实境训练', count: 48, tag: '英音', series: '听见英国实境训练' },
  { id: '5130940360ae4cef9800281c50fc07e8', name: '英音慢速经济学人', count: 108, tag: '英音', series: '英音慢速经济学人' },
  { id: '6f59566a90174185a25e8b75b8a5f10f', name: '英音快速BBC新闻', count: 398, tag: '英音', series: '英音快速BBC新闻' },
  { id: '78c86e8402ff4816a414af7c0907c8be', name: '英语播客English pod', count: 365, tag: '英音', series: '英语播客English pod' },
  { id: 'e6c53eded9e749b695095f9000d6f99f', name: 'BBC English 6 Minute', count: 18, tag: '英音', series: 'BBC English 6 Minute' },
  { id: 'bea5fce493554f7581e206623f307e0f', name: '美音慢速国家地理', count: 106, tag: '美音', series: '美音慢速国家地理' },
  { id: '9a27a47e28964cb8af028f741c2738c2', name: '美音中速CNN新闻', count: 339, tag: '美音', series: '美音中速CNN新闻' },
  { id: 'a419eb2de2544c91b2c9d3e2c9b5a254', name: '美音快速科学60秒', count: 380, tag: '美音', series: '美音快速科学60秒' },
  { id: '183e4f58ef2440c7b7ebb3dfdf141536', name: 'PTE备考 SST', count: 220, tag: 'PTE', series: 'PTE 备考' },
  { id: 'ec942fcc07994a958c9da1f79dc60efe', name: 'PTE备考 WFD', count: 135, tag: 'PTE', series: 'PTE 备考' },
  { id: '40447d58f5b840d29cc91fabcd47dba1', name: '达人真题1-6', count: 144, tag: 'IELTS', series: '雅思真题 IELTS' },
  { id: 'f98a3e1f71024220b12d88641eb6f366', name: '剑桥真题4-19', count: 256, tag: 'IELTS', series: '雅思真题 IELTS' },
  { id: 'bca6bf1f69604b79a3a6e818eb41250b', name: '老托听力93篇精选', count: 93, tag: 'TOFEL', series: '老托听力93篇精选' },
  { id: '234e7ef6ac064e1ca2959156dfcf0d68', name: '托福口语TPO1-75', count: 300, tag: 'TOFEL', series: '托福 TPO 真题' },
  { id: 'ff1acca4854149389af9f3203151ba6c', name: '托福听力TPO1-75', count: 439, tag: 'TOFEL', series: '托福 TPO 真题' },
  { id: '539db55cd86142cf984650894fa8d36e', name: '托福听力学科分类', count: 151, tag: 'TOFEL', series: '托福 TPO 真题' },
  { id: '3ebc764be8654cabb331cbeb225a99e5', name: 'BEC中级', count: 218, tag: '剑桥商务英语', series: '剑桥商务英语 BEC' },
  { id: '09ca363815884c4587614da5e84fc267', name: 'BEC高级', count: 48, tag: '剑桥商务英语', series: '剑桥商务英语 BEC' },
  { id: 'f3eb9c8f486b4178bbf6fecd2849aa81', name: '绝望主妇第一季', count: 198, tag: '美剧', series: '绝望主妇第一季' },
  { id: 'd57a552b176e4d5e96db3d54d82088c4', name: '老友记第一季', count: 49, tag: '美剧', series: '老友记第一季' },
  { id: 'cae1ebf9e1784a57bf48cfc2b3a1b519', name: '01 Fantastic Mr Fox', count: 18, tag: '罗尔德达尔', series: '罗尔德达尔' },
  { id: '7e36a2ae524b4c6683290b2dd7d2f42b', name: '02 The Witches', count: 26, tag: '罗尔德达尔', series: '罗尔德达尔' },
  { id: 'ecf58a0d1a454688b28544a202a33da8', name: '2024年高考卷', count: 40, tag: '高中听力', series: '高考英语听力真题' },
  { id: '5ae7ccf5ddfd4d5fbc5a0c2ad3f70175', name: '2023年高考卷', count: 50, tag: '高中听力', series: '高考英语听力真题' },
  { id: 'fb7930cf73da405b882b149d0cee3d99', name: '2022年高考卷', count: 30, tag: '高中听力', series: '高考英语听力真题' },
  { id: '5bfe5bca810145dda4cabed405efb679', name: '2021年高考卷', count: 40, tag: '高中听力', series: '高考英语听力真题' },
  { id: 'eec4565711654cdbac4ca73300f3dade', name: '2020年高考卷', count: 40, tag: '高中听力', series: '高考英语听力真题' },
  { id: 'b07dd4f56d3741b38ce48bf6fec529ae', name: '2019年高考卷', count: 20, tag: '高中听力', series: '高考英语听力真题' },
  { id: '1ac3aa0057994205b43b01b815be187c', name: '2018年高考卷', count: 20, tag: '高中听力', series: '高考英语听力真题' },
  { id: '9233ad05dca240219a4fcbe5696daeca', name: '2017年高考卷', count: 20, tag: '高中听力', series: '高考英语听力真题' },
  { id: '386b8721d049459c862302a121bf16cd', name: '2016年高考卷', count: 20, tag: '高中听力', series: '高考英语听力真题' },
  { id: '110f6c9882f749b0bd14450c13997059', name: '2015年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: '4594328c467748c5bb312453bf28133e', name: '2014年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: 'be300dcd32ea4dc693562f99aeced84b', name: '2013年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: 'c9c516a9ce664e028708f16a63bb4b00', name: '2012年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: '19d3662c767b40c988e3269924466e9c', name: '2011年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: '048ac4caac104581afb6e0bb30e7690c', name: '2010年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: '20dbd4bad72947729d403f5c19812dcf', name: '2009年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: '9ef5f4a745444857852bb6ca036da39e', name: '2008年高考卷', count: 10, tag: '高中听力', series: '高考英语听力真题' },
  { id: 'ff657eb9bcc1463ebd0df41278e41bd2', name: '四级历年真题', count: 304, tag: '大学听力', series: '大学听力真题' },
  { id: 'da2eacbe90914271921956a0868eb5df', name: '六级历年真题', count: 294, tag: '大学听力', series: '大学听力真题' },
  { id: '6899eb8d396847d690ac691518f530dc', name: '专四历年真题', count: 60, tag: '大学听力', series: '大学听力真题' },
  { id: 'c0a4639e491a4ffcaf4b12f5bf919dff', name: '专八历年真题', count: 45, tag: '大学听力', series: '大学听力真题' },
  { id: '5ab45e633e5f4775941f4b5c6602fb4a', name: 'TED-ed科普精选', count: 232, series: 'TED-ed科普精选' },
  { id: '46d1ce68c74141229538f124f4bda48b', name: 'Kaplan Practice Set', count: 30, series: 'Kaplan Practice Set' },
  { id: 'cc75116e64f84861958bc58da79f4fd4', name: 'OET Sample Tests', count: 40, series: 'OET 护理英语' },
  { id: 'fc02416c85b8425992210f0e3eed8405', name: 'Official OET Practice Tests', count: 30, series: 'OET 护理英语' },
  { id: 'b51119935d7d418f9e7542cc10f6e222', name: 'Reading Explorer', count: 120, series: 'Reading Explorer' },
  { id: 'b6bbb583478c4f79b7fe718f063bf685', name: '50篇文章搞定3500词', count: 50, series: '50篇文章搞定3500词' },
  { id: 'e3c28d8610c64a5485a1be9e3b0d1fe2', name: '综合写作TPO1-75', count: 75, series: '托福 TPO 真题' },
  { id: '7d717ffe78464164bd47ce2d406235c7', name: '基础起步想一分钟', count: 95, series: '基础起步想一分钟' },
]
