import oceanbaseDark from '../assets/sponsors/oceanbase-dark.svg';
import oceanbase from '../assets/sponsors/oceanbase.svg';
import powercontextDark from '../assets/sponsors/powercontext-dark.png';
import powercontext from '../assets/sponsors/powercontext.png';
import seekdbDark from '../assets/sponsors/seekdb-dark.svg';
import seekdb from '../assets/sponsors/seekdb.svg';
import { hit } from '../lib/api.ts';

export interface Sponsor {
  id: 'seekdb' | 'powercontext' | 'oceanbase';
  name: string;
  tag: string;
  desc: string;
  logo: { light: string; dark: string; ratio: number };
  links: { label: string; href: string }[];
}

/** 「由 OceanBase 强力驱动」推广位（README 顶部同一份内容，改这里记得同步 README） */
export const SPONSORS: Sponsor[] = [
  {
    id: 'oceanbase',
    name: 'OceanBase',
    tag: '分布式 · AI 数据库',
    desc: '完全自研的分布式数据库，高度兼容 MySQL / Oracle，一套系统承载交易、实时分析与 AI 负载。',
    logo: { light: oceanbase, dark: oceanbaseDark, ratio: 500 / 81.76 },
    links: [
      { label: '官网', href: 'https://www.oceanbase.com/' },
      { label: 'GitHub', href: 'https://github.com/oceanbase/oceanbase' },
      { label: '社区', href: 'https://open.oceanbase.com/' },
    ],
  },
  {
    id: 'powercontext',
    name: 'PowerContext',
    tag: 'Agent 记忆',
    desc: '给 Claude Code / Codex 的长期记忆与上下文交接：换个新会话，决策、约束和进度不用再交代一遍。',
    logo: { light: powercontext, dark: powercontextDark, ratio: 1696 / 240 },
    links: [
      { label: '官网', href: 'https://powercontext.oceanbase.io/zh/' },
      { label: 'GitHub', href: 'https://github.com/oceanbase/powercontext' },
    ],
  },
  {
    id: 'seekdb',
    name: 'seekdb',
    tag: 'AI 原生搜索数据库',
    desc: '向量、全文、结构化数据混合检索，一个引擎搞定，嵌入式即开即用，很适合给 Agent 当存储。',
    logo: { light: seekdb, dark: seekdbDark, ratio: 334.84 / 76.22 },
    links: [
      { label: '官网', href: 'https://www.seekdb.ai/' },
      { label: 'GitHub', href: 'https://github.com/oceanbase/seekdb' },
    ],
  },
];

const track = (id: Sponsor['id']) => () => hit({ k: 'ad', t: id });

/** 浅色 / 暗色各一张，跟随系统切换 */
function SponsorLogo({ s, height }: { s: Sponsor; height: number }) {
  return (
    <picture>
      <source srcSet={s.logo.dark} media="(prefers-color-scheme: dark)" />
      <img
        src={s.logo.light}
        alt={s.name}
        height={height}
        width={Math.round(height * s.logo.ratio)}
        loading="lazy"
        decoding="async"
        className="block max-w-full object-contain object-left"
        style={{ height }}
      />
    </picture>
  );
}

/** 侧栏卡片 */
export function Sponsors() {
  return (
    <section className="card p-4" aria-labelledby="sponsors-title">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 id="sponsors-title" className="card-title">
          <span aria-hidden className="text-amber-500">
            ⚡
          </span>
          由 OceanBase 强力驱动
        </h2>
      </header>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {SPONSORS.map((s) => (
          <li key={s.id} className="py-3 first:pt-0 last:pb-0">
            <a
              className="inline-block rounded focus-visible:outline-2 focus-visible:outline-brand-500"
              href={s.links[0]!.href}
              target="_blank"
              rel="noreferrer"
              onClick={track(s.id)}
              title={`${s.name} · ${s.tag}`}
            >
              <SponsorLogo s={s} height={22} />
            </a>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-200">{s.tag}</span> · {s.desc}
            </p>
            <p className="mt-1 flex gap-3 text-xs">
              {s.links.map((l) => (
                <a
                  key={l.href}
                  className="text-brand-600 hover:underline dark:text-brand-400"
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={track(s.id)}
                >
                  {l.label} ↗
                </a>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 页脚一行链接 */
export function SponsorLinks() {
  return (
    <>
      {SPONSORS.map((s, i) => (
        <span key={s.id}>
          {i > 0 && ' · '}
          <a className="hover:underline" href={s.links[0]!.href} target="_blank" rel="noreferrer" onClick={track(s.id)}>
            {s.name}
          </a>
        </span>
      ))}
    </>
  );
}
