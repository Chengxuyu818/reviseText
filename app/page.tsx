'use client';

import { Legend } from '@/components/Legend';
import type {
    CorrectResponse,
    CorrectionError,
    ErrorType,
    SpellingWordItem,
    SpellingWordsResponse,
    SuggestOptimizeResponse,
} from '@/lib/types';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { useEffect, useMemo, useRef, useState } from 'react';

const SAMPLE_TEXT = `People always say taht challenges are beneficial to growth. She have many competitions in rich families, and he go to school yesterday to discuss about this topic.`;

const typeLabel: Record<ErrorType, string> = {
    grammar: '语法基础错误',
    vocabulary: '词汇使用错误',
    expression: '句式与表达错误',
    logic: '逻辑与衔接错误',
};

const replaceClass: Record<ErrorType, string> = {
    grammar: 'text-green-600',
    vocabulary: 'text-red-600',
    expression: 'text-blue-600',
    logic: 'text-amber-600',
};

const wordTypes: ErrorType[] = ['grammar', 'vocabulary'];
const macroTypes: ErrorType[] = ['expression', 'logic'];

function Stats({ result }: { result: CorrectResponse | null }) {
    if (!result) return <p className="text-sm text-slate-500">暂无统计数据。</p>;

    return (
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <div className="rounded bg-slate-50 p-3">总错误：{result.stats.total}</div>
            <div className="rounded bg-green-50 p-3 text-green-700">语法：{result.stats.grammarCount}</div>
            <div className="rounded bg-red-50 p-3 text-red-700">词汇：{result.stats.vocabularyCount}</div>
            <div className="rounded bg-blue-50 p-3 text-blue-700">句式表达：{result.stats.expressionCount}</div>
            <div className="rounded bg-amber-50 p-3 text-amber-700">逻辑衔接：{result.stats.logicCount}</div>
        </div>
    );
}

function escapeHtml(text: string) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export default function Page() {
    const [text, setText] = useState(SAMPLE_TEXT);
    const [loading, setLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);
    const [exportingWord, setExportingWord] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [result, setResult] = useState<CorrectResponse | null>(null);
    const [optimizeResult, setOptimizeResult] = useState<SuggestOptimizeResponse | null>(null);
    const [activeErrorId, setActiveErrorId] = useState<string | null>(null);

    const tokenRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
    const reportRef = useRef<HTMLDivElement | null>(null);

    const wordCount = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text]);

    const wordErrors = useMemo(() => {
        if (!result) return [] as CorrectionError[];
        return result.errors.filter((e) => wordTypes.includes(e.type));
    }, [result]);

    const wordSegments = useMemo(() => {
        if (!result) return [] as Array<{ raw: string; err: CorrectionError | null }>;
        if (!wordErrors.length) return [{ raw: result.originalText, err: null }];

        const arr: Array<{ raw: string; err: CorrectionError | null }> = [];
        let cursor = 0;
        for (const err of wordErrors) {
            if (cursor < err.start) arr.push({ raw: result.originalText.slice(cursor, err.start), err: null });
            arr.push({ raw: result.originalText.slice(err.start, err.end), err });
            cursor = err.end;
        }
        if (cursor < result.originalText.length) arr.push({ raw: result.originalText.slice(cursor), err: null });
        return arr;
    }, [result, wordErrors]);

    const macroErrors = useMemo(() => {
        if (!result) return [] as CorrectionError[];
        const fromMacro = Array.isArray((result as { macroErrors?: CorrectionError[] }).macroErrors)
            ? ((result as { macroErrors?: CorrectionError[] }).macroErrors ?? [])
            : [];
        const fromErrors = result.errors.filter((e) => macroTypes.includes(e.type));
        const merged = [...fromMacro, ...fromErrors];
        const seen = new Map<string, CorrectionError>();
        for (const e of merged) {
            const key = `${e.type}-${e.start}-${e.end}-${e.wrong}-${e.suggestion}`;
            if (!seen.has(key)) seen.set(key, e);
        }
        return Array.from(seen.values());
    }, [result]);

    const segments = useMemo(() => {
        if (!result) return [] as Array<{ raw: string; err: CorrectionError | null }>;
        if (!wordErrors.length) return [{ raw: result.originalText, err: null }];

        const arr: Array<{ raw: string; err: CorrectionError | null }> = [];
        let cursor = 0;

        for (const err of wordErrors) {
            if (cursor < err.start) arr.push({ raw: result.originalText.slice(cursor, err.start), err: null });
            arr.push({ raw: result.originalText.slice(err.start, err.end), err });
            cursor = err.end;
        }

        if (cursor < result.originalText.length) arr.push({ raw: result.originalText.slice(cursor), err: null });
        return arr;
    }, [result, wordErrors]);

    const conservativeRevisedText = useMemo(() => {
        if (!result) return '';
        if (!wordErrors.length) return result.originalText;

        let out = '';
        let cursor = 0;
        for (const e of wordErrors) {
            if (cursor < e.start) out += result.originalText.slice(cursor, e.start);
            out += e.suggestion;
            cursor = e.end;
        }
        if (cursor < result.originalText.length) out += result.originalText.slice(cursor);
        return out;
    }, [result, wordErrors]);

    const [reportDate, setReportDate] = useState('');

    useEffect(() => {
        setReportDate(new Date().toLocaleString('zh-CN', { hour12: false }));
    }, []);
    const reportTitle = 'EssayFixer 英语作文批改报告';

    const onSubmit = async () => {
        setErrorMsg('');
        setLoading(true);
        setActiveErrorId(null);
        setOptimizeResult(null);

        try {
            const res = await fetch('/api/correct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message || '批改失败');
            setResult(data as CorrectResponse);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : '请求失败');
        } finally {
            setLoading(false);
        }
    };

    const onOptimize = async () => {
        setErrorMsg('');
        setOptimizing(true);
        try {
            const res = await fetch('/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.message || '优化失败');
            setOptimizeResult(data as SuggestOptimizeResponse);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : '请求失败');
        } finally {
            setOptimizing(false);
        }
    };

    const exportSpellingWords = async (): Promise<SpellingWordsResponse> => {
        if (!result) throw new Error('请先完成分析并修改');
        const res = await fetch('/api/spelling-words', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ errors: result.errors }),
        });
        const data = (await res.json()) as SpellingWordsResponse;
        if (!res.ok) throw new Error((data as never as { message?: string })?.message || '提取拼写词失败');
        return data;
    };

    const dedupeSpellingWords = (words: SpellingWordItem[]) =>
        words.filter((w, idx, arr) => {
            const key = `${w.wrong.toLowerCase()}=>${w.correct.toLowerCase()}`;
            return arr.findIndex((x) => `${x.wrong.toLowerCase()}=>${x.correct.toLowerCase()}` === key) === idx;
        });

    const buildReportHtml = (spellingWords: SpellingWordItem[]) => {
        const highlighter = result
            ? wordSegments
                  .map((seg) => {
                      if (!seg.err) return `<span>${escapeHtml(seg.raw)}</span>`;
                      const cls = seg.err.type === 'grammar' ? 'mark-green' : 'mark-red';
                      return `<span class="mark ${cls}"><del>${escapeHtml(seg.raw)}</del><span class="suggest">${escapeHtml(seg.err.suggestion)}</span></span>`;
                  })
                  .join('')
            : '<span>暂无批改结果</span>';

        const errorRows = result
            ? result.errors
                  .map(
                      (e, i) => `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(e.wrong)}</td>
                            <td>${escapeHtml(e.suggestion)}</td>
                            <td>${escapeHtml(e.reason)}</td>
                        </tr>`,
                  )
                  .join('')
            : '<tr><td colspan="4">暂无错误</td></tr>';

        const macroRows = macroErrors.length
            ? macroErrors
                  .map(
                      (e, i) => `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(typeLabel[e.type])}</td>
                            <td>${escapeHtml(e.wrong)}</td>
                            <td>${escapeHtml(e.suggestion)}</td>
                            <td>${escapeHtml(e.reason)}</td>
                        </tr>`,
                  )
                  .join('')
            : '<tr><td colspan="5">暂无句式与逻辑建议</td></tr>';

        const spellingRows = spellingWords
            .map(
                (w, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${escapeHtml(w.wrong)}</td>
                        <td>${escapeHtml(w.correct)}</td>
                        <td>${escapeHtml(w.chinese || '-')}</td>
                    </tr>`,
            )
            .join('');

        return `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${reportTitle}</title>
<style>
  body { font-family: Arial, 'Microsoft YaHei', sans-serif; color: #111827; line-height: 1.7; padding: 24px; }
  h1,h2 { margin: 0 0 12px 0; }
  .muted { color: #6b7280; font-size: 12px; }
  .section { margin-top: 20px; padding-top: 8px; }
  .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
  .mark { display: inline; padding: 0 4px; border-radius: 4px; margin-right: 2px; }
  .mark del { opacity: .6; margin-right: 3px; }
  .mark .suggest { font-weight: 700; }
  .mark-green { background: #ecfdf5; color: #166534; }
  .mark-red { background: #fef2f2; color: #b91c1c; }
  .macro-blue { border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 10px; padding: 14px; margin-top: 14px; }
  .macro-item { border: 1px solid #dbeafe; background: #fff; border-radius: 8px; padding: 12px; margin-top: 10px; }
  .macro-title { color: #1d4ed8; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; }
  .no-color td { color: #111827; }
</style>
</head>
<body>
  <h1>${reportTitle}</h1>
  <div class="muted">导出时间：${escapeHtml(reportDate)} ｜ 字数：${wordCount} ｜ 错误数：${result?.stats.total ?? 0}</div>

  <div class="section card">
    <h2>1. 高亮结果</h2>
    <div>${highlighter}</div>
  </div>

  <div class="section card">
    <h2>2. 句式与表达 / 逻辑与衔接建议</h2>
    <div>${macroRows}</div>
  </div>

  <div class="section card">
    <h2>3. 修订版</h2>
    <div>${escapeHtml(result?.revisedText ?? '暂无修订版')}</div>
  </div>

  <div class="section card">
    <h2>4. 错误列表</h2>
    <table>
      <thead>
        <tr>
          <th>序号</th>
          <th>原文片段</th>
          <th>修改建议</th>
          <th>原因说明</th>
        </tr>
      </thead>
      <tbody class="no-color">${errorRows}</tbody>
    </table>
  </div>

  <div class="section card">
    <h2>5. 词表补充</h2>
    <table>
      <thead>
        <tr>
          <th>序号</th>
          <th>错误拼写</th>
          <th>正确单词</th>
          <th>中文释义</th>
        </tr>
      </thead>
      <tbody>${spellingRows || '<tr><td colspan="4">暂无可导出的拼写词</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`;
    };

    const exportWordReport = async () => {
        if (!result) {
            setErrorMsg('请先完成分析并修改后再导出。');
            return;
        }
        setExportingWord(true);
        setErrorMsg('');
        try {
            const spellingData = await exportSpellingWords();
            const words = dedupeSpellingWords(spellingData.words);
            const html = buildReportHtml(words);
            const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `作文批改报告_${new Date().toISOString().slice(0, 10)}.doc`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Word 导出失败');
        } finally {
            setExportingWord(false);
        }
    };

    const exportPdfReport = async () => {
        if (!result) {
            setErrorMsg('请先完成分析并修改后再导出。');
            return;
        }
        setExportingPdf(true);
        setErrorMsg('');
        try {
            const node = reportRef.current;
            if (!node) throw new Error('未找到导出内容');

            const canvas = await html2canvas(node, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                scrollX: 0,
                scrollY: -window.scrollY,
                windowWidth: node.scrollWidth,
                windowHeight: node.scrollHeight,
            });

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = 210;
            const pageHeight = 297;
            const margin = 10;
            const usableWidth = pageWidth - margin * 2;
            const imgHeight = (canvas.height * usableWidth) / canvas.width;
            const pageInnerHeight = pageHeight - margin * 2;

            let heightLeft = imgHeight;
            let position = 0;

            pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
            heightLeft -= pageInnerHeight;

            while (heightLeft > 0) {
                pdf.addPage();
                position = -(imgHeight - heightLeft);
                pdf.addImage(imgData, 'PNG', margin, position, usableWidth, imgHeight);
                heightLeft -= pageInnerHeight;
            }

            pdf.save(`作文批改报告_${new Date().toISOString().slice(0, 10)}.pdf`);
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'PDF 导出失败');
        } finally {
            setExportingPdf(false);
        }
    };

    const focusError = (id: string) => {
        setActiveErrorId(id);
        itemRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const focusToken = (id: string) => {
        setActiveErrorId(id);
        tokenRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    };

    return (
        <main className="mx-auto max-w-6xl p-4 md:p-8">
            <header className="mb-6">
                <h1 className="text-2xl font-bold">EssayFixer 英语作文三色批改</h1>
                <p className="mt-2 text-sm text-slate-600">升级版：四轮独立检查、正文只高亮语法/词汇、宏观错误单独蓝框展示。</p>
            </header>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="font-semibold">作文输入</h2>
                        <span className="text-sm text-slate-500">{wordCount} 词</span>
                    </div>
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        className="h-80 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none ring-blue-500 focus:ring-2"
                        placeholder="请输入英文作文..."
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button onClick={onSubmit} disabled={loading || !text.trim()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400">
                            {loading ? '分析中...' : '分析并修改'}
                        </button>
                        <button onClick={onOptimize} disabled={optimizing || !text.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-indigo-300">
                            {optimizing ? '优化中...' : '优化建议'}
                        </button>
                        <button onClick={exportWordReport} disabled={exportingWord || !result?.errors.length} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                            {exportingWord ? '导出中...' : '导出Word报告'}
                        </button>
                        <button onClick={exportPdfReport} disabled={exportingPdf || !result?.errors.length} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                            {exportingPdf ? '导出中...' : '导出PDF报告'}
                        </button>
                        {errorMsg && <span className="text-sm text-red-600">{errorMsg}</span>}
                        {result?.meta && (
                            <div className="flex flex-col gap-1 text-xs">
                                <span className="text-slate-500">来源：{result.meta.provider === 'llm' ? `LLM(${result.meta.model})` : '本地规则回退'}</span>
                                {result.meta.provider === 'rules' && result.meta.llmError && <span className="max-w-[520px] text-amber-700">LLM错误：{result.meta.llmError}</span>}
                            </div>
                        )}
                    </div>
                </section>

                <section className="space-y-4">
                    <Legend />

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h2 className="mb-3 font-semibold">高亮结果（仅语法 + 词汇）</h2>
                        {!result ? (
                            <p className="text-sm text-slate-500">提交后在这里显示结果。</p>
                        ) : (
                            <p className="whitespace-pre-wrap leading-8 text-slate-800">
                                {segments.map((seg, idx) => {
                                    if (!seg.err) return <span key={idx}>{seg.raw}</span>;

                                    const err = seg.err;
                                    const active = activeErrorId === err.id;
                                    return (
                                        <button
                                            key={err.id}
                                            ref={(el) => {
                                                tokenRefs.current[err.id] = el;
                                            }}
                                            onClick={() => focusError(err.id)}
                                            className={`mx-0.5 inline rounded px-1 text-left align-baseline ${active ? 'bg-amber-100 ring-1 ring-amber-400' : 'bg-slate-100'}`}
                                            title={`${typeLabel[err.type]}：${err.reason}`}
                                        >
                                            <span className="mr-1 text-slate-400 line-through">{seg.raw}</span>
                                            <span className={`font-medium ${replaceClass[err.type]}`}>{err.suggestion}</span>
                                        </button>
                                    );
                                })}
                            </p>
                        )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h2 className="mb-3 font-semibold">错误统计</h2>
                        <Stats result={result} />
                    </div>
                </section>
            </div>

            <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 font-semibold">修订版（保守，仅应用语法/词汇修改）</h2>
                {result ? (
                    <div>
                        <p className="whitespace-pre-wrap leading-8 text-slate-800">{conservativeRevisedText}</p>
                        <button className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" onClick={() => navigator.clipboard.writeText(conservativeRevisedText)}>
                            复制修订版
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-slate-500">提交后显示修订版内容。</p>
                )}
            </section>

            {macroErrors.length > 0 && (
                <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
                    <h2 className="mb-3 font-semibold text-blue-900">句式与表达 / 逻辑与衔接建议</h2>
                    <div className="space-y-3">
                        {macroErrors.map((e) => (
                            <div key={e.id} className="rounded-lg border border-blue-100 bg-white p-3">
                                <div className={`font-medium ${replaceClass[e.type]}`}>{typeLabel[e.type]}</div>
                                <div className="mt-1 text-sm text-slate-700">原文：{e.wrong}</div>
                                <div className="mt-1 text-sm text-slate-700">建议：{e.suggestion}</div>
                                <div className="mt-1 text-sm text-slate-600">原因：{e.reason}</div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {optimizeResult && (
                <section className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
                    <h2 className="mb-3 font-semibold text-indigo-900">优化建议结果</h2>
                    <p className="whitespace-pre-wrap leading-8 text-slate-800">{optimizeResult.optimizedText}</p>
                    {!!optimizeResult.suggestions.length && (
                        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                            {optimizeResult.suggestions.map((s, i) => (
                                <li key={`${s}-${i}`}>{s}</li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            {!!wordErrors.length && (
                <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-3 font-semibold">逐条建议（可与左侧联动）</h2>
                    <ul className="max-h-80 space-y-2 overflow-auto pr-1 text-sm">
                        {wordErrors.map((e) => {
                            const active = activeErrorId === e.id;
                            return (
                                <li
                                    key={e.id}
                                    ref={(el) => {
                                        itemRefs.current[e.id] = el;
                                    }}
                                    onClick={() => focusToken(e.id)}
                                    className={`cursor-pointer rounded border p-3 transition ${active ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}
                                >
                                    <div className="mb-1 font-medium">
                                        <span className={replaceClass[e.type]}>{typeLabel[e.type]}</span> {e.wrong} → {e.suggestion}（后置修订）
                                    </div>
                                    <p className="text-slate-600">{e.reason}</p>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            <div className="pointer-events-none fixed left-[-99999px] top-0 w-[794px] bg-white p-8 text-[#111827]" aria-hidden="true">
                <div ref={reportRef}>
                    <div className="mb-6 border-b border-slate-200 pb-4">
                        <h1 className="text-3xl font-bold">EssayFixer 英语作文批改报告</h1>
                        <p className="mt-2 text-sm text-slate-500">
                            导出时间：{reportDate} ｜ 字数：{wordCount} ｜ 错误数：{result?.stats.total ?? 0}
                        </p>
                    </div>

                    <section className="mb-8">
                        <h2 className="mb-3 text-xl font-semibold">1. 高亮结果</h2>
                        {!result ? (
                            <p className="text-sm text-slate-500">暂无批改结果。</p>
                        ) : (
                            <div className="rounded-lg border border-slate-200 bg-white p-4 leading-8 text-[16px]">
                                {segments.map((seg, idx) => {
                                    if (!seg.err) {
                                        return (
                                            <span key={idx} className="text-[#111827]">
                                                {seg.raw}
                                            </span>
                                        );
                                    }

                                    const colorClass = seg.err.type === 'grammar' ? 'text-green-600' : 'text-red-600';

                                    return (
                                        <span key={seg.err.id} className="inline">
                                            <span className="text-slate-400 line-through">{seg.raw}</span>
                                            <span className={`font-semibold ${colorClass}`}> {seg.err.suggestion}</span>
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className="mb-8">
                        <h2 className="mb-3 text-xl font-semibold">2. 句式与表达 / 逻辑与衔接建议</h2>
                        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                            {!macroErrors.length ? (
                                <p className="text-sm text-slate-500">暂无句式与逻辑建议。</p>
                            ) : (
                                macroErrors.map((e, idx) => (
                                    <div key={e.id} className="rounded-lg border border-blue-100 bg-white p-3">
                                        <div className={`font-medium ${replaceClass[e.type]}`}>{idx + 1}. {typeLabel[e.type]}</div>
                                        <div className="mt-1 text-sm text-slate-700">原文：{e.wrong}</div>
                                        <div className="mt-1 text-sm text-slate-700">建议：{e.suggestion}</div>
                                        <div className="mt-1 text-sm text-slate-600">原因：{e.reason}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="mb-8">
                        <h2 className="mb-3 text-xl font-semibold">3. 修订版</h2>
                        <div className="rounded-lg border border-slate-200 bg-white p-4 leading-8 text-[16px]">
                            {conservativeRevisedText || '暂无修订版'}
                        </div>
                    </section>

                    <section className="mb-8">
                        <h2 className="mb-3 text-xl font-semibold">4. 错误列表</h2>
                        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                            {!wordErrors.length ? (
                                <p className="text-sm text-slate-500">暂无错误。</p>
                            ) : (
                                wordErrors.map((e, idx) => (
                                    <div key={e.id} className="border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                                        <div className="font-medium">
                                            {idx + 1}. {e.wrong} → {e.suggestion}
                                        </div>
                                        <div className="mt-1 text-sm text-slate-600">{e.reason}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="mb-2">
                        <h2 className="mb-3 text-xl font-semibold">5. 词表补充</h2>
                        <div className="rounded-lg border border-slate-200 bg-white p-4">
                            {!wordErrors.length ? (
                                <p className="text-sm text-slate-500">暂无可导出的拼写词。</p>
                            ) : (
                                <div className="space-y-2 text-[16px]">
                                    <div>如需显示拼写词，请保持页面上的 `spellingWords` 数据注入此区域。</div>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </main>
    );
}
