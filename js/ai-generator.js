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

  // Helper for interruptible sleep so "Stop Generation" responds immediately
  async sleepInterruptible(ms) {
    const step = 400;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this.shouldStop) return;
      await new Promise((r) => setTimeout(r, Math.min(step, ms - elapsed)));
      elapsed += step;
    }
  }

  // Calls Secure Server Proxy for Gemini generation (Direct Cloud Run URL avoids 60s Hosting proxy cap)
  async generateBatch({ batchText, courseContext, batchIndex, totalBatches, allowFallback = false }) {
    const endpoint = "https://generatequestions-x57uk3tqfq-uc.a.run.app";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchText,
        courseContext,
        batchIndex,
        totalBatches,
        allowFallback
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(data.error || `HTTP ${response.status}: Failed to generate questions.`);
      err.retryable = !!data.retryable || response.status === 429 || response.status >= 500;
      throw err;
    }

    if (!data.questions || !Array.isArray(data.questions)) {
      const err = new Error("Server returned invalid questions format.");
      err.retryable = true;
      throw err;
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

      let batchResults = null;
      let lastBatchErr = null;

      // Up to 3 attempts per batch:
      // Attempts 1 & 2 stay strictly on the Primary (Free) key with patient cooldown pacing;
      // Attempt 3 enables the Fallback (Paid) key if the Primary key is still busy/exhausted.
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (this.shouldStop) break;

        try {
          batchResults = await this.generateBatch({
            batchText,
            courseContext,
            batchIndex: i,
            totalBatches,
            allowFallback: attempt >= 3
          });
          lastBatchErr = null;
          break;
        } catch (err) {
          lastBatchErr = err;
          if (attempt < 3 && !this.shouldStop) {
            const waitMs = attempt === 1 ? 18000 : 12000;
            if (onProgress) {
              onProgress({
                batchIndex: i,
                totalBatches,
                percent: Math.round((i / totalBatches) * 100),
                statusText:
                  attempt === 1
                    ? `Synchronizing Batch ${i + 1} of ${totalBatches} with Olodo Academic AI...`
                    : `Verifying CBT distractors & explanations for Batch ${i + 1} of ${totalBatches}...`
              });
            }
            await this.sleepInterruptible(waitMs);
          }
        }
      }

      if (this.shouldStop) {
        break;
      }

      if (batchResults && Array.isArray(batchResults)) {
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

        // Steady 8-second pacing between batches to match Free Tier RPM/TPM windows smoothly
        if (i < totalBatches - 1 && !this.shouldStop) {
          if (onProgress) {
            onProgress({
              batchIndex: i + 1,
              totalBatches,
              percent: Math.round(((i + 1) / totalBatches) * 100),
              statusText: `Preparing Batch ${i + 2} of ${totalBatches}...`
            });
          }
          await this.sleepInterruptible(8000);
        }
      } else if (lastBatchErr && onError) {
        onError(lastBatchErr, i);
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
