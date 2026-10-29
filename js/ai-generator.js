// Olodo AI Question Generator for NOUN CBT & Nigerian Curricula
// Powered by Google Gemini API via Secure Cloud Functions Proxy with Automatic Paid Fallback

export class AIGenerator {
  constructor() {
    this.isGenerating = false;
    this.shouldStop = false;
    this.generatedQuestions = [];
  }

  stop() {
    this.shouldStop = true;
    this.isGenerating = false;
  }

  // Pre-parser: splits lecturer text into manageable chunks
  chunkText(rawText, batchSize = 10) {
    const text = rawText.trim();
    if (!text) return [];

    const normalized = text.replace(/\r\n/g, "\n");
    let blocks = normalized.split(/\n\s*\n+/).map(b => b.trim()).filter(b => b.length > 0);

    if (blocks.length <= 2 && /\n\s*(?:\d+[\.\)]|[Qq]\d+[\.\:])/m.test(normalized)) {
      blocks = normalized.split(/\n\s*(?=(?:\d+[\.\)]|[Qq]\d+[\.\:]))/m).map(b => b.trim()).filter(b => b.length > 0);
    }

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

    const batches = [];
    for (let i = 0; i < blocks.length; i += batchSize) {
      batches.push(blocks.slice(i, i + batchSize).join("\n\n"));
    }

    return batches;
  }

  // Calls Secure Server Proxy for Gemini generation
  async generateBatch({ batchText, courseContext, batchIndex, totalBatches }) {
    const endpoint = "/api/generateQuestions";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchText,
        courseContext,
        batchIndex,
        totalBatches
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}: Failed to generate questions.`);
    }

    if (!data.questions || !Array.isArray(data.questions)) {
      throw new Error("Server returned invalid questions format.");
    }

    if (data.usedFallback) {
      console.info(`[Olodo AI] Batch ${batchIndex + 1}: Used fallback Gemini key.`);
    }

    return data.questions;
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
