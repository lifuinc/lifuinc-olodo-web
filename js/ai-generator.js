// Olodo AI Question Generator for NOUN CBT & Nigerian Curricula
// Powered by Google Gemini API with Batching, Strict Schema, and Interactive Review

import { ENV } from "./env.js";

const SUPPORTED_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash"
];

export class AIGenerator {
  constructor() {
    this.apiKey = ENV.GEMINI_API_KEY || localStorage.getItem("olodo_gemini_api_key") || "";
    this.isGenerating = false;
    this.shouldStop = false;
    this.generatedQuestions = [];
  }

  saveApiKey(key) {
    this.apiKey = key.trim();
    localStorage.setItem("olodo_gemini_api_key", this.apiKey);
  }

  getApiKey() {
    return (ENV.GEMINI_API_KEY || "").trim() || this.apiKey || localStorage.getItem("olodo_gemini_api_key") || "";
  }

  stop() {
    this.shouldStop = true;
    this.isGenerating = false;
  }

  // Pre-parser: splits lecturer text into manageable chunks
  chunkText(rawText, batchSize = 10) {
    const text = rawText.trim();
    if (!text) return [];

    // Split by multiple newlines or common question separators
    // First normalize CRLF to LF
    const normalized = text.replace(/\r\n/g, "\n");

    // Try splitting by blank lines
    let blocks = normalized.split(/\n\s*\n+/).map(b => b.trim()).filter(b => b.length > 0);

    // If blocks are very few but text has numbered lines, split by question numbering
    if (blocks.length <= 2 && /\n\s*(?:\d+[\.\)]|[Qq]\d+[\.\:])/m.test(normalized)) {
      blocks = normalized.split(/\n\s*(?=(?:\d+[\.\)]|[Qq]\d+[\.\:]))/m).map(b => b.trim()).filter(b => b.length > 0);
    }

    // If still just 1 large block, split by pairs of lines (e.g. Line 1: Question, Line 2: Answer)
    if (blocks.length <= 1) {
      const lines = normalized.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      blocks = [];
      for (let i = 0; i < lines.length; i += 2) {
        if (i + 1 < lines.length) {
          blocks.push(`${lines[i]}\n${lines[i + 1]}`);
        } else {
          blocks.push(lines[i]);
        }
      }
    }

    // Group blocks into batches of `batchSize`
    const batches = [];
    for (let i = 0; i < blocks.length; i += batchSize) {
      batches.push(blocks.slice(i, i + batchSize).join("\n\n"));
    }

    return batches;
  }

  // Shuffle array helper so correct answer is randomly distributed among A, B, C, D
  shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Calls Gemini API for a single batch
  async generateBatch({ batchText, courseContext, batchIndex, totalBatches }) {
    const key = this.getApiKey();
    if (!key) {
      throw new Error("Platform Gemini API Key is not configured yet. Please set GEMINI_API_KEY in js/env.js (or .env).");
    }

    const contextInstruction = courseContext && courseContext.trim().length > 0
      ? `\nCOURSE CONTEXT: "${courseContext.trim()}". Distractors MUST be plausible scholars, theories, terms, or historical dates strictly relevant to this course.`
      : "";

    const systemPrompt = `You are a NOUN CBT exam generator.

TASK:
Convert every single fill-in-the-blank / Q&A entry in the provided text into a 4-option multiple-choice question.

STRICT CONSTRAINTS:
1. DO NOT rephrase, modernize, or rewrite the sentences. Keep the EXACT verbatim text and blank line from the source.
2. The correct answer MUST be the verbatim answer given directly underneath each item in the text.
3. Create 3 plausible distractors (options) relevant to the course context.${contextInstruction}
4. Output strict JSON array only.

Output JSON Schema:
[
  {
    "question": "_____ inferred that without conflict we cannot have change",
    "options": ["Ross (1993)", "Quicy Wright (1990)", "Kriesberg (1973)", "Stagner"],
    "answer": "Ross (1993)",
    "explanation": "Ross (1993) inferred that without conflict we cannot have change."
  }
]`;

    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [
            { text: `Process this batch (${batchIndex + 1} of ${totalBatches}) of raw entries:\n\n${batchText}` }
          ]
        }
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };

    let data = null;
    let lastError = null;

    // Try models in order: gemini-3.5-flash -> gemini-3.1-flash-lite -> gemini-3.8-flash
    for (const currentModel of SUPPORTED_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${key}`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          data = await response.json();
          break; // Succeeded!
        }

        const errJson = await response.json().catch(() => ({}));
        lastError = errJson?.error?.message || `HTTP error ${response.status} (${response.statusText})`;
        console.warn(`[Olodo AI] Model ${currentModel} returned error: ${lastError}. Trying next fallback...`);
      } catch (networkErr) {
        lastError = networkErr.message;
        console.warn(`[Olodo AI] Model ${currentModel} network error: ${lastError}. Trying next fallback...`);
      }
    }

    if (!data) {
      throw new Error(`Gemini API Error: ${lastError}`);
    }

    const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error("No response content generated by Gemini.");
    }

    let parsedQuestions;
    try {
      parsedQuestions = JSON.parse(candidate);
    } catch (e) {
      // If wrapped in markdown ```json ... ```
      const cleaned = candidate.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedQuestions = JSON.parse(cleaned);
    }

    if (!Array.isArray(parsedQuestions)) {
      throw new Error("Gemini returned non-array JSON response.");
    }

    // Normalize and validate options
    return parsedQuestions.map((q, idx) => {
      const questionText = (q.question || q.text || "").trim();
      const correctAnswer = (q.answer || q.correctAnswer || "").trim();
      let options = Array.isArray(q.options) ? q.options.map(o => String(o).trim()) : [];

      // Ensure answer is in options
      if (!options.includes(correctAnswer)) {
        options.push(correctAnswer);
      }

      // Ensure exactly 4 options
      while (options.length < 4) {
        options.push(`Alternative Option ${options.length + 1}`);
      }
      if (options.length > 4) {
        // Keep correct answer and first 3 distractors
        const distractors = options.filter(o => o !== correctAnswer).slice(0, 3);
        options = [correctAnswer, ...distractors];
      }

      // Randomly shuffle options so answer is not predictably at index 0
      options = this.shuffle(options);

      return {
        id: `ai_${Date.now()}_${batchIndex}_${idx + 1}`,
        question: questionText,
        options,
        answer: correctAnswer,
        explanation: (q.explanation || `${correctAnswer} is the verified answer.`).trim()
      };
    });
  }

  // Executes the full batch pipeline with progress callbacks
  async runPipeline({ rawText, courseContext, batchSize = 10, onProgress, onBatchSuccess, onError }) {
    this.isGenerating = true;
    this.shouldStop = false;
    this.generatedQuestions = [];

    const batches = this.chunkText(rawText, batchSize);
    if (batches.length === 0) {
      if (onError) onError(new Error("No question entries found in the input. Please paste your text."));
      this.isGenerating = false;
      return [];
    }

    const totalBatches = batches.length;
    let completedCount = 0;

    for (let i = 0; i < totalBatches; i++) {
      if (this.shouldStop) {
        break;
      }

      const batchText = batches[i];
      if (onProgress) {
        onProgress({
          batchIndex: i,
          totalBatches,
          percent: Math.round((i / totalBatches) * 100),
          statusText: `Processing Batch ${i + 1} of ${totalBatches}...`
        });
      }

      try {
        const batchResults = await this.generateBatch({
          batchText,
          courseContext,
          batchIndex: i,
          totalBatches
        });

        this.generatedQuestions.push(...batchResults);
        completedCount += batchResults.length;

        if (onBatchSuccess) {
          onBatchSuccess({
            batchIndex: i,
            totalBatches,
            batchResults,
            totalGenerated: this.generatedQuestions.length
          });
        }

        // Brief delay between batches to respect rate limits
        if (i < totalBatches - 1) {
          await new Promise(r => setTimeout(r, 600));
        }
      } catch (err) {
        if (onError) {
          onError(err, i);
        }
        // Ask caller whether to continue or abort; default continue to preserve partial progress
      }
    }

    this.isGenerating = false;
    if (onProgress) {
      onProgress({
        batchIndex: totalBatches,
        totalBatches,
        percent: 100,
        statusText: `Completed! Generated ${this.generatedQuestions.length} CBT questions.`
      });
    }

    return this.generatedQuestions;
  }
}
