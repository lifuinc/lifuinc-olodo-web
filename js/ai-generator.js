// Olodo AI Question Generator for NOUN CBT & Nigerian Curricula
// Powered by Google Gemini API via Secure Cloud Functions Proxy with Automatic Paid Fallback

export class AIGenerator {
  constructor() {
    this.isGenerating = false;
    this.shouldStop = false;
    this.generatedQuestions = [];
    this.pdfPageImages = [];
  }

  stop() {
    this.shouldStop = true;
    this.isGenerating = false;
  }

  // Strip common third-party summary watermarks, phone banners, and page footers
  cleanWatermarks(rawText) {
    if (!rawText) return "";
    return rawText
      .replace(/ACHIEVER['’]?S\s+EDU\s+CON\s*\d*/gi, "")
      .replace(/PLEASE\s+PATRONI[SZ]E\s+US[^\n]*/gi, "")
      .replace(/\b(?:WHATSAPP|CALL|CONTACT)\s*[:\-]?\s*0[789][01]\d{8}\b/gi, "")
      .replace(/^\s*Page\s+\d+\s*(?:of\s+\d+)?\s*$/gim, "")
      .replace(/\r\n/g, "\n");
  }

  // Extract structured text and visual diagram snapshots from an uploaded PDF file
  async extractFromPdf(file, onStatus) {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js library is not loaded yet. Please refresh the page and try again.");
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    const pageTexts = [];
    const pageImages = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (onStatus) {
        onStatus(`Reading PDF page ${pageNum} of ${numPages}...`);
      }

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Group text items by vertical line (Y coordinate) to preserve exact PDF line structure
      const items = textContent.items || [];
      const lineBuckets = [];
      const yTolerance = 4.5;

      for (const item of items) {
        const str = item.str || "";
        if (!str.trim()) continue;
        const x = item.transform ? item.transform[4] : 0;
        const y = item.transform ? item.transform[5] : 0;

        let bucket = lineBuckets.find((b) => Math.abs(b.y - y) <= yTolerance);
        if (!bucket) {
          bucket = { y, parts: [] };
          lineBuckets.push(bucket);
        }
        bucket.parts.push({ x, str });
      }

      // Sort top-to-bottom (descending Y in PDF coordinates), then left-to-right (ascending X)
      lineBuckets.sort((a, b) => b.y - a.y);
      const lines = lineBuckets
        .map((bucket) => {
          bucket.parts.sort((a, b) => a.x - b.x);
          return bucket.parts.map((p) => p.str).join(" ").replace(/\s+/g, " ").trim();
        })
        .filter((l) => l.length > 0);

      const cleanedPageText = this.cleanWatermarks(lines.join("\n")).trim();
      if (cleanedPageText) {
        pageTexts.push(cleanedPageText);
      }

      // Check if page references graphs/diagrams/figures and capture up to 3 compact snapshots
      const hasVisualKeywords = /\b(?:graph|diagram|figure|fig\.|slope|curve|circuit|apparatus|caliper|micrometer|spring|axis|axes)\b/i.test(
        cleanedPageText
      );
      if (hasVisualKeywords && pageImages.length < 3) {
        try {
          const viewport = page.getViewport({ scale: 1.0 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx, viewport }).promise;
          const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
          const base64Data = dataUrl.split(",")[1];
          if (base64Data) {
            pageImages.push({
              pageNum,
              mimeType: "image/jpeg",
              data: base64Data
            });
          }
        } catch (_) {
          // Ignore canvas snapshot errors and continue with text
        }
      }
    }

    this.pdfPageImages = pageImages;
    return {
      fullText: pageTexts.join("\n\n"),
      numPages,
      visualPagesCount: pageImages.length
    };
  }

  // Intelligent NOUN Parser: handles MCQ1..N, FBQ1..N, Answer:, inline blanks (____ Answer), multi-line Q&A, and Option 2 Summary Notes
  chunkText(rawText, batchSize = 10, mode = "option1") {
    const cleaned = this.cleanWatermarks(rawText).trim();
    if (!cleaned) return [];

    const lines = cleaned
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const questionBlocks = [];
    const summaryLines = [];

    const markerRegex = /^(?:MCQ|FBQ|TMA|Q|Question)\s*\d+[\.\:\)]?\s*/i;
    const answerPrefixRegex = /^(?:Answer|Ans|Correct\s*Answer)\s*[:\-]\s*(.+)$/i;
    const inlineBlankWithAnswerRegex = /_{2,}\s*([A-Za-z0-9][^\n]*)$/;

    // Check if document contains explicit MCQ/FBQ/Answer: markers
    const hasExplicitMarkers = lines.some(
      (l) => markerRegex.test(l) || answerPrefixRegex.test(l)
    );

    if (hasExplicitMarkers) {
      let currentQ = [];
      let inQuestionSection = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Start of a new MCQ1 / FBQ1 item
        if (markerRegex.test(line)) {
          inQuestionSection = true;
          if (currentQ.length > 0) {
            questionBlocks.push(currentQ.join("\n"));
          }
          currentQ = [line];
          continue;
        }

        // Explicit "Answer: ..." line closes the current question block
        if (answerPrefixRegex.test(line)) {
          inQuestionSection = true;
          if (currentQ.length === 0 && summaryLines.length > 0) {
            // Pull the preceding question lines from summaryLines (up to 3 lines)
            const pulled = [];
            while (summaryLines.length > 0 && pulled.length < 3) {
              const prev = summaryLines.pop();
              pulled.unshift(prev);
              if (/^(?:\d+[\.\)]|[A-Z])/.test(prev)) break;
            }
            currentQ.push(...pulled);
          }
          currentQ.push(line);
          questionBlocks.push(currentQ.join("\n"));
          currentQ = [];
          continue;
        }

        // Self-contained inline blank with trailing answer on the same line (e.g., "...called____ Field study")
        if (inlineBlankWithAnswerRegex.test(line) && currentQ.length === 0) {
          questionBlocks.push(line);
          continue;
        }

        if (currentQ.length > 0) {
          currentQ.push(line);
        } else if (!inQuestionSection) {
          summaryLines.push(line);
        } else {
          // Inside question section without a marker prefix yet (multi-line question before Answer:)
          currentQ.push(line);
        }
      }

      if (currentQ.length > 0) {
        questionBlocks.push(currentQ.join("\n"));
      }
    } else {
      // No explicit MCQ/FBQ/Answer: prefixes — handle blank-line blocks, inline blanks, or 2-line Q&A pairs
      const doubleNewlineBlocks = cleaned
        .split(/\n\s*\n+/)
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

      if (doubleNewlineBlocks.length >= 2) {
        for (const blk of doubleNewlineBlocks) {
          const blkLines = blk.split("\n").map((l) => l.trim()).filter(Boolean);
          // If it's a long prose paragraph (> 4 lines and no blanks/quotes), treat as summary prose
          const hasBlank = /_{2,}/.test(blk);
          const isQuotedPair = blkLines.length === 2 && /^["“]/.test(blkLines[0]);
          if (blkLines.length > 4 && !hasBlank && !isQuotedPair) {
            summaryLines.push(blk);
          } else if (blkLines.length > 2 && blkLines.every((l) => inlineBlankWithAnswerRegex.test(l))) {
            // Multiple single-line inline-blank items pasted together
            questionBlocks.push(...blkLines);
          } else {
            questionBlocks.push(blk);
          }
        }
      } else {
        // Single-spaced lines without blank lines between them
        let i = 0;
        while (i < lines.length) {
          const line = lines[i];
          // 1. If line has an inline answer right after the blank ("...called____ Field study"), keep it as 1 self-contained block!
          if (inlineBlankWithAnswerRegex.test(line)) {
            questionBlocks.push(line);
            i += 1;
            continue;
          }

          // 2. If next line is a short answer or quoted answer, pair them
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextLooksLikeQuestion = /_{2,}|\?$/.test(nextLine) && !/^["“][^"”]+["”]$/.test(nextLine);
            if (!nextLooksLikeQuestion) {
              questionBlocks.push(`${line}\nAnswer: ${nextLine}`);
              i += 2;
              continue;
            }
          }

          // 3. Otherwise treat as prose summary or standalone line
          if (line.split(/\s+/).length > 18 && !/_{2,}/.test(line)) {
            summaryLines.push(line);
          } else {
            questionBlocks.push(line);
          }
          i += 1;
        }
      }
    }

    const batches = [];

    // 1. Group Past Question blocks into "extract" batches separated by \n---\n
    for (let i = 0; i < questionBlocks.length; i += batchSize) {
      batches.push({
        text: questionBlocks.slice(i, i + batchSize).join("\n---\n"),
        batchType: "extract"
      });
    }

    // 2. If Option 2 ("option2") is selected (OR if the document only has summary prose and 0 past questions),
    //    chunk the summary prose into ~1800-char passages for AI question + diagram generation
    if ((mode === "option2" || batches.length === 0) && summaryLines.length > 0) {
      const fullSummary = summaryLines.join("\n");
      const maxCharsPerPassage = 1800;
      const summaryParagraphs = fullSummary.split(/\n+/);
      let currentPassage = "";

      for (const para of summaryParagraphs) {
        if ((currentPassage + "\n" + para).length > maxCharsPerPassage && currentPassage.trim().length > 200) {
          batches.push({
            text: currentPassage.trim(),
            batchType: "summary",
            pageImages: this.pdfPageImages.slice(0, 2)
          });
          currentPassage = para;
        } else {
          currentPassage += (currentPassage ? "\n" : "") + para;
        }
      }
      if (currentPassage.trim().length > 80) {
        batches.push({
          text: currentPassage.trim(),
          batchType: "summary",
          pageImages: this.pdfPageImages.slice(0, 2)
        });
      }
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
  async generateBatch({
    batchText,
    courseContext,
    batchIndex,
    totalBatches,
    allowFallback = false,
    batchType = "extract",
    includeDiagrams = true,
    pageImages = []
  }) {
    const endpoint = "https://generatequestions-x57uk3tqfq-uc.a.run.app";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchText,
        courseContext,
        batchIndex,
        totalBatches,
        allowFallback,
        batchType,
        includeDiagrams,
        pageImages
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
  async runPipeline({
    rawText,
    courseContext,
    batchSize = 10,
    pdfMode = "option1",
    includeDiagrams = true,
    onProgress,
    onBatchSuccess,
    onError
  }) {
    this.isGenerating = true;
    this.shouldStop = false;
    this.generatedQuestions = [];

    const batches = this.chunkText(rawText, batchSize, pdfMode);
    if (batches.length === 0) {
      if (onError) onError(new Error("No question entries found in the input. Please upload a PDF or paste your text."));
      this.isGenerating = false;
      return [];
    }

    const totalBatches = batches.length;
    let completedCount = 0;

    for (let i = 0; i < totalBatches; i++) {
      if (this.shouldStop) {
        break;
      }

      const batchObj = typeof batches[i] === "string" ? { text: batches[i], batchType: "extract" } : batches[i];
      const batchText = batchObj.text;
      const batchType = batchObj.batchType || "extract";
      const pageImages = batchObj.pageImages || [];

      const modeLabel = batchType === "summary" ? "Summary Notes" : "Past Questions";

      if (onProgress) {
        onProgress({
          batchIndex: i,
          totalBatches,
          percent: Math.round((i / totalBatches) * 100),
          statusText: `Processing Batch ${i + 1} of ${totalBatches} (${modeLabel})...`
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
            allowFallback: attempt >= 3,
            batchType,
            includeDiagrams,
            pageImages
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
