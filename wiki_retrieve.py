import pickle
import chromadb
from sentence_transformers import SentenceTransformer

EMBED_MODEL_NAME = "BAAI/bge-small-zh-v1.5"
CHROMA_PATH = "./wiki_chroma_db"
TOP_K = 5

def retrieve(query: str):
    # 加载资源
    embed_model = SentenceTransformer(EMBED_MODEL_NAME)
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    coll = coll = client.get_collection("wiki_store")
    with open("./bm25_store.pkl", "rb") as f:
        bm_data = pickle.load(f)
    bm25 = bm_data["bm25"]

    # 1.向量检索
    q_emb = embed_model.encode(query).tolist()
    vec_res = coll.query(query_embeddings=[q_emb], n_results=TOP_K)

    # 2.BM25关键词检索
    bm_scores = bm25.get_scores(query.split())
    bm_top_idx = sorted(range(len(bm_scores)), key=lambda i: bm_scores[i], reverse=True)[:TOP_K]

    # 合并结果（简易去重）
    result_set = {}
    # 加入向量结果
    for doc, meta in zip(vec_res["documents"][0], vec_res["metadatas"][0]):
        key = meta["path"] + doc[:100]
        result_set[key] = {"text": doc, "meta": meta, "source": "vector"}
    # 加入BM25结果
    for idx in bm_top_idx:
        chunk = bm_data["chunks"][idx]
        meta = bm_data["meta"][idx]
        key = meta["path"] + chunk[:100]
        if key not in result_set:
            result_set[key] = {"text": chunk, "meta": meta, "source": "bm25"}

    return list(result_set.values())[:TOP_K]

if __name__ == "__main__":
    while True:
        q = input("\n输入检索词（q退出）：")
        if q == "q":
            break
        res = retrieve(q)
        for idx, item in enumerate(res):
            print(f"--- [{idx+1}] 来源：{item['meta']['title']} | {item['meta']['path']}")
            print(f"片段：\n{item['text'][:600]}...\n")
