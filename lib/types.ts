export type ErrorType = 'grammar' | 'vocabulary' | 'expression' | 'logic';

export type ErrorScope = 'word' | 'sentence' | 'paragraph';

export interface CorrectionError {
    id: string;
    start: number;
    end: number;
    type: ErrorType;
    scope: ErrorScope;
    wrong: string;
    suggestion: string;
    reason: string;
}

export interface CorrectResponse {
    originalText: string;
    revisedText: string;
    errors: CorrectionError[];
    macroErrors: CorrectionError[];
    stats: {
        total: number;
        grammarCount: number;
        vocabularyCount: number;
        expressionCount: number;
        logicCount: number;
    };
    meta?: {
        provider: 'llm' | 'rules';
        model?: string;
        llmError?: string;
    };
}

export interface SuggestOptimizeResponse {
    originalText: string;
    optimizedText: string;
    suggestions: string[];
    meta?: {
        provider: 'llm' | 'rules';
        model?: string;
        llmError?: string;
    };
}

export interface SpellingWordItem {
    wrong: string;
    correct: string;
    chinese: string;
}

export interface SpellingWordsResponse {
    words: SpellingWordItem[];
    meta?: {
        provider: 'llm' | 'rules';
        model?: string;
        llmError?: string;
    };
}
