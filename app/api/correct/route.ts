import { NextRequest, NextResponse } from 'next/server';
import { analyzeEssay } from '@/lib/analyzer';
import { correctEssayByLLM } from '@/lib/llmCorrector';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = String(body?.text ?? '').trim();

    if (!text) {
      return NextResponse.json({ message: 'text 不能为空' }, { status: 400 });
    }

    if (text.length > 12000) {
      return NextResponse.json({ message: '文本过长，请控制在 12000 字符内' }, { status: 400 });
    }

    try {
      const llmResult = await correctEssayByLLM(text);
      return NextResponse.json(llmResult);
    } catch (error) {
      const fallback = analyzeEssay(text);
      const llmError = error instanceof Error ? error.message : '未知 LLM 错误';
      return NextResponse.json({
        ...fallback,
        meta: {
          ...(fallback.meta ?? { provider: 'rules' as const }),
          llmError,
        },
      });
    }
  } catch {
    return NextResponse.json({ message: '请求处理失败，请稍后重试' }, { status: 500 });
  }
}
