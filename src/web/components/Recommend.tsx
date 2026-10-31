import { hit } from '../lib/api.ts';

export interface Product {
  id: 'seekdb' | 'powercontext' | 'oceanbase';
  name: string;
  tag: string;
  desc: string;
  /** 卡片主色：只用于左侧色块和标签 */
  mark: string;
  links: { label: string; href: string }[];
}

/** 比赛里用到的产品（赛道就是围绕它们出的题） */
export const PRODUCTS: Product[] = [
  {
    id: 'seekdb',
    name: 'seekdb',
    tag: 'AI 原生搜索数据库',
    desc: '向量、全文、结构化数据混合检索，一个引擎搞定，嵌入式即开即用，很适合给 Agent 当存储。',
    mark: 'from-sky-400 to-blue-600',
    links: [
      { label: '官网', href: 'https://www.seekdb.ai/' },
      { label: 'GitHub', href: 'https://github.com/oceanbase/seekdb' },
    ],
  },
  {
    id: 'powercontext',
    name: 'PowerContext',
    tag: 'Agent 记忆',
    desc: '给 Claude Code / Codex 的长期记忆与上下文交接：换个新会话，决策、约束和进度不用再交代一遍。',
    mark: 'from-violet-400 to-fuchsia-600',
    links: [
      { label: '官网', href: 'https://powercontext.oceanbase.io/zh/' },
      { label: 'GitHub', href: 'https://github.com/oceanbase/powercontext' },
    ],
  },
  {
    id: 'oceanbase',
    name: 'OceanBase',
    tag: '分布式 · AI 数据库',
    desc: '完全自研的分布式数据库，高度兼容 MySQL / Oracle，一套系统承载交易、实时分析与 AI 负载。',
    mark: 'from-blue-500 to-indigo-700',
    links: [
      { label: '官网', href: 'https://www.oceanbase.com/' },
      { label: '社区', href: 'https://open.oceanbase.com/' },
    ],
  },
];

const track = (id: Product['id']) => () => hit({ k: 'ad', t: id });

/** 侧栏卡片：比赛用到的产品 */
export function Recommend() {
  return (
    <section className="card p-4" aria-labelledby="recommend-title">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 id="recommend-title" className="card-title">
          比赛用到的产品
        </h2>
        <span className="text-[11px] text-slate-400">推荐</span>
      </header>
      <ul className="space-y-3">
        {PRODUCTS.map((p) => (
          <li key={p.id} className="flex gap-3">
            <span
              aria-hidden
              className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${p.mark} text-sm font-bold text-white shadow-sm`}
            >
              {p.name[0]!.toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <a
                  className="font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100"
                  href={p.links[0]!.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={track(p.id)}
                >
                  {p.name}
                </a>
                <span className="text-xs text-slate-500">{p.tag}</span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{p.desc}</p>
              <p className="mt-1 flex gap-3 text-xs">
                {p.links.map((l) => (
                  <a
                    key={l.href}
                    className="text-brand-600 hover:underline dark:text-brand-400"
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={track(p.id)}
                  >
                    {l.label} ↗
                  </a>
                ))}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 页脚一行链接 */
export function RecommendLinks() {
  return (
    <>
      {PRODUCTS.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ' · '}
          <a className="hover:underline" href={p.links[0]!.href} target="_blank" rel="noreferrer" onClick={track(p.id)}>
            {p.name}
          </a>
        </span>
      ))}
    </>
  );
}
