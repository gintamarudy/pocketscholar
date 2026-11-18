// Study panel: shows the AI-generated study pack with its inference badge,
// plus the interactive flashcard + quiz study modes.
import { useMemo, useState } from 'react';
import type { InferenceSourceKind, StudyPackResult } from '../lib/types';

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The hybrid-inference badge. The source comes from the SDK's
 * `response.inferenceSource`, never from a guess — see lib/ai.ts. */
export function InferenceBadge({ source, modelName, latencyMs }: {
  source: InferenceSourceKind;
  modelName: string;
  latencyMs: number;
}) {
  const label =
    source === 'on_device'
      ? 'On-device (Gemini Nano)'
      : source === 'in_cloud'
        ? 'Cloud (Gemini)'
        : 'Local fallback (extractive)';
  const cls =
    source === 'on_device' ? 'badge badge-device' : source === 'in_cloud' ? 'badge badge-cloud' : 'badge badge-local';
  return (
    <span className={cls} title={modelName}>
      {source === 'on_device' ? '● ' : source === 'in_cloud' ? '☁ ' : '◐ '}
      {label} · {formatLatency(latencyMs)}
    </span>
  );
}

type Tab = 'summary' | 'flashcards' | 'quiz';

export default function StudyPanel({ pack }: { pack: StudyPackResult }) {
  const [tab, setTab] = useState<Tab>('summary');
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>(() =>
    pack.quiz.map(() => null),
  );

  // Reset study-mode state when a fresh pack arrives.
  const packKey = pack.generatedAt;
  const [seenKey, setSeenKey] = useState(packKey);
  if (seenKey !== packKey) {
    setSeenKey(packKey);
    setTab('summary');
    setCardIndex(0);
    setFlipped(false);
    setQuizIndex(0);
    setSelected(null);
    setAnswers(pack.quiz.map(() => null));
  }

  const score = useMemo(
    () => answers.filter((a, i) => a === pack.quiz[i]?.answerIndex).length,
    [answers, pack.quiz],
  );
  const answeredCount = answers.filter((a) => a !== null).length;
  const quizDone = answeredCount === pack.quiz.length;

  const card = pack.flashcards[cardIndex];
  const q = pack.quiz[quizIndex];

  return (
    <section className="study" aria-label="Study pack">
      <div className="study-head">
        <h2>Study pack</h2>
        <InferenceBadge source={pack.source} modelName={pack.modelName} latencyMs={pack.latencyMs} />
      </div>
      <p className="route-note" title={pack.routedReason}>
        {pack.routedReason}
      </p>

      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>
          Summary
        </button>
        <button role="tab" className={tab === 'flashcards' ? 'active' : ''} onClick={() => setTab('flashcards')}>
          Flashcards ({pack.flashcards.length})
        </button>
        <button role="tab" className={tab === 'quiz' ? 'active' : ''} onClick={() => setTab('quiz')}>
          Quiz ({pack.quiz.length}){quizDone ? ` · ${score}/${pack.quiz.length}` : ''}
        </button>
      </div>

      {tab === 'summary' && (
        <div className="tab-body">
          <p className="summary-text">{pack.summary}</p>
          <h3>Key points</h3>
          <ul className="keypoints">
            {pack.keyPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'flashcards' && card && (
        <div className="tab-body">
          <div
            className={`flashcard ${flipped ? 'flipped' : ''}`}
            onClick={() => setFlipped(!flipped)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setFlipped(!flipped);
            }}
            aria-label="Flashcard — click to flip"
          >
            <div className="flashcard-inner">
              <div className="flashcard-face flashcard-front">
                <span className="flashcard-tag">Question</span>
                <p>{card.question}</p>
                <span className="flashcard-hint">Click to reveal the answer</span>
              </div>
              <div className="flashcard-face flashcard-back">
                <span className="flashcard-tag">Answer</span>
                <p>{card.answer}</p>
                <span className="flashcard-hint">Click to flip back</span>
              </div>
            </div>
          </div>
          <div className="pager">
            <button
              disabled={cardIndex === 0}
              onClick={() => {
                setCardIndex(cardIndex - 1);
                setFlipped(false);
              }}
            >
              ← Previous
            </button>
            <span>
              {cardIndex + 1} / {pack.flashcards.length}
            </span>
            <button
              disabled={cardIndex === pack.flashcards.length - 1}
              onClick={() => {
                setCardIndex(cardIndex + 1);
                setFlipped(false);
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {tab === 'quiz' && q && (
        <div className="tab-body">
          {quizDone ? (
            <div className="quiz-result">
              <h3>
                Score: {score} / {pack.quiz.length}
              </h3>
              <p>
                {score === pack.quiz.length
                  ? 'Perfect — you have mastered this note.'
                  : score >= Math.ceil(pack.quiz.length * 0.6)
                    ? 'Good work — review the ones you missed and try again.'
                    : 'Keep studying — flip through the flashcards, then retake the quiz.'}
              </p>
              <button
                onClick={() => {
                  setAnswers(pack.quiz.map(() => null));
                  setQuizIndex(0);
                  setSelected(null);
                }}
              >
                Retake quiz
              </button>
            </div>
          ) : (
            <>
              <p className="quiz-progress">
                Question {quizIndex + 1} of {pack.quiz.length} · Score so far: {score}
              </p>
              <p className="quiz-question">{q.question}</p>
              <div className="quiz-options">
                {q.options.map((opt, i) => {
                  const isCorrect = i === q.answerIndex;
                  const isChosen = selected === i;
                  const cls = selected === null
                    ? ''
                    : isCorrect
                      ? 'correct'
                      : isChosen
                        ? 'wrong'
                        : 'dimmed';
                  return (
                    <button
                      key={i}
                      className={`quiz-option ${cls}`}
                      disabled={selected !== null}
                      onClick={() => setSelected(i)}
                    >
                      <span className="quiz-letter">{'ABCD'[i]}</span> {opt}
                    </button>
                  );
                })}
              </div>
              {selected !== null && (
                <div className="quiz-feedback">
                  <p>
                    {selected === q.answerIndex
                      ? 'Correct!'
                      : `Not quite — the correct answer is: ${q.options[q.answerIndex]}`}
                  </p>
                  <button
                    onClick={() => {
                      const next = [...answers];
                      next[quizIndex] = selected;
                      setAnswers(next);
                      setSelected(null);
                      if (quizIndex < pack.quiz.length - 1) setQuizIndex(quizIndex + 1);
                    }}
                  >
                    {quizIndex < pack.quiz.length - 1 ? 'Next question →' : 'See my score'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
