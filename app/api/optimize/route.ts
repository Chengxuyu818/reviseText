import { NextRequest, NextResponse } from 'next/server';
import { suggestOptimizeByLLM } from '@/lib/llmCorrector';
import type { SuggestOptimizeResponse } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body?.text ?? '').trim();

    if (!text) {
      return NextResponse.json({ message: 'text 不能为空' }, { status: 400 });
    }

    try {
      const result = await suggestOptimizeByLLM(text);
      return NextResponse.json(result);
    } catch (error) {
      const llmError = error instanceof Error ? error.message : '未知 LLM 错误';
      const fallback: SuggestOptimizeResponse = {
        originalText: text,
        optimizedText: text,
        suggestions: ['暂时无法获取优化建议，请检查模型配置后重试。'],
        meta: {
          provider: 'rules',
          model: 'fallback-optimize',
          llmError,
        },
      };
      return NextResponse.json(fallback);
    }
  } catch {
    return NextResponse.json({ message: '请求处理失败，请稍后重试' }, { status: 500 });
  }
}
