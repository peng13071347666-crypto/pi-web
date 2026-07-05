"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs, vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";

interface SyntaxHighlighterBodyProps {
  code: string;
  lang: string;
  isDark: boolean;
}

export function SyntaxHighlighterBody({ code, lang, isDark }: SyntaxHighlighterBodyProps) {
  return (
    <SyntaxHighlighter
      language={lang || "text"}
      style={isDark ? vscDarkPlus : vs}
      showLineNumbers
      lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
      customStyle={{
        margin: 0,
        padding: "11px 13px",
        fontSize: 12.5,
        lineHeight: 1.62,
        borderRadius: 0,
        background: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
      }}
      codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
