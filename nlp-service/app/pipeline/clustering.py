"""
News clustering — groups semantically similar articles so the dashboard
doesn't show near-duplicate stories as separate events.

Uses whatever embedder `embeddings.get_default_embedder` resolves to
(TF-IDF+SVD by default in this sandbox, transformer embeddings if
installed), then Agglomerative Clustering with a cosine-distance
threshold (no need to pre-specify k, which fits "new article arrives,
figure out its cluster" better than k-means).
"""
from __future__ import annotations

from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics.pairwise import cosine_distances

from .embeddings import get_default_embedder


def cluster_articles(doc_ids: list[str], texts: list[str], distance_threshold: float = 0.8) -> dict:
    if len(texts) < 2:
        return {"clusters": [{"clusterId": 0, "docIds": doc_ids}], "method": "trivial (fewer than 2 documents)"}

    embedder, method = get_default_embedder(texts)
    vectors = embedder.embed_all(texts)
    distances = cosine_distances(vectors)

    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=distance_threshold,
        metric="precomputed",
        linkage="average",
    )
    labels = clustering.fit_predict(distances)

    clusters: dict[int, list[str]] = {}
    for doc_id, label in zip(doc_ids, labels):
        clusters.setdefault(int(label), []).append(doc_id)

    return {
        "clusters": [
            {"clusterId": cid, "docIds": members, "size": len(members)}
            for cid, members in sorted(clusters.items())
        ],
        "method": f"agglomerative clustering (cosine distance, threshold={distance_threshold}) over {method} vectors",
    }
