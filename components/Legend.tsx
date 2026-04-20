export function Legend() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">四色规则</h3>
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="inline-flex items-center gap-2 rounded-md bg-green-50 px-2 py-1 text-green-600">
          <i className="h-2.5 w-2.5 rounded-full bg-green-500" /> 语法基础错误
        </span>
        <span className="inline-flex items-center gap-2 rounded-md bg-red-50 px-2 py-1 text-red-600">
          <i className="h-2.5 w-2.5 rounded-full bg-red-500" /> 词汇使用错误
        </span>
        <span className="inline-flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1 text-blue-600">
          <i className="h-2.5 w-2.5 rounded-full bg-blue-500" /> 句式与表达错误
        </span>
        <span className="inline-flex items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-amber-600">
          <i className="h-2.5 w-2.5 rounded-full bg-amber-500" /> 逻辑与衔接错误
        </span>
      </div>
    </div>
  );
}
