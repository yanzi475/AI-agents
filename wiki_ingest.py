import os
import re
import markdown
from bs4 import BeautifulSoup
from sentence_transformers import SentenceTransformer
import chromadb
from rank_bm25 import BM25Okapi

# ========== 配置区 ==========
WIKI_ROOT = r"/path/to/your/obsidian/vault"  # 你的Obsidian库目录
CHROMA_PATH = "./wiki_chroma_db"
EMBED_MODEL_NAME = "BAAI/bge-small-zh-v1.5"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
# ============================

# 清洗md：转纯文本，剔除标签、链接符号
def md_to_plain_text(md_content: str) -> str:
    html = markdown.markdown(md_content)
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text()
    # 清理多余换行空格
    text = re.sub(r"\n+", "\n", text)
    return text.strip()

# 简单分块器（按标题优先，简易实现；生产可以用langchain RecursiveCharacterTextSplitter）
def split_text(text: str, chunk_size=800, overlap=100):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start = end - overlap
    return chunks

# 遍历wiki目录，读取所有md
def load_wiki_docs(root):
    docs = []
    for root_dir, _, files in os.walk(root):
        for fname in files:
            if not fname.endswith(".md"):
                continue
            fpath = os.path.join(root_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    raw = f.read()
                plain = md_to_plain_text(raw)
                if len(plain) < 20:
                    continue
                docs.append({
                    "title": fname,
                    "path": fpath,
                    "text": plain
                })
            except Exception as e:
                print(f"skip {fpath}, err: {e}")
    return docs

if __name__ == "__main__":
    # 加载文档
    wiki_docs = load_wiki_docs(WIKI_ROOT)
    print(f"加载Wiki文档数：{len(wiki_docs)}")

    # 分块
    all_chunks = []
    chunk_meta = []
    for doc in wiki_docs:
        chunks = split_text(doc["text"], CHUNK_SIZE, CHUNK_OVERLAP)
        for c in chunks:
            all_chunks.append(c)
            chunk_meta.append({
                "title": doc["title"],
                "path": doc["path"]
            })
    print(f"总共生成块数量：{len(all_chunks)}")

    # 初始化embedding
    embed_model = SentenceTransformer(EMBED_MODEL_NAME)

    # 初始化Chroma
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    coll = client.get_or_create_collection(name="wiki_store")

    # 写入向量库
    embeddings = embed_model.encode(all_chunks)
    ids = [f"chunk_{i}" for i in range(len(all_chunks))]
    coll.add(
        documents=all_chunks,
        embeddings=embeddings.tolist(),
        metadatas=chunk_meta,
        ids=ids
    )

    # 构建BM25索引，用于混合检索
    tokenized_corpus = [c.split() for c in all_chunks]
    bm25 = BM25Okapi(tokenized_corpus)

    # 把bm25和chunk数据持久化（简单方案：pickle，生产可以存进chroma metadata）
    import pickle
    with open("./bm25_store.pkl", "wb") as f:
        pickle.dump({"bm25": bm25, "chunks": all_chunks, "meta": chunk_meta}, f)

    print("✅ Wiki入库完成，向量库+BM25索引已保存本地")
