import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * AI provider switch. Set LLM_PROVIDER=ollama (default) or gemini.
 * Ollama Cloud: OLLAMA_API_KEY, OLLAMA_MODEL (default gpt-oss:120b)
 * Gemini: GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.5-flash)
 */
const PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase();

function parseJSON<T>(text: string): T {
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned) as T; }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI did not return JSON");
    return JSON.parse(m[0]) as T;
  }
}

async function ollamaJSON(prompt: string): Promise<string> {
  const r = await fetch("https://ollama.com/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "gpt-oss:120b",
      messages: [
        { role: "system", content: "You reply with a single valid JSON object and nothing else." },
        { role: "user", content: prompt }
      ],
      format: "json",
      stream: false,
      options: { temperature: 0.2 }
    })
  });
  if (!r.ok) throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.message?.content ?? "";
}

async function geminiJSON(prompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
  });
  const res = await model.generateContent(prompt);
  return res.response.text();
}

/** Ask the configured AI for strict JSON and parse it. */
export async function askJSON<T>(prompt: string): Promise<T> {
  const text = PROVIDER === "gemini" ? await geminiJSON(prompt) : await ollamaJSON(prompt);
  return parseJSON<T>(text);
}

/** True when the selected provider has a key. Routes use this to degrade to rule-only results. */
export function aiConfigured(): boolean {
  return PROVIDER === "gemini" ? !!process.env.GEMINI_API_KEY : !!process.env.OLLAMA_API_KEY;
}

/** Like askJSON but returns null instead of throwing (for optional AI extras). */
export async function tryAskJSON<T>(prompt: string): Promise<T | null> {
  if (!aiConfigured()) return null;
  try { return await askJSON<T>(prompt); } catch { return null; }
}

export const RESUME_SCHEMA = `{
 "full_name": string, "email": string, "phone": string, "location": string,
 "linkedin": string, "github": string, "portfolio": string,
 "headline": string, "summary": string, "total_experience_years": number,
 "education": [{"degree": string, "field": string, "institution": string, "start": string, "end": string, "grade": string}],
 "experience": [{"title": string, "company": string, "start": string, "end": string, "bullets": string[]}],
 "projects": [{"name": string, "tech": string[], "bullets": string[], "link": string}],
 "skills": string[], "certifications": string[], "achievements": string[],
 "answers": {"work_authorization_india": string, "notice_period": string, "willing_to_relocate": string, "expected_ctc": string, "current_ctc": string}
}`;
