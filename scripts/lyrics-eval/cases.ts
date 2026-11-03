/**
 * 歌词匹配评测用例。title / artist 写参考平台（默认 QQ）上的规范歌名与歌手，用来找参考曲目（真实时长与 ID）
 * 并判定对上的曲目是否正确；as 模拟播放平台上的不同写法（Apple 英文署名、繁体、括注等）。
 *
 * origin：
 * - apple：模拟 Apple Music 曲目（无 Apple 账号，只能从网易云、QQ、AMLL、酷狗取词），时长取参考曲目 +350ms
 * - netease / qq：直接用参考平台上的真实曲目，查另一平台与 AMLL、酷狗
 *
 * expect：
 * - match：网易云或 QQ 至少一个来源对上正确曲目并取到歌词
 * - version：只要对上就必须是同一版本（对上的歌名含 marker），对不上也算通过——宁缺毋错
 * - none：任何来源都不应给出歌词（不存在的歌、时长明显不同的版本）
 * - safe：允许取不到，但不能对上歌手或版本不符的曲目
 */
export interface EvalCase {
  id: string
  category: string
  title: string
  artist: string
  ref?: 'netease' | 'qq'
  origin: 'apple' | 'netease' | 'qq'
  as?: { name?: string; artist?: string; album?: string; durationOffsetMs?: number }
  /** Apple 目录 ID：用于测试按 ID 查 AMLL 的 Apple 分区。 */
  appleId?: string
  expect: 'match' | 'version' | 'none' | 'safe'
  marker?: string
  note?: string
}

const hit = (id: string, title: string, artist: string, extra: Partial<EvalCase> = {}): EvalCase =>
  ({ id, category: '热门华语', title, artist, origin: 'apple', expect: 'match', ...extra })

export const CASES: EvalCase[] = [
  // 热门华语：Apple 中文署名 → 网易云 / QQ
  hit('hot-1', '晴天', '周杰伦'),
  hit('hot-2', '演员', '薛之谦'),
  hit('hot-3', '光年之外', '邓紫棋'),
  hit('hot-4', '起风了', '买辣椒也用券'),
  hit('hot-5', '小幸运', '田馥甄'),
  hit('hot-6', '后来', '刘若英'),
  hit('hot-7', '平凡之路', '朴树'),
  hit('hot-8', '成都', '赵雷'),
  hit('hot-9', '稻香', '周杰伦'),
  hit('hot-10', '孤勇者', '陈奕迅'),
  hit('hot-11', '年少有为', '李荣浩'),
  hit('hot-12', '消愁', '毛不易'),

  // 平台互查：网易云曲目查 QQ，QQ 曲目查网易云
  hit('cross-1', '江南', '林俊杰', { category: '平台互查', origin: 'netease', ref: 'netease' }),
  hit('cross-2', '倔强', '五月天', { category: '平台互查', origin: 'netease', ref: 'netease' }),
  hit('cross-3', '富士山下', '陈奕迅', { category: '平台互查', origin: 'netease', ref: 'netease' }),
  hit('cross-4', '红豆', '王菲', { category: '平台互查', origin: 'qq' }),
  hit('cross-5', '告白气球', '周杰伦', { category: '平台互查', origin: 'qq', expect: 'safe', note: '网易云没有周杰伦版权，只能不配' }),
  hit('cross-6', '夜に駆ける', 'YOASOBI', { category: '平台互查', origin: 'netease', ref: 'netease' }),

  // 冷门华语：独立乐队、小众歌手
  hit('indie-1', '大风吹', '草东没有派对', { category: '冷门华语' }),
  hit('indie-2', '杀死那个石家庄人', '万能青年旅店', { category: '冷门华语' }),
  hit('indie-3', '爱人错过', '告五人', { category: '冷门华语' }),
  hit('indie-4', '董小姐', '宋冬野', { category: '冷门华语' }),
  hit('indie-5', '易燃易爆炸', '陈粒', { category: '冷门华语' }),
  hit('indie-6', '秋酿', '房东的猫', { category: '冷门华语' }),
  hit('indie-7', '我要你', '任素汐', { category: '冷门华语' }),
  hit('indie-8', '鼓楼', '赵雷', { category: '冷门华语' }),
  hit('indie-9', '春风十里', '鹿先森乐队', { category: '冷门华语' }),
  hit('indie-10', '没有人能够比我们更接近对方', '声音玩具', { category: '冷门华语' }),
  hit('indie-11', '鲜花', '回春丹', { category: '冷门华语' }),
  hit('indie-12', '安和桥', '宋冬野', { category: '冷门华语' }),

  // 日文
  hit('ja-1', '夜に駆ける', 'YOASOBI', { category: '日文' }),
  hit('ja-2', 'Lemon', '米津玄師', { category: '日文' }),
  hit('ja-3', '残響散歌', 'Aimer', { category: '日文' }),
  hit('ja-4', '白日', 'King Gnu', { category: '日文' }),
  hit('ja-5', 'Pretender', 'Official髭男dism', { category: '日文' }),
  hit('ja-6', '前前前世', 'RADWIMPS', { category: '日文' }),
  hit('ja-7', 'ただ君に晴れ', 'ヨルシカ', { category: '日文' }),
  hit('ja-8', '秒針を噛む', 'ずっと真夜中でいいのに。', { category: '日文' }),
  hit('ja-9', 'First Love', '宇多田ヒカル', { category: '日文' }),
  hit('ja-10', '糸', '中島みゆき', { category: '日文' }),
  hit('ja-11', '光るとき', '羊文学', { category: '日文', note: '冷门' }),
  hit('ja-12', '祝福', 'YOASOBI', { category: '日文', appleId: '1645308331', note: '按 Apple 目录 ID 查 AMLL' }),

  // 英文 / 韩文
  hit('en-1', 'Shape of You', 'Ed Sheeran', { category: '英文韩文' }),
  hit('en-2', 'Blinding Lights', 'The Weeknd', { category: '英文韩文' }),
  hit('en-3', 'bad guy', 'Billie Eilish', { category: '英文韩文' }),
  hit('en-4', 'Yellow', 'Coldplay', { category: '英文韩文' }),
  hit('en-5', 'Bohemian Rhapsody', 'Queen', { category: '英文韩文' }),
  hit('en-6', 'Someone Like You', 'Adele', { category: '英文韩文' }),
  hit('en-7', 'Blueming', 'IU', { category: '英文韩文' }),

  // 粤语
  hit('yue-1', '海阔天空', 'Beyond', { category: '粤语' }),
  hit('yue-2', '风继续吹', '张国荣', { category: '粤语' }),
  hit('yue-3', '富士山下', '陈奕迅', { category: '粤语' }),
  hit('yue-4', '喜帖街', '谢安琪', { category: '粤语' }),

  // 繁体署名（Apple 港台区）
  hit('trad-1', '说好的幸福呢', '周杰伦', { category: '繁体署名', as: { name: '說好的幸福呢', artist: '周杰倫' } }),
  hit('trad-2', '倔强', '五月天', { category: '繁体署名', as: { name: '倔強', artist: '五月天' } }),
  hit('trad-3', '小情歌', '苏打绿', { category: '繁体署名', as: { name: '小情歌', artist: '蘇打綠' } }),
  hit('trad-4', '江南', '林俊杰', { category: '繁体署名', as: { artist: '林俊傑' } }),
  hit('trad-5', '后来', '刘若英', { category: '繁体署名', as: { name: '後來', artist: '劉若英' } }),

  // 外文署名（Apple 美区）：只能靠平台资料里的歌手别名对上
  hit('alias-1', '晴天', '周杰伦', { category: '外文署名', as: { artist: 'Jay Chou' } }),
  hit('alias-2', '富士山下', '陈奕迅', { category: '外文署名', as: { artist: 'Eason Chan' } }),
  hit('alias-3', '江南', '林俊杰', { category: '外文署名', as: { artist: 'JJ Lin' } }),
  hit('alias-4', '倔强', '五月天', { category: '外文署名', as: { artist: 'Mayday' } }),
  hit('alias-5', '光年之外', '邓紫棋', { category: '外文署名', as: { artist: 'G.E.M.' } }),
  hit('alias-6', '小幸运', '田馥甄', { category: '外文署名', as: { artist: 'Hebe Tien' } }),
  hit('alias-7', '红豆', '王菲', { category: '外文署名', as: { artist: 'Faye Wong' } }),
  hit('alias-8', '吻别', '张学友', { category: '外文署名', as: { artist: 'Jacky Cheung' } }),
  hit('alias-9', '演员', '薛之谦', { category: '外文署名', as: { artist: 'Joker Xue' } }),
  hit('alias-10', 'Lemon', '米津玄師', { category: '外文署名', as: { artist: 'Kenshi Yonezu' }, note: '两个平台的资料都没有外文名，目前配不上' }),

  // 多歌手与 feat
  hit('multi-1', 'Something Just Like This', 'The Chainsmokers', { category: '多歌手', as: { artist: 'The Chainsmokers & Coldplay' } }),
  hit('multi-2', 'Señorita', 'Shawn Mendes', { category: '多歌手', as: { artist: 'Shawn Mendes & Camila Cabello' } }),
  hit('multi-3', 'STAY', 'The Kid LAROI', { category: '多歌手', as: { name: 'STAY', artist: 'The Kid LAROI & Justin Bieber' } }),
  hit('multi-4', '等你下课', '周杰伦', { category: '多歌手', as: { artist: '周杰伦、杨瑞代' } }),
  hit('multi-5', '我们的歌', '王力宏', { category: '多歌手' }),

  // 括注与写法差异
  hit('paren-1', 'Mojito', '周杰伦', { category: '括注写法', as: { name: 'Mojito (Explicit)' } }),
  hit('paren-2', '光年之外', '邓紫棋', { category: '括注写法', as: { name: '光年之外 (电影《太空旅客》中文主题曲)' } }),
  hit('paren-3', 'Love Story', 'Taylor Swift', { category: '括注写法', as: { name: 'Love Story' } }),
  hit('paren-4', 'Shape of You', 'Ed Sheeran', { category: '括注写法', as: { name: 'Shape of You' } }),
  hit('paren-5', '起风了', '买辣椒也用券', { category: '括注写法', as: { name: '起风了 - 旧版' }, expect: 'version', marker: '旧版', note: '「 - X」后缀当作括注' }),

  // 版本陷阱：不能把录音室版本的时间轴套给现场、伴奏、加速、重录、翻唱等版本
  hit('ver-1', '晴天', '周杰伦', { category: '版本陷阱', as: { name: '晴天 (Live)' }, expect: 'version', marker: 'live' }),
  hit('ver-2', '晴天', '周杰伦', { category: '版本陷阱', as: { name: '晴天 (伴奏)' }, expect: 'version', marker: '伴奏' }),
  hit('ver-3', '起风了', '买辣椒也用券', { category: '版本陷阱', as: { name: '起风了 (加速版)' }, expect: 'version', marker: '加速' }),
  hit('ver-4', 'Love Story', 'Taylor Swift', { category: '版本陷阱', as: { name: 'Love Story (Taylor’s Version)' }, expect: 'version', marker: 'taylorsversion' }),
  hit('ver-5', '光年之外', '邓紫棋', { category: '版本陷阱', as: { name: '光年之外 (Remix)' }, expect: 'version', marker: 'remix' }),
  hit('ver-6', '晴天', '周杰伦', { category: '版本陷阱', as: { name: '晴天 (女声版)' }, expect: 'version', marker: '女声版' }),
  hit('ver-7', '晴天', '周杰伦', { category: '版本陷阱', as: { durationOffsetMs: 25_000 }, expect: 'none', note: '时长差 25 秒的加长版' }),
  hit('ver-8', '夜に駆ける', 'YOASOBI', { category: '版本陷阱', as: { name: 'Into The Night', artist: 'YOASOBI' }, expect: 'version', marker: 'intothenight', note: '英文版是另一首录音' }),

  // 冒名与不存在：网易云有翻唱账号把知名歌手填作自己的别名；不存在的歌不能硬配
  hit('fake-1', '晴天', '周杰伦', { category: '冒名不存在', origin: 'qq', expect: 'safe', note: '网易云「Jay」账号把周杰伦填作别名，正版曲目不能对上它' }),
  hit('fake-4', '稻香', '周杰伦', { category: '冒名不存在', origin: 'qq', expect: 'safe' }),
  hit('fake-2', '晴天', '周杰伦', { category: '冒名不存在', as: { name: '晴天的另一首不存在的歌', artist: '周杰伦' }, expect: 'none' }),
  hit('fake-3', '晴天', '周杰伦', { category: '冒名不存在', as: { name: '晴天', artist: '某位不存在的歌手' }, expect: 'none' }),
]
