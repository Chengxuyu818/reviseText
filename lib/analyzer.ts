import { CorrectionError, CorrectResponse, ErrorType } from './types';

type Rule = {
  pattern: RegExp;
  type: ErrorType;
  suggestion: string;
  reason: string;
};

const rules: Rule[] = [
  {
    pattern: /\bteh\b/gi,
    type: 'vocabulary',
    suggestion: 'the',
    reason: '单词拼写错误，应改为 the。',
  },
  {
    pattern: /\benviroment\b/gi,
    type: 'vocabulary',
    suggestion: 'environment',
    reason: '单词拼写错误，应为 environment。',
  },
  {
    pattern: /\brecieve\b/gi,
    type: 'vocabulary',
    suggestion: 'receive',
    reason: '单词拼写错误，应为 receive。',
  },
  {
    pattern: /\bdo a decision\b/gi,
    type: 'vocabulary',
    suggestion: 'make a decision',
    reason: '固定搭配错误，应为 make a decision。',
  },
  {
    pattern: /\bvery delicious\b/gi,
    type: 'expression',
    suggestion: 'delicious',
    reason: '表达冗余，delicious 通常不需 very 修饰。',
  },
  {
    pattern: /\bdiscuss about\b/gi,
    type: 'vocabulary',
    suggestion: 'discuss',
    reason: '固定搭配错误：discuss 是及物动词，后不接 about。',
  },
  {
    pattern: /\bhe go to school yesterday\b/gi,
    type: 'grammar',
    suggestion: 'he went to school yesterday',
    reason: '时态误用：yesterday 表示过去，动词应使用过去式。',
  },
  {
    pattern: /\bshe have\b/gi,
    type: 'grammar',
    suggestion: 'she has',
    reason: '主谓不一致：第三人称单数 she 应搭配 has。',
  },
  {
    pattern: /\ban university\b/gi,
    type: 'grammar',
    suggestion: 'a university',
    reason: '冠词误用：university 以辅音音素开头，应使用 a。',
  },
];

const priority: Record<ErrorType, number> = {
  logic: 4,
  expression: 3,
  vocabulary: 2,
  grammar: 1,
};

function collectErrors(text: string): CorrectionError[] {
  const found: CorrectionError[] = [];

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const wrong = match[0];
      const start = match.index;
      const end = start + wrong.length;

      found.push({
        id: `${rule.type}-${start}-${end}`,
        start,
        end,
        type: rule.type,
        scope: rule.type === 'grammar' || rule.type === 'vocabulary' ? 'word' : 'sentence',
        wrong,
        suggestion: preserveCase(wrong, rule.suggestion),
        reason: rule.reason,
      });
    }
  }

  found.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return priority[b.type] - priority[a.type];
  });

  const deduped: CorrectionError[] = [];

  for (const item of found) {
    const overlap = deduped.find((d) => !(item.end <= d.start || item.start >= d.end));

    if (!overlap) {
      deduped.push(item);
      continue;
    }

    if (priority[item.type] > priority[overlap.type]) {
      const idx = deduped.indexOf(overlap);
      deduped[idx] = item;
    }
  }

  return deduped.sort((a, b) => a.start - b.start);
}

function preserveCase(source: string, target: string): string {
  if (!source) return target;
  if (source.toUpperCase() === source) return target.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return target;
}

function applyCorrections(text: string, errors: CorrectionError[]): string {
  if (!errors.length) return text;

  let cursor = 0;
  let result = '';

  for (const err of errors) {
    result += text.slice(cursor, err.start);
    result += err.suggestion;
    cursor = err.end;
  }

  result += text.slice(cursor);
  return result;
}

export function analyzeEssay(text: string): CorrectResponse {
  const errors = collectErrors(text);
  const revisedText = applyCorrections(text, errors);

  const grammarCount = errors.filter((e) => e.type === 'grammar').length;
  const vocabularyCount = errors.filter((e) => e.type === 'vocabulary').length;
  const expressionCount = errors.filter((e) => e.type === 'expression').length;
  const logicCount = errors.filter((e) => e.type === 'logic').length;

  return {
    originalText: text,
    revisedText,
    errors,
    macroErrors: [],
    stats: {
      total: errors.length,
      grammarCount,
      vocabularyCount,
      expressionCount,
      logicCount,
    },
    meta: {
      provider: 'rules',
      model: 'built-in-rules',
    },
  };
}
