import { NextResponse } from "next/server";

const SYSTEM_PROMPT_BASE =
  "You are a senior business analyst reviewing a BI report with a junior consultant. " +
  "You have full context of the current client analysis. When asked about specific metrics, charts, anomalies or recommendations, " +
  "give direct honest assessments — flag anything that looks like filler, misleading, or based on bad data logic. " +
  "Explain issues in plain English. Keep responses concise and practical.";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as
      | { messages?: ChatMessage[]; context?: Record<string, unknown> }
      | null;

    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }

    const cleanMessages = body.messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    if (cleanMessages.length === 0) {
      return NextResponse.json({ error: "no valid messages provided" }, { status: 400 });
    }

    const contextBlock = body.context
      ? `\n\n--- CURRENT CLIENT ANALYSIS CONTEXT (JSON) ---\nIndustry, client notes, benchmarks (if present) reflect what this consultant has set up for this client. Use them to keep your answers tailored.\n${JSON.stringify(body.context, null, 2)}\n--- END CONTEXT ---`
      : "";

    const system = SYSTEM_PROMPT_BASE + contextBlock;

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system,
        messages: cleanMessages,
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error("Anthropic API error", anthropicResp.status, errText);
      let friendly = "The AI consultant is temporarily unavailable.";
      if (anthropicResp.status === 401) friendly = "Anthropic API key is invalid. Please update ANTHROPIC_API_KEY.";
      else if (anthropicResp.status === 429) friendly = "Rate limit reached. Please wait a moment and try again.";
      else if (anthropicResp.status === 529) friendly = "Anthropic is overloaded. Please try again shortly.";
      return NextResponse.json({ error: friendly, detail: errText }, { status: anthropicResp.status });
    }

    const data = await anthropicResp.json();
    const reply = Array.isArray(data?.content)
      ? data.content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join("\n")
          .trim()
      : "";

    return NextResponse.json({ reply: reply || "(no response)" }, { status: 200 });
  } catch (e) {
    console.error("consultant-chat error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
