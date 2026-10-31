FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Optional heavy deps (FinBERT/spaCy/sentence-transformers) are NOT
# installed by default — uncomment to bake them into the image:
# COPY requirements-transformers.txt .
# RUN pip install --no-cache-dir -r requirements-transformers.txt
# RUN python -m spacy download en_core_web_sm

COPY app ./app
COPY data ./data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
