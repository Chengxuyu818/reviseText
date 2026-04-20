import type {
    CorrectResponse,
    CorrectionError,
    ErrorScope,
    ErrorType,
    SpellingWordsResponse,
    SuggestOptimizeResponse,
} from './types';

type LlmRawError = {
    start: number;
    end: number;
    type: ErrorType;
    scope?: ErrorScope;
    wrong: string;
    suggestion: string;
    reason: string;
};

type LlmCategoryResponse = {
    errors: LlmRawError[];
};

type LlmReviewResponse = {
    supplementErrors: LlmRawError[];
};

type LlmOptimizeResponse = {
    optimizedText: string;
    suggestions: string[];
};

type LlmSpellingWord = {
    wrong: string;
    correct: string;
    chinese: string;
};

type LlmSpellingResponse = {
    words: LlmSpellingWord[];
};

const priority: Record<ErrorType, number> = {
    logic: 4,
    expression: 3,
    vocabulary: 2,
    grammar: 1,
};

const defaultScopeByType: Record<ErrorType, ErrorScope> = {
    grammar: 'word',
    vocabulary: 'word',
    expression: 'sentence',
    logic: 'paragraph',
};

const AUTO_REPLACE_TYPES: ErrorType[] = ['grammar', 'vocabulary'];
const MAX_AUTO_REPLACE_WORDS = 4;
const MAX_AUTO_REPLACE_CHARS = 24;
const REPLACEMENT_CONTEXT_RADIUS = 20;

function startsWithVowelSound(word: string): boolean {
    const w = word.toLowerCase();
    if (!w) return false;

    if (/^(uni|use|user|euro|one|once|ubiq)/.test(w)) return false;
    if (/^(hour|honest|honor|heir)/.test(w)) return true;

    return /^[aeiou]/.test(w);
}

function detectArticleErrors(text: string): CorrectionError[] {
    const errs: CorrectionError[] = [];
    const regex = /\b(a|an)\s+([A-Za-z][A-Za-z'-]*)\b/g;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(text)) !== null) {
        const article = m[1];
        const noun = m[2];
        const should = startsWithVowelSound(noun) ? 'an' : 'a';

        if (article.toLowerCase() === should) continue;

        const start = m.index;
        const end = start + article.length;
        const fixed = article[0] === article[0].toUpperCase() ? should[0].toUpperCase() + should.slice(1) : should;

        errs.push({
            id: `grammar-article-${start}-${end}`,
            start,
            end,
            type: 'grammar',
            scope: 'word',
            wrong: text.slice(start, end),
            suggestion: fixed,
            reason: `冠词误用：此处应使用 ${should}。`,
        });
    }

    return errs;
}

function safeJsonParse<T>(content: string): T | null {
    try {
        return JSON.parse(content) as T;
    } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]) as T;
        } catch {
            return null;
        }
    }
}

function getConfig() {
    const apiKey = process.env.LLM_API_KEY;
    const baseUrl = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
    const model = process.env.LLM_MODEL ?? 'deepseek-chat';

    if (!apiKey) {
        throw new Error('缺少 LLM_API_KEY');
    }

    return { apiKey, baseUrl, model };
}

async function chatWithLLM(prompt: string): Promise<{ content: string; model: string }> {
    const { apiKey, baseUrl, model } = getConfig();

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
                {
                    role: 'system',
                    content: '你是严谨的英语作文批改专家。只修明确错误，禁止润色正确内容。',
                },
                { role: 'user', content: prompt },
            ],
        }),
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`LLM 请求失败: ${res.status} ${detail}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string') {
        throw new Error('LLM 返回内容为空');
    }

    return { content, model };
}

function isWordBoundaryChar(ch: string | undefined): boolean {
    return !ch || !/[A-Za-z'-]/.test(ch);
}

function countWords(text: string): number {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function isSentenceSpan(text: string, start: number, end: number): boolean {
    return /[.!?\n]/.test(text.slice(start, end));
}

function hasSafeWordBoundaries(text: string, start: number, end: number): boolean {
    const left = start > 0 ? text[start - 1] : undefined;
    const right = end < text.length ? text[end] : undefined;
    return isWordBoundaryChar(left) && isWordBoundaryChar(right);
}

function isConservativeReplacement(
    text: string,
    start: number,
    end: number,
    wrong: string,
    suggestion: string,
): boolean {
    if (!wrong.trim() || !suggestion.trim()) return false;
    if (wrong === suggestion) return false;
    if (isSentenceSpan(text, start, end)) return false;
    if (wrong.length > MAX_AUTO_REPLACE_CHARS || suggestion.length > MAX_AUTO_REPLACE_CHARS) return false;
    if (countWords(wrong) > MAX_AUTO_REPLACE_WORDS || countWords(suggestion) > MAX_AUTO_REPLACE_WORDS) return false;
    if (!hasSafeWordBoundaries(text, start, end)) return false;

    return true;
}

function shouldRollbackReplacement(originalText: string, error: CorrectionError): boolean {
    if (!isConservativeReplacement(originalText, error.start, error.end, error.wrong, error.suggestion)) {
        return true;
    }

    const replaced = originalText.slice(0, error.start) + error.suggestion + originalText.slice(error.end);
    const contextStart = Math.max(0, error.start - REPLACEMENT_CONTEXT_RADIUS);
    const contextEnd = Math.min(replaced.length, error.start + error.suggestion.length + REPLACEMENT_CONTEXT_RADIUS);
    const context = replaced.slice(contextStart, contextEnd);

    if (/\ba\s+[aeiou]/i.test(context)) return true;
    if (/\ban\s+[^aeiou\W]/i.test(context)) return true;
    if (/\bto\s+to\b/i.test(context)) return true;
    if (/\b(is|am|are|was|were|have|has|had)\s+(is|am|are|was|were|have|has|had)\b/i.test(context)) {
        return true;
    }
    if (/([A-Za-z])\1\1/.test(error.suggestion)) return true;
    if (countWords(error.suggestion) > countWords(error.wrong) + 2) return true;
    if (/更自然|更地道|优化表达|改写|rewrite|rephrase/i.test(error.reason)) return true;

    return false;
}

function normalizeErrors(text: string, errors: LlmRawError[], fallbackScope: ErrorScope): CorrectionError[] {
    const aligned: CorrectionError[] = [];

    for (const e of errors) {
        if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end <= e.start || e.end > text.length) {
            continue;
        }
        if (!e.wrong || !e.suggestion || !e.reason) continue;

        const scope = e.scope ?? fallbackScope;
        let start = e.start;
        let end = e.end;

        const rawSlice = text.slice(start, end);
        if (rawSlice !== e.wrong) {
            const windowStart = Math.max(0, e.start - 60);
            const windowEnd = Math.min(text.length, e.end + 60);
            const windowText = text.slice(windowStart, windowEnd);
            const localIdx = windowText.indexOf(e.wrong);
            if (localIdx === -1) continue;
            start = windowStart + localIdx;
            end = start + e.wrong.length;
        }

        const wrong = text.slice(start, end);
        if (wrong !== e.wrong) continue;

        aligned.push({
            id: `${e.type}-${scope}-${start}-${end}-${wrong}`,
            start,
            end,
            type: e.type,
            scope,
            wrong,
            suggestion: e.suggestion.trim(),
            reason: e.reason.trim(),
        });
    }

    return aligned.sort((a, b) => a.start - b.start || priority[b.type] - priority[a.type]);
}

function dedupeByKey(errors: CorrectionError[]): CorrectionError[] {
    const map = new Map<string, CorrectionError>();
    for (const e of errors) {
        map.set(`${e.type}-${e.scope}-${e.start}-${e.end}-${e.wrong}-${e.suggestion}`, e);
    }
    return [...map.values()].sort((a, b) => a.start - b.start);
}

function resolveWordOverlaps(errors: CorrectionError[]): CorrectionError[] {
    const sorted = [...errors].sort((a, b) => a.start - b.start || priority[b.type] - priority[a.type]);
    const picked: CorrectionError[] = [];

    for (const item of sorted) {
        const overlap = picked.find((d) => !(item.end <= d.start || item.start >= d.end));
        if (!overlap) {
            picked.push(item);
            continue;
        }
        if (priority[item.type] > priority[overlap.type]) {
            picked[picked.indexOf(overlap)] = item;
        }
    }

    return picked.sort((a, b) => a.start - b.start);
}

function filterAutoReplaceErrors(text: string, errors: CorrectionError[]): CorrectionError[] {
    return errors.filter(
        (e) =>
            AUTO_REPLACE_TYPES.includes(e.type) &&
            e.scope === 'word' &&
            text.slice(e.start, e.end) === e.wrong &&
            isConservativeReplacement(text, e.start, e.end, e.wrong, e.suggestion) &&
            !shouldRollbackReplacement(text, e),
    );
}

function applyConservativeWordCorrections(text: string, errors: CorrectionError[]): string {
    const safeErrors = filterAutoReplaceErrors(text, errors).sort((a, b) => a.start - b.start);
    if (!safeErrors.length) return text;

    let out = '';
    let cursor = 0;
    for (const e of safeErrors) {
        if (e.start < cursor) continue;
        out += text.slice(cursor, e.start);
        out += e.suggestion;
        cursor = e.end;
    }
    out += text.slice(cursor);
    return out;
}

function categoryPrompt(type: ErrorType, text: string): string {
    const spec: Record<ErrorType, { title: string; scope: ErrorScope; rules: string }> = {
        grammar: {
            title: '语法基础错误',
            scope: 'word',
            rules: '只检查 grammar：时态、主谓一致、冠词、介词、单复数、非谓语、残句。只返回非常确定的局部错误。',
        },
        vocabulary: {
            title: '词汇使用错误',
            scope: 'word',
            rules: '只检查 vocabulary：拼写、词性误用、搭配错误、中式词汇。只返回非常确定的局部错误。',
        },
        expression: {
            title: '句式与表达错误',
            scope: 'sentence',
            rules: '只检查 expression：句式单一、run-on、表达不自然、直译腔、冗长重复。只给建议，不要词级误判。',
        },
        logic: {
            title: '逻辑与衔接错误',
            scope: 'paragraph',
            rules: '只检查 logic：段落衔接、连接词、论证链条、前后语义冲突、跑题。只给建议，不要词级误判。',
        },
    };

    return `你现在只做一件事：检查【${spec[type].title}】。

要求：
1) ${spec[type].rules}
2) 不要输出其他三类错误。
3) 只返回明确错误，不要润色正确内容。
4) 输出严格 JSON，不要任何额外文本。
5) 每条错误必须包含：start,end,type,scope,wrong,suggestion,reason。
6) type 只能是 ${type}。
7) scope 只能是 ${spec[type].scope}。
8) wrong 必须与 originalText.slice(start, end) 完全一致。
9) 没有错误就返回空数组。

JSON Schema:
{
  "errors": [
    {
      "start": 0,
      "end": 5,
      "type": "${type}",
      "scope": "${spec[type].scope}",
      "wrong": "string",
      "suggestion": "string",
      "reason": "string"
    }
  ]
}

originalText:
${text}`;
}

async function runCategoryPass(text: string, type: ErrorType): Promise<CorrectionError[]> {
    const { content } = await chatWithLLM(categoryPrompt(type, text));
    const parsed = safeJsonParse<LlmCategoryResponse>(content);
    if (!parsed?.errors) return [];

    return normalizeErrors(text, parsed.errors, defaultScopeByType[type]).filter((e) => e.type === type);
}

async function runFinalReviewPass(text: string, existingErrors: CorrectionError[]): Promise<CorrectionError[]> {
    const prompt = `请对以下作文做最终复核，只补充遗漏的明确错误。

要求：
1) 只补充遗漏，不要重复已有错误。
2) grammar 和 vocabulary 只允许非常短的局部替换，不要整句改写。
3) expression 和 logic 只给建议，不进入自动改写。
4) wrong 必须与 originalText.slice(start, end) 完全一致。
5) 仅返回 JSON：{"supplementErrors":[...]}。

existingErrors:
${JSON.stringify(existingErrors, null, 2)}

originalText:
${text}`;

    const { content } = await chatWithLLM(prompt);
    const parsed = safeJsonParse<LlmReviewResponse>(content);
    if (!parsed?.supplementErrors) return [];

    return normalizeErrors(text, parsed.supplementErrors, 'word');
}

async function fourPassAnalyze(text: string): Promise<{ wordErrors: CorrectionError[]; macroErrors: CorrectionError[] }> {
    const [grammarErrorsRaw, vocabularyErrorsRaw, expressionErrorsRaw, logicErrorsRaw] = await Promise.all([
        runCategoryPass(text, 'grammar'),
        runCategoryPass(text, 'vocabulary'),
        runCategoryPass(text, 'expression'),
        runCategoryPass(text, 'logic'),
    ]);

    const articleErrors = detectArticleErrors(text);

    const wordErrors = resolveWordOverlaps(dedupeByKey([...grammarErrorsRaw, ...vocabularyErrorsRaw, ...articleErrors]));
    const macroErrors = dedupeByKey([
        ...expressionErrorsRaw.map((e) => ({ ...e, scope: 'sentence' as ErrorScope })),
        ...logicErrorsRaw.map((e) => ({ ...e, scope: 'paragraph' as ErrorScope })),
    ]);

    return { wordErrors, macroErrors };
}

export async function correctEssayByLLM(text: string): Promise<CorrectResponse> {
    const { model } = getConfig();

    const firstPass = await fourPassAnalyze(text);
    const supplements = await runFinalReviewPass(text, [...firstPass.wordErrors, ...firstPass.macroErrors]).catch(
        () => [] as CorrectionError[],
    );

    const supplementWord = supplements.filter((e) => e.type === 'grammar' || e.type === 'vocabulary');
    const supplementMacro = supplements.filter((e) => e.type === 'expression' || e.type === 'logic');

    const mergedWord = resolveWordOverlaps(dedupeByKey([...firstPass.wordErrors, ...supplementWord]));
    const mergedMacro = dedupeByKey([...firstPass.macroErrors, ...supplementMacro]);

    const safeWordErrors = filterAutoReplaceErrors(text, mergedWord);
    let revisedText = applyConservativeWordCorrections(text, safeWordErrors);

    const recheckEnabled = process.env.LLM_RECHECK_MODE !== 'false';
    if (recheckEnabled) {
        const secondPass = await fourPassAnalyze(revisedText).catch(() => ({
            wordErrors: [] as CorrectionError[],
            macroErrors: [] as CorrectionError[],
        }));
        const secondSafeWordErrors = filterAutoReplaceErrors(revisedText, secondPass.wordErrors);
        if (secondSafeWordErrors.length) {
            revisedText = applyConservativeWordCorrections(revisedText, secondSafeWordErrors);
        }
    }

    return {
        originalText: text,
        revisedText,
        errors: safeWordErrors,
        macroErrors: mergedMacro,
        stats: {
            total: safeWordErrors.length + mergedMacro.length,
            grammarCount: safeWordErrors.filter((e) => e.type === 'grammar').length,
            vocabularyCount: safeWordErrors.filter((e) => e.type === 'vocabulary').length,
            expressionCount: mergedMacro.filter((e) => e.type === 'expression').length,
            logicCount: mergedMacro.filter((e) => e.type === 'logic').length,
        },
        meta: {
            provider: 'llm',
            model,
        },
    };
}

export async function suggestOptimizeByLLM(text: string): Promise<SuggestOptimizeResponse> {
    const prompt = `你是英语写作教练。请在不改变原意的前提下优化句式和表达，让作文更自然、更有层次。
要求：
1) 允许改写，但必须保持原意。
2) 输出一个优化后全文 optimizedText。
3) 额外给出 3-6 条优化建议 suggestions（中文）。
4) 仅返回 JSON，不要其他内容。

JSON Schema:
{
  "optimizedText": "string",
  "suggestions": ["string"]
}

originalText:
${text}`;

    const { content, model } = await chatWithLLM(prompt);
    const parsed = safeJsonParse<LlmOptimizeResponse>(content);
    if (!parsed || typeof parsed.optimizedText !== 'string' || !Array.isArray(parsed.suggestions)) {
        throw new Error('LLM 返回 JSON 不合法');
    }

    return {
        originalText: text,
        optimizedText: parsed.optimizedText,
        suggestions: parsed.suggestions.slice(0, 6),
        meta: {
            provider: 'llm',
            model,
        },
    };
}

export async function extractSpellingWordsByLLM(errors: CorrectionError[]): Promise<SpellingWordsResponse> {
    const spellingErrors = errors
        .filter((e) => e.type === 'vocabulary' && /拼写/.test(e.reason))
        .filter((e, idx, arr) => {
            const current = `${e.wrong.toLowerCase()}=>${e.suggestion.toLowerCase()}`;
            return arr.findIndex((x) => `${x.wrong.toLowerCase()}=>${x.suggestion.toLowerCase()}` === current) === idx;
        });

    const fallbackWords = spellingErrors.map((e) => ({
        wrong: e.wrong,
        correct: e.suggestion,
        chinese: '',
    }));

    if (!spellingErrors.length) {
        return {
            words: [],
            meta: { provider: 'rules', model: 'no-spelling-errors' },
        };
    }

    const prompt = `你是英语词汇老师。请根据给定拼写纠错列表，补充每个正确单词的简短中文释义。
仅返回 JSON，不要任何解释。

输入拼写纠错列表：
${JSON.stringify(
        spellingErrors.map((e) => ({ wrong: e.wrong, correct: e.suggestion })),
        null,
        2,
    )}

JSON Schema:
{
  "words": [
    {
      "wrong": "string",
      "correct": "string",
      "chinese": "string"
    }
  ]
}`;

    try {
        const { content, model } = await chatWithLLM(prompt);
        const parsed = safeJsonParse<LlmSpellingResponse>(content);
        if (!parsed || !Array.isArray(parsed.words)) {
            throw new Error('LLM 返回 JSON 不合法');
        }

        const words = parsed.words
            .filter(
                (w) =>
                    typeof w.wrong === 'string' &&
                    typeof w.correct === 'string' &&
                    typeof w.chinese === 'string',
            )
            .map((w) => ({ wrong: w.wrong, correct: w.correct, chinese: w.chinese }));

        return {
            words: words.length ? words : fallbackWords,
            meta: { provider: 'llm', model },
        };
    } catch {
        return {
            words: fallbackWords,
            meta: {
                provider: 'rules',
                model: 'fallback-no-translation',
                llmError: '词义翻译失败，已回退仅英文列表',
            },
        };
    }
}
