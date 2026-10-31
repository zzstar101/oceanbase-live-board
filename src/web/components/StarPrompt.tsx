import { useEffect, useRef, useState } from 'react';
import catgirl from '../assets/powercontext-star.webp';
import { hit } from '../lib/api.ts';
import { cx } from './ui.tsx';

const REPO = 'https://github.com/oceanbase/powercontext';
const KEY = 'ob-board:pc-star:v1';
/** 拒绝后多久再来求一次 */
const ASK_AGAIN_MS = 7 * 24 * 3600 * 1000;
/** 打开页面后等一会儿再弹，先让人看到榜单 */
const DELAY_MS = 1500;

type Stage = 'ask' | 'beg' | 'last' | 'thanks' | 'bye';
type Saved = { state: 'starred' | 'declined'; at: number };

function load(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}
function save(state: Saved['state']) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, at: Date.now() } satisfies Saved));
  } catch {}
}

function shouldAsk() {
  if (new URLSearchParams(location.search).has('nostar')) return false;
  const s = load();
  if (!s) return true;
  if (s.state === 'starred') return false;
  return Date.now() - s.at > ASK_AGAIN_MS;
}

const COPY: Record<Stage, { title: string; body: string }> = {
  ask: {
    title: '给 PowerContext 点个 Star 吧，求求了喵～',
    body: 'PowerContext 是给 Claude Code / Codex 用的 Agent 记忆：换个新会话，决策、约束和进度不用再交代一遍。这个看板也在用它，你的一颗 ⭐ 对它很重要喵！',
  },
  beg: {
    title: '诶？！真的不点吗喵…… (｡•́︿•̀｡)',
    body: '只要 3 秒：打开 GitHub → 点右上角 ⭐ Star → 完事。点完就再也不烦你了，真的喵！',
  },
  last: {
    title: '呜呜……最后一次求求你了喵',
    body: '看在这只已经哭成这样的猫娘份上……就一下下，好不好？',
  },
  thanks: {
    title: '谢谢你喵！！(≧▽≦)',
    body: 'GitHub 已经在新标签页打开啦，记得点右上角的 ⭐ Star 哦～ 祝你的队伍早日满分！',
  },
  bye: {
    title: '好吧……那下次再来求你喵 (；´д｀)',
    body: '榜单继续看吧。哪天想通了，右侧「由 OceanBase 强力驱动」里也能找到 PowerContext。',
  },
};

/** 首次打开时弹出：求一个 PowerContext 的 Star。拒绝会被挽留两次；点过 Star 不再弹，拒绝的 7 天后再问 */
export function StarPrompt() {
  const [show, setShow] = useState(false);
  const [stage, setStage] = useState<Stage>('ask');
  const [dodged, setDodged] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!shouldAsk()) return;
    let timer: ReturnType<typeof setTimeout>;
    const tryOpen = () => {
      // 有别的弹窗（例如分享链接打开的队伍详情）时先等它关掉
      if (document.querySelector('dialog[open]')) timer = setTimeout(tryOpen, 2000);
      else setShow(true);
    };
    timer = setTimeout(tryOpen, DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (show && d && !d.open) {
      d.showModal();
      hit({ k: 'ad', t: '弹窗:展示' });
    }
  }, [show]);

  if (!show) return null;

  const close = () => {
    ref.current?.close();
    setShow(false);
  };
  const star = () => {
    window.open(REPO, '_blank', 'noopener');
    save('starred');
    hit({ k: 'ad', t: stage === 'ask' ? '弹窗:点Star' : '弹窗:挽留后点Star' });
    setStage('thanks');
  };
  const refuse = () => {
    if (stage === 'ask') setStage('beg');
    else if (stage === 'beg') setStage('last');
    else {
      save('declined');
      hit({ k: 'ad', t: '弹窗:最终拒绝' });
      setStage('bye');
    }
  };
  const done = stage === 'thanks' || stage === 'bye';
  const { title, body } = COPY[stage];

  return (
    <dialog
      ref={ref}
      closedby="none"
      // Esc 也算「拒绝」，走挽留流程而不是直接关掉
      onCancel={(e) => {
        e.preventDefault();
        if (done) close();
        else refuse();
      }}
      className="m-auto w-[min(440px,calc(100vw-1.5rem))] overflow-visible rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-[#0f141d] dark:text-slate-100"
      aria-labelledby="star-title"
      aria-describedby="star-body"
    >
      <div key={stage} className="pop-in relative px-6 pt-5 pb-6 text-center">
        <div className="relative mx-auto w-fit">
          <img
            src={catgirl}
            alt="哭着求你给 PowerContext 点 Star 的猫娘"
            width={280}
            height={280}
            className={cx(
              'mx-auto size-[min(280px,60vw)] rounded-xl object-cover transition-[filter] duration-500',
              (stage === 'beg' || stage === 'last') && 'sob',
              stage === 'last' && 'saturate-[.85]',
              stage === 'bye' && 'grayscale',
            )}
          />
          {stage === 'thanks' && <Burst />}
          {stage === 'last' && (
            <span className="absolute -top-2 -right-3 rotate-12 rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white shadow">
              最后一次！
            </span>
          )}
        </div>

        <h2 id="star-title" className="mt-4 text-lg font-bold tracking-wide">
          {title}
        </h2>
        <p id="star-body" className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {body}
        </p>

        <div className="relative mt-5 flex flex-col items-center gap-2">
          {done ? (
            <button type="button" className="btn btn-primary min-w-40 justify-center" autoFocus onClick={close}>
              {stage === 'thanks' ? '不客气喵 ♡' : '关闭'}
            </button>
          ) : (
            <>
              <button
                type="button"
                autoFocus
                onClick={star}
                className={cx(
                  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-400 font-bold text-amber-950 shadow-md shadow-amber-500/30 transition hover:scale-[1.03] hover:shadow-lg active:scale-100',
                  stage === 'ask' && 'px-6 py-2.5 text-[15px]',
                  stage === 'beg' && 'px-8 py-3 text-base',
                  stage === 'last' && 'px-10 py-3.5 text-lg',
                )}
              >
                <GithubMark />
                {stage === 'ask' ? '去 GitHub 点 Star' : stage === 'beg' ? '好嘛好嘛，这就去 ⭐' : '⭐ 好吧，就点一下'}
              </button>
              <button
                type="button"
                onClick={refuse}
                // 最后一次：拒绝按钮第一次被鼠标碰到会躲开（键盘、触屏照常可点）
                onPointerEnter={(e) => {
                  if (stage !== 'last' || dodged || e.pointerType !== 'mouse') return;
                  setDodged({ x: Math.random() < 0.5 ? -110 : 110, y: 6 });
                }}
                style={stage === 'last' && dodged ? { transform: `translate(${dodged.x}px, ${dodged.y}px)` } : undefined}
                className={cx(
                  'rounded-lg px-3 py-1 text-slate-400 transition-all duration-300 hover:text-slate-600 dark:hover:text-slate-300',
                  stage === 'ask' && 'text-sm',
                  stage === 'beg' && 'text-xs',
                  stage === 'last' && 'text-[11px] opacity-70',
                )}
              >
                {stage === 'ask' ? '下次一定' : stage === 'beg' ? '还是不要' : '狠心拒绝 (╥﹏╥)'}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

function Burst() {
  const items = ['⭐', '💙', '✨', '⭐', '💙', '✨', '⭐'];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center gap-5">
      {items.map((x, i) => (
        <span key={i} className="float-up text-2xl" style={{ animationDelay: `${i * 0.09}s` }}>
          {x}
        </span>
      ))}
    </div>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-[1.1em] fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
