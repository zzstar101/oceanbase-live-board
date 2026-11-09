import { useId, useState } from 'react';
import { Logo } from '../components/Logo.tsx';
import { BASEPATH, MODE } from '../lib/config.ts';
import { buildMcpConfigs, copyMcpText, MCP_ENDPOINT, MCP_QUESTIONS, MCP_TOOLS } from '../lib/mcp.ts';

type Client = 'claude' | 'codex' | 'cursor';
const CLIENTS = ['claude', 'codex', 'cursor'] as const;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn min-h-9 shrink-0" disabled={busy} aria-describedby={id} onClick={async () => {
        setBusy(true);
        setStatus('');
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        setStatus(await copyMcpText(text, clipboard));
        setBusy(false);
      }}>{busy ? '复制中…' : label}</button>
      <span id={id} role="status" aria-live="polite" aria-atomic="true" className="text-xs text-slate-500 dark:text-slate-400">{status}</span>
    </span>
  );
}

/** Pure documentation: no live-data context, API fetch, or WebSocket required. */
export function McpPage({ endpoint = MCP_ENDPOINT }: { endpoint?: string }) {
  const [client, setClient] = useState<Client>('claude');
  const configs = buildMcpConfigs(endpoint);
  const selected = configs[client];
  return (
    <div className="min-h-dvh">
      <title>MCP 接入 · OceanBase 榜单实时看板</title>
      <meta name="description" content="把 OceanBase 公开榜单接入 Claude Code、Codex 或 Cursor。只读、免 API Key 的 Streamable HTTP MCP。" />
      <a href="#mcp-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3 focus:text-brand-700">跳到接入说明</a>
      <header className="border-b border-slate-200/80 bg-white/85 dark:border-slate-800 dark:bg-[#0b0f17]/85">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <a href={BASEPATH} className="flex min-w-0 items-center gap-2.5">
            <Logo className="size-8 shrink-0" />
            <span className="truncate text-sm font-semibold">OceanBase 榜单看板</span>
          </a>
          <a href={BASEPATH} className="chip shrink-0 text-xs">← 返回榜单</a>
        </div>
      </header>

      <main id="mcp-main" className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-14">
        <section aria-labelledby="mcp-title" className="mb-9 max-w-3xl">
          <p className="mb-3 font-mono text-xs font-medium tracking-[0.18em] text-brand-600 dark:text-brand-300">OCEANBASE BOARD / MCP</p>
          <h1 id="mcp-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">让 AI 帮你读榜</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base dark:text-slate-400">把公开榜单接入你的 AI 客户端。找队伍、比较分数线、估计初赛与加赛赛题的出分时间，不必来回复制整张表。</p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            {['Streamable HTTP', '公开只读', '免 API Key'].map((label) => <span key={label} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-800 dark:bg-slate-900">{label}</span>)}
          </div>
        </section>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8">
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="connect-title" className="card min-w-0 p-5 sm:p-6">
              <div className="mb-5 flex items-baseline gap-3"><span className="font-mono text-xs text-brand-600 dark:text-brand-300">01</span><h2 id="connect-title" className="text-base font-semibold">连接你的客户端</h2></div>
              <label htmlFor="mcp-endpoint" className="mb-2 block text-xs font-medium text-slate-500 dark:text-slate-400">MCP 服务地址</label>
              <div className="flex flex-wrap items-start gap-2">
                <input id="mcp-endpoint" className="input min-h-9 min-w-0 flex-1 basis-64 font-mono text-xs" readOnly value={endpoint} onFocus={(event) => event.currentTarget.select()} />
                <CopyButton text={endpoint} label="复制地址" />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{MODE === 'pages' ? 'Pages 托管接入文档，此地址指向配置的实时服务 liveOrigin。' : '使用当前实时站 / 本地服务的同源地址。'}</p>
              <nav aria-label="选择 MCP 客户端" className="mt-6 flex flex-wrap gap-2">
                {CLIENTS.map((id) => <button key={id} type="button" className="chip min-h-9" aria-pressed={id === client} onClick={() => setClient(id)}>{configs[id].label}</button>)}
              </nav>
              <div className="mt-4" aria-label={`${selected.label} 接入配置`}>
                <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">写入 {selected.file}；已有配置时只合并此服务，勿覆盖其他配置。</p>
                <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-6 dark:border-slate-800 dark:bg-[#0b0f17]"><code>{selected.config}</code></pre>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <CopyButton key={client} text={selected.config} label="复制配置" />
                  <a className="text-xs text-brand-600 underline decoration-brand-200 underline-offset-4 dark:text-brand-300" href={selected.source} target="_blank" rel="noreferrer">{selected.label} 官方配置说明 ↗</a>
                </div>
                {client === 'claude' ? <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800"><p className="mb-2 text-xs text-slate-500 dark:text-slate-400">也可使用 CLI 添加（默认本地作用域）：</p><pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs leading-6 dark:bg-[#0b0f17]"><code>{configs.claude.command}</code></pre><div className="mt-2"><CopyButton text={configs.claude.command} label="复制命令" /></div></div> : null}
                <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">保存后在客户端的 MCP 管理界面检查连接与工具列表，并按客户端要求确认工具使用权限。不需要登录、Token 或鉴权头。</p>
              </div>
            </section>

            <section aria-labelledby="questions-title" className="card p-5 sm:p-6">
              <div className="mb-4 flex items-baseline gap-3"><span className="font-mono text-xs text-brand-600 dark:text-brand-300">02</span><h2 id="questions-title" className="text-base font-semibold">从一个问题开始</h2></div>
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{MCP_QUESTIONS.map((question) => <li key={question} className="flex gap-3 py-3 leading-6"><span aria-hidden className="mt-0.5 text-brand-400">↳</span><span>{question}</span></li>)}</ul>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">将示例中的队伍 ID、赛题 ID 与提交时间替换为你的实际值。</p>
            </section>
          </div>

          <aside aria-labelledby="data-title" className="min-w-0 text-sm">
            <section className="border-l-2 border-brand-300 pl-5 dark:border-brand-700">
              <h2 id="data-title" className="font-semibold">数据与预测</h2>
              <dl className="mt-5 space-y-5 text-xs leading-6 text-slate-500 dark:text-slate-400">
                <div><dt className="font-semibold text-slate-700 dark:text-slate-200">数据时间</dt><dd>每次查询返回 fetchedAt、数据年龄与 stale。超过 120 秒或抓取时间未知时标记为 stale，预测状态会同步说明数据时效。</dd></div>
                <div><dt className="font-semibold text-slate-700 dark:text-slate-200">按赛题估计出分</dt><dd>初赛 q600071 等赛题和加赛 q600081 支持 ETA。三种加赛榜共用 q600081 赛题的预测模型；总榜不提供 ETA。</dd></div>
                <div><dt className="font-semibold text-slate-700 dark:text-slate-200">样本与区间</dt><dd>使用提交时间与评测完成时间构建样本。暂无样本时显示“暂无出分样本”；有效样本齐备后给出预计出分时刻与 80% 区间。</dd></div>
                <div><dt className="font-semibold text-slate-700 dark:text-slate-200">覆盖哪些数据</dt><dd>初赛总榜、各赛题与三种加赛榜。队伍按 groupId 关联，支持学校、省份筛选、全局名次、省内名次与分数线分析。</dd></div>
              </dl>
            </section>
          </aside>
        </div>

        <section aria-labelledby="tools-title" className="mt-9">
          <div className="mb-5 flex items-baseline gap-3"><span className="font-mono text-xs text-brand-600 dark:text-brand-300">03</span><h2 id="tools-title" className="text-base font-semibold">五个工具，覆盖读榜所需</h2></div>
          <div className="card divide-y divide-slate-100 dark:divide-slate-800">{MCP_TOOLS.map((tool) => <article key={tool.name} className="grid gap-2 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-6 sm:px-6"><div className="min-w-0"><h3 className="mb-2 text-sm font-semibold">{tool.title}</h3><p className="break-all font-mono text-xs leading-6 text-brand-700 dark:text-brand-300">{tool.name}</p><code className="break-words text-[11px] leading-6 text-slate-500 dark:text-slate-400">{tool.args}</code></div><p className="text-xs leading-6 text-slate-500 dark:text-slate-400">{tool.description}</p></article>)}</div>
          <p className="mt-3 break-words text-xs leading-6 text-slate-500 dark:text-slate-400">查询 boardId：total、q600071 等赛题 ID、playoff-combined、playoff-performance、playoff-prompt。预测 boardId 使用赛题 qID（加赛为 q600081），可从发现结果的 predictionBoardId 获取。省份用全称；__none__ 表示未填。</p>
        </section>
        <footer className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span>官方格式来源</span>{CLIENTS.map((id) => <a key={id} className="text-brand-600 hover:underline dark:text-brand-300" href={configs[id].source} target="_blank" rel="noreferrer">{configs[id].label} ↗</a>)}
        </footer>
      </main>
    </div>
  );
}
