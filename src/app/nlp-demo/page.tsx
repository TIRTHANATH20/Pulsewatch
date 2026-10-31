"use client";

import { useState } from "react";

const SAMPLE =
  "TCS announced a major partnership with Microsoft to accelerate generative AI adoption.";

export default function NlpDemoPage() {
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/nlp/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.message ?? "NLP service unavailable.");
        return;
      }
      setResult(await res.json());
    } catch {
      setError("Could not reach the NLP service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container">
      <h1 className="page-title">NLP Demo</h1>
      <p className="page-subtitle">
        Paste financial text below to see every NLP technology run live:
        preprocessing, sentiment, NER, classification, aspect sentiment, event
        extraction, keyphrases, similarity, and embedding info.
      </p>

      <form
        onSubmit={runAnalysis}
        className="card liquid-glass"
        style={{ marginBottom: 16 }}
      >
        <textarea
          className="nlp-demo-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          aria-label="Financial text to analyze"
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </form>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card liquid-glass">
            <h2 className="section-title">Preprocessing</h2>
            <p>
              <strong>Tokens:</strong> {result.preprocessing.tokens.join(", ")}
            </p>
            <p>
              <strong>Lemmas:</strong> {result.preprocessing.lemmas.join(", ")}
            </p>
            <p>
              <strong>Tokens (no stopwords):</strong>{" "}
              {result.preprocessing.tokensNoStopwords.join(", ")}
            </p>
            <p>
              <strong>Money mentions:</strong>{" "}
              {result.preprocessing.moneyMentions.join(", ") || "none"}
            </p>
            <p>
              <strong>Percent mentions:</strong>{" "}
              {result.preprocessing.percentMentions.join(", ") || "none"}
            </p>
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">Sentiment</h2>
            <p>
              <span
                className={`nlp-sentiment-badge nlp-sentiment-${result.sentiment.sentiment.toLowerCase()}`}
              >
                {result.sentiment.sentiment}
              </span>{" "}
              ({result.sentiment.modelUsed})
            </p>
            <p className="nlp-intel-muted">
              P(positive)={result.sentiment.probabilities.positive?.toFixed(3)},
              P(neutral)=
              {result.sentiment.probabilities.neutral?.toFixed(3)}, P(negative)=
              {result.sentiment.probabilities.negative?.toFixed(3)}
            </p>
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">
              Named Entities ({result.entities.engine})
            </h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {result.entities.entities.map((e: any, i: number) => (
                <span key={i} className="nlp-chip">
                  {e.text} → {e.label}
                </span>
              ))}
            </div>
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">Category</h2>
            <p>
              {result.category.category} —{" "}
              {Math.round(result.category.confidence * 100)}% (
              {result.category.method})
            </p>
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">Aspect-Based Sentiment</h2>
            {result.aspectSentiment.aspectSentiments.length === 0 && (
              <p className="nlp-intel-muted">
                No clause-level aspects detected in this text.
              </p>
            )}
            {result.aspectSentiment.aspectSentiments.map(
              (a: any, i: number) => (
                <p key={i}>
                  <strong>{a.aspect}</strong> → {a.sentiment}{" "}
                  <span className="nlp-intel-muted">({a.clause})</span>
                </p>
              ),
            )}
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">Detected Event</h2>
            {result.event.eventDetected ? (
              <div>
                <p>
                  <strong>
                    {result.event.events[0].eventType.replace(/_/g, " ")}
                  </strong>
                </p>
                <p>Actor: {result.event.events[0].actor ?? "—"}</p>
                <p>Target: {result.event.events[0].target ?? "—"}</p>
                <p>Value: {result.event.events[0].value ?? "—"}</p>
              </div>
            ) : (
              <p className="nlp-intel-muted">{result.event.note}</p>
            )}
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">Keyphrases</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {result.keyphrases.map((k: any, i: number) => (
                <span key={i} className="nlp-chip">
                  {k.phrase} ({k.score.toFixed(3)})
                </span>
              ))}
            </div>
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">Similar Articles</h2>
            {result.similarArticles.length === 0 && (
              <p className="nlp-intel-muted">No corpus loaded.</p>
            )}
            {result.similarArticles.map((s: any, i: number) => (
              <p key={i}>
                {s.docId} — similarity {s.similarity.toFixed(3)}
              </p>
            ))}
          </section>

          <section className="card liquid-glass">
            <h2 className="section-title">Embedding Info</h2>
            <p>
              Method: {result.embeddingInfo.method} · Dimension:{" "}
              {result.embeddingInfo.dimension}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
