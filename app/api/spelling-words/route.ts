import { NextRequest, NextResponse } from 'next/server';
import type { CorrectionError } from '@/lib/types';
import { extractSpellingWordsByLLM } from '@/lib/llmCorrector';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const errors = Array.isArray(body?.errors) ? (body.errors as CorrectionError[]) : [];

    const result = await extractSpellingWordsByLLM(errors);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ message: '请求处理失败，请稍后重试' }, { status: 500 });
  }
}
