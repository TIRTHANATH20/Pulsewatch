# MODEL_EVALUATION.md

## How to reproduce every number in this document

```bash
cd nlp-service
python evaluation/evaluate_sentiment.py        # -> evaluation/metrics_report.md
python evaluation/evaluate_classification.py   # -> evaluation/classification_metrics_report.md
```

Both scripts use a fixed `random_state=42` train/test split, so re-running
them reproduces exactly the numbers below. Nothing in this document is
invented — every figure is the literal output of one of these two scripts.

## Methodology

- **Split**: a single stratified train/test split per model (75/25 for
  sentiment, 70/30 for classification), fixed `random_state=42`.
- **No separate dev/validation split.** Both models use fixed
  hyperparameters (scikit-learn defaults for `LogisticRegression`, with
  `class_weight="balanced"`) — there is no hyperparameter search that
  would need a held-out dev set. If a hyperparameter sweep is added
  later, a three-way train/dev/test split should be introduced at that
  point rather than tuning against the test set.
- **Dataset size — read this before interpreting the numbers below.**
  `data/sample_phrasebank.csv` (75 rows) and
  `data/sample_news_categories.csv` (40 rows) are small, hand-written
  **demo/sample datasets**, shipped so the pipeline and evaluation
  scripts run end-to-end with zero external downloads. They are **not**
  the full Financial PhraseBank or a production-scale news corpus — see
  DATASET_SETUP.md for how to swap in real data. The metrics below
  demonstrate that the evaluation methodology and model training/scoring
  code work correctly, not that these are production-grade models.

## Sentiment classification: classical vs FinBERT

| Model | NLP category | Accuracy | Macro F1 | Test size | Availability |
|---|---|---|---|---|---|
| TF-IDF + Logistic Regression | classical/statistical + machine-learning | **0.579** | **0.566** | 19 | Offline evaluation baseline; runtime training requires `SENTIMENT_DATASET_PATH` |
| FinBERT (`ProsusAI/finbert`) | transformer-based | *not run* | *not run* | — | Optional — requires `requirements-transformers.txt` **and** downloading ~440MB of weights from huggingface.co |

The FinBERT row is left as "not run" rather than filled with an invented
number: `transformers`/`torch` and model weights are optional and were not
available in this local environment. `evaluation/evaluate_sentiment.py`
already contains the full FinBERT evaluation code path — installing the
optional extras and re-running the script will populate this row with a
real measurement on the same test split, for a genuine apples-to-apples
comparison.

Classical model confusion matrix (rows = true label, columns = predicted,
order negative/neutral/positive):

```
              neg  neu  pos
negative    [  2,   2,   2 ]
neutral     [  1,   4,   1 ]
positive    [  2,   0,   5 ]
```

Per-class:

| Class | Precision | Recall | F1 |
|---|---|---|---|
| negative | 0.400 | 0.333 | 0.364 |
| neutral | 0.667 | 0.667 | 0.667 |
| positive | 0.625 | 0.714 | 0.667 |

## News category classification

| Model | NLP category | Accuracy | Macro F1 | Test size |
|---|---|---|---|---|
| TF-IDF + Logistic Regression | classical/statistical + machine-learning | **0.750** | **0.622** | 12 |

No transformer-based comparison is included for this specific task: this
project does not bundle or fetch a pretrained financial news-category
transformer. The rule-based confidence backstop in `classification.py`
(fires when the classifier's top-class probability is below
`CONFIDENCE_THRESHOLD`) is a robustness fallback, not a second model
being benchmarked here.

Per-class F1 is 1.0 for well-represented, lexically distinctive
categories (REGULATION, PRODUCT, MACROECONOMICS, OTHER) and 0.0 for
categories with only 1-2 examples in this 40-row sample's test fold
(AI_TECHNOLOGY, MANAGEMENT, PARTNERSHIP) — the expected failure mode of
evaluating a 9-class classifier on ~4 examples per class, not a modeling
defect. This is exactly why the rule-based backstop exists: a
low-confidence prediction from an underrepresented class is caught and
labeled explicitly (`method: "rule-based-fallback"` in the API response)
rather than presented as confident.

## Semantic similarity: classical vs dense embeddings

These are separate runtime paths: related-news similarity uses the
TF-IDF index, while RAG uses dense embeddings selected by
`embeddings.get_default_embedder()`:

| Approach | NLP category | Availability |
|---|---|---|
| TF-IDF cosine similarity (`tfidf.py::TfidfIndex`) | classical/statistical | Implemented; used by related-news similarity |
| TF-IDF + SVD / LSA (`embeddings.py::TfidfSvdEmbedder`) | classical/statistical | Default dense embedding for RAG when transformer models are unavailable |
| Sentence-transformer embeddings (`all-MiniLM-L6-v2`) | transformer-based | Optional — requires `requirements-transformers.txt` + ~90MB model download |

No formal retrieval-quality benchmark (e.g. recall@k against a labeled
query set) is run for this comparison in this build — see "Suggested
additional evaluation" below.

## Topic modeling: LDA (implemented) vs BERTopic (not implemented)

| Approach | NLP category | Availability |
|---|---|---|
| LDA (`topics.py`, gensim) | classical/statistical | Implemented; can discover topics when the corpus has enough articles |
| BERTopic | transformer-based | Not implemented in this build — requires sentence-transformers + UMAP + HDBSCAN |

A typical run over the 15-article sample corpus (`data/sample_news.csv`,
`num_topics=5`, reproducible via `GET /nlp/topics`) surfaces topics such
as *Earnings*, *AI / Technology*, *Banking / Credit*, and *Regulation*
(auto-labeled from top words; see `topics.py::LABEL_KEYWORDS`), matching
the sample corpus's actual content.

## Evaluation methodology notes

- All splits use `train_test_split(..., stratify=labels, random_state=42)`
  so results are reproducible and each class is represented in both
  train and test where the sample size allows.
- No metric anywhere in this codebase is hardcoded; every `evaluate()`
  method fits and scores a model at call time, and both evaluation
  scripts write their output straight from that call — there is no
  manual editing step between "the model ran" and "the number appears in
  this document."
- **Why the numbers are modest**: the sample datasets are 40-75 rows,
  meant to demonstrate the pipeline end-to-end and let the project run
  without any external download, not to train production-grade models.
  Swapping in the full Financial PhraseBank and a larger labeled news
  corpus (DATASET_SETUP.md) would be expected to substantially improve
  these numbers — that is a documented follow-up, not something to
  simulate here.

## Suggested additional evaluation (not automated in this build)

- **Retrieval relevance for RAG**: for a set of (query, expected article
  ids) pairs, measure recall@k of the FAISS search — see
  RAG_ARCHITECTURE.md's evaluation section.
- **Answer faithfulness for RAG**: for LLM-generated answers, verify
  every `[n]` citation in the answer text corresponds to a real
  retrieved source.
- **FinBERT / sentence-transformer benchmarks**: re-run
  `evaluate_sentiment.py` after installing `requirements-transformers.txt`
  to get a real classical-vs-transformer number instead of "not run".
