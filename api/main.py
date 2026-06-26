"""
月球基地 v2 后端（Vercel Serverless Function）
- 无状态：不保存会话，每次请求都依赖前端传过来的完整 state。
- 路由：/api/agent（开放式追问）、/api/summary（可行性简报）、
        /api/compare（多基地对比）、/api/story（基地一日叙事）、
        /api/poster（招募海报）、/api/suggest（下一步建议）。
"""

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# 本地开发时从 .env.local 加载环境变量；Vercel 上由平台注入，此调用无影响。
load_dotenv(".env.local")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Moon Base Agent API", version="2.0.0")

# 允许本地开发与 Vercel 同源调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DeepSeek 通过 openai 库调用
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
MODEL = "deepseek-chat"

if DEEPSEEK_API_KEY:
    from openai import OpenAI

    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
else:
    client = None


class AgentRequest(BaseModel):
    state: dict[str, Any]
    question: str


class SummaryRequest(BaseModel):
    state: dict[str, Any]
    history: list[dict[str, Any]]


class CompareRequest(BaseModel):
    states: list[dict[str, Any]]


class SimpleStateRequest(BaseModel):
    state: dict[str, Any]


REFERENCE_DIR = Path(__file__).parent.parent / "ReferenceMaterials" / "KimiMoonBase" / "facts"


def load_facts(filename: str) -> list[dict[str, Any]]:
    """从 ReferenceMaterials 加载 JSON 事实数据；文件缺失时返回空列表。"""
    path = REFERENCE_DIR / filename
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def format_fact(fact: dict[str, Any]) -> str:
    """将单条 fact 格式化为可读的引用文本。"""
    claim = fact.get("claim", "")
    value = fact.get("value")
    unit = fact.get("unit", "")
    source = fact.get("source", "")
    note = fact.get("note", "")
    parts = [claim]
    if value is not None:
        parts.append(f"{value} {unit}".strip())
    if source:
        parts.append(f"来源：{source}")
    if note:
        parts.append(f"备注：{note}")
    return "；".join(p for p in parts if p)


def collect_reference_snippets(state: dict[str, Any]) -> str:
    """根据当前选址与决策，动态抽取相关 ReferenceMaterials 片段（RAG-light）。"""
    site = state.get("site", "")
    decisions = {k: state.get(k) for k in ["energy", "water", "radiation", "communication", "habitat", "transport"]}

    snippets: list[str] = []

    def add_facts(facts: list[dict[str, Any]], predicate, limit: int):
        count = 0
        for fact in facts:
            if predicate(fact):
                snippets.append(format_fact(fact))
                count += 1
                if count >= limit:
                    break

    # 站点相关：按 site id 与 topic 中的站点名匹配
    site_map = {
        "shackleton": "shackleton",
        "connecting_ridge": "connecting_ridge",
        "cabeus": "cabeus",
        "marius_lava_tube": "marius",
        "tranquility": "tranquility",
        "imbrium": "imbrium",
        "tycho": "tycho",
        "malapert": "malapert",
        "de_gerlache": "de_gerlache",
    }
    site_key = site_map.get(site, site)
    if site_key:
        add_facts(
            load_facts("site_selection.json"),
            lambda f: site_key in f.get("topic", ""),
            8,
        )

    # 能源决策相关
    energy = decisions.get("energy")
    if energy:
        if energy == "nuclear":
            add_facts(load_facts("energy.json"), lambda f: "nuclear" in f.get("topic", ""), 5)
        elif energy in ("solar", "storage"):
            add_facts(
                load_facts("energy.json"),
                lambda f: any(k in f.get("topic", "") for k in ("solar", "storage", "battery", "fuel_cell")),
                5,
            )

    # 水源决策相关
    water = decisions.get("water")
    if water:
        if water == "isru":
            add_facts(
                load_facts("water_life_support.json"),
                lambda f: any(k in f.get("topic", "") for k in ("water", "regolith", "extract", "lcross", "lamp")),
                5,
            )
        elif water == "recycle":
            add_facts(
                load_facts("water_life_support.json"),
                lambda f: any(k in f.get("topic", "") for k in ("eclss", "recycle", "life_support")),
                5,
            )
        elif water == "earth":
            add_facts(
                load_facts("water_life_support.json"),
                lambda f: any(k in f.get("topic", "") for k in ("supply", "earth")),
                5,
            )

    # 辐射决策相关
    radiation = decisions.get("radiation")
    if radiation:
        if radiation == "regolith":
            add_facts(load_facts("radiation_protection.json"), lambda f: "shielding" in f.get("topic", ""), 5)
        elif radiation == "cave":
            add_facts(
                load_facts("radiation_protection.json"),
                lambda f: any(k in f.get("topic", "") for k in ("lava", "tube", "cave", "shielding")),
                5,
            )
        elif radiation == "hull":
            add_facts(
                load_facts("radiation_protection.json"),
                lambda f: any(k in f.get("topic", "") for k in ("multilayer", "storm", "shielding", "SPE")),
                5,
            )

    # 限制总条数，避免 prompt 过长
    snippets = snippets[:20]
    if not snippets:
        return ""
    return "\n\n参考数据（来自项目 ReferenceMaterials）：\n" + "\n".join(f"- {s}" for s in snippets)


DOMAIN_KNOWLEDGE = """你是月球基地领域的专家顾问，熟悉月球候选基地的真实工程参数（数据来自 NASA、CNSA、ESA、JAXA 等机构及同行评审文献）：

1. 沙克尔顿环形山（Shackleton，89.67°S, 129.78°E）
- 坑缘平均光照率 85.5%，最高可达 92.55%，最长连续阴影约 65 小时。
- 坑底 PSR 面积 ~223 km²，表面霜约 2.0%，Mini-RF 暗示上部 1-2 m 含冰 5-10 wt%，但 LEND 仅测得 ~0.7 wt%，水冰信号存在显著不确定性。
- 坑底 doubly-shadowed 温度可低至 18-40 K，是太阳系最冷环境之一。
- 主要挑战：极端低温、坑壁坡度大（内壁 >30°）、地形崎岖。

2. 连接岭 C1-0（Connecting Ridge，南极）
- 当前月球南极综合最优选址：2 m 高度平均光照率 88%，最长连续阴影仅 112 小时。
- 高光照区约 135,200 m²，距离最近 PSR 仅 100 m，坡度普遍 <10°。
- 太阳能阵列与水冰提取区可步行共存，是 NASA Artemis 与 ILRS 长期规划的高优先级区域。

3. 卡比厄斯撞击坑（Cabeus，85.3°S, 41.8°W）
- 2009 年 LCROSS 撞击实验直接测得羽流含水量 5.6±2.9 wt%，是月球水冰原位确认置信度最高的地点。
- 总水冰储量估算约 1.63 亿吨，PSR 面积 743 km²。
- 位于永久阴影区内，无日照，必须依赖核电源或远程输电；温度极低。

4. 马里乌斯丘陵熔岩管（Marius Hills，14.3°N, 303.5°E）
- 天窗直径约 58 m，GRAIL 估计下方存在长 60 km、宽 9 km 的空腔。
- 水平熔岩管内部 GCR 年剂量可 <1 mSv/年（低于地球背景），温度稳定约 -20°C。
- 水冰稀缺，非极区；结构稳定性与原位验证是主要风险。

5. 静海（Tranquility，0.7°N, 23.5°E）
- 阿波罗 11 号登月点，日照充沛、地形平缓，历史与科普价值高。
- 水冰极度稀缺，长期居住必须依赖循环水回收或昂贵地球补给。

6. 雨海（Imbrium，32.8°N, -15.6°E）
- 玄武岩富含钛铁矿与氦-3，是月球工业化首选。
- 月夜较长，工业用电需求大。

7. 第谷（Tycho，43.3°S, -11.2°E）
- 高海拔、地质年轻，天文观测条件优异；地形复杂、基建成本高。

关键工程数据：
- 月面未屏蔽 GCR 年剂量：330-380 mSv（太阳极小），NASA 职业上限 600 mSv。
- 3 m 月壤可降至 ~50 mSv/年；7 m 月壤 ~5 mSv/年；水平熔岩管 <1 mSv/年。
- NASA FSP：40 kWe / ~6 t / 10 年；核裂变质量效率约为太阳能+储能的 2 倍以上。
- 太阳能+RFC：40 kWe 连续功率约需 14.5 t 储能（按 550 Wh/kg 目标）。
- 水冰热升华提取：约 2.4 kWh/kg；月壤含氧约 42-45%。
- ISS ECLSS 水回收率约 93%，中国空间站约 95%。

用户正在做一个交互式沙盘，会依次做六个决策：
1. 能源：微型核反应堆（FSP 40 kWe）、太阳能+再生燃料电池、薄膜太阳能阵列。
2. 水源：就地采水冰（ISRU）、地球补给、循环水回收（ECLSS）。
3. 辐射防护：埋入 2-3 m 月壤、利用熔岩洞/永久阴影坑缘、加厚舱壁+风暴掩体。
4. 通信网络：激光通信、中继卫星、直联地球。
5. 生命维持与食品：全封闭农场、地球补给食品、藻类蛋白管。
6. 交通运输：月面跳跃器、质量投射器、地表缆车。

你的回答要基于当前 state 里用户已经选择的配置，解释"如果这样选会怎样"，用中文作答，控制在 400 字以内，语气专业但易懂。如果用户询问不同基地，要针对具体基地特点分析。每次给出具体数字时，要尽量标注数据来源或研究名称，让用户知道信息不是编造的。"""

SUMMARY_PROMPT = """你是一名月球基地可行性评估专家。请根据用户当前的基地配置，生成一份简洁的「基地可行性简报」。

要求：
- 用中文，分「配置摘要」「关键指标」「优势」「风险」「总体结论」几个小节。
- 基于用户选择的选址和六个决策展开，不要编造 state 里没有的选项。
- 给出明确、可执行的评估，控制在 800 字以内。
- 如果能源结余为负、辐射剂量过高或水源不足，要在风险里重点指出。
- 引用具体数据时标注来源或研究名称。"""

COMPARE_PROMPT = """你是一名月球基地选址顾问。用户已经给出了 2-4 个不同基地的配置与推演指标，请生成一份「多基地对比报告」。

要求：
- 用中文，分「总体推荐」「各基地亮点」「横向对比」「建议」几个小节。
- 基于每个基地的选址特点和所选配置，不要编造数据。
- 控制在 1000 字以内，语气专业。
- 最后给出一个明确的推荐选址及理由。
- 引用具体数据时标注来源或研究名称。"""

STORY_PROMPT = """你是一名科幻作家兼月球基地顾问。请根据用户当前的基地配置，创作一段 300-500 字的「基地一日」叙事片段。

要求：
- 用中文，以第一人称或第三人称描写基地中普通居民 / 工程师 / 科学家的一天。
- 融入用户选择的能源、水源、辐射防护、通信、食品、交通等技术细节，让选择产生代入感。
- 风格真实、克制、富有月球环境氛围（寂静、灰色荒原、长月夜、低重力等）。
- 不要编造 state 里没有的选项。"""

POSTER_PROMPT = """你是一名月球基地宣传文案专家。请根据用户当前的基地配置，生成一段「招募海报文案」。

要求：
- 用中文，包含一句响亮的口号、一段 150 字以内的招募正文、以及 3-5 个核心卖点（每条 10 字以内）。
- 文案风格要有未来感、使命感和月球特色。
- 融入用户选择的基地特点与配置亮点，不要编造数据。"""

SUGGEST_PROMPT = """你是一名月球基地设计顾问。用户当前尚未完成全部决策，请根据已选配置，给出下一步决策建议。

要求：
- 用中文，控制在 250 字以内。
- 指出当前配置的短板（能源、辐射、水源、通信、食品、交通任一）。
- 明确推荐下一个应该选择哪个选项，并给出理由。
- 不要编造 state 里没有的选项。"""


def build_state_context(state: dict[str, Any]) -> str:
    lines = ["当前基地配置："]
    site = state.get("site")
    lines.append(f"- 选址：{site or '未选择'}")
    for key in ["energy", "water", "radiation", "communication", "habitat", "transport"]:
        val = state.get(key)
        lines.append(f"- {key}：{val or '未选择'}")

    # 动态注入 ReferenceMaterials 中与当前配置相关的真实数据片段
    ref_snippets = collect_reference_snippets(state)
    if ref_snippets:
        lines.append(ref_snippets)

    metrics = state.get("metrics")
    if metrics:
        lines.append("\n前端推演指标：")
        lines.append(f"- 能源结余：{metrics.get('powerSurplus_kW')} kW")
        lines.append(f"- 总部署质量：{metrics.get('totalMass_t')} t")
        lines.append(f"- 年供水量：{metrics.get('waterSupply_t_y')} t")
        lines.append(f"- 年辐射剂量：{metrics.get('radiation_mSv_y')} mSv")
        lines.append(f"- 综合风险：{metrics.get('riskScore')}/18")
        lines.append(f"- 可持续性：{metrics.get('sustainability')}/30")
        lines.append(f"- 通信评分：{metrics.get('commScore')}/95")
        lines.append(f"- 食品自给率：{metrics.get('foodSelfSufficiency')}%")
        lines.append(f"- 运输能力：{metrics.get('transportCapacity')}/95")
        lines.append(f"- 综合可行性：{metrics.get('viabilityScore')}/100")
    return "\n".join(lines)


def chat_completion(messages: list[dict[str, str]], max_tokens: int = 900) -> str:
    if not client:
        raise RuntimeError("DEEPSEEK_API_KEY 未配置，无法调用模型")

    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=max_tokens,
        )
        return resp.choices[0].message.content or ""
    except Exception as exc:
        raise RuntimeError(f"模型调用失败：{exc}") from exc


def demo_placeholder(action_name: str, extra: str = "") -> str:
    return (
        f"## （演示模式）{action_name}\n\n"
        "当前后端未配置 DEEPSEEK_API_KEY，因此返回占位文本。\n\n"
        f"{extra}\n\n"
        "部署到 Vercel 并在后台填入 API key 后，这里将返回 AI 生成的专业内容。"
    )


@app.get("/api/health")
def health():
    return {"ok": True, "model_available": client is not None, "version": "2.0.0"}


@app.post("/api/agent")
def agent(req: AgentRequest):
    """开放式追问：基于当前 state 回答用户的自由提问。"""
    try:
        if not client:
            return {
                "answer": (
                    "（演示模式）当前后端未配置 DEEPSEEK_API_KEY，无法调用真实模型。\n\n"
                    "你问的是：" + req.question[:200] + "\n\n"
                    "部署到 Vercel 并在后台填入 API key 后，这里将返回 AI 的专业回答。"
                )
            }

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": req.question},
        ]
        answer = chat_completion(messages, max_tokens=800)
        return {"answer": answer}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/summary")
def summary(req: SummaryRequest):
    """收尾产出：生成基于当前配置的可行性简报。"""
    try:
        if not client:
            return {"result": demo_placeholder("基地可行性简报")}

        history_text = "\n".join(
            f"- {h.get('step')}: {h.get('label')}"
            for h in (req.history or [])
        )

        messages = [
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "system", "content": f"用户选择历史：\n{history_text or '（无）'}"},
            {"role": "user", "content": "请生成基地可行性简报。"},
        ]
        result = chat_completion(messages, max_tokens=1000)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/compare")
def compare(req: CompareRequest):
    """多基地对比：基于多个 state 生成对比报告。"""
    try:
        if not client:
            return {"result": demo_placeholder("多基地对比报告", "前端会收集各基地配置并传入；接入模型后将生成专业对比。")}

        contexts = []
        for idx, st in enumerate(req.states or [], 1):
            contexts.append(f"=== 基地 {idx} ===\n{build_state_context(st)}")

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": COMPARE_PROMPT},
            {"role": "user", "content": "请根据以下配置生成多基地对比报告。\n\n" + "\n\n".join(contexts)},
        ]
        result = chat_completion(messages, max_tokens=1200)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/story")
def story(req: SimpleStateRequest):
    """创意产出：生成基地一日叙事片段。"""
    try:
        if not client:
            return {"result": demo_placeholder("基地一日叙事片段", "基于你的配置，AI 将创作一段有代入感的月球生活故事。")}

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": STORY_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": "请创作一段基地一日叙事。"},
        ]
        result = chat_completion(messages, max_tokens=900)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/poster")
def poster(req: SimpleStateRequest):
    """营销产出：生成招募海报文案。"""
    try:
        if not client:
            return {"result": demo_placeholder("招募海报文案", "AI 将基于你的基地配置生成宣传口号与卖点。")}

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": POSTER_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": "请生成招募海报文案。"},
        ]
        result = chat_completion(messages, max_tokens=700)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/suggest")
def suggest(req: SimpleStateRequest):
    """决策辅助：根据当前未完成状态建议下一步。"""
    try:
        if not client:
            return {"result": demo_placeholder("下一步决策建议", "AI 会根据你当前的短板推荐下一个最优选择。")}

        messages = [
            {"role": "system", "content": DOMAIN_KNOWLEDGE},
            {"role": "system", "content": SUGGEST_PROMPT},
            {"role": "system", "content": build_state_context(req.state)},
            {"role": "user", "content": "请给出下一步决策建议。"},
        ]
        result = chat_completion(messages, max_tokens=500)
        return {"result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# 本地开发时让 FastAPI 同时托管前端静态文件，访问 http://localhost:8000 即可。
# Vercel 部署后仍由 Vercel 静态托管处理根目录，不会走到这里。
app.mount(
    "/",
    StaticFiles(directory=Path(__file__).parent.parent, html=True),
    name="static",
)
