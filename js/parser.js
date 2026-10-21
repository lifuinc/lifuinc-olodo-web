// Olodo Question Bank Parser & Distractor Generator

const GLOBAL_SALT = "QuizShield_SecSalt_2026";

// SHA-256 in browser using Web Crypto API
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashAnswer(answer) {
  const normalized = `${GLOBAL_SALT}:${answer.trim().toLowerCase()}`;
  return await sha256(normalized);
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function parseQuestionBank(rawText) {
  const text = rawText.trim();
  if (!text) return { ok: false, error: "Question bank text is empty." };

  // Check if JSON format
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const questions = [];
        for (let i = 0; i < parsed.length; i++) {
          const q = parsed[i];
          const correct = q.correctAnswer || q.answer || "";
          const hash = await hashAnswer(correct);
          questions.push({
            id: String(i + 1),
            text: q.text || q.question || "",
            options: q.options || [],
            correctAnswer: correct,
            answerHash: hash,
            group: q.group || "G",
            explanation: q.explanation || null
          });
        }
        return { ok: true, questions, total: questions.length, format: "JSON" };
      }
    } catch (_) {}
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return { ok: false, error: "No valid question lines found." };

  // Determine line format by checking the first few lines
  const firstLinePipes = (lines[0].match(/\|/g) || []).length;

  // Format A: Explicit options (Question | OptA | OptB | OptC | OptD | CorrectAnswer | Explanation?)
  if (firstLinePipes >= 5) {
    const questions = [];
    const seenTexts = new Set();
    const warnings = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("|").map(p => p.trim());
      if (parts.length < 6) {
        warnings.push(`Line ${i + 1} skipped: Expected at least 6 pipe-separated parts.`);
        continue;
      }
      const qText = parts[0];
      const opts = [parts[1], parts[2], parts[3], parts[4]];
      const correct = parts[5];
      const explanation = parts[6] || null;

      if (seenTexts.has(qText.toLowerCase())) {
        warnings.push(`Line ${i + 1}: Duplicate question ignored.`);
        continue;
      }
      seenTexts.add(qText.toLowerCase());

      const hash = await hashAnswer(correct);
      questions.push({
        id: String(questions.length + 1),
        text: qText,
        options: opts,
        correctAnswer: correct,
        answerHash: hash,
        group: "General",
        explanation
      });
    }

    const withExpl = questions.filter(q => q.explanation && q.explanation.trim().length > 0).length;
    const hasExplanations = questions.length > 0 && (withExpl / questions.length) >= 0.7;

    return { 
      ok: true, 
      questions, 
      total: questions.length, 
      warnings, 
      format: "Pipe-Delimited Options",
      hasExplanations,
      withExplanationsCount: withExpl
    };
  }

  // Format B: Group | Question | Answer (e.g. gst204 format: P|Question text|Answer)
  if (firstLinePipes >= 2) {
    const rawParsed = [];
    const groupAnswerPool = {};
    const globalAnswerPool = new Set();
    const seenTexts = new Set();
    const warnings = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("|").map(p => p.trim());
      if (parts.length < 3) {
        warnings.push(`Line ${i + 1} skipped: Expected Group|Question|Answer.`);
        continue;
      }
      const group = parts[0];
      const qText = parts[1];
      const answer = parts[2];
      const explanation = parts[3] || null;

      if (seenTexts.has(qText.toLowerCase())) {
        warnings.push(`Line ${i + 1}: Duplicate question skipped.`);
        continue;
      }
      seenTexts.add(qText.toLowerCase());

      if (!groupAnswerPool[group]) {
        groupAnswerPool[group] = [];
      }
      if (!groupAnswerPool[group].includes(answer)) {
        groupAnswerPool[group].push(answer);
      }
      globalAnswerPool.add(answer);

      rawParsed.push({ group, text: qText, answer, explanation });
    }

    const allAnswers = Array.from(globalAnswerPool);
    const questions = [];

    for (let i = 0; i < rawParsed.length; i++) {
      const item = rawParsed[i];
      const groupPool = (groupAnswerPool[item.group] || []).filter(a => a.toLowerCase() !== item.answer.toLowerCase());
      
      // Shuffle group pool to pick random distractors
      const shuffledGroup = shuffle(groupPool);
      const distractors = shuffledGroup.slice(0, 3);

      // If group doesn't have 3 distractors, supplement from global pool
      if (distractors.length < 3) {
        const otherPool = allAnswers.filter(a => a.toLowerCase() !== item.answer.toLowerCase() && !distractors.includes(a));
        const extra = shuffle(otherPool).slice(0, 3 - distractors.length);
        distractors.push(...extra);
      }

      // 4 Options total (shuffled)
      const options = shuffle([item.answer, ...distractors]);
      const hash = await hashAnswer(item.answer);

      questions.push({
        id: String(i + 1),
        text: item.text,
        options,
        correctAnswer: item.answer,
        answerHash: hash,
        group: item.group,
        explanation: item.explanation
      });
    }

    const withExpl = questions.filter(q => q.explanation && q.explanation.trim().length > 0).length;
    const hasExplanations = questions.length > 0 && (withExpl / questions.length) >= 0.7;

    return { 
      ok: true, 
      questions, 
      total: questions.length, 
      warnings, 
      format: "Group|Question|Answer (Auto-distractors generated)",
      hasExplanations,
      withExplanationsCount: withExpl
    };
  }

  return { ok: false, error: "Unrecognized question bank format. Please use 'Group|Question|Answer' or 'Question|OptA|OptB|OptC|OptD|Answer'." };
}
