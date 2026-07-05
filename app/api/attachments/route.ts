import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { getAgentDir } from "@/lib/session-reader";
import { allowFileRoot } from "@/lib/file-access";
import type { AttachedFilePreviewKind, AttachedFileRef } from "@/lib/types";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

const TEXT_EXTS = new Set([
  "txt", "md", "mdx", "json", "jsonl", "xml", "yaml", "yml", "toml",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "pyw", "pyi", "rb",
  "java", "kt", "scala", "groovy", "go", "rs", "swift", "m", "h", "hpp",
  "c", "cc", "cpp", "cxx", "cs", "html", "htm", "css", "scss", "sass",
  "less", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql",
  "graphql", "gql", "proto", "dockerfile", "makefile", "cmake", "env",
  "gitignore", "editorconfig", "csv", "tsv", "log", "ini", "cfg", "conf",
  "tex", "latex", "bib", "r", "lua", "pl", "php", "vue", "svelte",
  "astro", "prisma", "schema",
]);

function sanitizeFileName(name: string): string {
  const trimmed = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, "_").trim();
  return trimmed.slice(0, 160) || "attachment";
}

function getExtension(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

function getPreviewKind(name: string, mimeType: string): AttachedFilePreviewKind {
  const ext = getExtension(name);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("text/") || TEXT_EXTS.has(ext)) return "text";
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return "docx";
  }
  return "binary";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    let total = 0;
    for (const file of files) {
      total += file.size;
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name} is larger than 50MB` }, { status: 413 });
      }
    }
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "Attachments exceed 150MB total" }, { status: 413 });
    }

    const day = new Date().toISOString().slice(0, 10);
    const root = join(getAgentDir(), "web-attachments", day);
    await mkdir(root, { recursive: true });
    allowFileRoot(join(getAgentDir(), "web-attachments"));

    const attachments: AttachedFileRef[] = [];
    for (const file of files) {
      const safeName = sanitizeFileName(file.name);
      const filePath = join(root, `${Date.now()}-${randomUUID()}-${safeName}`);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);
      const mimeType = file.type || "application/octet-stream";
      attachments.push({
        name: file.name || safeName,
        size: file.size,
        mimeType,
        path: filePath,
        previewKind: getPreviewKind(file.name || safeName, mimeType),
      });
    }

    return NextResponse.json({ attachments });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
